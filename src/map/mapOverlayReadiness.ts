import type { Map as MlMap } from 'maplibre-gl';

/**
 * MapLibre poate păstra `isStyleLoaded() === false` dacă tile-urile raster ale basemap-ului
 * nu sosesc (offline, rețea, PMTiles fără tile la zoomul curent). GeoJSON (CAD, puncte, …)
 * poate fi desenat deasupra fundalului chiar și fără acele tile-uri.
 */
export function mapAcceptsOverlayLayers(map: MlMap): boolean {
  try {
    if (map.isStyleLoaded()) return true;
    const st = map.getStyle();
    if (!st?.layers?.length) return false;
    return map.getSource('base') != null;
  } catch {
    return false;
  }
}
