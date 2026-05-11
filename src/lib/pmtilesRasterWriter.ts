import { gzipSync } from 'fflate';
import type { Entry } from 'pmtiles';
import { Compression, TileType } from 'pmtiles';

const HEADER_BYTES = 127;
const MAX_ROOT_COMPRESSED = 16257;
const LEAF_CHUNK_TARGET = 14_000;

/** Append protobuf-style unsigned varint (little-endian 7-bit groups). */
export function appendVarint(parts: number[], n: number) {
  let v = n;
  if (v < 0 || !Number.isFinite(v)) throw new Error('varint: invalid');
  while (v >= 0x80) {
    parts.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  parts.push(v);
}

/** Encode a PMTiles v3 directory (uncompressed wire format). */
export function encodeDirectory(entries: Entry[]): Uint8Array {
  if (entries.length === 0) throw new Error('PMTiles directory: empty');
  const sorted = [...entries].sort((a, b) => a.tileId - b.tileId);
  const buf: number[] = [];
  appendVarint(buf, sorted.length);

  let lastId = 0;
  for (const e of sorted) {
    appendVarint(buf, e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of sorted) {
    appendVarint(buf, e.runLength);
  }
  for (const e of sorted) {
    appendVarint(buf, e.length);
  }
  let nextByte = 0;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (i > 0 && e.offset === nextByte) {
      appendVarint(buf, 0);
    } else {
      appendVarint(buf, e.offset + 1);
    }
    nextByte = e.offset + e.length;
  }
  return new Uint8Array(buf);
}

function setUint64(dv: DataView, offset: number, value: number) {
  const lo = value >>> 0;
  const hi = Math.floor(value / 2 ** 32) >>> 0;
  dv.setUint32(offset, lo, true);
  dv.setUint32(offset + 4, hi, true);
}

function lonLatToPositionInt(lon: number, lat: number): [number, number] {
  return [Math.round(lon * 10_000_000), Math.round(lat * 10_000_000)];
}

export interface RasterTileBlob {
  tileId: number;
  data: Uint8Array;
}

export interface BuildRasterPmtilesOptions {
  tiles: RasterTileBlob[];
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  /** PNG or JPEG tile payloads (stored uncompressed in archive). */
  tileType: TileType;
  name?: string;
  attribution?: string;
}

/**
 * Build a clustered PMTiles v3 raster archive (gzip internal dirs, raw tiles).
 * Splits into leaf directories when the tile entry list does not fit in one gzip blob under spec limits.
 */
export function buildRasterPmtilesBlob(opts: BuildRasterPmtilesOptions): Blob {
  const { tiles, minZoom, maxZoom, minLon, minLat, maxLon, maxLat, tileType } = opts;
  if (tiles.length === 0) throw new Error('Nu exista tile-uri descarcate');

  const sorted = [...tiles].sort((a, b) => a.tileId - b.tileId);
  let tileDataLen = 0;
  for (const t of sorted) tileDataLen += t.data.byteLength;

  const tileData = new Uint8Array(tileDataLen);
  let tileEntries: Entry[] = [];
  let off = 0;
  for (const t of sorted) {
    const len = t.data.byteLength;
    tileEntries.push({ tileId: t.tileId, offset: off, length: len, runLength: 1 });
    tileData.set(t.data, off);
    off += len;
  }

  const internalCompression = Compression.Gzip;
  const tileCompression = Compression.None;
  const clustered = 1;

  const metaObj: Record<string, string> = {
    name: opts.name ?? 'Handi offline',
    type: 'baselayer',
    version: '1.0.0',
    description: 'Regional raster pack generated in Handi',
  };
  if (opts.attribution) metaObj.attribution = opts.attribution;
  const metaJson = new TextEncoder().encode(JSON.stringify(metaObj));
  const metaCompressed = gzipSync(metaJson, { level: 6 });

  const rootTry = gzipSync(encodeDirectory(tileEntries), { level: 6 });

  let rootCompressed: Uint8Array;
  let leafSection: Uint8Array;

  if (rootTry.byteLength <= MAX_ROOT_COMPRESSED) {
    leafSection = new Uint8Array(0);
    rootCompressed = rootTry;
  } else {
    const leafChunks: Entry[][] = [];
    let cur: Entry[] = [];
    for (const e of tileEntries) {
      const tryChunk = [...cur, e];
      const tryEnc = gzipSync(encodeDirectory(tryChunk), { level: 6 });
      if (tryEnc.byteLength > LEAF_CHUNK_TARGET && cur.length > 0) {
        leafChunks.push(cur);
        cur = [e];
      } else {
        cur = tryChunk;
      }
    }
    if (cur.length) leafChunks.push(cur);

    const leafBodies = leafChunks.map((chunk) => gzipSync(encodeDirectory(chunk), { level: 6 }));
    let leafOff = 0;
    const rootEntries = leafChunks.map((chunk, i) => {
      const body = leafBodies[i];
      const ent: Entry = {
        tileId: chunk[0].tileId,
        offset: leafOff,
        length: body.byteLength,
        runLength: 0,
      };
      leafOff += body.byteLength;
      return ent;
    });
    leafSection = new Uint8Array(leafOff);
    leafOff = 0;
    for (const b of leafBodies) {
      leafSection.set(b, leafOff);
      leafOff += b.byteLength;
    }
    rootCompressed = gzipSync(encodeDirectory(rootEntries), { level: 6 });
  }

  if (rootCompressed.byteLength > MAX_ROOT_COMPRESSED) {
    throw new Error('Arhiva e prea complexa (prea multe tile-uri). Micsoreaza zoom-ul sau zona.');
  }

  const rootDirectoryOffset = HEADER_BYTES;
  const jsonMetadataOffset = rootDirectoryOffset + rootCompressed.byteLength;
  const leafDirectoryOffset = jsonMetadataOffset + metaCompressed.byteLength;
  const tileDataOffset = leafDirectoryOffset + leafSection.byteLength;

  const totalLen =
    HEADER_BYTES +
    rootCompressed.byteLength +
    metaCompressed.byteLength +
    leafSection.byteLength +
    tileData.byteLength;

  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);

  const magic = new TextEncoder().encode('PMTiles');
  out.set(magic, 0);
  out[7] = 3;
  setUint64(dv, 8, rootDirectoryOffset);
  setUint64(dv, 16, rootCompressed.byteLength);
  setUint64(dv, 24, jsonMetadataOffset);
  setUint64(dv, 32, metaCompressed.byteLength);
  setUint64(dv, 40, leafDirectoryOffset);
  setUint64(dv, 48, leafSection.byteLength);
  setUint64(dv, 56, tileDataOffset);
  setUint64(dv, 64, tileData.byteLength);
  setUint64(dv, 72, sorted.length);
  setUint64(dv, 80, sorted.length);
  setUint64(dv, 88, sorted.length);
  out[96] = clustered;
  out[97] = internalCompression;
  out[98] = tileCompression;
  out[99] = tileType;
  out[100] = minZoom;
  out[101] = maxZoom;

  const [minLonI, minLatI] = lonLatToPositionInt(minLon, minLat);
  const [maxLonI, maxLatI] = lonLatToPositionInt(maxLon, maxLat);
  dv.setInt32(102, minLonI, true);
  dv.setInt32(106, minLatI, true);
  dv.setInt32(110, maxLonI, true);
  dv.setInt32(114, maxLatI, true);

  const cz = Math.min(maxZoom, Math.max(minZoom, Math.round((minZoom + maxZoom) / 2)));
  out[118] = cz;
  const cLon = (minLon + maxLon) / 2;
  const cLat = (minLat + maxLat) / 2;
  dv.setInt32(119, Math.round(cLon * 10_000_000), true);
  dv.setInt32(123, Math.round(cLat * 10_000_000), true);

  let p = rootDirectoryOffset;
  out.set(rootCompressed, p);
  p += rootCompressed.byteLength;
  out.set(metaCompressed, p);
  p += metaCompressed.byteLength;
  if (leafSection.byteLength) out.set(leafSection, p);
  p += leafSection.byteLength;
  out.set(tileData, p);

  return new Blob([out], { type: 'application/vnd.pmtiles' });
}

export function sniffRasterTileType(bytes: Uint8Array): TileType {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return TileType.Png;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return TileType.Jpeg;
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return TileType.Webp;
  }
  return TileType.Unknown;
}
