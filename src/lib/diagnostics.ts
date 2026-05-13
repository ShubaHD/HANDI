import { PMTiles } from 'pmtiles';

export interface PmtilesCheckResult {
  url: string;
  /** Antetul PMTiles (getHeader) s-a citit cu succes — arhiva e validă la acest URL. */
  ok: boolean;
  /**
   * Răspuns la `Range: bytes=0-1023` e 206 și `Content-Range` e vizibil în JS.
   * Dacă e false dar `ok` e true, de obicei lipsesc antete expuse în CORS pe storage;
   * tile-urile pot merge totuși dacă browserul primește corect octeții.
   */
  byteRangeProbeOk: boolean;
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
  let status: number | null = null;
  let contentRange: string | null = null;
  let acceptRanges: string | null = null;
  let byteRangeProbeOk = false;

  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    status = res.status;
    contentRange = res.headers.get('content-range');
    acceptRanges = res.headers.get('accept-ranges');
    byteRangeProbeOk =
      res.status === 206 &&
      Boolean(contentRange) &&
      (acceptRanges === null || acceptRanges.toLowerCase().includes('bytes'));
  } catch {
    /* rețea / CORS la primul fetch — încercăm totuși getHeader */
  }

  try {
    const pm = new PMTiles(url);
    const h = await pm.getHeader();
    return {
      url,
      ok: true,
      byteRangeProbeOk,
      status,
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
      byteRangeProbeOk,
      status,
      contentRange,
      acceptRanges,
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

