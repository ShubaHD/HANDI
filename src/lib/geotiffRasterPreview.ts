import { fromBlob, type TypedArray } from 'geotiff';
import proj4 from 'proj4';
import type { BBox } from '@/features/rasters/api';
import './ensureRomaniaStereo70Proj';

/** Subset din GeoTIFFImage pentru tipare fără import de modul intern. */
type GeoImage = {
  getGeoKeys: () => Partial<Record<string, unknown>> | null;
  getBoundingBox: (tilegrid?: boolean) => number[];
  getFileDirectory: () => { getValue: (k: string) => unknown };
  getOrigin: () => number[];
  getResolution: () => number[];
  getWidth: () => number;
  getHeight: () => number;
  readRGB: (o?: Record<string, unknown>) => Promise<unknown>;
  readRasters: (o?: Record<string, unknown>) => Promise<unknown>;
  getGDALNoData: () => number | null;
};

/**
 * BBox în CRS-ul rasterului, aliniat cu GDAL la „RasterPixelIsPoint” (GeoKey 2):
 * geotiff.js folosește colțuri la 0…W/H ca la PixelIsArea, ceea ce deplasează
 * extinderea cu ~½ pixel în sol → pe hartă (ex. Stereo70) apare adesea spre est.
 */
function getProjectedBoundingBox(image: GeoImage): [number, number, number, number] {
  try {
    const gk = image.getGeoKeys();
    const rasterType = gk?.GTRasterTypeGeoKey;
    const isPoint = rasterType === 2;
    const w = image.getWidth();
    const h = image.getHeight();
    const corners: [number, number][] = isPoint
      ? [
          [-0.5, -0.5],
          [-0.5, h - 0.5],
          [w - 0.5, -0.5],
          [w - 0.5, h - 0.5],
        ]
      : [
          [0, 0],
          [0, h],
          [w, 0],
          [w, h],
        ];

    const fd = image.getFileDirectory();
    const modelTransformation = fd.getValue('ModelTransformation') as number[] | undefined;
    if (
      modelTransformation &&
      modelTransformation.length >= 16 &&
      Number.isFinite(modelTransformation[0] as number)
    ) {
      const [a, b, , d, e, f, , hh] = modelTransformation;
      const xs = corners.map(([I, J]) => d + a * I + b * J);
      const ys = corners.map(([I, J]) => hh + e * I + f * J);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }

    const origin = image.getOrigin();
    const res = image.getResolution();
    const xs = corners.map(([I, _J]) => origin[0] + I * res[0]);
    const ys = corners.map(([_I, J]) => origin[1] + J * res[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  } catch {
    const b = image.getBoundingBox();
    return [b[0]!, b[1]!, b[2]!, b[3]!];
  }
}

/** WGS 84 / Pseudo-Mercator (Google Maps, multe ortofoto „3857”). */
proj4.defs(
  'EPSG:3857',
  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +k=1 +x_0=0 +y_0=0 +units=m +no_defs',
);

const PREVIEW_MAX = 2048;
const JPEG_QUALITY = 0.86;

function citationGeoKeysBlob(gk: Partial<Record<string, unknown>>): string {
  const keys = ['PCSCitationGeoKey', 'GeogCitationGeoKey', 'GTCitationGeoKey'] as const;
  const parts: string[] = [];
  for (const k of keys) {
    const v = gk[k];
    if (typeof v === 'string' && v.trim()) parts.push(v);
  }
  return parts.join('\n').toUpperCase();
}

/** PCS fără EPSG explicit (0 / lipsă / 32767 = user-defined). */
function projectedCrsIsCustomOrMissing(p: unknown): boolean {
  return !(typeof p === 'number' && p > 0 && p !== 32767);
}

/**
 * Stereo 70 pe datum Dealul Piscului 1970 ⇒ EPSG:31700 (nu 3844 = Pulkovo 1942(58) / ANCPI).
 * Ex.: ArcGIS „STEREOGRAPHIC_M_DP1970”, GCS_Dealul_Piscului_1970, GeoKey Geog 4317 + PCS custom.
 */
function inferDealulPiscului1970Stereo70Grid(gk: Partial<Record<string, unknown>>): boolean {
  if (!projectedCrsIsCustomOrMissing(gk.ProjectedCSTypeGeoKey)) return false;
  if (gk.GeographicTypeGeoKey === 4317) return true;
  const c = citationGeoKeysBlob(gk);
  if (!c) return false;
  return (
    c.includes('DP1970') ||
    c.includes('STEREOGRAPHIC_M_DP') ||
    c.includes('PISCULUI_1970') ||
    c.includes('GCS_DEALUL') ||
    c.includes('D_DEALUL_PISCULUI') ||
    (c.includes('DEALUL') && c.includes('PISCUL'))
  );
}

function geoKeysToEpsg(
  image: GeoImage,
  projectedBounds: [number, number, number, number],
): string | null {
  const gk = image.getGeoKeys();
  if (!gk) return null;
  const p = gk.ProjectedCSTypeGeoKey;
  if (typeof p === 'number' && p > 0 && p !== 32767) {
    return normalizeGridEpsg(`EPSG:${p}`);
  }
  const [minX, minY, maxX, maxY] = projectedBounds;
  if (
    inferDealulPiscului1970Stereo70Grid(gk) &&
    !bboxLooksLikeGeographicDegrees(minX, minY, maxX, maxY)
  ) {
    return 'EPSG:31700';
  }
  const g = gk.GeographicTypeGeoKey;
  if (typeof g === 'number' && g > 0 && g !== 32767) {
    return normalizeGridEpsg(`EPSG:${g}`);
  }
  return null;
}

/** Coduri echivalente Web Mercator folosite în GeoTIFF-uri vechi. */
function normalizeGridEpsg(epsg: string): string {
  const u = epsg.toUpperCase();
  if (
    u === 'EPSG:900913' ||
    u === 'EPSG:3785' ||
    u === 'EPSG:102113' ||
    u === 'EPSG:102100' ||
    u === 'EPSG:3857'
  ) {
    return 'EPSG:3857';
  }
  return epsg;
}

function bboxToWgs84(minX: number, minY: number, maxX: number, maxY: number, fromCrs: string): BBox {
  const corners: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [x, y] of corners) {
    const [lon, lat] = proj4(fromCrs, 'EPSG:4326', [x, y]) as [number, number];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon) || minLon >= maxLon || minLat >= maxLat) {
    throw new Error('Nu pot calcula bounding box WGS84 din GeoTIFF.');
  }
  return { minLon, minLat, maxLon, maxLat };
}

function resolveSourceCrs(image: GeoImage, projectedBounds?: [number, number, number, number]): string {
  const extent = projectedBounds ?? getProjectedBoundingBox(image);
  const fromKeys = geoKeysToEpsg(image, extent);
  if (fromKeys) return fromKeys;
  const [minX, minY, maxX, maxY] = extent;
  const spanX = Math.abs(maxX - minX);
  const spanY = Math.abs(maxY - minY);
  if (spanX <= 360 && spanY <= 180 && spanX > 1e-6 && spanY > 1e-6) {
    return 'EPSG:4326';
  }
  throw new Error(
    'GeoTIFF fără CRS (GeoKeys). Reexportă cu EPSG în metadata sau folosește un .pmtiles.',
  );
}

/** `auto` = din GeoKeys / euristică; altfel forțează CRS pentru bbox. */
export type GeoTiffCrsMode = 'auto' | 'EPSG:3857' | 'EPSG:3844' | 'EPSG:31700';

function resolveCrsForBBox(image: GeoImage, mode: GeoTiffCrsMode): string {
  if (mode === 'EPSG:3844' || mode === 'EPSG:31700' || mode === 'EPSG:3857') return mode;
  const extent = getProjectedBoundingBox(image);
  const fromKeys = geoKeysToEpsg(image, extent);
  if (fromKeys) return fromKeys;
  return resolveSourceCrs(image, extent);
}

/**
 * True dacă limitele arată ca lon/lat în grade (tipic WGS84), nu ca metri proiectați.
 * Forțarea Stereo70/3857 pe astfel de valori produce poziții complet greșite.
 */
function bboxLooksLikeGeographicDegrees(minX: number, minY: number, maxX: number, maxY: number): boolean {
  const wx = Math.min(minX, maxX);
  const ex = Math.max(minX, maxX);
  const sy = Math.min(minY, maxY);
  const ny = Math.max(minY, maxY);
  const spanX = ex - wx;
  const spanY = ny - sy;
  if (!(spanX > 1e-12 && spanY > 1e-12)) return false;
  if (spanX > 350 || spanY > 170) return false;
  const inLonRange = wx >= -180 && ex <= 180;
  const inLatRange = sy >= -90 && ny <= 90;
  return inLonRange && inLatRange && spanX <= 30 && spanY <= 25;
}

function validateForcedCrsMatchesBboxUnits(
  fromCrs: string,
  crsMode: GeoTiffCrsMode,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  if (crsMode === 'auto') return;
  if (!bboxLooksLikeGeographicDegrees(minX, minY, maxX, maxY)) return;

  if (fromCrs === 'EPSG:31700' || fromCrs === 'EPSG:3844') {
    throw new Error(
      'BBox-ul din GeoTIFF arată în grade (longitudine / latitudine), nu în metri Stereo70. ' +
        'EPSG:31700 și EPSG:3844 sunt pentru coordonate în metri pe sol (ex. 400000–700000). ' +
        'Dacă forțezi Stereo70 aici, imaginea sare departe (ex. peste Rusia). ' +
        'Alege „Auto” ca să se folosească CRS-ul din fișier, sau EPSG:3857 dacă e ortofoto Web Mercator.',
    );
  }
  if (fromCrs === 'EPSG:3857') {
    throw new Error(
      'BBox-ul pare deja în grade geografice; EPSG:3857 folosește metri Web Mercator. Alege „Auto” sau alt CRS potrivit.',
    );
  }
}

function isNoData(v: number, nodata: number | null): boolean {
  if (Number.isNaN(v)) return true;
  if (nodata == null || !Number.isFinite(nodata)) return false;
  return Math.abs(v - nodata) < 1e-10;
}

function floatBandToImageData(
  band: Float32Array | Float64Array | Int16Array | Int32Array | Uint16Array | Uint32Array,
  w: number,
  h: number,
  nodata: number | null,
): ImageData {
  const rgba = new Uint8ClampedArray(w * h * 4);
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i < band.length; i++) {
    const v = band[i] as number;
    if (isNoData(v, nodata)) continue;
    if (Number.isFinite(v)) {
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
  }
  if (!Number.isFinite(vmin) || vmin === vmax) {
    vmin = 0;
    vmax = 1;
  }
  const range = vmax - vmin || 1;
  for (let i = 0; i < w * h; i++) {
    const v = band[i] as number;
    const o = i * 4;
    if (isNoData(v, nodata)) {
      rgba[o + 3] = 0;
      continue;
    }
    const t = Math.max(0, Math.min(255, Math.round(((v - vmin) / range) * 255)));
    rgba[o] = t;
    rgba[o + 1] = t;
    rgba[o + 2] = t;
    rgba[o + 3] = 255;
  }
  return new ImageData(rgba, w, h);
}

function interleavedToImageData(
  data: Uint8Array | Uint16Array,
  w: number,
  h: number,
  samples: number,
): ImageData {
  const rgba = new Uint8ClampedArray(w * h * 4);
  if (samples >= 3) {
    for (let i = 0; i < w * h; i++) {
      const s = i * samples;
      const o = i * 4;
      const r = data[s];
      const g = data[s + 1];
      const b = data[s + 2];
      rgba[o] = typeof r === 'number' && r <= 255 ? r : Math.round(r / 257);
      rgba[o + 1] = typeof g === 'number' && g <= 255 ? g : Math.round(g / 257);
      rgba[o + 2] = typeof b === 'number' && b <= 255 ? b : Math.round(b / 257);
      rgba[o + 3] = samples >= 4 ? (typeof data[s + 3] === 'number' && data[s + 3]! <= 255
          ? (data[s + 3] as number)
          : Math.round((data[s + 3] as number) / 257)) : 255;
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      const v = data[i * samples] as number;
      const o = i * 4;
      const t = typeof v === 'number' && v <= 255 ? v : Math.round(v / 257);
      rgba[o] = t;
      rgba[o + 1] = t;
      rgba[o + 2] = t;
      rgba[o + 3] = 255;
    }
  }
  return new ImageData(rgba, w, h);
}

/**
 * Construiește un JPEG georeferențiat (bbox WGS84) din GeoTIFF, pentru overlay ImageSource.
 * Folosește citiri parțiale (blob slice) — poate procesa și fișiere mari, dar durează la primul decode.
 */
export async function buildRasterPreviewFromGeoTiff(
  file: File,
  opts?: { crsMode?: GeoTiffCrsMode },
): Promise<{
  jpegBlob: Blob;
  bbox: BBox;
}> {
  const crsMode = opts?.crsMode ?? 'auto';
  const tiff = await fromBlob(file);
  try {
    const image = (await tiff.getImage(0)) as GeoImage;
    const iw = image.getWidth();
    const ih = image.getHeight();
    const scale = Math.min(1, PREVIEW_MAX / Math.max(iw, ih));
    const outW = Math.max(1, Math.round(iw * scale));
    const outH = Math.max(1, Math.round(ih * scale));

    const fromCrs = resolveCrsForBBox(image, crsMode);
    const [minX, minY, maxX, maxY] = getProjectedBoundingBox(image);
    validateForcedCrsMatchesBboxUnits(fromCrs, crsMode, minX, minY, maxX, maxY);
    const bbox = bboxToWgs84(minX, minY, maxX, maxY, fromCrs);

    const nodata = image.getGDALNoData();
    let imageData: ImageData;

    try {
      const rgb = await image.readRGB({
        width: outW,
        height: outH,
        interleave: true,
        resampleMethod: 'bilinear',
      });
      const data = rgb as Uint8Array & { width: number; height: number };
      const copy = new Uint8ClampedArray(data.length);
      copy.set(data);
      imageData = new ImageData(copy, data.width, data.height);
    } catch {
      const bands = await image.readRasters({
        width: outW,
        height: outH,
        interleave: false,
        resampleMethod: 'bilinear',
      });
      const arr = bands as unknown as TypedArray[] & { width: number; height: number };
      const w = arr.width;
      const h = arr.height;
      const b0 = arr[0];
      if (!b0) throw new Error('GeoTIFF fără benzi de date citibile.');
      if (b0 instanceof Float32Array || b0 instanceof Float64Array) {
        imageData = floatBandToImageData(b0, w, h, nodata);
      } else if (arr.length >= 3) {
        const inter = new Uint8Array(w * h * 3);
        for (let i = 0; i < w * h; i++) {
          inter[i * 3] = Number(arr[0][i]) <= 255 ? Number(arr[0][i]) : Math.round(Number(arr[0][i]) / 257);
          inter[i * 3 + 1] = Number(arr[1][i]) <= 255 ? Number(arr[1][i]) : Math.round(Number(arr[1][i]) / 257);
          inter[i * 3 + 2] = Number(arr[2][i]) <= 255 ? Number(arr[2][i]) : Math.round(Number(arr[2][i]) / 257);
        }
        imageData = interleavedToImageData(inter, w, h, 3);
      } else {
        imageData = interleavedToImageData(arr[0] as Uint16Array, w, h, 1);
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponibil.');
    ctx.putImageData(imageData, 0, 0);

    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Nu pot encoda JPEG.'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });

    return { jpegBlob, bbox };
  } finally {
    await Promise.resolve(tiff.close()).catch(() => {});
  }
}
