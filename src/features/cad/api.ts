import { supabase } from '@/lib/supabase';
import type { Visibility } from '@/lib/types';
import {
  type CadLayerKind,
  type ClassifiedCadLayer,
  defaultLabelBehaviorForKind,
} from './classifyCadLayer';
import type { FeatureCollection } from 'geojson';
import { toFeatureCollection } from './classifyCadLayer';
import { ensureCadFeatureCollectionIds } from './cadFeatureIds';

const BUCKET = 'cad-imports';

export interface CadImport {
  id: string;
  owner_id: string;
  name: string;
  source_path: string | null;
  visibility: Visibility;
  /** GeoJSON Polygon in WGS84 from `bounds` column (rectangle). */
  bounds_json: GeoJSON.Polygon | null;
  created_at: string;
  updated_at: string;
}

export interface CadLayerRow {
  id: string;
  import_id: string;
  cad_layer: string;
  kind: CadLayerKind;
  features: FeatureCollection;
  style: Record<string, unknown>;
  visible: boolean;
  feature_count: number;
  created_at: string;
}

interface ImportRow {
  id: string;
  owner_id: string;
  name: string;
  source_path: string | null;
  visibility: Visibility;
  bounds_json: GeoJSON.Polygon | null;
  created_at: string;
  updated_at: string;
}

interface LayerRow {
  id: string;
  import_id: string;
  cad_layer: string;
  kind: CadLayerKind;
  features: FeatureCollection;
  style: Record<string, unknown>;
  visible: boolean;
  feature_count: number;
  created_at: string;
}

const IMPORT_SELECT = 'id, owner_id, name, source_path, visibility, bounds_json, created_at, updated_at';
const LAYER_SELECT =
  'id, import_id, cad_layer, kind, features, style, visible, feature_count, created_at';

function rowImport(r: ImportRow): CadImport {
  return {
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    source_path: r.source_path,
    visibility: r.visibility,
    bounds_json: r.bounds_json ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowLayer(r: LayerRow): CadLayerRow {
  return {
    id: r.id,
    import_id: r.import_id,
    cad_layer: r.cad_layer,
    kind: r.kind,
    features: r.features,
    style: r.style ?? {},
    visible: r.visible,
    feature_count: r.feature_count,
    created_at: r.created_at,
  };
}

export async function fetchCadImports(): Promise<CadImport[]> {
  const { data, error } = await supabase
    .from('cad_imports')
    .select(IMPORT_SELECT)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowImport(r as unknown as ImportRow));
}

export async function fetchCadLayers(importIds: string[]): Promise<CadLayerRow[]> {
  if (importIds.length === 0) return [];
  const { data, error } = await supabase
    .from('cad_layers')
    .select(LAYER_SELECT)
    .in('import_id', importIds)
    .order('cad_layer', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => rowLayer(r as unknown as LayerRow));
}

export async function uploadCadImport(args: {
  name: string;
  file: File;
  visibility: Visibility;
  layers: ClassifiedCadLayer[];
  layerOverrides: Record<
    string,
    { kind: CadLayerKind; color: string; width: number; opacity: number; visible: boolean }
  >;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}): Promise<{ import: CadImport; layers: CadLayerRow[] }> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const path = `${userId}/${crypto.randomUUID()}.dxf`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, args.file, {
    cacheControl: '3600',
    upsert: false,
    contentType: 'application/dxf',
  });
  if (upErr) throw upErr;

  const wkt = bboxToWktPolygon(args.bbox);
  const { data: imp, error: impErr } = await supabase
    .from('cad_imports')
    .insert({
      owner_id: userId,
      name: args.name,
      source_path: path,
      bounds: `SRID=4326;${wkt}`,
      visibility: args.visibility,
    })
    .select(IMPORT_SELECT)
    .single();
  if (impErr) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw impErr;
  }

  const importRow = rowImport(imp as unknown as ImportRow);
  const rows = args.layers.map((l) => {
    const ov = args.layerOverrides[l.cadLayer];
    const kind = ov?.kind ?? l.kind;
    const style = {
      color: ov?.color,
      width: ov?.width,
      opacity: ov?.opacity,
      ...defaultLabelBehaviorForKind(kind),
    };
    const fc = ensureCadFeatureCollectionIds(toFeatureCollection(l.features));
    return {
      import_id: importRow.id,
      cad_layer: l.cadLayer,
      kind,
      features: fc,
      style,
      visible: ov?.visible ?? true,
    };
  });

  const { data: layRows, error: layErr } = await supabase.from('cad_layers').insert(rows).select(LAYER_SELECT);
  if (layErr) {
    await supabase.from('cad_imports').delete().eq('id', importRow.id);
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw layErr;
  }

  return {
    import: importRow,
    layers: (layRows ?? []).map((r) => rowLayer(r as unknown as LayerRow)),
  };
}

export async function deleteCadImport(i: CadImport): Promise<void> {
  if (i.source_path) {
    await supabase.storage.from(BUCKET).remove([i.source_path]).catch(() => {});
  }
  const { error } = await supabase.from('cad_imports').delete().eq('id', i.id);
  if (error) throw error;
}

export async function updateCadLayer(
  id: string,
  patch: Partial<Pick<CadLayerRow, 'kind' | 'style' | 'visible' | 'features'>>,
): Promise<void> {
  const { error } = await supabase.from('cad_layers').update(patch).eq('id', id);
  if (error) throw error;
}

export function cadImportSourceUrl(path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Bbox from import bounds polygon (first ring), or null if missing. */
export function bboxFromCadImportBounds(poly: GeoJSON.Polygon | null): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} | null {
  if (!poly?.coordinates?.[0]?.length) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of poly.coordinates[0]) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLon)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function bboxToWktPolygon(b: {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}): string {
  const { minLon: x1, minLat: y1, maxLon: x2, maxLat: y2 } = b;
  return `POLYGON((${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}, ${x1} ${y1}))`;
}
