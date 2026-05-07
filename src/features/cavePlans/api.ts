import { supabase } from '@/lib/supabase';
import type { Visibility } from '@/lib/types';

export type CavePlanKind = 'survey_plan' | 'geology' | 'other';

export interface CavePlan {
  id: string;
  owner_id: string;
  name: string;
  kind: CavePlanKind;
  description: string | null;
  visibility: Visibility;
  source_path: string | null;
  geom: GeoJSON.MultiLineString;
  created_at: string;
  updated_at: string;
}

const BUCKET = 'cave-plans';

interface Row {
  id: string;
  owner_id: string;
  name: string;
  kind: CavePlanKind;
  description: string | null;
  visibility: Visibility;
  source_path: string | null;
  geom_json: GeoJSON.MultiLineString;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS =
  'id, owner_id, name, kind, description, visibility, source_path, geom_json, created_at, updated_at';

function rowToPlan(r: Row): CavePlan {
  return {
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    kind: r.kind,
    description: r.description,
    visibility: r.visibility,
    source_path: r.source_path,
    geom: r.geom_json,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function fetchCavePlans(): Promise<CavePlan[]> {
  const { data, error } = await supabase
    .from('cave_plans')
    .select(SELECT_COLS)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToPlan(r as unknown as Row));
}

export async function uploadCavePlanDxf(args: {
  file: File;
  name: string;
  kind: CavePlanKind;
  description: string | null;
  visibility: Visibility;
  geom: GeoJSON.MultiLineString;
}): Promise<CavePlan> {
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

  const wkt = multiLineToWKT(args.geom);
  const { data, error } = await supabase
    .from('cave_plans')
    .insert({
      owner_id: userId,
      name: args.name,
      kind: args.kind,
      description: args.description,
      visibility: args.visibility,
      source_path: path,
      geom: `SRID=4326;${wkt}`,
    })
    .select(SELECT_COLS)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return rowToPlan(data as unknown as Row);
}

export async function updateCavePlan(
  id: string,
  patch: Partial<Pick<CavePlan, 'name' | 'description' | 'visibility' | 'kind'>>,
): Promise<void> {
  const { error } = await supabase.from('cave_plans').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCavePlan(p: CavePlan): Promise<void> {
  if (p.source_path) {
    await supabase.storage.from(BUCKET).remove([p.source_path]).catch(() => {});
  }
  const { error } = await supabase.from('cave_plans').delete().eq('id', p.id);
  if (error) throw error;
}

export function planSourceUrl(source_path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(source_path);
  return data.publicUrl;
}

function multiLineToWKT(mls: GeoJSON.MultiLineString): string {
  const parts = mls.coordinates
    .map((line) => `(${line.map((c) => `${c[0]} ${c[1]}`).join(', ')})`)
    .join(', ');
  return `MULTILINESTRING(${parts})`;
}

