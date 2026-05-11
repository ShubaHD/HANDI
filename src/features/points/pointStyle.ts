import { POINT_TYPES, type PointOfInterest, type PointType } from '@/lib/types';

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function pointDisplayColor(p: Pick<PointOfInterest, 'type' | 'marker_color'>): string {
  const c = p.marker_color?.trim();
  if (c && HEX6.test(c)) return c;
  return POINT_TYPES.find((t) => t.value === p.type)?.color ?? '#475569';
}

/** Din proprietăți GeoJSON (Leaflet). */
export function pointDisplayColorFromProps(props: { type?: string; marker_color?: string | null } | null): string {
  const type = (props?.type as PointType | undefined) ?? 'other';
  return pointDisplayColor({ type, marker_color: props?.marker_color ?? null });
}
