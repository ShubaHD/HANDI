import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import { POINT_TYPES, type PointOfInterest } from '@/lib/types';

const SOURCE_ID = 'poi-source';
const LAYER_CIRCLES = 'poi-circles';
const LAYER_LABELS = 'poi-labels';

function pointsToGeoJSON(points: PointOfInterest[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id,
        name: p.name,
        type: p.type,
        visibility: p.visibility,
      },
    })),
  };
}

export function addPointsLayer(map: MlMap) {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  const colorMatch: (string | string[])[] = ['match', ['get', 'type']];
  for (const t of POINT_TYPES) {
    colorMatch.push(t.value, t.color);
  }
  colorMatch.push('#94a3b8');

  map.addLayer({
    id: LAYER_CIRCLES,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['!=', ['get', 'type'], 'label'] as never,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 8, 18, 12],
      'circle-color': colorMatch as never,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
      'circle-opacity': ['case', ['==', ['get', 'visibility'], 'private'], 0.7, 1],
    },
  });

  map.addLayer({
    id: LAYER_LABELS,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 12,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 11,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': '#0f172a',
      'text-halo-color': '#fff',
      'text-halo-width': 1.5,
    },
  });
}

export function updatePointsLayer(map: MlMap, points: PointOfInterest[]) {
  const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(pointsToGeoJSON(points));
}

export const POINTS_LAYER_ID = LAYER_CIRCLES;
