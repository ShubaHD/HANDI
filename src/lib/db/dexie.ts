import Dexie, { type EntityTable } from 'dexie';
import type { Annotation, PointOfInterest, RasterOverlay, Track, Zone } from '@/lib/types';
import type { CadImport, CadLayerRow } from '@/features/cad/api';

/** Ultimul pachet salvat explicit (CAD + listă rastere) pentru când nu există rețea. */
export interface FieldOfflineSnapshotRow {
  id: string;
  savedAt: number;
  cadImports: CadImport[];
  cadLayers: CadLayerRow[];
  rasters: RasterOverlay[];
}

export interface PendingMutation {
  id?: number;
  kind:
    | 'createPoint'
    | 'updatePoint'
    | 'deletePoint'
    | 'createZone'
    | 'updateZoneStatus'
    | 'deleteZone'
    | 'createTrack'
    | 'deleteTrack'
    | 'createAnnotation'
    | 'deleteAnnotation'
    | 'updateAnnotation';
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface PMTilesArchive {
  key: string;
  name: string;
  /** Obligatoriu pentru arhive PMTiles în IndexedDB; pentru MBTiles poate lipsi dacă fișierul e în OPFS. */
  blob?: Blob;
  size: number;
  bounds: [number, number, number, number] | null;
  minzoom: number | null;
  maxzoom: number | null;
  addedAt: number;
  kind?: 'basemap' | 'raster';
  remoteUrl?: string;
  rasterId?: string;
  /** Implicit `pmtiles` pentru înregistrări vechi fără câmp. */
  format?: 'pmtiles' | 'mbtiles' | 'raster_image';
  /** Cale relativă în OPFS, ex. `handi-mbtiles/<key>.mbtiles` (fără slash inițial). */
  opfsRelPath?: string;
}

class HandiDB extends Dexie {
  points!: EntityTable<PointOfInterest, 'id'>;
  zones!: EntityTable<Zone, 'id'>;
  tracks!: EntityTable<Track, 'id'>;
  rasters!: EntityTable<RasterOverlay, 'id'>;
  annotations!: EntityTable<Annotation, 'id'>;
  pendingMutations!: EntityTable<PendingMutation, 'id'>;
  pmtiles!: EntityTable<PMTilesArchive, 'key'>;
  fieldOfflineSnapshots!: EntityTable<FieldOfflineSnapshotRow, 'id'>;

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

    // v3: annotations (symbols/text/arrows) offline-first
    this.version(3).stores({
      points: 'id, owner_id, type, visibility, created_at',
      zones: 'id, owner_id, status, visibility, created_at',
      tracks: 'id, owner_id, source, visibility, created_at',
      rasters: 'id, owner_id, kind, visibility, created_at',
      annotations: 'id, owner_id, kind, visibility, created_at, updated_at',
      pendingMutations: '++id, kind, createdAt',
      pmtiles: 'key, addedAt, kind, remoteUrl, rasterId',
    });

    this.version(4).stores({
      points: 'id, owner_id, type, visibility, created_at',
      zones: 'id, owner_id, status, visibility, created_at',
      tracks: 'id, owner_id, source, visibility, created_at',
      rasters: 'id, owner_id, kind, visibility, created_at',
      annotations: 'id, owner_id, kind, visibility, created_at, updated_at',
      pendingMutations: '++id, kind, createdAt',
      pmtiles: 'key, addedAt, kind, remoteUrl, rasterId, format',
    });

    this.version(5).stores({
      points: 'id, owner_id, type, visibility, created_at',
      zones: 'id, owner_id, status, visibility, created_at',
      tracks: 'id, owner_id, source, visibility, created_at',
      rasters: 'id, owner_id, kind, visibility, created_at',
      annotations: 'id, owner_id, kind, visibility, created_at, updated_at',
      pendingMutations: '++id, kind, createdAt',
      pmtiles: 'key, addedAt, kind, remoteUrl, rasterId, format',
      fieldOfflineSnapshots: 'id, savedAt',
    });
  }
}

export const db = new HandiDB();
