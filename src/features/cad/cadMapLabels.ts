import type { Feature, FeatureCollection } from 'geojson';

/** Strip control chars / ZWSP / crude AutoCAD field wrappers so labels map cleanly in MapLibre. */
export function normalizeCadMapLabelString(s: string): string {
  return String(s ?? '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/%<[^>%]*>%/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isJunkCadPlaceholderLabel(s: string): boolean {
  const t = normalizeCadMapLabelString(s).toLowerCase();
  return t === '' || t === 'mark' || t === 'marker';
}

/**
 * For CAD layers of kind `labels`, rewrite Point features so MapLibre only sees `cad_label`
 * (avoids edge cases with a property literally named `text`) and drops Civil3D placeholders.
 */
export function sanitizeCadLabelsFeatureCollection(fc: FeatureCollection): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.flatMap((f) => sanitizeCadLabelFeature(f)),
  };
}

function sanitizeCadLabelFeature(f: Feature): Feature[] {
  if (f.geometry?.type !== 'Point') return [f];
  const p = (f.properties ?? {}) as Record<string, unknown>;
  if (p.cad_label == null && p.dxfText == null && p.text == null) return [f];

  const merged = normalizeCadMapLabelString(String(p.cad_label ?? p.dxfText ?? p.text ?? ''));
  if (isJunkCadPlaceholderLabel(merged)) return [];

  const next: Record<string, unknown> = { ...p, cad_label: merged };
  delete next.dxfText;
  delete next.text;
  return [{ ...f, properties: next }];
}
