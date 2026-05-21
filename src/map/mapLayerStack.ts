import type { Map as MlMap } from 'maplibre-gl';

/** Primul strat vector deasupra căruia stau ortofoto / PMTiles (sub CAD, puncte, etc.). */
const EXACT_LAYER_IDS_ABOVE_RASTER = [
  'zones-fill',
  'tracks-line',
  'live-track-line',
  'annotations-symbols',
  'poi-circles',
] as const;

const PREFIX_LAYER_IDS_ABOVE_RASTER = ['cadlay-', 'cave-plans-'] as const;

export function beforeIdForRasterOverlay(map: MlMap): string | undefined {
  for (const layer of map.getStyle().layers ?? []) {
    if ((EXACT_LAYER_IDS_ABOVE_RASTER as readonly string[]).includes(layer.id)) {
      return layer.id;
    }
    for (const prefix of PREFIX_LAYER_IDS_ABOVE_RASTER) {
      if (layer.id.startsWith(prefix)) return layer.id;
    }
  }
  return undefined;
}

export function ensureRasterLayerBelowVectors(map: MlMap, layerId: string): void {
  if (!map.getLayer(layerId)) return;
  const beforeId = beforeIdForRasterOverlay(map);
  if (!beforeId) return;
  try {
    map.moveLayer(layerId, beforeId);
  } catch {
    /* layer deja sub beforeId sau stil în curs de schimbare */
  }
}
