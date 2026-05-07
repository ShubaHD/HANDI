import type { PointOfInterest, Track, Zone } from '@/lib/types';
import { db } from './dexie';
import { fetchPoints as fetchPointsRemote } from '@/features/points/api';
import { fetchZones as fetchZonesRemote } from '@/features/zones/api';
import { fetchTracks as fetchTracksRemote } from '@/features/tracks/api';

export interface CachedFetchResult<T> {
  data: T[];
  fromCache: boolean;
  error?: string;
}

async function safeFetch<T>(
  remote: () => Promise<T[]>,
  table: 'points' | 'zones' | 'tracks',
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
    return {
      data: cached,
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
