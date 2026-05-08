import type { Stereo70SourceCrs } from '@/features/cad/dxfImport';
import { stereo70XYToWgs84 } from '@/features/cad/dxfImport';
import type { NewPointInput } from './api';
import type { PointType, Visibility } from '@/lib/types';

export type CsvPointsDiagnostics = {
  totalRows: number;
  created: number;
  skipped: number;
  errors: string[];
};

function splitCsvLine(line: string, delim: string): string[] {
  // Minimal CSV: supports quoted fields and escaped quotes ("")
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delim) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const counts: Array<[',' | ';' | '\t', number]> = [
    [',', (first.match(/,/g) ?? []).length],
    [';', (first.match(/;/g) ?? []).length],
    ['\t', (first.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function toNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parsePointsCsvToInputs(args: {
  csvText: string;
  sourceCrs: Stereo70SourceCrs;
  defaultType?: PointType;
  defaultVisibility?: Visibility;
}): { inputs: NewPointInput[]; diag: CsvPointsDiagnostics } {
  const delim = detectDelimiter(args.csvText);
  const lines = args.csvText
    .replace(/^\uFEFF/, '') // BOM
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const diag: CsvPointsDiagnostics = { totalRows: 0, created: 0, skipped: 0, errors: [] };
  if (lines.length === 0) return { inputs: [], diag };

  const headerCells = splitCsvLine(lines[0], delim).map(normalizeHeader);
  const idx = (names: string[]) => headerCells.findIndex((h) => names.includes(h));

  const iName = idx(['name', 'nume', 'label', 'denumire']);
  const iX = idx(['x', 'east', 'e', 'stereo_x']);
  const iY = idx(['y', 'north', 'n', 'stereo_y']);
  const iLon = idx(['lon', 'lng', 'longitude']);
  const iLat = idx(['lat', 'latitude']);
  const iType = idx(['type', 'tip']);
  const iVis = idx(['visibility', 'vizibilitate']);
  const iElev = idx(['elevation_m', 'elev', 'z', 'alt', 'altitude']);
  const iDesc = idx(['description', 'descriere', 'desc']);

  if (iName === -1) diag.errors.push('CSV: lipseste coloana name/nume.');
  const hasWgs84 = iLon !== -1 && iLat !== -1;
  const hasStereo = iX !== -1 && iY !== -1;
  if (!hasWgs84 && !hasStereo) diag.errors.push('CSV: lipsesc coordonatele (lon+lat sau x+y Stereo70).');
  if (diag.errors.length) return { inputs: [], diag };

  const inputs: NewPointInput[] = [];
  for (let li = 1; li < lines.length; li++) {
    diag.totalRows += 1;
    const cells = splitCsvLine(lines[li], delim);
    const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '');

    const name = get(iName);
    if (!name) {
      diag.skipped += 1;
      continue;
    }

    let lon: number | null = null;
    let lat: number | null = null;
    if (hasWgs84) {
      lon = toNum(get(iLon));
      lat = toNum(get(iLat));
    } else {
      const x = toNum(get(iX));
      const y = toNum(get(iY));
      if (x != null && y != null) {
        const ll = stereo70XYToWgs84(args.sourceCrs, { x, y });
        lon = ll.lon;
        lat = ll.lat;
      }
    }

    if (lon == null || lat == null) {
      diag.skipped += 1;
      continue;
    }

    const elevation_m = iElev !== -1 ? toNum(get(iElev)) : null;
    const description = iDesc !== -1 ? (get(iDesc) || null) : null;

    // Keep it simple: allow overriding via columns if present, else defaults.
    const type = (get(iType) as PointType) || args.defaultType || 'other';
    const visibility = (get(iVis) as Visibility) || args.defaultVisibility || 'club';

    inputs.push({
      name,
      type,
      lat,
      lon,
      elevation_m,
      description,
      visibility,
    });
  }

  diag.created = inputs.length;
  diag.skipped = diag.totalRows - diag.created;
  return { inputs, diag };
}

