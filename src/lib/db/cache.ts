import type { Annotation, AnnotationStyle, PointOfInterest, Track, Zone } from '@/lib/types';
import { fetchPoints as fetchPointsRemote } from '@/features/points/api';
import { fetchZones as fetchZonesRemote } from '@/features/zones/api';
import { fetchTracks as fetchTracksRemote } from '@/features/tracks/api';
import { fetchAnnotations as fetchAnnotationsRemote } from '@/features/annotations/api';
import { db } from './dexie';

/** Scoate adnotarea din cache-ul Dexie (ex. dupa stergere offline sau inainte de reload). */
export async function removeAnnotationFromLocalCache(id: string): Promise<void> {
  try {
    await db.annotations.delete(id);
  } catch {
    /* ignore */
  }
}

export interface CachedFetchResult<T> {
  data: T[];
  fromCache: boolean;
  error?: string;
}

async function safeFetch<T>(
  remote: () => Promise<T[]>,
  table: 'points' | 'zones' | 'tracks' | 'annotations',
): Promise<CachedFetchResult<T>> {
  try {
    const fresh = await remote();
    await db.transaction('rw', db[table] as never, async () => {
      const t = db[table] as unknown as {
        clear: () => Promise<void>;
        bulkPut: (items: unknown[]) => Promise<unknown>;
      };
      await t.clear();
      await t.bulkPut(fresh as unknown[]);
    });
    return { data: fresh, fromCache: false };
  } catch (e) {
    const cached = (await (db[table] as unknown as { toArray: () => Promise<unknown[]> }).toArray()) as T[];
    let data = cached;
    if (table === 'points') {
      data = (cached as unknown as PointOfInterest[]).map((p) => {
        const raw = p as { marker_color?: unknown };
        const marker_color =
          typeof raw.marker_color === 'string' || raw.marker_color === null
            ? (raw.marker_color as string | null)
            : null;
        return { ...(p as object), marker_color: marker_color ?? null } as PointOfInterest;
      }) as T[];
    }
    if (table === 'annotations') {
      data = (cached as unknown as Annotation[]).map((a) => {
        const raw = a as { style?: unknown; notes?: unknown };
        const s = raw.style;
        const style: AnnotationStyle =
          s && typeof s === 'object' && !Array.isArray(s) ? (s as AnnotationStyle) : {};
        const notes = typeof raw.notes === 'string' || raw.notes === null ? (raw.notes as string | null) : null;
        return { ...(a as object), style, notes: notes ?? null } as Annotation;
      }) as T[];
    }
    return {
      data,
      fromCache: true,
      error: e instanceof Error ? e.message : 'Eroare',
    };
  }
}

export function fetchPointsCached(): Promise<CachedFetchResult<PointOfInterest>> {
  return safeFetch(fetchPointsRemote, 'points');
}

export function fetchZonesCached(): Promise<CachedFetchResult<Zone>> {
  return safeFetch(fetchZonesRemote, 'zones');
}

export function fetchTracksCached(): Promise<CachedFetchResult<Track>> {
  return safeFetch(fetchTracksRemote, 'tracks');
}

export function fetchAnnotationsCached(): Promise<CachedFetchResult<Annotation>> {
  return safeFetch(fetchAnnotationsRemote, 'annotations');
}

export async function loadFromCache(): Promise<{
  points: PointOfInterest[];
  zones: Zone[];
  tracks: Track[];
}> {
  const [points, zones, tracks] = await Promise.all([
    db.points.toArray(),
    db.zones.toArray(),
    db.tracks.toArray(),
  ]);
  return { points, zones, tracks };
}
