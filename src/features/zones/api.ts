import { supabase } from '@/lib/supabase';
import type { Visibility, Zone } from '@/lib/types';

export interface NewZoneInput {
  name: string;
  geom: GeoJSON.Polygon;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done' | 'rejected';
  visibility: Visibility;
  notes?: string | null;
}

interface ZoneRow {
  id: string;
  owner_id: string;
  name: string;
  geom_json: GeoJSON.Polygon;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done' | 'rejected';
  visibility: Visibility;
  notes: string | null;
  created_at: string;
}

const SELECT_COLS =
  'id, owner_id, name, geom_json, priority, status, visibility, notes, created_at';

function rowToZone(r: ZoneRow): Zone {
  return {
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    geom: r.geom_json,
    priority: r.priority,
    status: r.status,
    visibility: r.visibility,
    notes: r.notes,
    created_at: r.created_at,
  };
}

export async function fetchZones(): Promise<Zone[]> {
  const { data, error } = await supabase
    .from('zones')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToZone(r as unknown as ZoneRow));
}

export async function createZone(input: NewZoneInput): Promise<Zone> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const { data, error } = await supabase
    .from('zones')
    .insert({
      owner_id: userId,
      name: input.name,
      geom: `SRID=4326;${polygonToWKT(input.geom)}`,
      priority: input.priority,
      status: input.status,
      visibility: input.visibility,
      notes: input.notes ?? null,
    })
    .select(SELECT_COLS)
    .single();
  if (error) throw error;
  return rowToZone(data as unknown as ZoneRow);
}

export async function deleteZone(id: string): Promise<void> {
  const { error } = await supabase.from('zones').delete().eq('id', id);
  if (error) throw error;
}

export async function updateZoneStatus(
  id: string,
  status: 'todo' | 'in_progress' | 'done' | 'rejected',
): Promise<void> {
  const { error } = await supabase.from('zones').update({ status }).eq('id', id);
  if (error) throw error;
}

function polygonToWKT(poly: GeoJSON.Polygon): string {
  const rings = poly.coordinates
    .map((ring) => `(${ring.map((c) => `${c[0]} ${c[1]}`).join(', ')})`)
    .join(', ');
  return `POLYGON(${rings})`;
}
