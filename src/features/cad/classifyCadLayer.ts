import { featureCollection, lineString, nearestPointOnLine, point } from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';
import type { CadLayerGroup } from './dxfImport';
import { simplifyLayerFeatures } from './dxfImport';

export type CadLayerKind =
  | 'caves'
  | 'dolines'
  | 'contours'
  | 'labels'
  | 'springs'
  | 'avens'
  | 'other';

const RULES: { kind: CadLayerKind; pattern: RegExp }[] = [
  { kind: 'caves', pattern: /^(PESTERI?|CAVE|CAV|PEST|INTRARE)/i },
  { kind: 'dolines', pattern: /^(DOLINE?|DOLINA|SINKHOLE)/i },
  { kind: 'contours', pattern: /^(CONTUR|CONTOUR|CURBE|NIVEL|ELEVATION|CN?)/i },
  { kind: 'labels', pattern: /^(NUME|NAME|LABEL|ETICHETA|TEXT)/i },
  { kind: 'springs', pattern: /^(IZVOR|SPRING|SOURCE)/i },
  { kind: 'avens', pattern: /^(AVEN|SHAFT|PUT)/i },
];

export function suggestKindForCadLayer(cadLayer: string): CadLayerKind {
  const n = cadLayer.trim();
  for (const r of RULES) {
    if (r.pattern.test(n)) return r.kind;
  }
  return 'other';
}

export function defaultStyleForKind(kind: CadLayerKind): { color: string; width: number; opacity: number } {
  switch (kind) {
    case 'caves':
      return { color: '#22c55e', width: 3, opacity: 0.95 };
    case 'dolines':
      return { color: '#f97316', width: 2, opacity: 0.5 };
    case 'contours':
      return { color: '#64748b', width: 1, opacity: 0.65 };
    case 'labels':
      return { color: '#0f172a', width: 1, opacity: 1 };
    case 'springs':
      return { color: '#06b6d4', width: 4, opacity: 0.9 };
    case 'avens':
      return { color: '#a855f7', width: 4, opacity: 0.9 };
    default:
      return { color: '#94a3b8', width: 2, opacity: 0.8 };
  }
}

export interface ClassifiedCadLayer extends CadLayerGroup {
  kind: CadLayerKind;
}

const LABEL_MAX_KM = 0.05; // ~50m

/** Classify each CAD layer, simplify contours, associate label points to nearest cave line. */
export function classifyCadImport(layers: CadLayerGroup[]): ClassifiedCadLayer[] {
  const classified: ClassifiedCadLayer[] = layers.map((g) => {
    const kind = suggestKindForCadLayer(g.cadLayer);
    let feats = [...g.features];
    if (kind === 'contours') {
      feats = simplifyLayerFeatures(feats, 0.000025);
    }
    return { ...g, kind, features: feats };
  });

  const caveLines = classified
    .filter((l) => l.kind === 'caves')
    .flatMap((l) => l.features)
    .filter((f) => f.geometry?.type === 'LineString');

  const labelLayers = classified.filter((l) => l.kind === 'labels');
  for (const ll of labelLayers) {
    ll.features = ll.features.map((f) => {
      if (f.geometry?.type !== 'Point') return f;
      const text = (f.properties?.text as string | undefined) ?? '';
      const pt = point(f.geometry.coordinates as [number, number]);
      let bestKm = Infinity;
      let bestName = '';
      for (const cave of caveLines) {
        if (cave.geometry?.type !== 'LineString') continue;
        const ls = lineString(cave.geometry.coordinates as [number, number][]);
        const snap = nearestPointOnLine(ls, pt, { units: 'kilometers' });
        const d =
          (snap.properties?.pointDistance as number | undefined) ??
          (snap.properties?.dist as number | undefined) ??
          Infinity;
        if (d < bestKm) {
          bestKm = d;
          bestName = (cave.properties?.label as string) || (cave.properties?.name as string) || '';
        }
      }
      const props = { ...f.properties };
      if (bestKm <= LABEL_MAX_KM && text) {
        props.nearestCaveKm = Math.round(bestKm * 1000);
        props.matchedCaveHint = bestName || 'aproape de linie pestera';
      }
      return { ...f, properties: props };
    });
  }

  return classified;
}

export function toFeatureCollection(features: Feature[]): FeatureCollection {
  return featureCollection(features);
}
