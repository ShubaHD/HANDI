import type { Feature, FeatureCollection } from 'geojson';

function stripDisallowedControls(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const allowed = c === 9 || c === 10 || c === 13;
    if (c < 32 && !allowed) continue;
    out += str[i];
  }
  return out;
}

/** Strip control chars / ZWSP / crude AutoCAD field wrappers so labels map cleanly in MapLibre. */
export function normalizeCadMapLabelString(s: string): string {
  return stripDisallowedControls(String(s ?? ''))
    .replace(/[\u200b-\u200d\ufeff]/g, '')
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
