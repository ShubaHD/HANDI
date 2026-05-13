/** Convenție pentru `tile_row` în tabelul `tiles` (MapLibre folosește mereu XYZ pentru y). */
export type MbtilesTileScheme = 'tms' | 'xyz';

/** Parsare metadata MBTiles (tabel `metadata`: name, value). */
export interface ParsedMbtilesMeta {
  bounds: [number, number, number, number] | null;
  minzoom: number | null;
  maxzoom: number | null;
  format: string | null;
  name: string | null;
}

/**
 * MBTiles standard: TMS. Multe unelte (ex. tippecanoe, unele exporturi GDAL) scriu `scheme: xyz`
 * în metadata JSON sau ca rând `scheme`.
 */
export function inferMbtilesTileScheme(meta: Record<string, string>): MbtilesTileScheme {
  const direct = meta.scheme?.trim().toLowerCase();
  if (direct === 'xyz') return 'xyz';
  if (direct === 'tms') return 'tms';

  const j = meta.json?.trim();
  if (j) {
    try {
      const o = JSON.parse(j) as { scheme?: string };
      const s = typeof o?.scheme === 'string' ? o.scheme.trim().toLowerCase() : '';
      if (s === 'xyz') return 'xyz';
      if (s === 'tms') return 'tms';
    } catch {
      /* json invalid */
    }
  }
  return 'tms';
}

export function parseMetadataMap(meta: Record<string, string>): ParsedMbtilesMeta {
  const format = meta.format?.trim().toLowerCase() ?? null;
  const name = meta.name?.trim() ?? null;

  let minzoom: number | null = null;
  let maxzoom: number | null = null;
  if (meta.minzoom != null && meta.minzoom !== '') {
    const n = Number(meta.minzoom);
    if (Number.isFinite(n)) minzoom = Math.round(n);
  }
  if (meta.maxzoom != null && meta.maxzoom !== '') {
    const n = Number(meta.maxzoom);
    if (Number.isFinite(n)) maxzoom = Math.round(n);
  }

  let bounds: [number, number, number, number] | null = null;
  const b = meta.bounds?.trim();
  if (b) {
    const xs = b.split(',').map((x) => Number(x.trim()));
    if (xs.length === 4 && xs.every((n) => Number.isFinite(n))) {
      bounds = [xs[0], xs[1], xs[2], xs[3]];
    }
  }

  return { bounds, minzoom, maxzoom, format, name };
}

export function assertRasterMbtilesFormat(format: string | null): void {
  if (!format) return;
  const f = format.toLowerCase();
  if (f === 'pbf' || f.includes('mvt') || f === 'vector') {
    throw new Error('MBTiles vector (MVT/PBF) nu e suportat in HANDI — export raster (png/jpg).');
  }
}
