import type { Map as MlMap } from 'maplibre-gl';
import type { RasterOverlay } from '@/lib/types';
import { publicUrl, rasterCornersFromBounds } from '@/features/rasters/api';

const SOURCE_PREFIX = 'raster-overlay-src-';
const LAYER_PREFIX = 'raster-overlay-lyr-';

export interface RasterLayerState {
  visibleIds: Set<string>;
  opacity: Record<string, number>;
}

export function syncRasterLayers(
  map: MlMap,
  rasters: RasterOverlay[],
  state: RasterLayerState,
) {
  if (!map.isStyleLoaded()) return;

  const desiredIds = new Set(rasters.filter((r) => state.visibleIds.has(r.id)).map((r) => r.id));

  // Sterge layer-uri pentru rasterele care nu mai sunt vizibile.
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    if (layer.id.startsWith(LAYER_PREFIX)) {
      const id = layer.id.slice(LAYER_PREFIX.length);
      if (!desiredIds.has(id)) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        const srcId = SOURCE_PREFIX + id;
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    }
  }

  // Adauga / actualizeaza pentru cele vizibile.
  for (const r of rasters) {
    if (!state.visibleIds.has(r.id)) continue;
    const corners = rasterCornersFromBounds(r.bounds);
    if (!corners) continue;
    const srcId = SOURCE_PREFIX + r.id;
    const lyrId = LAYER_PREFIX + r.id;
    const url = publicUrl(r.storage_path);
    const coordinates: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [corners.minLon, corners.maxLat],
      [corners.maxLon, corners.maxLat],
      [corners.maxLon, corners.minLat],
      [corners.minLon, corners.minLat],
    ];
    const opacity = state.opacity[r.id] ?? 0.7;

    if (!map.getSource(srcId)) {
      map.addSource(srcId, {
        type: 'image',
        url,
        coordinates,
      });
    }

    if (!map.getLayer(lyrId)) {
      map.addLayer({
        id: lyrId,
        type: 'raster',
        source: srcId,
        paint: {
          'raster-opacity': opacity,
          'raster-fade-duration': 200,
        },
      });
    } else {
      map.setPaintProperty(lyrId, 'raster-opacity', opacity);
    }
  }
}
