import { supabase } from '@/lib/supabase';
import type { Annotation, AnnotationKind, AnnotationSymbol, Visibility } from '@/lib/types';

export type NewAnnotationInput =
  | {
      kind: 'symbol';
      symbol: AnnotationSymbol;
      text?: string | null;
      lat: number;
      lon: number;
      bearing_deg?: number | null;
      visibility: Visibility;
    }
  | {
      kind: 'text';
      text: string;
      lat: number;
      lon: number;
      bearing_deg?: number | null;
      visibility: Visibility;
    }
  | {
      kind: 'arrow';
      geom: GeoJSON.LineString;
      bearing_deg?: number | null;
      visibility: Visibility;
    };

interface AnnotationRow {
  id: string;
  owner_id: string;
  kind: AnnotationKind;
  symbol: string | null;
  text: string | null;
  lat: number | null;
  lon: number | null;
  geom_json: GeoJSON.Geometry;
  bearing_deg: number | null;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS =
  'id, owner_id, kind, symbol, text, lat, lon, geom_json, bearing_deg, visibility, created_at, updated_at';

function rowToAnnotation(r: AnnotationRow): Annotation {
  return {
    id: r.id,
    owner_id: r.owner_id,
    kind: r.kind,
    symbol: (r.symbol as AnnotationSymbol | null) ?? null,
    text: r.text ?? null,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    geom: r.geom_json,
    bearing_deg: r.bearing_deg ?? null,
    visibility: r.visibility,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function fetchAnnotations(): Promise<Annotation[]> {
  const { data, error } = await supabase
    .from('annotations')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToAnnotation(r as unknown as AnnotationRow));
}

export async function createAnnotation(input: NewAnnotationInput): Promise<Annotation> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error('Trebuie sa fii autentificat');

  const row: Record<string, unknown> = {
    owner_id: userId,
    kind: input.kind,
    visibility: input.visibility,
    bearing_deg: input.bearing_deg ?? null,
  };

  if (input.kind === 'arrow') {
    row.geom = `SRID=4326;${lineToWKT(input.geom)}`;
    row.lat = null;
    row.lon = null;
    row.symbol = null;
    row.text = null;
  } else if (input.kind === 'text') {
    row.geom = `SRID=4326;POINT(${input.lon} ${input.lat})`;
    row.lat = input.lat;
    row.lon = input.lon;
    row.symbol = null;
    row.text = input.text;
  } else {
    row.geom = `SRID=4326;POINT(${input.lon} ${input.lat})`;
    row.lat = input.lat;
    row.lon = input.lon;
    row.symbol = input.symbol;
    row.text = input.text ?? null;
  }

  const { data, error } = await supabase.from('annotations').insert(row).select(SELECT_COLS).single();
  if (error) throw error;
  return rowToAnnotation(data as unknown as AnnotationRow);
}

export async function deleteAnnotation(id: string): Promise<void> {
  const { error } = await supabase.from('annotations').delete().eq('id', id);
  if (error) throw error;
}

export async function updateAnnotation(
  id: string,
  patch: Partial<Omit<NewAnnotationInput, 'kind'>> & { text?: string | null; visibility?: Visibility },
): Promise<Annotation> {
  const { data, error } = await supabase.from('annotations').update(patch).eq('id', id).select(SELECT_COLS).single();
  if (error) throw error;
  return rowToAnnotation(data as unknown as AnnotationRow);
}

function lineToWKT(line: GeoJSON.LineString): string {
  const coords = line.coordinates.map((c) => `${c[0]} ${c[1]}`).join(', ');
  return `LINESTRING(${coords})`;
}

