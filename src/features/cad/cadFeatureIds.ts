import type { Feature, FeatureCollection } from 'geojson';
import { normalizeCadMapLabelString } from './cadMapLabels';

/** Stable id for picking / updating CAD GeoJSON features (client-side). */
export const CAD_FEATURE_ID_KEY = '_fid' as const;

export type CadLabelEditTapPayload = {
  layerRowId: string;
  lon: number;
  lat: number;
  featureFid?: string;
};

export function ensureCadFeatureCollectionIds(fc: FeatureCollection): FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      if (typeof p[CAD_FEATURE_ID_KEY] === 'string' && (p[CAD_FEATURE_ID_KEY] as string).length > 0) {
        return f;
      }
      return {
        ...f,
        properties: { ...p, [CAD_FEATURE_ID_KEY]: crypto.randomUUID() },
      };
    }),
  };
}

export function cadLabelTextFromProps(p: Record<string, unknown> | null | undefined): string {
  if (!p) return '';
  const raw =
    (typeof p.cad_label === 'string' ? p.cad_label : '') ||
    (typeof p.dxfText === 'string' ? p.dxfText : '') ||
    (typeof p.text === 'string' ? p.text : '') ||
    (typeof p.block === 'string' ? p.block : '') ||
    (typeof (p as { name?: unknown }).name === 'string' ? String((p as { name?: unknown }).name) : '');
  return normalizeCadMapLabelString(raw);
}

function pointHasCadLabel(f: Feature): boolean {
  return f.geometry?.type === 'Point' && cadLabelTextFromProps(f.properties as Record<string, unknown>).length > 0;
}

export function findCadPointLabelFeatureIndex(
  fc: FeatureCollection,
  opts: { fid?: string; lon: number; lat: number; eps?: number },
): number {
  const eps = opts.eps ?? 1e-5;
  if (opts.fid) {
    const i = fc.features.findIndex(
      (f) =>
        pointHasCadLabel(f) &&
        (f.properties as Record<string, unknown> | undefined)?.[CAD_FEATURE_ID_KEY] === opts.fid,
    );
    if (i >= 0) return i;
  }
  return fc.features.findIndex((f) => {
    if (!pointHasCadLabel(f) || f.geometry?.type !== 'Point') return false;
    const [x, y] = f.geometry.coordinates;
    return Math.abs(x - opts.lon) < eps && Math.abs(y - opts.lat) < eps;
  });
}

export function updateCadPointLabelInCollection(
  fc: FeatureCollection,
  index: number,
  newText: string,
): FeatureCollection {
  if (index < 0 || index >= fc.features.length) return fc;
  const features = fc.features.map((f, i) => {
    if (i !== index) return f;
    const p = { ...(f.properties as Record<string, unknown> | null) } as Record<string, unknown>;
    p.cad_label = newText;
    p.dxfText = newText;
    p.text = newText;
    return { ...f, properties: p };
  });
  return { ...fc, features };
}
