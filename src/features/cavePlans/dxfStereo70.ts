import proj4 from 'proj4';
import DxfParser from 'dxf-parser';
import '@/lib/ensureRomaniaStereo70Proj';

type XY = { x: number; y: number };

function asXY(v: unknown): XY | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { x?: unknown; y?: unknown };
  const x = Number(o.x);
  const y = Number(o.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/** LINE: dxf-parser uses `vertices` [start, end], not always `start`/`end`. */
function lineEndpoints(e: Record<string, unknown>): [XY, XY] | null {
  const v1 = asXY(e.start);
  const v2 = asXY(e.end);
  if (v1 && v2) return [v1, v2];
  const verts = e.vertices as unknown;
  if (Array.isArray(verts) && verts.length >= 2) {
    const a = asXY(verts[0]);
    const b = asXY(verts[verts.length - 1]);
    if (a && b) return [a, b];
  }
  return null;
}

export interface ParsedPlan {
  name: string;
  geom: GeoJSON.MultiLineString;
  bbox4326: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  stats: { segments: number; vertices: number };
}

export function parseDxfStereo70ToWgs84(fileName: string, dxfText: string): ParsedPlan {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf) throw new Error('DXF invalid sau gol');

  const lineStrings: number[][][] = [];
  let segments = 0;
  let vertices = 0;

  const addPolyline = (pts: XY[]) => {
    if (pts.length < 2) return;
    const coords: number[][] = pts
      .map((p) => stereo70ToWgs84(p.x, p.y))
      .map(([lon, lat]) => [lon, lat]);
    lineStrings.push(coords);
    segments += Math.max(0, coords.length - 1);
    vertices += coords.length;
  };

  const ents = (dxf.entities ?? []) as unknown as Array<Record<string, unknown>>;
  for (const e of ents) {
    const type = (e.type as string | undefined)?.toUpperCase();
    if (type === 'LINE') {
      const ends = lineEndpoints(e);
      if (ends) addPolyline([ends[0], ends[1]]);
    } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      // dxf-parser uses .vertices for POLYLINE and .vertices/.points for LWPOLYLINE depending on source
      const v = (e.vertices ?? e.points) as XY[] | undefined;
      if (Array.isArray(v)) addPolyline(v);
    }
  }

  if (lineStrings.length === 0) {
    throw new Error('DXF nu contine linii/polilinii (LINE/LWPOLYLINE/POLYLINE)');
  }

  const geom: GeoJSON.MultiLineString = { type: 'MultiLineString', coordinates: lineStrings };
  const bbox4326 = computeBbox(geom);

  return {
    name: fileName.replace(/\.dxf$/i, ''),
    geom,
    bbox4326,
    stats: { segments, vertices },
  };
}

function stereo70ToWgs84(x: number, y: number): [number, number] {
  const [lon, lat] = proj4('EPSG:3844', 'EPSG:4326', [x, y]) as [number, number];
  return [lon, lat];
}

function computeBbox(geom: GeoJSON.MultiLineString) {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const line of geom.coordinates) {
    for (const [lon, lat] of line) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!isFinite(minLon)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

