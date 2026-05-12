import type { Annotation } from '@/lib/types';

/** Punct reprezentativ (punct adnotare sau mijlocul săgeții). */
export function annotationRepresentativePoint(a: Annotation): { lat: number; lon: number } | null {
  if (typeof a.lat === 'number' && typeof a.lon === 'number' && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
    return { lat: a.lat, lon: a.lon };
  }
  if (a.geom.type === 'LineString' && a.geom.coordinates.length > 0) {
    const mid = Math.floor(a.geom.coordinates.length / 2);
    const p = a.geom.coordinates[mid];
    if (!p || p.length < 2) return null;
    return { lat: p[1], lon: p[0] };
  }
  return null;
}

export function formatAnnotationCoords(a: Annotation): string {
  const p = annotationRepresentativePoint(a);
  if (!p) return '—';
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

function csvCell(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** CSV cu BOM UTF-8 pentru Excel; coloane WGS84. */
export function annotationsToCsv(rows: Annotation[]): string {
  const headers = [
    'id',
    'kind',
    'lat',
    'lon',
    'lon_start',
    'lat_start',
    'lon_end',
    'lat_end',
    'line_wkt',
    'text',
    'symbol',
    'notes',
    'visibility',
    'bearing_deg',
    'created_at',
    'updated_at',
  ];
  const lines: string[] = [headers.join(',')];

  for (const a of rows) {
    const rep = annotationRepresentativePoint(a);
    let lonStart = '';
    let latStart = '';
    let lonEnd = '';
    let latEnd = '';
    let lineWkt = '';
    if (a.geom.type === 'LineString' && a.geom.coordinates.length >= 2) {
      const c0 = a.geom.coordinates[0];
      const c1 = a.geom.coordinates[a.geom.coordinates.length - 1];
      if (c0 && c0.length >= 2 && c1 && c1.length >= 2) {
        lonStart = String(c0[0]);
        latStart = String(c0[1]);
        lonEnd = String(c1[0]);
        latEnd = String(c1[1]);
      }
      lineWkt = `LINESTRING(${a.geom.coordinates.map((xy) => `${xy[0]} ${xy[1]}`).join(', ')})`;
    }
    lines.push(
      [
        csvCell(a.id),
        csvCell(a.kind),
        csvCell(rep?.lat ?? ''),
        csvCell(rep?.lon ?? ''),
        csvCell(lonStart),
        csvCell(latStart),
        csvCell(lonEnd),
        csvCell(latEnd),
        csvCell(lineWkt),
        csvCell(a.text ?? ''),
        csvCell(a.symbol ?? ''),
        csvCell(a.notes ?? ''),
        csvCell(a.visibility),
        csvCell(a.bearing_deg ?? ''),
        csvCell(a.created_at),
        csvCell(a.updated_at),
      ].join(','),
    );
  }
  return `\uFEFF${lines.join('\n')}`;
}

export function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
