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
}

export async function fetchPoints(): Promise<PointOfInterest[]> {
  const { data, error } = await supabase
    .from('points')
    .select(
      'id, owner_id, name, type, lat, lon, elevation_m, description, visibility, status, created_at, updated_at',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PointOfInterest[];
}

export async function createPoint(input: NewPointInput): Promise<PointOfInterest> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userData.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const { data, error } = await supabase
    .from('points')
    .insert({
      owner_id: userId,
      name: input.name,
      type: input.type,
      lat: input.lat,
      lon: input.lon,
      elevation_m: input.elevation_m ?? null,
      description: input.description ?? null,
      visibility: input.visibility,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PointOfInterest;
}

export async function createPointsBulk(inputs: NewPointInput[]): Promise<PointOfInterest[]> {
  if (inputs.length === 0) return [];

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const userId = userData.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const rows = inputs.map((p) => ({
    owner_id: userId,
    name: p.name,
    type: p.type,
    lat: p.lat,
    lon: p.lon,
    elevation_m: p.elevation_m ?? null,
    description: p.description ?? null,
    visibility: p.visibility,
  }));

  const { data, error } = await supabase.from('points').insert(rows).select();
  if (error) throw error;
  return (data ?? []) as PointOfInterest[];
}

export async function deletePoint(id: string): Promise<void> {
  const { error } = await supabase.from('points').delete().eq('id', id);
  if (error) throw error;
}

export async function updatePoint(
  id: string,
  patch: Partial<NewPointInput>,
): Promise<PointOfInterest> {
  const { data, error } = await supabase
    .from('points')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as PointOfInterest;
}
