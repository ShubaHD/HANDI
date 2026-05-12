import { TileType, zxyToTileId } from 'pmtiles';
import type { BaseMapDef } from '@/map/layers/BaseLayers';
import { getBaseMapById } from '@/map/layers/BaseLayers';
import { buildRasterPmtilesBlob, sniffRasterTileType, type RasterTileBlob } from '@/lib/pmtilesRasterWriter';

export type OfflinePackSourceId = 'opentopomap' | 'esri-sat' | 'carto-voyager' | 'cyclosm';

export interface BBoxLonLat {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface OfflinePackProgress {
  phase: 'counting' | 'fetching' | 'building';
  loaded: number;
  total: number;
  message?: string;
}

function lonToXTile(lon: number, z: number): number {
  const n = 1 << z;
  return Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
}

function latToYTile(lat: number, z: number): number {
  const n = 1 << z;
  const latRad = (lat * Math.PI) / 180;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return Math.max(0, Math.min(n - 1, Math.floor(yFloat)));
}

/** XYZ y from lat (Web Mercator slippy map). */
export function tilesCoveringBBox(bbox: BBoxLonLat, z: number): { z: number; x: number; y: number }[] {
  let xMin = lonToXTile(bbox.minLon, z);
  let xMax = lonToXTile(bbox.maxLon, z);
  let yMin = latToYTile(bbox.maxLat, z);
  let yMax = latToYTile(bbox.minLat, z);
  if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
  if (yMin > yMax) [yMin, yMax] = [yMax, yMin];
  const out: { z: number; x: number; y: number }[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      out.push({ z, x, y });
    }
  }
  return out;
}

export function countPackTiles(bbox: BBoxLonLat, minZoom: number, maxZoom: number): number {
  let n = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    n += tilesCoveringBBox(bbox, z).length;
  }
  return n;
}

/** Aceleași șabloane ca în BASE_MAPS; Esri folosește TMS (y inversat). */
function packUrlForSource(
  source: OfflinePackSourceId,
  z: number,
  x: number,
  y: number,
  hostIdx: number,
): string {
  if (source === 'esri-sat') {
    const n = 1 << z;
    const yTms = n - 1 - y;
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${yTms}/${x}`;
  }
  const def = getBaseMapById(source);
  if (!def?.tileUrls?.length) {
    throw new Error(`Sursă pack necunoscută: ${source}`);
  }
  const tpl = def.tileUrls[hostIdx % def.tileUrls.length];
  return tpl.replace(/\{z\}/g, String(z)).replace(/\{x\}/g, String(x)).replace(/\{y\}/g, String(y));
}

export interface FetchTileResult {
  bytes: Uint8Array | null;
  /** Motiv scurt pentru diagnostic (HTTP, CORS, rețea). */
  detail?: string;
}

async function fetchTileBytes(url: string, signal?: AbortSignal): Promise<FetchTileResult> {
  try {
    const res = await fetch(url, { signal, mode: 'cors', cache: 'no-store' });
    if (!res.ok) {
      return {
        bytes: null,
        detail: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`,
      };
    }
    const buf = await res.arrayBuffer();
    return { bytes: new Uint8Array(buf) };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    const msg =
      e instanceof TypeError
        ? 'CORS sau rețea (fetch blocat)'
        : e instanceof Error
          ? e.message
          : String(e);
    return { bytes: null, detail: msg };
  }
}

const DEFAULT_CONCURRENCY = 5;
const MAX_TILES = 14_000;

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onEach: (done: number, total: number) => void,
): Promise<R[]> {
  const total = items.length;
  if (total === 0) {
    onEach(0, 0);
    return [];
  }
  const results: R[] = new Array(total);
  let nextIndex = 0;
  let finished = 0;

  const runWorker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      try {
        results[i] = await worker(items[i], i);
      } finally {
        finished++;
        onEach(finished, total);
      }
    }
  };

  const n = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: n }, () => runWorker()));
  return results;
}

export function baseMapMetaForPack(source: OfflinePackSourceId): Pick<
  BaseMapDef,
  'label' | 'attribution' | 'maxzoom'
> {
  const def = getBaseMapById(source);
  if (!def) throw new Error(`Sursă pack necunoscută: ${source}`);
  return {
    label: def.label,
    attribution: def.attribution,
    maxzoom: def.maxzoom,
  };
}

export interface BuildOfflineBasemapPackArgs {
  source: OfflinePackSourceId;
  bbox: BBoxLonLat;
  minZoom: number;
  maxZoom: number;
  name: string;
  signal?: AbortSignal;
  onProgress?: (p: OfflinePackProgress) => void;
}

function bumpFail(map: Map<string, number>, detail: string | undefined) {
  const k = detail?.trim() || 'necunoscut';
  map.set(k, (map.get(k) ?? 0) + 1);
}

/**
 * Download raster tiles for bbox+zoom range and build a single-file PMTiles archive suitable for Handi offline basemap import.
 */
export async function buildOfflineBasemapPackBlob(args: BuildOfflineBasemapPackArgs): Promise<Blob> {
  const { source, bbox, minZoom, maxZoom, name, signal, onProgress } = args;
  if (minZoom > maxZoom) throw new Error('minZoom > maxZoom');
  const meta = baseMapMetaForPack(source);
  if (minZoom < 0 || maxZoom > meta.maxzoom) {
    throw new Error(`Zoom ${minZoom}–${maxZoom} invalid pentru sursa (${meta.label}, max z${meta.maxzoom})`);
  }

  const coords: { z: number; x: number; y: number }[] = [];
  for (let z = minZoom; z <= maxZoom; z++) coords.push(...tilesCoveringBBox(bbox, z));
  if (coords.length > MAX_TILES) {
    throw new Error(
      `Prea multe tile-uri (~${coords.length}). Ridica min zoom, coboara max zoom sau micsoreaza zona pe harta (limita ${MAX_TILES}).`,
    );
  }

  onProgress?.({ phase: 'fetching', loaded: 0, total: coords.length });

  const failReasons = new Map<string, number>();

  const blobs = await runPool(
    coords,
    DEFAULT_CONCURRENCY,
    async (c, i) => {
      const url = packUrlForSource(source, c.z, c.x, c.y, i);
      const { bytes, detail } = await fetchTileBytes(url, signal);
      if (!bytes || bytes.byteLength < 8) bumpFail(failReasons, detail);
      return { c, bytes };
    },
    (loaded, total) => onProgress?.({ phase: 'fetching', loaded, total }),
  );

  const tiles: RasterTileBlob[] = [];
  let sniffed = TileType.Unknown;
  for (const row of blobs) {
    if (!row.bytes || row.bytes.byteLength < 8) continue;
    const tileId = zxyToTileId(row.c.z, row.c.x, row.c.y);
    if (sniffed === TileType.Unknown) sniffed = sniffRasterTileType(row.bytes);
    tiles.push({ tileId, data: row.bytes });
  }
  if (tiles.length === 0) {
    const ranked = [...failReasons.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const hint = top ? `Cel mai frecvent: „${top[0]}” (${top[1]} tile-uri). ` : '';
    throw new Error(
      `${hint}Niciun tile descarcat. Incearca sursa „Carto Voyager”, alt browser, sau genereaza PMTiles pe desktop si importa fisierul.`,
    );
  }

  const tileType =
    sniffed === TileType.Unknown ? (source === 'esri-sat' ? TileType.Jpeg : TileType.Png) : sniffed;

  onProgress?.({ phase: 'building', loaded: tiles.length, total: tiles.length, message: 'Scriu PMTiles…' });

  return buildRasterPmtilesBlob({
    tiles,
    minZoom,
    maxZoom,
    minLon: bbox.minLon,
    minLat: bbox.minLat,
    maxLon: bbox.maxLon,
    maxLat: bbox.maxLat,
    tileType,
    name,
    attribution: meta.attribution,
  });
}
