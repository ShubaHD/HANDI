import type { Map as MlMap } from 'maplibre-gl';
import type { CadLayerRow } from '@/features/cad/api';
import { sanitizeCadLabelsFeatureCollection } from '@/features/cad/cadMapLabels';
import type { FeatureCollection } from 'geojson';

const PREFIX_SRC = 'cadsrc-';
const PREFIX_LAYER = 'cadlay-';

/** MapLibre expression: resolved label string from GeoJSON properties (new + legacy imports). */
const cadLabelExpr: unknown[] = ['coalesce', ['get', 'cad_label'], ['get', 'dxfText'], ['get', 'text'], ''];

/** Glyphs on demotiles host (same as app basemap `glyphs` URL). */
const CAD_LABEL_TEXT_FONT = ['Open Sans Regular'];

function styleDefaults(row: CadLayerRow): { color: string; width: number; opacity: number } {
  const s = row.style as { color?: string; width?: number; opacity?: number };
  return {
    color: typeof s.color === 'string' ? s.color : '#94a3b8',
    width: typeof s.width === 'number' ? s.width : 2,
    opacity: typeof s.opacity === 'number' ? s.opacity : 0.85,
  };
}

function removeAllCadLayers(map: MlMap) {
  const style = map.getStyle();
  for (const l of [...(style.layers ?? [])].reverse()) {
    if (l.id.startsWith(PREFIX_LAYER)) {
      if (map.getLayer(l.id)) map.removeLayer(l.id);
    }
  }
  for (const sid of Object.keys(style.sources ?? {})) {
    if (sid.startsWith(PREFIX_SRC) && map.getSource(sid)) {
      map.removeSource(sid);
    }
  }
}

export function updateCadLayersOnMap(map: MlMap, rows: CadLayerRow[]) {
  if (!map.isStyleLoaded()) return;
  removeAllCadLayers(map);

  for (const row of rows) {
    if (!row.visible) continue;
    const fc = row.features as FeatureCollection;
    if (!fc.features?.length) continue;

    const srcId = `${PREFIX_SRC}${row.id}`;
    const st = styleDefaults(row);

    // Same DXF layer often mixes cave polylines + TEXT (e.g. layer "CAVE" → kind `caves`); sanitize keeps lines + label points.
    const useSanitizedLabelPoints = row.kind === 'labels' || row.kind === 'caves';
    const dataFc = useSanitizedLabelPoints ? sanitizeCadLabelsFeatureCollection(fc) : fc;
    if (row.kind === 'labels' && (!dataFc.features || dataFc.features.length === 0)) continue;

    map.addSource(srcId, { type: 'geojson', data: dataFc });

    const addCadTextSymbolLayer = () => {
      map.addLayer({
        id: `${PREFIX_LAYER}${row.id}-sym`,
        type: 'symbol',
        source: srcId,
        filter: [
          'all',
          ['==', ['geometry-type'], 'Point'],
          ['!=', cadLabelExpr, ''],
          ['!=', ['downcase', cadLabelExpr], 'mark'],
          ['!=', ['downcase', cadLabelExpr], 'marker'],
        ] as never,
        layout: {
          'text-field': cadLabelExpr as never,
          'text-font': CAD_LABEL_TEXT_FONT as never,
          'text-size': 13,
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-allow-overlap': true,
          'text-optional': true,
        },
        paint: {
          'text-color': st.color,
          'text-halo-color': '#fff',
          'text-halo-width': 1.2,
          'text-opacity': st.opacity,
        },
      });
    };

    if (row.kind === 'labels') {
      addCadTextSymbolLayer();
      continue;
    }

    if (row.kind === 'caves') {
      addCadTextSymbolLayer();
    }

    if (row.kind === 'springs' || row.kind === 'avens') {
      map.addLayer({
        id: `${PREFIX_LAYER}${row.id}-pt`,
        type: 'circle',
        source: srcId,
        filter: ['==', ['geometry-type'], 'Point'] as never,
        paint: {
          'circle-radius': 5,
          'circle-color': st.color,
          'circle-opacity': st.opacity,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
        },
      });
    }

    const lineFilter: unknown[] = [
      'any',
      ['==', ['geometry-type'], 'LineString'],
      ['==', ['geometry-type'], 'MultiLineString'],
      ['==', ['geometry-type'], 'Polygon'],
    ];

    if (row.kind === 'dolines') {
      map.addLayer({
        id: `${PREFIX_LAYER}${row.id}-fill`,
        type: 'fill',
        source: srcId,
        filter: ['==', ['geometry-type'], 'Polygon'] as never,
        paint: {
          'fill-color': st.color,
          'fill-opacity': Math.min(0.45, st.opacity * 0.5),
        },
      });
    }

    const minzoom = row.kind === 'contours' ? 12 : 0;

    map.addLayer({
      id: `${PREFIX_LAYER}${row.id}-line`,
      type: 'line',
      source: srcId,
      minzoom,
      filter: lineFilter as never,
      paint: {
        'line-color': st.color,
        'line-width': st.width,
        'line-opacity': st.opacity,
      },
    });
  }
}

export function getCadLayerPrefix(): string {
  return PREFIX_LAYER;
}

/** MapLibre layer id `cadlay-{rowUuid}-sym` → `cad_layers.id`. */
export function cadLayerRowIdFromSymbolLayerId(layerId: string): string | null {
  if (!layerId.startsWith(PREFIX_LAYER) || !layerId.endsWith('-sym')) return null;
  return layerId.slice(PREFIX_LAYER.length, -'-sym'.length);
}
