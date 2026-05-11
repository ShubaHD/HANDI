import type { PointOfInterest } from '@/lib/types';

function csvCell(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** CSV UTF-8 cu BOM pentru Excel. */
export function pointsToCsv(rows: PointOfInterest[]): string {
  const headers = [
    'id',
    'nume',
    'lat',
    'lon',
    'altitudine_m',
    'tip',
    'culoare_marcaj',
    'observatii',
    'vizibilitate',
    'creat_la',
    'actualizat_la',
  ];
  const lines = [headers.join(',')];
  for (const p of rows) {
    lines.push(
      [
        csvCell(p.id),
        csvCell(p.name),
        csvCell(p.lat),
        csvCell(p.lon),
        csvCell(p.elevation_m ?? ''),
        csvCell(p.type),
        csvCell(p.marker_color ?? ''),
        csvCell(p.description ?? ''),
        csvCell(p.visibility),
        csvCell(p.created_at),
        csvCell(p.updated_at),
      ].join(','),
    );
  }
  return `\uFEFF${lines.join('\n')}`;
}

export function downloadPointsCsv(filename: string, csv: string): void {
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
