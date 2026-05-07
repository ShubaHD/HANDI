import type { Map as MlMap } from 'maplibre-gl';

const SOURCE_ID = 'hillshade-terrarium';
const LAYER_ID = 'hillshade-overlay';

export function addHillshadeOverlay(map: MlMap) {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    tileSize: 256,
    encoding: 'terrarium',
    maxzoom: 15,
    attribution:
      'Terrain Tiles by Mapzen / AWS Open Data (CC-BY)',
  });

  map.addLayer({
    id: LAYER_ID,
    type: 'hillshade',
    source: SOURCE_ID,
    paint: {
      'hillshade-exaggeration': 0.6,
      'hillshade-shadow-color': '#000',
      'hillshade-highlight-color': '#fff',
      'hillshade-accent-color': '#5a4a3a',
    },
    layout: { visibility: 'none' },
  });
}

export function setHillshadeVisible(map: MlMap, visible: boolean) {
  if (!map.getLayer(LAYER_ID)) return;
  map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
}

export function setHillshadeOpacity(map: MlMap, opacity: number) {
  if (!map.getLayer(LAYER_ID)) return;
  map.setPaintProperty(LAYER_ID, 'hillshade-exaggeration', opacity);
}
