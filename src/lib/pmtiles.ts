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
  try {
    await db.pmtiles.put(archive);
  } catch (e) {
    const name = e instanceof DOMException ? e.name : (e as Error)?.name;
    if (name === 'QuotaExceededError') {
      throw new Error(
        'Spatiu IndexedDB insuficient. Sterge alte harti offline sau micsoreaza fisierul.',
        { cause: e },
      );
    }
    throw e;
  }
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
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? ' Verifica ca bucket-ul Supabase „raster-overlays” e public sau foloseste un URL semnat in metadata.'
        : '';
    throw new Error(`Download PMTiles failed (${res.status}).${hint}`);
  }
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
  try {
    await db.pmtiles.put(archive);
  } catch (e) {
    const name = e instanceof DOMException ? e.name : (e as Error)?.name;
    if (name === 'QuotaExceededError') {
      throw new Error(
        'Spatiu IndexedDB insuficient pentru acest PMTiles. Micsoreaza fisierul sau elibereaza spatiu in browser.',
        { cause: e },
      );
    }
    throw e;
  }
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
  for (const a of archs) {
    const eff = effectiveArchiveBytes(a);
    if (eff > 0 && a.size !== eff) {
      try {
        await db.pmtiles.update(a.key, { size: eff });
        Object.assign(a, { size: eff });
      } catch {
        /* ignore */
      }
    }
  }
  return archs.map((a) => archiveToBaseMap(a));
}

/** Unele înregistrări au `size` 0 în DB dar `blob.size` corect (sau invers); folosim maximul. */
function effectiveArchiveBytes(a: PMTilesArchive): number {
  const n = typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : 0;
  const b = a.blob instanceof Blob && Number.isFinite(a.blob.size) ? a.blob.size : 0;
  return Math.max(n, b, 0);
}

function formatArchiveSizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
}

function archiveToBaseMap(a: PMTilesArchive): BaseMapDef {
  const url = archiveBlobUrl(a);
  const bytes = effectiveArchiveBytes(a);
  return {
    id: `pmtiles-${a.key}`,
    label: `Offline: ${a.name}`,
    description: `${formatArchiveSizeBytes(bytes)} - PMTiles local (zoom ${a.minzoom ?? '?'}-${a.maxzoom ?? '?'})`,
    attribution: '© OpenStreetMap contributors / PMTiles',
    tileUrls: [],
    maxzoom: a.maxzoom ?? 14,
    pmtiles: true,
    pmtilesUrl: url,
    pmtilesBounds: a.bounds,
    pmtilesMinZoom: a.minzoom,
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
  try {
    await db.pmtiles.put(archive);
  } catch (e) {
    const name = e instanceof DOMException ? e.name : (e as Error)?.name;
    if (name === 'QuotaExceededError') {
      throw new Error(
        'Spatiu IndexedDB insuficient. Sterge alte harti offline sau micsoreaza pachetul.',
        { cause: e },
      );
    }
    throw e;
  }
  return archiveToBaseMap(archive);
}
