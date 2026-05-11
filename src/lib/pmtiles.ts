import maplibregl from 'maplibre-gl';
import { Protocol, PMTiles } from 'pmtiles';
import { db, type PMTilesArchive } from './db/dexie';
import type { BaseMapDef } from '@/map/layers/BaseLayers';

let registered = false;
const protocol = new Protocol({ metadata: true });
const blobUrlByKey = new Map<string, string>();

export function ensurePMTilesProtocol() {
  if (registered) return;
  maplibregl.addProtocol('pmtiles', protocol.tile);
  registered = true;
}

interface PMTilesHeaderLite {
  bounds: [number, number, number, number] | null;
  minzoom: number | null;
  maxzoom: number | null;
}

export async function readArchiveMetadata(blob: Blob): Promise<PMTilesHeaderLite> {
  const tempUrl = URL.createObjectURL(blob);
  try {
    const arch = new PMTiles(tempUrl);
    const h = await arch.getHeader();
    return {
      bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
      minzoom: h.minZoom,
      maxzoom: h.maxZoom,
    };
  } finally {
    setTimeout(() => URL.revokeObjectURL(tempUrl), 30_000);
  }
}

export async function saveLocalArchive(file: File): Promise<PMTilesArchive> {
  const blob = await file.arrayBuffer().then((b) => new Blob([b]));
  const meta = await readArchiveMetadata(blob);
  const key = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const archive: PMTilesArchive = {
    key,
    name: file.name.replace(/\.pmtiles$/i, ''),
    blob,
    size: blob.size,
    bounds: meta.bounds,
    minzoom: meta.minzoom,
    maxzoom: meta.maxzoom,
    addedAt: Date.now(),
    kind: 'basemap',
  };
  await db.pmtiles.put(archive);
  return archive;
}

export async function listLocalArchives(): Promise<PMTilesArchive[]> {
  const all = await db.pmtiles.orderBy('addedAt').reverse().toArray();
  // Back-compat: older entries might have kind missing; treat as basemap.
  return all.filter((a) => a.kind !== 'raster');
}

export async function listRasterArchives(): Promise<PMTilesArchive[]> {
  return db.pmtiles.where('kind').equals('raster').reverse().sortBy('addedAt');
}

export async function getRasterArchiveByRasterId(rasterId: string): Promise<PMTilesArchive | undefined> {
  return db.pmtiles.where('rasterId').equals(rasterId).first();
}

export async function deleteLocalArchive(key: string): Promise<void> {
  const url = blobUrlByKey.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlByKey.delete(key);
  }
  await db.pmtiles.delete(key);
}

export function archiveBlobUrl(arch: PMTilesArchive): string {
  let url = blobUrlByKey.get(arch.key);
  if (!url) {
    url = URL.createObjectURL(arch.blob);
    blobUrlByKey.set(arch.key, url);
  }
  return url;
}

async function readResponseToBlob(
  res: Response,
  onProgress?: (p: { loaded: number; total?: number }) => void,
): Promise<Blob> {
  const total = Number(res.headers.get('content-length') ?? '');
  const body = res.body;
  if (!body) {
    const buf = await res.arrayBuffer();
    onProgress?.({ loaded: buf.byteLength, total: Number.isFinite(total) ? total : undefined });
    return new Blob([buf]);
  }
  const reader = body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(new Uint8Array(r.value.buffer.slice(0)));
    loaded += r.value.byteLength;
    onProgress?.({ loaded, total: Number.isFinite(total) ? total : undefined });
  }
  return new Blob(chunks, { type: 'application/octet-stream' });
}

export async function saveRemoteRasterArchive(args: {
  rasterId: string;
  name: string;
  url: string;
  onProgress?: (p: { loaded: number; total?: number }) => void;
}): Promise<PMTilesArchive> {
  const res = await fetch(args.url, { method: 'GET' });
  if (!res.ok) throw new Error(`Download PMTiles failed (${res.status})`);
  const blob = await readResponseToBlob(res, args.onProgress);
  const meta = await readArchiveMetadata(blob);
  const key = `raster-${args.rasterId}`;
  const archive: PMTilesArchive = {
    key,
    name: args.name,
    blob,
    size: blob.size,
    bounds: meta.bounds,
    minzoom: meta.minzoom,
    maxzoom: meta.maxzoom,
    addedAt: Date.now(),
    kind: 'raster',
    remoteUrl: args.url,
    rasterId: args.rasterId,
  };
  await db.pmtiles.put(archive);
  return archive;
}

export async function deleteRasterArchive(rasterId: string): Promise<void> {
  const arch = await getRasterArchiveByRasterId(rasterId);
  if (!arch) return;
  await deleteLocalArchive(arch.key);
}

export async function buildRasterUrlOverrides(): Promise<Record<string, string>> {
  const ras = await db.pmtiles.where('kind').equals('raster').toArray();
  const out: Record<string, string> = {};
  for (const a of ras) {
    if (a.rasterId) out[a.rasterId] = archiveBlobUrl(a);
  }
  return out;
}

export async function buildBaseMapsFromArchives(): Promise<BaseMapDef[]> {
  const archs = await listLocalArchives();
  return archs.map((a) => archiveToBaseMap(a));
}

function archiveToBaseMap(a: PMTilesArchive): BaseMapDef {
  const url = archiveBlobUrl(a);
  return {
    id: `pmtiles-${a.key}`,
    label: `Offline: ${a.name}`,
    description: `${(a.size / 1024 / 1024).toFixed(0)} MB - PMTiles local (zoom ${a.minzoom ?? '?'}-${a.maxzoom ?? '?'})`,
    attribution: '© OpenStreetMap contributors / PMTiles',
    tileUrls: [],
    maxzoom: a.maxzoom ?? 14,
    pmtiles: true,
    pmtilesUrl: url,
  };
}

/** Salveaza un PMTiles generat in-app (ex. pachet offline) ca basemap local. */
export async function saveGeneratedBasemapBlob(blob: Blob, name: string): Promise<BaseMapDef> {
  const meta = await readArchiveMetadata(blob);
  const key = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const archive: PMTilesArchive = {
    key,
    name,
    blob,
    size: blob.size,
    bounds: meta.bounds,
    minzoom: meta.minzoom,
    maxzoom: meta.maxzoom,
    addedAt: Date.now(),
    kind: 'basemap',
  };
  await db.pmtiles.put(archive);
  return archiveToBaseMap(archive);
}
