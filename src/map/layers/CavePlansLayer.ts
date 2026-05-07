import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { CavePlan } from '@/features/cavePlans/api';

const SOURCE_ID = 'cave-plans-source';
const LAYER_LINE = 'cave-plans-line';
const LAYER_LABEL = 'cave-plans-label';

function toGeoJSON(plans: CavePlan[]): GeoJSON.FeatureCollection<GeoJSON.MultiLineString> {
  return {
    type: 'FeatureCollection',
    features: plans.map((p) => ({
      type: 'Feature',
      geometry: p.geom,
      properties: {
        id: p.id,
        name: p.name,
        kind: p.kind,
        visibility: p.visibility,
      },
    })),
  };
}

export function addCavePlansLayer(map: MlMap) {
  if (map.getSource(SOURCE_ID)) return;
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LAYER_LINE,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': [
        'match',
        ['get', 'kind'],
        'survey_plan',
        '#22c55e',
        'geology',
        '#0ea5e9',
        'other',
        '#a855f7',
        '#22c55e',
      ] as never,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2.5, 18, 4] as never,
      'line-opacity': ['case', ['==', ['get', 'visibility'], 'private'], 0.7, 0.95] as never,
    },
  });

  map.addLayer({
    id: LAYER_LABEL,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 13,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'symbol-placement': 'line',
      'text-optional': true,
    },
    paint: {
      'text-color': '#0f172a',
      'text-halo-color': '#fff',
      'text-halo-width': 1.5,
    },
  });
}

export function updateCavePlansLayer(map: MlMap, plans: CavePlan[]) {
  const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(toGeoJSON(plans));
}

export const CAVE_PLANS_LAYER_ID = LAYER_LINE;

