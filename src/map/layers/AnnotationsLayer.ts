import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Annotation } from '@/lib/types';

const SOURCE_ID = 'annotations-source';
const LAYER_SYMBOLS = 'annotations-symbols';
const LAYER_TEXT = 'annotations-text';
const LAYER_ARROWS = 'annotations-arrows';
const LAYER_ARROW_HEADS = 'annotations-arrow-heads';

const ANNOT_TEXT_FONT = ['Open Sans Regular'];
const ANNOT_TEXT_EXPR: unknown[] = ['coalesce', ['get', 'text'], ''];

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

function styleProps(a: Annotation): Record<string, unknown> {
  const s = a.style ?? {};
  if (a.kind === 'arrow' || a.kind === 'sketch') {
    const def = a.kind === 'sketch' ? '#f97316' : '#22c55e';
    return { arrow_color: typeof s.arrowColor === 'string' ? s.arrowColor : def };
  }
  if (a.kind === 'text') {
    return {
      text_size_px: typeof s.textSizePx === 'number' ? s.textSizePx : 14,
      text_color: typeof s.textColor === 'string' ? s.textColor : '#f1f5f9',
    };
  }
  return {};
}

function annotationsToGeoJSON(
  annotations: Annotation[],
): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  const features: Array<GeoJSON.Feature<GeoJSON.Geometry>> = [];

  for (const a of annotations) {
    const extra = styleProps(a);
    const props: Record<string, unknown> = {
      id: a.id,
      kind: a.kind,
      symbol: a.symbol,
      text: a.text,
      visibility: a.visibility,
      symbol_label: a.symbol ? symbolLabel(a.symbol) : '',
      ...extra,
    };
    if (a.kind === 'arrow' && a.bearing_deg != null && Number.isFinite(a.bearing_deg)) {
      props.bearing_deg = a.bearing_deg;
    }
    features.push({
      type: 'Feature',
      geometry: a.geom,
      properties: props,
    });

    if (a.kind === 'arrow' && a.geom.type === 'LineString') {
      const coords = a.geom.coordinates;
      if (coords.length >= 2) {
        const p1 = coords[coords.length - 2];
        const p2 = coords[coords.length - 1];
        const bearing = a.bearing_deg ?? computeBearingDeg(p1[0], p1[1], p2[0], p2[1]);
        const ac = (extra as { arrow_color?: string }).arrow_color ?? '#22c55e';
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: p2 },
          properties: {
            id: `${a.id}:head`,
            kind: 'arrowhead',
            visibility: a.visibility,
            bearing_deg: bearing,
            arrow_color: ac,
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

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: LAYER_ARROWS,
    type: 'line',
    source: SOURCE_ID,
    filter: ['any', ['==', ['get', 'kind'], 'arrow'], ['==', ['get', 'kind'], 'sketch']] as never,
    paint: {
      'line-color': ['coalesce', ['get', 'arrow_color'], '#22c55e'] as never,
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
      'text-color': ['coalesce', ['get', 'arrow_color'], '#22c55e'] as never,
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
      'text-field': ['get', 'symbol_label'],
      'text-size': 18,
      'text-allow-overlap': true,
      'text-anchor': 'center',
    },
    paint: {
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
    filter: [
      'all',
      ['==', ['get', 'kind'], 'text'],
      ['!=', ANNOT_TEXT_EXPR, ''],
      ['!=', ['downcase', ANNOT_TEXT_EXPR], 'mark'],
      ['!=', ['downcase', ANNOT_TEXT_EXPR], 'marker'],
    ] as never,
    layout: {
      'symbol-placement': 'point',
      'text-field': ['get', 'text'],
      'text-font': ANNOT_TEXT_FONT as never,
      'text-size': [
        'case',
        ['has', 'text_size_px'],
        ['max', 8, ['min', 44, ['to-number', ['get', 'text_size_px']]]],
        14,
      ] as never,
      'text-offset': [0, 0.9],
      'text-anchor': 'top',
      /** Rămâne lizibil orizontal pe ecran (nu se rotește odată cu bearing-ul hărții). */
      'text-rotation-alignment': 'viewport',
      'text-pitch-alignment': 'viewport',
      'text-rotate': 0,
      'text-writing-mode': ['horizontal'] as never,
      'text-max-width': 22,
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': ['coalesce', ['get', 'text_color'], '#f1f5f9'] as never,
      'text-halo-color': '#0f172a',
      'text-halo-width': 1.5,
    },
  });
}

export function updateAnnotationsLayer(map: MlMap, annotations: Annotation[]) {
  const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(annotationsToGeoJSON(annotations));
}
