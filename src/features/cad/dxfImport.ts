import proj4 from 'proj4';
import DxfParser from 'dxf-parser';
import { lineString, simplify } from '@turf/turf';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';

proj4.defs(
  'EPSG:3844',
  '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);

type XY = { x: number; y: number; z?: number };

export interface CadLayerGroup {
  cadLayer: string;
  features: Feature[];
}

export interface ParsedDxfImport {
  name: string;
  layers: CadLayerGroup[];
  bbox4326: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
}

function stereo70ToWgs84(x: number, y: number): [number, number] {
  return proj4('EPSG:3844', 'EPSG:4326', [x, y]) as [number, number];
}

function layerName(e: Record<string, unknown>): string {
  const raw = (e.layer as string | undefined) ?? '0';
  return String(raw).trim() || '0';
}

function toLonLat(xy: XY): [number, number] {
  return stereo70ToWgs84(xy.x, xy.y);
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

function transformXY(
  pt: XY,
  t: { x: number; y: number; sx: number; sy: number; rotRad: number },
): XY {
  const x1 = pt.x * t.sx;
  const y1 = pt.y * t.sy;
  const c = Math.cos(t.rotRad);
  const s = Math.sin(t.rotRad);
  const xr = x1 * c - y1 * s;
  const yr = x1 * s + y1 * c;
  return { x: xr + t.x, y: yr + t.y, z: pt.z };
}

function mapVertices(
  raw: Array<XY | { x: number; y: number }>,
  t: { x: number; y: number; sx: number; sy: number; rotRad: number },
): [number, number][] {
  return raw.map((p) => toLonLat(transformXY(p as XY, t))) as [number, number][];
}

function sampleCircle(center: XY, radius: number, segments = 32): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = center.x + radius * Math.cos(a);
    const y = center.y + radius * Math.sin(a);
    coords.push(toLonLat({ x, y }));
  }
  return coords;
}

function sampleArc(center: XY, radius: number, startAngle: number, endAngle: number, segments = 24): [number, number][] {
  const coords: [number, number][] = [];
  let s = startAngle;
  let e = endAngle;
  if (e < s) e += Math.PI * 2;
  for (let i = 0; i <= segments; i++) {
    const t = s + ((e - s) * i) / segments;
    const x = center.x + radius * Math.cos(t);
    const y = center.y + radius * Math.sin(t);
    coords.push(toLonLat({ x, y }));
  }
  return coords;
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

/** Parse DXF (Stereo70) into GeoJSON features grouped by CAD layer name. */
export function parseDxfStereo70Full(fileName: string, dxfText: string): ParsedDxfImport {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf) throw new Error('DXF invalid sau gol');

  const byLayer = new Map<string, Feature[]>();

  const push = (ln: string, f: Feature) => {
    const arr = byLayer.get(ln) ?? [];
    arr.push(f);
    byLayer.set(ln, arr);
  };

  const ents = (dxf.entities ?? []) as unknown as Array<Record<string, unknown>>;
  const blocksArr = (dxf as unknown as { blocks?: Array<{ name?: string; entities?: unknown[] }> }).blocks ?? [];
  const blocks = new Map<string, Array<Record<string, unknown>>>();
  for (const b of blocksArr) {
    const n = String(b.name ?? '').trim();
    if (!n) continue;
    const es = (b.entities ?? []) as unknown as Array<Record<string, unknown>>;
    blocks.set(n, es);
  }

  const pushEntity = (
    e: Record<string, unknown>,
    lnOverride?: string,
    transform?: { x: number; y: number; sx: number; sy: number; rotRad: number },
  ) => {
    const ln = lnOverride ?? layerName(e);
    const type = (e.type as string | undefined)?.toUpperCase();

    const toLL = (pt: XY) => toLonLat(transform ? transformXY(pt, transform) : pt);

    if (type === 'LINE') {
      const v1 = e.start as XY | undefined;
      const v2 = e.end as XY | undefined;
      if (!v1 || !v2) return;
      const c1 = toLL(v1);
      const c2 = toLL(v2);
      push(ln, {
        type: 'Feature',
        properties: { entity: 'LINE' },
        geometry: { type: 'LineString', coordinates: [c1, c2] },
      });
      return;
    }

    if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const raw = (e.vertices ?? e.points) as Array<XY | { x: number; y: number }> | undefined;
      if (!Array.isArray(raw) || raw.length < 2) return;
      const coords = transform
        ? mapVertices(raw as Array<XY | { x: number; y: number }>, transform)
        : (raw.map((p) => toLonLat(p as XY)) as [number, number][]);
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
      const cc = transform ? transformXY(c, transform) : c;
      const ring = sampleCircle(cc, r * (transform ? Math.max(transform.sx, transform.sy) : 1));
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
      const cc = transform ? transformXY(c, transform) : c;
      const coords = sampleArc(
        cc,
        r * (transform ? Math.max(transform.sx, transform.sy) : 1),
        degToRad(start),
        degToRad(end),
      );
      push(ln, {
        type: 'Feature',
        properties: { entity: 'ARC' },
        geometry: { type: 'LineString', coordinates: coords },
      });
      return;
    }

    if (type === 'TEXT' || type === 'MTEXT') {
      const pos = (e.start ?? e.position ?? e.point) as XY | undefined;
      let text = String((e.text as string | undefined) ?? '').trim();
      if (type === 'MTEXT') text = text.replace(/\{[^}]*\}/g, '').replace(/\\P/g, ' ').trim();
      if (!pos || !text) return;
      const [lon, lat] = toLL(pos);
      push(ln, {
        type: 'Feature',
        properties: { entity: type, text },
        geometry: { type: 'Point', coordinates: [lon, lat] } as Point,
      });
      return;
    }
  };

  for (const e of ents) {
    const type = (e.type as string | undefined)?.toUpperCase();
    if (type === 'INSERT') {
      const pos = (e.position ?? e.start) as XY | undefined;
      if (!pos) continue;
      const blockName = String((e.name as string | undefined) ?? (e.block as string | undefined) ?? '').trim();
      const sx = (e.xScale as number | undefined) ?? 1;
      const sy = (e.yScale as number | undefined) ?? 1;
      const rot = (e.rotation as number | undefined) ?? 0;
      const t = { x: pos.x, y: pos.y, sx: sx || 1, sy: sy || 1, rotRad: degToRad(rot) };
      const blockEnts = blockName ? blocks.get(blockName) : undefined;
      if (blockEnts && blockEnts.length > 0) {
        for (const be of blockEnts) {
          // Keep each entity's own layer; apply insert transform.
          pushEntity(be, undefined, t);
        }
        continue;
      }
    }

    pushEntity(e);
  }

  const layers: CadLayerGroup[] = [];
  for (const [cadLayer, features] of byLayer) {
    if (features.length === 0) continue;
    layers.push({ cadLayer, features });
  }

  if (layers.length === 0) {
    throw new Error('DXF nu contine entitati suportate (linii, text, cercuri)');
  }

  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: layers.flatMap((l) => l.features),
  };
  const bbox4326 = bboxOfFeatureCollection(fc);

  return {
    name: fileName.replace(/\.dxf$/i, ''),
    layers,
    bbox4326,
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
