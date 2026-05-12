import type { Feature, FeatureCollection } from 'geojson';
import { normalizeCadMapLabelString } from './cadMapLabels';

/** Stable id for picking / updating CAD GeoJSON features (client-side). */
export const CAD_FEATURE_ID_KEY = '_fid' as const;

/** Metadate teren (nu vin din DXF); persistă în `cad_layers.features` GeoJSON. */
export const HANDI_CAD_DESC_KEY = 'handi_description' as const;
export const HANDI_CAD_PHOTO_URL_KEY = 'handi_photo_url' as const;
export const HANDI_CAD_PHOTO_PATH_KEY = 'handi_photo_path' as const;

export function cadLabelHandiDescriptionFromProps(p: Record<string, unknown> | null | undefined): string {
  const v = p?.[HANDI_CAD_DESC_KEY];
  return typeof v === 'string' ? v : '';
}

export function cadLabelHandiPhotoUrlFromProps(p: Record<string, unknown> | null | undefined): string | null {
  const v = p?.[HANDI_CAD_PHOTO_URL_KEY];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export function cadLabelHandiPhotoPathFromProps(p: Record<string, unknown> | null | undefined): string | null {
  const v = p?.[HANDI_CAD_PHOTO_PATH_KEY];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

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

export type CadLabelPhotoPatch = 'keep' | 'remove' | { url: string; path: string };

/** Actualizează textul etichetei + descriere / poză (URL + path storage). */
export function patchCadLabelFeatureMetadata(
  fc: FeatureCollection,
  index: number,
  parts: {
    text: string;
    description: string;
    photo: CadLabelPhotoPatch;
  },
): FeatureCollection {
  if (index < 0 || index >= fc.features.length) return fc;
  const features = fc.features.map((f, i) => {
    if (i !== index) return f;
    const p = { ...(f.properties as Record<string, unknown> | null) } as Record<string, unknown>;
    const t = parts.text.trim();
    p.cad_label = t;
    p.dxfText = t;
    p.text = t;
    const d = parts.description.trim();
    if (d) p[HANDI_CAD_DESC_KEY] = d;
    else delete p[HANDI_CAD_DESC_KEY];

    if (parts.photo === 'remove') {
      delete p[HANDI_CAD_PHOTO_URL_KEY];
      delete p[HANDI_CAD_PHOTO_PATH_KEY];
    } else if (parts.photo !== 'keep' && typeof parts.photo === 'object') {
      p[HANDI_CAD_PHOTO_URL_KEY] = parts.photo.url;
      p[HANDI_CAD_PHOTO_PATH_KEY] = parts.photo.path;
    }
    return { ...f, properties: p };
  });
  return { ...fc, features };
}

/** Elimină complet un feature (ex. punct TEXT) din colecția stratului CAD. */
export function removeCadFeatureAtIndex(fc: FeatureCollection, index: number): FeatureCollection {
  if (index < 0 || index >= fc.features.length) return fc;
  return { ...fc, features: fc.features.filter((_, i) => i !== index) };
}
