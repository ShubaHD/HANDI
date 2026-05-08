import Dexie, { type EntityTable } from 'dexie';
import type { PointOfInterest, RasterOverlay, Track, Zone } from '@/lib/types';

export interface PendingMutation {
  id?: number;
  kind:
    | 'createPoint'
    | 'deletePoint'
    | 'createZone'
    | 'updateZoneStatus'
    | 'deleteZone'
    | 'createTrack'
    | 'deleteTrack';
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface PMTilesArchive {
  key: string;
  name: string;
  blob: Blob;
  size: number;
  bounds: [number, number, number, number] | null;
  minzoom: number | null;
  maxzoom: number | null;
  addedAt: number;
  kind?: 'basemap' | 'raster';
  remoteUrl?: string;
  rasterId?: string;
}

class HandiDB extends Dexie {
  points!: EntityTable<PointOfInterest, 'id'>;
  zones!: EntityTable<Zone, 'id'>;
  tracks!: EntityTable<Track, 'id'>;
  rasters!: EntityTable<RasterOverlay, 'id'>;
  pendingMutations!: EntityTable<PendingMutation, 'id'>;
  pmtiles!: EntityTable<PMTilesArchive, 'key'>;

  constructor() {
    super('handi');
    this.version(1).stores({
      points: 'id, owner_id, type, visibility, created_at',
      zones: 'id, owner_id, status, visibility, created_at',
      tracks: 'id, owner_id, source, visibility, created_at',
      rasters: 'id, owner_id, kind, visibility, created_at',
      pendingMutations: '++id, kind, createdAt',
      pmtiles: 'key, addedAt',
    });

    // v2: store PMTiles mirrors for offline use (basemaps + raster overlays)
    this.version(2).stores({
      points: 'id, owner_id, type, visibility, created_at',
      zones: 'id, owner_id, status, visibility, created_at',
      tracks: 'id, owner_id, source, visibility, created_at',
      rasters: 'id, owner_id, kind, visibility, created_at',
      pendingMutations: '++id, kind, createdAt',
      pmtiles: 'key, addedAt, kind, remoteUrl, rasterId',
    });
  }
}

export const db = new HandiDB();
