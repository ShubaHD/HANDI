import { gpx as togeojsonGpx } from '@tmcw/togeojson';
import type { Track } from '@/lib/types';

export interface ParsedGpxTrack {
  name: string;
  geom: GeoJSON.LineString;
  recordedAt: string | null;
}

export function parseGpxFile(xmlString: string): ParsedGpxTrack[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Fisier GPX invalid (XML malformed)');
  }
  const fc = togeojsonGpx(doc) as GeoJSON.FeatureCollection;
  const result: ParsedGpxTrack[] = [];

  for (const f of fc.features) {
    if (!f.geometry) continue;
    const props = f.properties ?? {};
    const recordedAt = readRecordedAt(props as Record<string, unknown>);
    if (f.geometry.type === 'LineString') {
      result.push({
        name: (props as { name?: string }).name ?? 'Traseu importat',
        geom: f.geometry,
        recordedAt,
      });
    } else if (f.geometry.type === 'MultiLineString') {
      f.geometry.coordinates.forEach((coords, i) => {
        result.push({
          name:
            ((props as { name?: string }).name ?? 'Traseu importat') +
            (f.geometry.type === 'MultiLineString' && coords.length > 0 ? ` [${i + 1}]` : ''),
          geom: { type: 'LineString', coordinates: coords },
          recordedAt,
        });
      });
    }
  }
  return result;
}

function readRecordedAt(props: Record<string, unknown>): string | null {
  const t = props.time;
  if (typeof t === 'string') return t;
  const coordTimes = props.coordTimes;
  if (Array.isArray(coordTimes) && typeof coordTimes[0] === 'string') return coordTimes[0];
  return null;
}

export function tracksToGpx(tracks: Track[]): string {
  const trks = tracks.map((t) => {
    const trkpts = t.geom.coordinates
      .map((c) => {
        const ele = c.length >= 3 ? `<ele>${c[2]}</ele>` : '';
        return `<trkpt lat="${c[1]}" lon="${c[0]}">${ele}</trkpt>`;
      })
      .join('');
    return `<trk><name>${escapeXml(t.name)}</name><trkseg>${trkpts}</trkseg></trk>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="HANDI Speo Field" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>HANDI export</name><time>${new Date().toISOString()}</time></metadata>
  ${trks.join('\n')}
</gpx>`;
}

export function pointsToGpx(
  points: { name: string; lat: number; lon: number; elevation_m: number | null }[],
): string {
  const wpts = points
    .map((p) => {
      const ele = p.elevation_m != null ? `<ele>${p.elevation_m}</ele>` : '';
      return `<wpt lat="${p.lat}" lon="${p.lon}">${ele}<name>${escapeXml(p.name)}</name></wpt>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="HANDI Speo Field" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>HANDI export</name><time>${new Date().toISOString()}</time></metadata>
  ${wpts}
</gpx>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function downloadFile(filename: string, content: string, mime = 'application/gpx+xml') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
