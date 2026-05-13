import { db, type FieldOfflineSnapshotRow } from './dexie';
import type { CadImport, CadLayerRow } from '@/features/cad/api';
import type { RasterOverlay } from '@/lib/types';

const SNAPSHOT_ID = 'default';

export type { FieldOfflineSnapshotRow };

export async function saveFieldOfflineSnapshot(args: {
  cadImports: CadImport[];
  cadLayers: CadLayerRow[];
  rasters: RasterOverlay[];
}): Promise<number> {
  const savedAt = Date.now();
  const row: FieldOfflineSnapshotRow = {
    id: SNAPSHOT_ID,
    savedAt,
    cadImports: args.cadImports,
    cadLayers: args.cadLayers,
    rasters: args.rasters,
  };
  await db.fieldOfflineSnapshots.put(row);
  return savedAt;
}

export async function loadFieldOfflineSnapshot(): Promise<FieldOfflineSnapshotRow | undefined> {
  return db.fieldOfflineSnapshots.get(SNAPSHOT_ID);
}
