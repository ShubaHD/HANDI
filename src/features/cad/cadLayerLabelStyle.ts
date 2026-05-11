/** Citește câmpuri din `cad_layers.style` (JSON) cu toleranță la tipuri din PostgREST / serializare. */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandShortHex(hex: string): string {
  const h = hex.trim();
  if (h.length === 4 && h.startsWith('#')) {
    const r = h[1]!,
      g = h[2]!,
      b = h[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return h.toLowerCase();
}

/** Culoare text etichetă; fallback de obicei = culoarea layerului (`color`). */
export function cadLabelTextColorFromStyle(
  style: Record<string, unknown> | null | undefined,
  fallback: string,
): string {
  const c = style?.cadLabelTextColor;
  if (typeof c === 'string' && HEX_COLOR.test(c.trim())) return expandShortHex(c.trim());
  const f = typeof fallback === 'string' ? fallback.trim() : '';
  if (HEX_COLOR.test(f)) return expandShortHex(f);
  return '#0f172a';
}

/** Etichetă fără „cutie” (Leaflet) și fără contur/halo (MapLibre). */
export function cadLabelPlainFromStyle(style: Record<string, unknown> | null | undefined): boolean {
  const v = style?.cadLabelPlain;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function finiteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Mărime text etichetă (px), 8–28; lipsă = implicit în renderer. */
export function cadLabelTextSizeFromStyle(style: Record<string, unknown> | null | undefined): number | undefined {
  const n = finiteNumber(style?.cadLabelTextSize);
  if (n == null) return undefined;
  return Math.min(28, Math.max(8, Math.round(n)));
}

function finiteZoom(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function cadLabelMinZoomFromStyle(style: Record<string, unknown> | null | undefined): number | undefined {
  return finiteZoom(style?.cadLabelMinZoom);
}

export function cadLabelMaxZoomFromStyle(style: Record<string, unknown> | null | undefined): number | undefined {
  return finiteZoom(style?.cadLabelMaxZoom);
}

/** Blocat editare din hartă: acceptă boolean, string "true", 1. */
export function cadLabelLockedFromStyle(style: Record<string, unknown> | null | undefined): boolean {
  const v = style?.cadLabelLocked;
  return v === true || v === 'true' || v === 1 || v === '1';
}
