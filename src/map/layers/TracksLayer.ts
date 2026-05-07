import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Track } from '@/lib/types';

const SOURCE_ID = 'tracks-source';
const LAYER_LINE = 'tracks-line';
const LAYER_LIVE_SOURCE = 'live-track-source';
const LAYER_LIVE = 'live-track-line';

function tracksToGeoJSON(tracks: Track[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: tracks.map((t) => ({
      type: 'Feature',
      geometry: t.geom,
      properties: {
        id: t.id,
        name: t.name,
        source: t.source,
        visibility: t.visibility,
      },
    })),
  };
}

export function addTracksLayer(map: MlMap) {
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
        ['get', 'source'],
        'recorded', '#dc2626',
        'gpx_import', '#2563eb',
        '#7c3aed',
      ] as never,
      'line-width': 3,
      'line-opacity': 0.85,
    },
  });

  if (!map.getSource(LAYER_LIVE_SOURCE)) {
    map.addSource(LAYER_LIVE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: LAYER_LIVE,
      type: 'line',
      source: LAYER_LIVE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ef4444',
        'line-width': 4,
        'line-dasharray': [2, 2],
      },
    });
  }
}

export function updateTracksLayer(map: MlMap, tracks: Track[]) {
  const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(tracksToGeoJSON(tracks));
}

export function updateLiveTrack(map: MlMap, coords: [number, number][]) {
  const src = map.getSource(LAYER_LIVE_SOURCE) as GeoJSONSource | undefined;
  if (!src) return;
  if (coords.length < 2) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  src.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      },
    ],
  });
}

export const TRACKS_LAYER_ID = LAYER_LINE;
