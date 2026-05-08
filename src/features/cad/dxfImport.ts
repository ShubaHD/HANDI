import proj4 from 'proj4';
import DxfParser from 'dxf-parser';
import { lineString, simplify } from '@turf/turf';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';

proj4.defs(
  'EPSG:3844',
  '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

// Dealul Piscului 1970 / Stereo 70 (deprecated EPSG:31700), commonly used legacy datum (Krassowsky 1940).
// Parameters from EPSG and widely used PROJ.4 definitions. Accuracy depends on source data.
proj4.defs(
  'EPSG:31700',
  '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass +towgs84=28,-121,-77,0,0,0,0 +units=m +no_defs',
);

type XY = { x: number; y: number; z?: number };

/** 2D affine: world = A * local + t */
export type Affine2D = {
  m11: number;
  m12: number;
  m21: number;
  m22: number;
  tx: number;
  ty: number;
};

export interface CadLayerGroup {
  cadLayer: string;
  features: Feature[];
}

export interface DxfParseDiagnostics {
  totalEntities: number;
  blocksCount: number;
  explodedFromBlocks: number;
  countsByType: Record<string, number>;
  skippedTypes: string[];
  sourceCrs: 'EPSG:3844' | 'EPSG:31700';
}

export interface ParsedDxfImport {
  name: string;
  layers: CadLayerGroup[];
  bbox4326: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  diagnostics: DxfParseDiagnostics;
}

const MAX_INSERT_DEPTH = 5;

export type Stereo70SourceCrs = 'EPSG:3844' | 'EPSG:31700';

const SUPPORTED_TYPES = new Set([
  'LINE',
  'LWPOLYLINE',
  'POLYLINE',
  'CIRCLE',
  'ARC',
  'TEXT',
  'MTEXT',
  'INSERT',
  'POINT',
  'ELLIPSE',
  'SPLINE',
  '3DFACE',
  'SOLID',
]);

function stereo70ToWgs84(sourceCrs: Stereo70SourceCrs, x: number, y: number): [number, number] {
  return proj4(sourceCrs, 'EPSG:4326', [x, y]) as [number, number];
}

export function stereo70XYToWgs84(
  sourceCrs: Stereo70SourceCrs,
  xy: { x: number; y: number },
): { lon: number; lat: number } {
  const [lon, lat] = stereo70ToWgs84(sourceCrs, xy.x, xy.y);
  return { lon, lat };
}

function layerName(e: Record<string, unknown>): string {
  const raw = (e.layer as string | undefined) ?? '0';
  return String(raw).trim() || '0';
}

/** Effective layer: AutoCAD rule — layer "0" inside block inherits INSERT layer. */
function effectiveLayer(
  e: Record<string, unknown>,
  insertLayer: string | undefined,
  lnOverride: string | undefined,
): string {
  if (lnOverride != null) return lnOverride;
  const ln = layerName(e);
  if (ln === '0' && insertLayer) return insertLayer;
  return ln;
}

function toLonLat(sourceCrs: Stereo70SourceCrs, xy: XY): [number, number] {
  return stereo70ToWgs84(sourceCrs, xy.x, xy.y);
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

function asXY(v: unknown): XY | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { x?: unknown; y?: unknown; z?: unknown };
  const x = Number(o.x);
  const y = Number(o.y);
  const z = o.z == null ? undefined : Number(o.z);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y, z: Number.isFinite(z) ? z : undefined };
}

function entityPosition(e: Record<string, unknown>): XY | undefined {
  return (
    asXY(e.start) ??
    asXY(e.position) ??
    asXY(e.point) ??
    asXY(e.startPoint) ??
    asXY(e.insert) ??
    asXY(e.alignPoint) ??
    asXY(e.firstAlignmentPoint) ??
    asXY(e.secondAlignmentPoint)
  );
}

function decodeDxfText(s: string): string {
  // Common DXF TEXT escapes (esp. from ODA/AutoCAD exports)
  return String(s ?? '')
    .replace(/%%[Dd]/g, '°')
    .replace(/%%[Pp]/g, '±')
    .replace(/%%[Cc]/g, '⌀')
    .replace(/%%[Uu]/g, '')
    .trim();
}

function decodeMText(raw: string): string {
  // Keep plain text while removing MTEXT formatting codes.
  // Braces group formatting; the content inside must remain.
  const s = String(raw ?? '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{' || ch === '}') continue;
    if (ch !== '\\') {
      out += ch;
      continue;
    }

    const next = s[i + 1] ?? '';

    // Simple escapes
    if (next === '\\' || next === '{' || next === '}') {
      out += next;
      i += 1;
      continue;
    }
    if (next === 'P') {
      out += ' ';
      i += 1;
      continue;
    }
    if (next === '~') {
      out += ' ';
      i += 1;
      continue;
    }

    // Unicode escape: \U+XXXX
    if (next === 'U' && s[i + 2] === '+') {
      const hex = s.slice(i + 3, i + 7);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
    }

    // Formatting codes like \A...; \C...; \F...; \H...; \W...; etc.
    // Stacked fractions: \S...; => keep first token (before '/', '#', or '^')
    const code = next;
    const semi = s.indexOf(';', i + 2);
    if (semi !== -1) {
      const payload = s.slice(i + 2, semi);
      if (code === 'S') {
        out += (payload.split(/[\/#\^]/)[0] ?? '');
      }
      i = semi;
      continue;
    }
    // Unknown/unterminated code: ignore.
  }
  return decodeDxfText(out).replace(/\s+/g, ' ').trim();
}

function insertToAffine(t: { x: number; y: number; sx: number; sy: number; rotRad: number }): Affine2D {
  const c = Math.cos(t.rotRad);
  const s = Math.sin(t.rotRad);
  return {
    m11: t.sx * c,
    m12: -t.sy * s,
    m21: t.sx * s,
    m22: t.sy * c,
    tx: t.x,
    ty: t.y,
  };
}

function multiplyAffine(parent: Affine2D, child: Affine2D): Affine2D {
  return {
    m11: parent.m11 * child.m11 + parent.m12 * child.m21,
    m12: parent.m11 * child.m12 + parent.m12 * child.m22,
    m21: parent.m21 * child.m11 + parent.m22 * child.m21,
    m22: parent.m21 * child.m12 + parent.m22 * child.m22,
    tx: parent.m11 * child.tx + parent.m12 * child.ty + parent.tx,
    ty: parent.m21 * child.tx + parent.m22 * child.ty + parent.ty,
  };
}

function applyAffine(A: Affine2D | undefined, pt: XY): XY {
  if (!A) return pt;
  return {
    x: A.m11 * pt.x + A.m12 * pt.y + A.tx,
    y: A.m21 * pt.x + A.m22 * pt.y + A.ty,
    z: pt.z,
  };
}

function mapVerticesRaw(
  raw: Array<XY | { x: number; y: number }>,
  A: Affine2D | undefined,
  sourceCrs: Stereo70SourceCrs,
): [number, number][] {
  return raw.map((p) => toLonLat(sourceCrs, applyAffine(A, p as XY))) as [number, number][];
}

function sampleCircle(
  center: XY,
  radius: number,
  A: Affine2D | undefined,
  sourceCrs: Stereo70SourceCrs,
  segments = 32,
): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = center.x + radius * Math.cos(a);
    const y = center.y + radius * Math.sin(a);
    coords.push(toLonLat(sourceCrs, applyAffine(A, { x, y })));
  }
  return coords;
}

function sampleArc(
  center: XY,
  radius: number,
  startAngle: number,
  endAngle: number,
  A: Affine2D | undefined,
  sourceCrs: Stereo70SourceCrs,
  segments = 24,
): [number, number][] {
  const coords: [number, number][] = [];
  let s = startAngle;
  let e = endAngle;
  if (e < s) e += Math.PI * 2;
  for (let i = 0; i <= segments; i++) {
    const t = s + ((e - s) * i) / segments;
    const x = center.x + radius * Math.cos(t);
    const y = center.y + radius * Math.sin(t);
    coords.push(toLonLat(sourceCrs, applyAffine(A, { x, y })));
  }
  return coords;
}

function sampleEllipse(
  center: XY,
  majorEnd: XY,
  axisRatio: number,
  startParam: number,
  endParam: number,
  A: Affine2D | undefined,
  sourceCrs: Stereo70SourceCrs,
  segments = 64,
): [number, number][] {
  const dx = majorEnd.x - center.x;
  const dy = majorEnd.y - center.y;
  const a = Math.hypot(dx, dy) || 1e-9;
  const ux = dx / a;
  const uy = dy / a;
  const vx = -uy;
  const vy = ux;
  const b = axisRatio * a;
  let s = startParam;
  let e = endParam;
  if (Number.isNaN(s) || Number.isNaN(e)) {
    s = 0;
    e = Math.PI * 2;
  }
  if (e <= s) e += Math.PI * 2;
  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = s + ((e - s) * i) / segments;
    const lx = center.x + a * Math.cos(t) * ux + b * Math.sin(t) * vx;
    const ly = center.y + a * Math.cos(t) * uy + b * Math.sin(t) * vy;
    coords.push(toLonLat(sourceCrs, applyAffine(A, { x: lx, y: ly })));
  }
  return coords;
}

function sampleSpline(
  e: Record<string, unknown>,
  A: Affine2D | undefined,
  sourceCrs: Stereo70SourceCrs,
): [number, number][] | null {
  const fit = e.fitPoints as XY[] | undefined;
  const ctrl = e.controlPoints as XY[] | undefined;
  const closed = Boolean(e.closed);
  const pts = fit && fit.length >= 2 ? fit : ctrl && ctrl.length >= 2 ? ctrl : null;
  if (!pts) return null;
  const ring = pts.map((p) => toLonLat(sourceCrs, applyAffine(A, p)));
  if (closed && ring.length >= 3) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  }
  return ring as [number, number][];
}

function polylineVertices(e: Record<string, unknown>): Array<XY | { x: number; y: number }> | null {
  const rawPts = e.points as Array<XY | { x: number; y: number }> | undefined;
  if (Array.isArray(rawPts) && rawPts.length >= 2) return rawPts;
  const verts = e.vertices as Array<{ x?: number; y?: number }> | undefined;
  if (!Array.isArray(verts) || verts.length < 2) return null;
  return verts
    .map((v) => ({ x: Number(v.x ?? 0), y: Number(v.y ?? 0) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function faceVertices(e: Record<string, unknown>): XY[] | null {
  const v3 = e.vertices as IPointLike[] | undefined;
  if (Array.isArray(v3) && v3.length >= 3) {
    return v3.map((p) => ({ x: Number(p.x), y: Number(p.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  const solidPts = e.points as IPointLike[] | undefined;
  if (Array.isArray(solidPts) && solidPts.length >= 3) {
    return solidPts.map((p) => ({ x: Number(p.x), y: Number(p.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  return null;
}

interface IPointLike {
  x: number;
  y: number;
}

function isClosedRing(coords: [number, number][], eps = 1e-7): boolean {
  if (coords.length < 4) return false;
  const a = coords[0];
  const b = coords[coords.length - 1];
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

function maybeSimplifyLine(coords: [number, number][], toleranceDeg: number): [number, number][] {
  if (coords.length < 8) return coords;
  const ls = lineString(coords);
  const out = simplify(ls, { tolerance: toleranceDeg, highQuality: true });
  if (out.geometry.type !== 'LineString') return coords;
  return out.geometry.coordinates as [number, number][];
}

function countEntityTypes(list: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of list) {
    const t = String((e.type as string | undefined) ?? 'UNKNOWN').toUpperCase();
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** Parse DXF (Stereo70) into GeoJSON features grouped by CAD layer name. */
export function parseDxfStereo70Full(
  fileName: string,
  dxfText: string,
  opts?: { sourceCrs?: Stereo70SourceCrs },
): ParsedDxfImport {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf) throw new Error('DXF invalid sau gol');

  const sourceCrs: Stereo70SourceCrs = opts?.sourceCrs ?? 'EPSG:3844';

  const byLayer = new Map<string, Feature[]>();
  let explodedFromBlocks = 0;

  const push = (ln: string, f: Feature) => {
    const arr = byLayer.get(ln) ?? [];
    arr.push(f);
    byLayer.set(ln, arr);
  };

  const ents = (dxf.entities ?? []) as unknown as Array<Record<string, unknown>>;

  const blocksObj = (dxf.blocks ?? {}) as Record<string, { entities?: unknown[] }>;
  const blocks = new Map<string, Array<Record<string, unknown>>>();
  for (const [name, blk] of Object.entries(blocksObj)) {
    const n = String(name).trim();
    if (!n) continue;
    const es = (blk?.entities ?? []) as unknown as Array<Record<string, unknown>>;
    // Normalize for lookups: some parsers/exporters differ in case.
    blocks.set(n, es);
    blocks.set(n.toUpperCase(), es);
  }

  const blocksCount = blocks.size;
  let countsByType = countEntityTypes(ents);
  for (const [, bes] of blocks) {
    countsByType = mergeCounts(countsByType, countEntityTypes(bes));
  }

  const skippedTypesSet = new Set<string>();

  const pushEntity = (
    e: Record<string, unknown>,
    lnOverride: string | undefined,
    A: Affine2D | undefined,
    insertLayer: string | undefined,
    fromBlock: boolean,
  ) => {
    if (fromBlock) explodedFromBlocks += 1;

    const ln = effectiveLayer(e, insertLayer, lnOverride);
    const type = (e.type as string | undefined)?.toUpperCase();

    const toLL = (pt: XY) => toLonLat(sourceCrs, applyAffine(A, pt));

    if (type === 'LINE') {
      const v1 = e.start as XY | undefined;
      const v2 = e.end as XY | undefined;
      if (!v1 || !v2) return;
      push(ln, {
        type: 'Feature',
        properties: { entity: 'LINE' },
        geometry: { type: 'LineString', coordinates: [toLL(v1), toLL(v2)] },
      });
      return;
    }

    if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const raw = polylineVertices(e);
      if (!raw || raw.length < 2) return;
      const coords = mapVerticesRaw(raw, A, sourceCrs);
      const closed =
        Boolean((e as { shape?: boolean; closed?: boolean }).shape) ||
        Boolean((e as { closed?: boolean }).closed);
      const ringClosed = closed || isClosedRing(coords);
      if (ringClosed && coords.length >= 4) {
        const ring = [...coords];
        if (!isClosedRing(ring)) ring.push([...ring[0]]);
        push(ln, {
          type: 'Feature',
          properties: { entity: 'LWPOLYLINE', closed: true },
          geometry: { type: 'Polygon', coordinates: [ring] } as Polygon,
        });
      } else {
        push(ln, {
          type: 'Feature',
          properties: { entity: 'LWPOLYLINE' },
          geometry: { type: 'LineString', coordinates: maybeSimplifyLine(coords, 0.00002) },
        });
      }
      return;
    }

    if (type === 'CIRCLE') {
      const c = e.center as XY | undefined;
      const r = e.radius as number | undefined;
      if (!c || r == null || r <= 0) return;
      const ring = sampleCircle(c, r, A, sourceCrs);
      push(ln, {
        type: 'Feature',
        properties: { entity: 'CIRCLE' },
        geometry: { type: 'LineString', coordinates: ring },
      });
      return;
    }

    if (type === 'ARC') {
      const c = e.center as XY | undefined;
      const r = e.radius as number | undefined;
      const start = (e.startAngle as number | undefined) ?? (e.angleStart as number | undefined);
      const end = (e.endAngle as number | undefined) ?? (e.angleEnd as number | undefined);
      if (!c || r == null || r <= 0 || start == null || end == null) return;
      const coords = sampleArc(c, r, degToRad(start), degToRad(end), A, sourceCrs);
      push(ln, {
        type: 'Feature',
        properties: { entity: 'ARC' },
        geometry: { type: 'LineString', coordinates: coords },
      });
      return;
    }

    if (type === 'TEXT' || type === 'MTEXT') {
      const pos = entityPosition(e);
      const raw = String((e.text as string | undefined) ?? '');
      const text = type === 'MTEXT' ? decodeMText(raw) : decodeDxfText(raw);
      if (!pos || !text) return;
      const [lon, lat] = toLL(pos);
      push(ln, {
        type: 'Feature',
        properties: { entity: type, text },
        geometry: { type: 'Point', coordinates: [lon, lat] } as Point,
      });
      return;
    }

    if (type === 'POINT') {
      const pos = e.position as XY | undefined;
      if (!pos) return;
      const [lon, lat] = toLL(pos);
      push(ln, {
        type: 'Feature',
        properties: { entity: 'POINT' },
        geometry: { type: 'Point', coordinates: [lon, lat] } as Point,
      });
      return;
    }

    if (type === 'ELLIPSE') {
      const c = e.center as XY | undefined;
      const maj = e.majorAxisEndPoint as XY | undefined;
      const ratio = e.axisRatio as number | undefined;
      if (!c || !maj || ratio == null || ratio <= 0) return;
      const start = (e.startAngle as number | undefined) ?? 0;
      const end = (e.endAngle as number | undefined) ?? Math.PI * 2;
      const coords = sampleEllipse(c, maj, ratio, start, end, A, sourceCrs);
      push(ln, {
        type: 'Feature',
        properties: { entity: 'ELLIPSE' },
        geometry: { type: 'LineString', coordinates: coords },
      });
      return;
    }

    if (type === 'SPLINE') {
      const coords = sampleSpline(e, A, sourceCrs);
      if (!coords || coords.length < 2) return;
      push(ln, {
        type: 'Feature',
        properties: { entity: 'SPLINE' },
        geometry: { type: 'LineString', coordinates: maybeSimplifyLine(coords, 0.00002) },
      });
      return;
    }

    if (type === '3DFACE' || type === 'SOLID') {
      const raw = faceVertices(e);
      if (!raw || raw.length < 3) return;
      const coords = mapVerticesRaw(raw, A, sourceCrs);
      if (coords.length >= 4 && isClosedRing(coords)) {
        const ring = [...coords];
        if (!isClosedRing(ring)) ring.push([...ring[0]]);
        push(ln, {
          type: 'Feature',
          properties: { entity: type },
          geometry: { type: 'Polygon', coordinates: [ring] } as Polygon,
        });
      } else if (coords.length >= 3) {
        const ring = [...coords, coords[0]];
        push(ln, {
          type: 'Feature',
          properties: { entity: type },
          geometry: { type: 'Polygon', coordinates: [ring] } as Polygon,
        });
      }
      return;
    }

    if (type && !SUPPORTED_TYPES.has(type)) {
      skippedTypesSet.add(type);
    }
  };

  const explodeInsert = (
    e: Record<string, unknown>,
    parentA: Affine2D | undefined,
    parentInsertLayer: string | undefined,
    depth: number,
  ) => {
    if (depth > MAX_INSERT_DEPTH) return;
    const pos = entityPosition(e);
    if (!pos) return;
    const blockName = String((e.name as string | undefined) ?? (e.block as string | undefined) ?? (e.blockName as string | undefined) ?? '')
      .trim();
    const sx = (e.xScale as number | undefined) ?? 1;
    const sy = (e.yScale as number | undefined) ?? 1;
    const rot = (e.rotation as number | undefined) ?? 0;
    const local = insertToAffine({ x: pos.x, y: pos.y, sx: sx || 1, sy: sy || 1, rotRad: degToRad(rot) });
    const A = parentA ? multiplyAffine(parentA, local) : local;
    const rawIns = layerName(e);
    const insLayer = rawIns === '0' && parentInsertLayer ? parentInsertLayer : rawIns;
    const blockEnts = blockName ? (blocks.get(blockName) ?? blocks.get(blockName.toUpperCase())) : undefined;
    if (blockEnts && blockEnts.length > 0) {
      for (const be of blockEnts) {
        const bt = (be.type as string | undefined)?.toUpperCase();
        if (bt === 'INSERT') {
          explodeInsert(be, A, insLayer, depth + 1);
        } else {
          pushEntity(be, undefined, A, insLayer, true);
        }
      }
    }
  };

  for (const e of ents) {
    const type = (e.type as string | undefined)?.toUpperCase();
    if (type === 'INSERT') {
      explodeInsert(e, undefined, undefined, 0);
      continue;
    }
    pushEntity(e, undefined, undefined, undefined, false);
  }

  const layers: CadLayerGroup[] = [];
  for (const [cadLayer, features] of byLayer) {
    if (features.length === 0) continue;
    layers.push({ cadLayer, features });
  }

  const fc: FeatureCollection =
    layers.length > 0
      ? {
          type: 'FeatureCollection',
          features: layers.flatMap((l) => l.features),
        }
      : { type: 'FeatureCollection', features: [] };

  const bbox4326 = bboxOfFeatureCollection(fc);

  const diagnostics: DxfParseDiagnostics = {
    totalEntities: ents.length,
    blocksCount,
    explodedFromBlocks,
    countsByType,
    skippedTypes: Array.from(skippedTypesSet).sort(),
    sourceCrs,
  };

  return {
    name: fileName.replace(/\.dxf$/i, ''),
    layers,
    bbox4326,
    diagnostics,
  };
}

function bboxOfFeatureCollection(fc: FeatureCollection) {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  const extend = (lon: number, lat: number) => {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  };
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Point') extend(g.coordinates[0], g.coordinates[1]);
    else if (g.type === 'LineString') for (const c of g.coordinates) extend(c[0], c[1]);
    else if (g.type === 'Polygon') for (const ring of g.coordinates) for (const c of ring) extend(c[0], c[1]);
  }
  if (!isFinite(minLon)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

/** Simplify line features in a layer (for contours / heavy polylines). */
export function simplifyLayerFeatures(
  features: Feature[],
  toleranceDeg: number,
): Feature[] {
  return features.map((f) => {
    if (f.geometry?.type !== 'LineString') return f;
    const coords = f.geometry.coordinates as [number, number][];
    const next = maybeSimplifyLine(coords, toleranceDeg);
    return { ...f, geometry: { type: 'LineString', coordinates: next } };
  });
}
