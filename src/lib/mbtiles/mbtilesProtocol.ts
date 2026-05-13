import maplibregl from 'maplibre-gl';
import { db } from '@/lib/db/dexie';
import {
  mbtilesWorkerClose,
  mbtilesWorkerOpenBuffer,
  mbtilesWorkerOpenOpfs,
  mbtilesWorkerTile,
} from '@/lib/mbtiles/mbtilesWorkerClient';

let registered = false;

const openedMbtilesKeys = new Set<string>();

export function invalidateMbtilesWorkerKey(key: string) {
  openedMbtilesKeys.delete(key);
  void mbtilesWorkerClose(key).catch(() => {});
}

/** După import sau reconectare worker — DB-ul e deja deschis. */
export function registerMbtilesKeyOpened(key: string) {
  openedMbtilesKeys.add(key);
}

/**
 * Deschide arhiva MBTiles în worker (OPFS sau Blob), dacă nu e deja deschisă.
 */
export async function ensureMbtilesDbOpenForKey(key: string): Promise<void> {
  if (openedMbtilesKeys.has(key)) return;
  const arch = await db.pmtiles.get(key);
  if (!arch || arch.format !== 'mbtiles') {
    throw new Error('MBTiles: arhiva nu exista sau format invalid.');
  }
  const rel = arch.opfsRelPath?.replace(/^\/+/, '');
  if (rel) {
    await mbtilesWorkerOpenOpfs(key, `/${rel}`);
  } else if (arch.blob) {
    const buf = await arch.blob.arrayBuffer();
    await mbtilesWorkerOpenBuffer(key, buf);
  } else {
    throw new Error('MBTiles: lipseste fisierul local (OPFS sau blob).');
  }
  openedMbtilesKeys.add(key);
}

export function ensureMBTilesProtocol() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('mbtiles-handi', async (params, abortController) => {
    const match = params.url.match(/^mbtiles-handi:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) throw new Error('URL mbtiles-handi invalid');
    const key = decodeURIComponent(match[1]);
    const z = Number(match[2]);
    const x = Number(match[3]);
    const y = Number(match[4]);
    await ensureMbtilesDbOpenForKey(key);
    abortController.signal.throwIfAborted();
    const buf = await mbtilesWorkerTile(key, z, x, y);
    abortController.signal.throwIfAborted();
    if (!buf || buf.byteLength === 0) {
      return { data: new Uint8Array(0) };
    }
    return { data: new Uint8Array(buf) };
  });
}
