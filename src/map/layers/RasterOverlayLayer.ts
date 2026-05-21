import type { Map as MlMap } from 'maplibre-gl';
import type { RasterOverlay } from '@/lib/types';
import { mapAcceptsOverlayLayers } from '@/map/mapOverlayReadiness';
import { isRasterPmtilesOverlay, publicUrl, rasterCornersFromBounds } from '@/features/rasters/api';

const SOURCE_PREFIX = 'raster-overlay-src-';
const LAYER_PREFIX = 'raster-overlay-lyr-';

export interface RasterLayerState {
  visibleIds: Set<string>;
  opacity: Record<string, number>;
  pmtilesUrlByRasterId?: Record<string, string>;
  pmtilesZoomByRasterId?: Record<string, { minzoom: number; maxzoom: number }>;
}

export function syncRasterLayers(
  map: MlMap,
  rasters: RasterOverlay[],
  state: RasterLayerState,
) {
  if (!mapAcceptsOverlayLayers(map)) return;

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
    const srcId = SOURCE_PREFIX + r.id;
    const lyrId = LAYER_PREFIX + r.id;
    const opacity = state.opacity[r.id] ?? 0.7;

    const isPMTiles = isRasterPmtilesOverlay(r);
    const metaUrl = (r.metadata as { pmtiles_url?: unknown } | null | undefined)?.pmtiles_url;
    const overrideUrl = state.pmtilesUrlByRasterId?.[r.id];
    const zoomOverride = state.pmtilesZoomByRasterId?.[r.id];
    const url =
      typeof overrideUrl === 'string' && overrideUrl.trim()
        ? overrideUrl.trim()
        : typeof metaUrl === 'string' && metaUrl.trim()
          ? metaUrl.trim()
          : publicUrl(r.storage_path);

    if (!map.getSource(srcId)) {
      if (isPMTiles) {
        const meta = r.metadata as { maxzoom?: unknown; minzoom?: unknown } | null | undefined;
        const maxzoom = Number.isFinite(zoomOverride?.maxzoom)
          ? zoomOverride!.maxzoom
          : Number(meta?.maxzoom);
        const minzoomRaw = zoomOverride?.minzoom ?? meta?.minzoom;
        const minzoom = Number(
          typeof minzoomRaw === 'number' || typeof minzoomRaw === 'string'
            ? minzoomRaw
            : Number.isFinite(maxzoom)
              ? maxzoom
              : NaN,
        );
        map.addSource(srcId, {
          type: 'raster',
          url: `pmtiles://${url}`,
          tileSize: 256,
          ...(Number.isFinite(minzoom) ? { minzoom } : {}),
          ...(Number.isFinite(maxzoom) ? { maxzoom } : {}),
        });
      } else {
        const corners = rasterCornersFromBounds(r.bounds);
        if (!corners) continue;
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
        map.addSource(srcId, {
          type: 'image',
          url,
          coordinates,
        });
      }
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
