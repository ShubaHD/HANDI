import { supabase } from '@/lib/supabase';
import type { RasterKind, RasterOverlay, Visibility } from '@/lib/types';

const BUCKET = 'raster-overlays';

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface UploadRasterInput {
  name: string;
  kind: RasterKind;
  file: File;
  bbox: BBox;
  capturedAt?: string | null;
  visibility: Visibility;
  metadata?: Record<string, unknown>;
}

interface RasterRow {
  id: string;
  owner_id: string;
  name: string;
  kind: RasterKind;
  storage_path: string;
  bounds_json: GeoJSON.Polygon;
  captured_at: string | null;
  metadata: Record<string, unknown>;
  visibility: Visibility;
  created_at: string;
}

const SELECT_COLS =
  'id, owner_id, name, kind, storage_path, bounds_json, captured_at, metadata, visibility, created_at';

function rowToRaster(r: RasterRow): RasterOverlay {
  return {
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    kind: r.kind,
    storage_path: r.storage_path,
    bounds: r.bounds_json,
    captured_at: r.captured_at,
    metadata: r.metadata,
    visibility: r.visibility,
    created_at: r.created_at,
  };
}

export async function fetchRasters(): Promise<RasterOverlay[]> {
  const { data, error } = await supabase
    .from('raster_overlays')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToRaster(r as unknown as RasterRow));
}

export async function uploadRaster(input: UploadRasterInput): Promise<RasterOverlay> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const dotIdx = input.file.name.lastIndexOf('.');
  const ext = (dotIdx >= 0 ? input.file.name.slice(dotIdx + 1) : 'png').toLowerCase();
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    cacheControl: '3600',
    upsert: false,
    contentType: input.file.type || 'image/png',
  });
  if (upErr) throw upErr;

  const wkt = bboxToWKT(input.bbox);
  const { data, error } = await supabase
    .from('raster_overlays')
    .insert({
      owner_id: userId,
      name: input.name,
      kind: input.kind,
      storage_path: path,
      bounds: `SRID=4326;${wkt}`,
      captured_at: input.capturedAt ?? null,
      metadata: input.metadata ?? {},
      visibility: input.visibility,
    })
    .select(SELECT_COLS)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return rowToRaster(data as unknown as RasterRow);
}

export async function deleteRaster(r: RasterOverlay): Promise<void> {
  await supabase.storage.from(BUCKET).remove([r.storage_path]).catch(() => {});
  const { error } = await supabase.from('raster_overlays').delete().eq('id', r.id);
  if (error) throw error;
}

export function publicUrl(storagePath: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * URL HTTP(S) pentru un raster PMTiles (randare MapLibre + download offline).
 * Folosește `metadata.pmtiles_url` dacă e setat, altfel URL public din `storage_path`
 * (upload-ul normal pune doar `format: 'pmtiles'` fără URL în metadata).
 */
export function rasterPmtilesHttpUrl(r: RasterOverlay): string | null {
  const meta = r.metadata as { format?: unknown; pmtiles_url?: unknown } | null | undefined;
  if (meta?.format !== 'pmtiles') return null;
  const fromMeta = meta.pmtiles_url;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  if (r.storage_path) return publicUrl(r.storage_path);
  return null;
}

export function rasterCornersFromBounds(bounds: GeoJSON.Polygon): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} | null {
  const ring = bounds.coordinates[0];
  if (!ring || ring.length < 4) return null;
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLon) minLon = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLon) maxLon = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function bboxToWKT(b: BBox): string {
  const { minLon: x1, minLat: y1, maxLon: x2, maxLat: y2 } = b;
  return `POLYGON((${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}, ${x1} ${y1}))`;
}
