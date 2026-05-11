import { supabase } from '@/lib/supabase';
import type {
  Annotation,
  AnnotationKind,
  AnnotationStyle,
  AnnotationSymbol,
  Visibility,
} from '@/lib/types';

export type NewAnnotationInput =
  | {
      kind: 'symbol';
      symbol: AnnotationSymbol;
      text?: string | null;
      notes?: string | null;
      lat: number;
      lon: number;
      bearing_deg?: number | null;
      visibility: Visibility;
      style?: AnnotationStyle;
    }
  | {
      kind: 'text';
      text: string;
      notes?: string | null;
      lat: number;
      lon: number;
      bearing_deg?: number | null;
      visibility: Visibility;
      style?: AnnotationStyle;
    }
  | {
      kind: 'arrow';
      geom: GeoJSON.LineString;
      notes?: string | null;
      bearing_deg?: number | null;
      visibility: Visibility;
      style?: AnnotationStyle;
    };

export type AnnotationUpdatePatch = {
  text?: string | null;
  notes?: string | null;
  visibility?: Visibility;
  style?: AnnotationStyle;
  symbol?: AnnotationSymbol | null;
};

interface AnnotationRow {
  id: string;
  owner_id: string;
  kind: AnnotationKind;
  symbol: string | null;
  text: string | null;
  notes: string | null;
  lat: number | null;
  lon: number | null;
  geom_json: GeoJSON.Geometry;
  bearing_deg: number | null;
  visibility: Visibility;
  style: unknown;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS =
  'id, owner_id, kind, symbol, text, notes, lat, lon, geom_json, bearing_deg, visibility, style, created_at, updated_at';

function parseStyle(raw: unknown): AnnotationStyle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: AnnotationStyle = {};
  if (typeof o.arrowColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.arrowColor)) {
    out.arrowColor = o.arrowColor;
  }
  if (typeof o.textColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.textColor)) {
    out.textColor = o.textColor;
  }
  if (typeof o.textSizePx === 'number' && Number.isFinite(o.textSizePx)) {
    out.textSizePx = Math.max(8, Math.min(48, Math.round(o.textSizePx)));
  }
  return out;
}

function rowToAnnotation(r: AnnotationRow): Annotation {
  return {
    id: r.id,
    owner_id: r.owner_id,
    kind: r.kind,
    symbol: (r.symbol as AnnotationSymbol | null) ?? null,
    text: r.text ?? null,
    notes: r.notes ?? null,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    geom: r.geom_json,
    bearing_deg: r.bearing_deg ?? null,
    visibility: r.visibility,
    style: parseStyle(r.style),
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

  const style = input.style && Object.keys(input.style).length > 0 ? input.style : {};

  const notesTrim = typeof input.notes === 'string' ? input.notes.trim() : '';
  const row: Record<string, unknown> = {
    owner_id: userId,
    kind: input.kind,
    visibility: input.visibility,
    bearing_deg: input.bearing_deg ?? null,
    style,
    notes: notesTrim ? notesTrim : null,
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
  const { data, error } = await supabase.from('annotations').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      'Stergerea nu s-a aplicat (niciun rand). Cel mai frecvent: nu esti proprietarul adnotarii sau politica RLS „delete” pe Supabase.',
    );
  }
}

export async function updateAnnotation(id: string, patch: AnnotationUpdatePatch): Promise<Annotation> {
  const updateRow: Record<string, unknown> = {};
  if ('text' in patch) updateRow.text = patch.text;
  if ('notes' in patch) updateRow.notes = patch.notes === '' || patch.notes == null ? null : patch.notes;
  if ('visibility' in patch) updateRow.visibility = patch.visibility;
  if ('style' in patch && patch.style != null) updateRow.style = patch.style;
  if ('symbol' in patch) updateRow.symbol = patch.symbol;

  const { data, error } = await supabase.from('annotations').update(updateRow).eq('id', id).select(SELECT_COLS).single();
  if (error) throw error;
  return rowToAnnotation(data as unknown as AnnotationRow);
}

function lineToWKT(line: GeoJSON.LineString): string {
  const coords = line.coordinates.map((c) => `${c[0]} ${c[1]}`).join(', ');
  return `LINESTRING(${coords})`;
}
