/**
 * Glyph-uri pentru straturi `symbol` (etichete CAD, puncte, zone, adnotări).
 * demotiles.maplibre.org/font/... returnează 404 pentru Open Sans pe multe medii → hartă albastră / erori în buclă.
 * OpenMapTiles găzduiește aceleași familii (Open Sans, Noto Sans, …) pe HTTPS.
 */
export const MAP_GLYPHS_URL = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';

/** Trebuie să coincidă cu un font disponibil la MAP_GLYPHS_URL. */
export const MAP_SYMBOL_FONT: string[] = ['Open Sans Regular'];
