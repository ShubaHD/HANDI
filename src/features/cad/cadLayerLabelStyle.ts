/** Citește câmpuri din `cad_layers.style` (JSON) cu toleranță la tipuri din PostgREST / serializare. */

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
