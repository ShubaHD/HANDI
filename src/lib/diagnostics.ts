import { PMTiles } from 'pmtiles';

export interface PmtilesCheckResult {
  url: string;
  ok: boolean;
  status: number | null;
  contentRange: string | null;
  acceptRanges: string | null;
  header?: {
    minZoom: number | null;
    maxZoom: number | null;
    minLon: number | null;
    minLat: number | null;
    maxLon: number | null;
    maxLat: number | null;
    tileType: number | null;
    tileCompression: number | null;
    internalCompression: number | null;
  };
  error?: string;
}

export async function checkPmtilesUrl(url: string): Promise<PmtilesCheckResult> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    const contentRange = res.headers.get('content-range');
    const acceptRanges = res.headers.get('accept-ranges');

    // Even if Range is not OK, try header fetch to provide details.
    const pm = new PMTiles(url);
    const h = await pm.getHeader();

    const ok =
      res.status === 206 &&
      Boolean(contentRange) &&
      (acceptRanges === null || acceptRanges.toLowerCase().includes('bytes'));

    return {
      url,
      ok,
      status: res.status,
      contentRange,
      acceptRanges,
      header: {
        minZoom: h.minZoom ?? null,
        maxZoom: h.maxZoom ?? null,
        minLon: h.minLon ?? null,
        minLat: h.minLat ?? null,
        maxLon: h.maxLon ?? null,
        maxLat: h.maxLat ?? null,
        tileType: h.tileType ?? null,
        tileCompression: h.tileCompression ?? null,
        internalCompression: h.internalCompression ?? null,
      },
    };
  } catch (e) {
    return {
      url,
      ok: false,
      status: null,
      contentRange: null,
      acceptRanges: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface AppDiagnostics {
  timeISO: string;
  url: string;
  renderer: 'maplibre' | 'leaflet';
  serviceWorker: {
    supported: boolean;
    controlled: boolean;
  };
  pmtiles: PmtilesCheckResult[];
}

