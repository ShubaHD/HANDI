import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Zone } from '@/lib/types';

const SOURCE_ID = 'zones-source';
const LAYER_FILL = 'zones-fill';
const LAYER_OUTLINE = 'zones-outline';
const LAYER_LABEL = 'zones-label';

function zonesToGeoJSON(zones: Zone[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      geometry: z.geom,
      properties: {
        id: z.id,
        name: z.name,
        priority: z.priority,
        status: z.status,
        visibility: z.visibility,
      },
    })),
  };
}

export function addZonesLayer(map: MlMap) {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LAYER_FILL,
    type: 'fill',
    source: SOURCE_ID,
    paint: {
      'fill-color': [
        'match',
        ['get', 'status'],
        'todo', '#facc15',
        'in_progress', '#fb923c',
        'done', '#22c55e',
        'rejected', '#64748b',
        '#94a3b8',
      ] as never,
      'fill-opacity': [
        'match',
        ['get', 'priority'],
        'high', 0.4,
        'medium', 0.25,
        'low', 0.15,
        0.2,
      ] as never,
    },
  });

  map.addLayer({
    id: LAYER_OUTLINE,
    type: 'line',
    source: SOURCE_ID,
    paint: {
      'line-color': [
        'match',
        ['get', 'status'],
        'todo', '#eab308',
        'in_progress', '#f97316',
        'done', '#16a34a',
        'rejected', '#475569',
        '#94a3b8',
      ] as never,
      'line-width': [
        'match',
        ['get', 'priority'],
        'high', 3,
        'medium', 2,
        'low', 1.5,
        2,
      ] as never,
      'line-opacity': 0.95,
    },
  });

  map.addLayer({
    id: LAYER_LABEL,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 11,
    filter: [
      'all',
      ['!=', ['coalesce', ['get', 'name'], ''], ''],
      ['!=', ['downcase', ['coalesce', ['get', 'name'], '']], 'mark'],
      ['!=', ['downcase', ['coalesce', ['get', 'name'], '']], 'marker'],
    ] as never,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Regular'] as never,
      'text-size': 12,
      'symbol-placement': 'point',
    },
    paint: {
      'text-color': '#0f172a',
      'text-halo-color': '#fff',
      'text-halo-width': 1.5,
    },
  });
}

export function updateZonesLayer(map: MlMap, zones: Zone[]) {
  const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(zonesToGeoJSON(zones));
}

export const ZONES_LAYER_ID = LAYER_FILL;
