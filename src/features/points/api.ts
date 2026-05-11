import { supabase } from '@/lib/supabase';
import type { PointOfInterest, PointType, Visibility } from '@/lib/types';

export interface NewPointInput {
  name: string;
  type: PointType;
  lat: number;
  lon: number;
  elevation_m?: number | null;
  description?: string | null;
  visibility: Visibility;
  /** Hex #rrggbb sau omis / null pentru culoare implicită după tip. */
  marker_color?: string | null;
}

export async function fetchPoints(): Promise<PointOfInterest[]> {
  const { data, error } = await supabase
    .from('points')
    .select(
      'id, owner_id, name, type, marker_color, lat, lon, elevation_m, description, visibility, status, created_at, updated_at',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...(r as PointOfInterest),
    marker_color: (r as { marker_color?: string | null }).marker_color ?? null,
  })) as PointOfInterest[];
}

export async function createPoint(input: NewPointInput): Promise<PointOfInterest> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userData.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const mc =
    typeof input.marker_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.marker_color.trim())
      ? input.marker_color.trim()
      : null;
  const { data, error } = await supabase
    .from('points')
    .insert({
      owner_id: userId,
      name: input.name,
      type: input.type,
      marker_color: mc,
      lat: input.lat,
      lon: input.lon,
      elevation_m: input.elevation_m ?? null,
      description: input.description ?? null,
      visibility: input.visibility,
    })
    .select()
    .single();
  if (error) throw error;
  return {
    ...(data as PointOfInterest),
    marker_color: (data as { marker_color?: string | null }).marker_color ?? null,
  };
}

export async function createPointsBulk(inputs: NewPointInput[]): Promise<PointOfInterest[]> {
  if (inputs.length === 0) return [];

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userData.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const rows = inputs.map((p) => {
    const mc =
      typeof p.marker_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.marker_color.trim())
        ? p.marker_color.trim()
        : null;
    return {
      owner_id: userId,
      name: p.name,
      type: p.type,
      marker_color: mc,
      lat: p.lat,
      lon: p.lon,
      elevation_m: p.elevation_m ?? null,
      description: p.description ?? null,
      visibility: p.visibility,
    };
  });

  const { data, error } = await supabase.from('points').insert(rows).select();
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...(r as PointOfInterest),
    marker_color: (r as { marker_color?: string | null }).marker_color ?? null,
  })) as PointOfInterest[];
}

export async function deletePoint(id: string): Promise<void> {
  // Cu RLS, PostgREST poate răspunde 204 chiar dacă nu s-a șters niciun rând (ex. nu ești owner).
  // `.select('id')` forțează răspunsul să includă rândurile efectiv șterse.
  const { data, error } = await supabase.from('points').delete().eq('id', id).select('id');
  if (error) throw error;
  if (data == null || data.length === 0) {
    throw new Error(
      'Punctul nu a fost șters (probabil nu îți aparține sau sesiunea a expirat). Reautentifică-te și încearcă din nou.',
    );
  }
}

export async function updatePoint(
  id: string,
  patch: Partial<NewPointInput>,
): Promise<PointOfInterest> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch) as [keyof NewPointInput, NewPointInput[keyof NewPointInput]][]) {
    if (v === undefined) continue;
    if (k === 'marker_color') {
      if (v == null || v === '') row.marker_color = null;
      else if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())) row.marker_color = v.trim();
      continue;
    }
    row[k] = v;
  }
  const { data, error } = await supabase.from('points').update(row).eq('id', id).select().single();
  if (error) throw error;
  return {
    ...(data as PointOfInterest),
    marker_color: (data as { marker_color?: string | null }).marker_color ?? null,
  };
}
