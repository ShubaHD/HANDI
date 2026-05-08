import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Annotation } from '@/lib/types';

const SOURCE_ID = 'annotations-source';
const LAYER_SYMBOLS = 'annotations-symbols';
const LAYER_TEXT = 'annotations-text';
const LAYER_ARROWS = 'annotations-arrows';
const LAYER_ARROW_HEADS = 'annotations-arrow-heads';

function symbolLabel(symbol: string): string {
  switch (symbol) {
    case 'diaclaza':
      return '⟂';
    case 'dolina':
      return '◯';
    case 'abrupt':
      return '⛰';
    case 'pestera':
      return '⊙';
    case 'intrebare':
      return '?';
    case 'mirare':
      return '!';
    case 'ravene':
      return 'V';
    case 'ponoare':
      return '⊘';
    case 'izbuc':
      return '⛲';
    case 'depresiune_hachuri':
      return '⌵';
    case 'alunecare':
      return '⇣';
    default:
      return '•';
  }
}

function annotationsToGeoJSON(
  annotations: Annotation[],
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  const features: Array<GeoJSON.Feature<GeoJSON.Geometry>> = [];

  for (const a of annotations) {
    features.push({
      type: 'Feature',
      geometry: a.geom,
      properties: {
        id: a.id,
        kind: a.kind,
        symbol: a.symbol,
        text: a.text,
        visibility: a.visibility,
        bearing_deg: a.bearing_deg,
        symbol_label: a.symbol ? symbolLabel(a.symbol) : '',
        icon: a.symbol ? `sym-${a.symbol}` : '',
      },
    });

    if (a.kind === 'arrow' && a.geom.type === 'LineString') {
      const coords = a.geom.coordinates;
      if (coords.length >= 2) {
        const p1 = coords[coords.length - 2];
        const p2 = coords[coords.length - 1];
        const bearing = a.bearing_deg ?? computeBearingDeg(p1[0], p1[1], p2[0], p2[1]);
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: p2 },
          properties: {
            id: `${a.id}:head`,
            kind: 'arrowhead',
            visibility: a.visibility,
            bearing_deg: bearing,
          },
        });
      }
    }
  }

  return { type: 'FeatureCollection', features };
}

function computeBearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

export function addAnnotationsLayer(map: MlMap) {
  if (map.getSource(SOURCE_ID)) return;

  ensureSymbolImages(map);

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LAYER_ARROWS,
    type: 'line',
    source: SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'arrow'] as never,
    paint: {
      'line-color': '#22c55e',
      'line-width': 3,
      'line-opacity': 0.9,
    },
  });

  map.addLayer({
    id: LAYER_ARROW_HEADS,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['==', ['get', 'kind'], 'arrowhead'] as never,
    layout: {
      'text-field': '➤',
      'text-size': 16,
      'text-allow-overlap': true,
      'text-rotate': ['get', 'bearing_deg'] as never,
      'text-rotation-alignment': 'map',
    },
    paint: {
      'text-color': '#22c55e',
      'text-halo-color': '#0f172a',
      'text-halo-width': 1.2,
    },
  });

  map.addLayer({
    id: LAYER_SYMBOLS,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 10,
    filter: ['==', ['get', 'kind'], 'symbol'] as never,
    layout: {
      'icon-image': ['get', 'icon'] as never,
      'icon-size': 0.6,
      'icon-allow-overlap': true,
      'icon-optional': true,
      'text-field': ['get', 'symbol_label'],
      'text-size': 14,
      'text-allow-overlap': true,
      'text-anchor': 'center',
    },
    paint: {
      'icon-color': '#a855f7',
      'text-color': '#a855f7',
      'text-halo-color': '#fff',
      'text-halo-width': 1.2,
      'text-opacity': ['case', ['==', ['get', 'visibility'], 'private'], 0.85, 1] as never,
    },
  });

  map.addLayer({
    id: LAYER_TEXT,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 11,
    filter: ['==', ['get', 'kind'], 'text'] as never,
    layout: {
      'text-field': ['get', 'text'],
      'text-size': 12,
      'text-offset': [0, 0.9],
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

export function updateAnnotationsLayer(map: MlMap, annotations: Annotation[]) {
  const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(annotationsToGeoJSON(annotations));
}

function ensureSymbolImages(map: MlMap) {
  const symbols = [
    'diaclaza',
    'dolina',
    'abrupt',
    'pestera',
    'intrebare',
    'mirare',
    'ravene',
    'ponoare',
    'izbuc',
    'depresiune_hachuri',
    'alunecare',
  ] as const;

  for (const s of symbols) {
    const name = `sym-${s}`;
    if (map.hasImage(name)) continue;
    void map
      .loadImage(`/symbols/${s}.svg`)
      .then((res) => {
        const img = (res as unknown as { data?: unknown }).data ?? res;
        if (!img) return;
        try {
          if (!map.hasImage(name)) map.addImage(name, img as never, { sdf: true });
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* ignore */
      });
  }
}

