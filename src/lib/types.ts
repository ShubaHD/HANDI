export type Visibility = 'private' | 'club';

export type PointType =
  | 'cave'
  | 'doline'
  | 'spring'
  | 'dig_site'
  | 'aven'
  | 'resurgence'
  | 'other';

export const POINT_TYPES: { value: PointType; label: string; color: string; emoji: string }[] = [
  { value: 'cave', label: 'Pestera', color: '#1e3a8a', emoji: 'P' },
  { value: 'aven', label: 'Aven', color: '#7c3aed', emoji: 'A' },
  { value: 'doline', label: 'Dolina', color: '#b45309', emoji: 'D' },
  { value: 'spring', label: 'Izvor', color: '#0891b2', emoji: 'I' },
  { value: 'resurgence', label: 'Resurgenta', color: '#0e7490', emoji: 'R' },
  { value: 'dig_site', label: 'Zona de sapat', color: '#dc2626', emoji: 'S' },
  { value: 'other', label: 'Altele', color: '#475569', emoji: 'X' },
];

export interface Profile {
  id: string;
  full_name: string | null;
  role: 'admin' | 'member';
  created_at: string;
}

export interface PointOfInterest {
  id: string;
  owner_id: string;
  name: string;
  type: PointType;
  lat: number;
  lon: number;
  elevation_m: number | null;
  description: string | null;
  visibility: Visibility;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface Zone {
  id: string;
  owner_id: string;
  name: string;
  geom: GeoJSON.Polygon;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done' | 'rejected';
  visibility: Visibility;
  notes: string | null;
  created_at: string;
}

export interface Track {
  id: string;
  owner_id: string;
  name: string;
  geom: GeoJSON.LineString;
  source: 'gpx_import' | 'recorded';
  distance_m: number | null;
  elev_gain_m: number | null;
  visibility: Visibility;
  recorded_at: string | null;
  created_at: string;
}

export type RasterKind = 'thermal' | 'lidar_hillshade' | 'orthophoto' | 'other';

export interface RasterOverlay {
  id: string;
  owner_id: string;
  name: string;
  kind: RasterKind;
  storage_path: string;
  bounds: GeoJSON.Polygon;
  captured_at: string | null;
  metadata: Record<string, unknown>;
  visibility: Visibility;
  created_at: string;
}
