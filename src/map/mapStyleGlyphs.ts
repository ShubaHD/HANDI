/**
 * Glyph-uri pentru straturi `symbol` (etichete CAD, puncte, zone, adnotări).
 * - `public/glyphs/...` — același layout ca OpenMapTiles; funcționează **offline** (PMTiles / fără semnal).
 * - Fallback HTTPS doar pentru SSR / teste fără `window`.
 */
export function getMapGlyphsUrl(): string {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf';
  }
  const base = String(import.meta.env.BASE_URL ?? '/');
  const prefix = base === '/' ? '' : base.replace(/\/$/, '');
  return `${window.location.origin}${prefix}/glyphs/{fontstack}/{range}.pbf`.replace(/([^:])\/{2,}/g, '$1/');
}

/** Trebuie să coincidă cu fontul din `public/glyphs/{fontstack}/`. */
export const MAP_SYMBOL_FONT: string[] = ['Open Sans Regular'];
