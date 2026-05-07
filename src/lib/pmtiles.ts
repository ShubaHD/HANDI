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
  };
  await db.pmtiles.put(archive);
  return archive;
}

export async function listLocalArchives(): Promise<PMTilesArchive[]> {
  return db.pmtiles.orderBy('addedAt').reverse().toArray();
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
