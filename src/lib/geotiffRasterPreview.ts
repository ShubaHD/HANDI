import { fromBlob, type TypedArray } from 'geotiff';
import proj4 from 'proj4';
import type { BBox } from '@/features/rasters/api';

/** Subset din GeoTIFFImage pentru tipare fără import de modul intern. */
type GeoImage = {
  getGeoKeys: () => Partial<Record<string, unknown>> | null;
  getBoundingBox: (tilegrid?: boolean) => number[];
  getWidth: () => number;
  getHeight: () => number;
  readRGB: (o?: Record<string, unknown>) => Promise<unknown>;
  readRasters: (o?: Record<string, unknown>) => Promise<unknown>;
  getGDALNoData: () => number | null;
};

proj4.defs(
  'EPSG:3844',
  '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
);
proj4.defs(
  'EPSG:31700',
  '+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass +towgs84=28,-121,-77,0,0,0,0 +units=m +no_defs',
);

const PREVIEW_MAX = 2048;
const JPEG_QUALITY = 0.86;

function geoKeysToEpsg(image: GeoImage): string | null {
  const gk = image.getGeoKeys();
  if (!gk) return null;
  const p = gk.ProjectedCSTypeGeoKey;
  if (typeof p === 'number' && p > 0 && p !== 32767) return `EPSG:${p}`;
  const g = gk.GeographicTypeGeoKey;
  if (typeof g === 'number' && g > 0 && g !== 32767) return `EPSG:${g}`;
  return null;
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

function resolveSourceCrs(image: GeoImage): string {
  const fromKeys = geoKeysToEpsg(image);
  if (fromKeys) return fromKeys;
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const spanX = Math.abs(maxX - minX);
  const spanY = Math.abs(maxY - minY);
  if (spanX <= 360 && spanY <= 180 && spanX > 1e-6 && spanY > 1e-6) {
    return 'EPSG:4326';
  }
  throw new Error(
    'GeoTIFF fără CRS (GeoKeys). Reexportă cu EPSG în metadata sau folosește un .pmtiles.',
  );
}

/** `auto` = din GeoKeys / euristică; altfel forțează CRS pentru bbox (metri Stereo70). */
export type GeoTiffCrsMode = 'auto' | 'EPSG:3844' | 'EPSG:31700';

function resolveCrsForBBox(image: GeoImage, mode: GeoTiffCrsMode): string {
  if (mode === 'EPSG:3844' || mode === 'EPSG:31700') return mode;
  return resolveSourceCrs(image);
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
    const [minX, minY, maxX, maxY] = image.getBoundingBox();
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
