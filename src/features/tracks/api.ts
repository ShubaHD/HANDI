import { supabase } from '@/lib/supabase';
import type { Track, Visibility } from '@/lib/types';
import { length as turfLength } from '@turf/turf';

export interface NewTrackInput {
  name: string;
  geom: GeoJSON.LineString;
  source: 'gpx_import' | 'recorded';
  recorded_at?: string | null;
  visibility: Visibility;
}

interface TrackRow {
  id: string;
  owner_id: string;
  name: string;
  geom_json: GeoJSON.LineString;
  source: 'gpx_import' | 'recorded';
  distance_m: number | null;
  elev_gain_m: number | null;
  visibility: Visibility;
  recorded_at: string | null;
  created_at: string;
}

const SELECT_COLS =
  'id, owner_id, name, geom_json, source, distance_m, elev_gain_m, visibility, recorded_at, created_at';

function rowToTrack(r: TrackRow): Track {
  return {
    id: r.id,
    owner_id: r.owner_id,
    name: r.name,
    geom: r.geom_json,
    source: r.source,
    distance_m: r.distance_m,
    elev_gain_m: r.elev_gain_m,
    visibility: r.visibility,
    recorded_at: r.recorded_at,
    created_at: r.created_at,
  };
}

export async function fetchTracks(): Promise<Track[]> {
  const { data, error } = await supabase
    .from('tracks')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToTrack(r as unknown as TrackRow));
}

export async function createTrack(input: NewTrackInput): Promise<Track> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const distanceKm = turfLength(
    {
      type: 'Feature',
      geometry: input.geom,
      properties: {},
    },
    { units: 'kilometers' },
  );
  const distance_m = distanceKm * 1000;

  const elev_gain_m = computeElevGain(input.geom);

  const { data, error } = await supabase
    .from('tracks')
    .insert({
      owner_id: userId,
      name: input.name,
      geom: `SRID=4326;${lineToWKT(input.geom)}`,
      source: input.source,
      distance_m,
      elev_gain_m,
      recorded_at: input.recorded_at ?? null,
      visibility: input.visibility,
    })
    .select(SELECT_COLS)
    .single();
  if (error) throw error;
  return rowToTrack(data as unknown as TrackRow);
}

export async function deleteTrack(id: string): Promise<void> {
  const { error } = await supabase.from('tracks').delete().eq('id', id);
  if (error) throw error;
}

function lineToWKT(line: GeoJSON.LineString): string {
  const coords = line.coordinates.map((c) => `${c[0]} ${c[1]}`).join(', ');
  return `LINESTRING(${coords})`;
}

function computeElevGain(line: GeoJSON.LineString): number | null {
  if (line.coordinates.length === 0) return null;
  let gain = 0;
  let hasZ = false;
  for (let i = 1; i < line.coordinates.length; i++) {
    const prev = line.coordinates[i - 1];
    const cur = line.coordinates[i];
    if (prev.length >= 3 && cur.length >= 3) {
      hasZ = true;
      const d = (cur[2] as number) - (prev[2] as number);
      if (d > 0) gain += d;
    }
  }
  return hasZ ? gain : null;
}
