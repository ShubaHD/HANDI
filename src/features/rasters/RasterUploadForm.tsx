import { useEffect, useState, type FormEvent } from 'react';
import { buildRasterPreviewFromGeoTiff, type GeoTiffCrsMode } from '@/lib/geotiffRasterPreview';
import { readArchiveMetadata, saveLocalPmtilesRasterFromFile } from '@/lib/pmtiles';
import type { RasterKind, RasterOverlay, Visibility } from '@/lib/types';
import {
  createLocalPmtilesRasterOverlay,
  MAX_RASTER_CLOUD_UPLOAD_BYTES,
  uploadRaster,
  type BBox,
} from './api';

const GEOTIFF_CRS_STORAGE_KEY = 'handi-geotiff-crs-mode';

function readStoredGeoTiffCrsMode(): GeoTiffCrsMode {
  try {
    const v = localStorage.getItem(GEOTIFF_CRS_STORAGE_KEY);
    if (v === 'EPSG:3844' || v === 'EPSG:31700' || v === 'EPSG:3857' || v === 'auto') return v;
  } catch {
    /* ignore */
  }
  return 'auto';
}

function persistGeoTiffCrsMode(m: GeoTiffCrsMode) {
  try {
    localStorage.setItem(GEOTIFF_CRS_STORAGE_KEY, m);
  } catch {
    /* ignore */
  }
}

const KIND_LABELS: Record<RasterKind, string> = {
  thermal: 'Termal (drona)',
  lidar_hillshade: 'LIDAR hillshade',
  orthophoto: 'Ortofoto',
  other: 'Alt raster',
};

interface Props {
  defaultBbox?: BBox | null;
  onCreated: (r: RasterOverlay) => void;
  /** După import PMTiles local în IndexedDB (reîncarcă URL-urile blob pe hartă). */
  onLocalPmtilesReady?: () => void | Promise<void>;
  onCancel: () => void;
}

export function RasterUploadForm({ defaultBbox, onCreated, onLocalPmtilesReady, onCancel }: Props) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RasterKind>('thermal');
  const [file, setFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('club');
  const [minLon, setMinLon] = useState(defaultBbox ? String(defaultBbox.minLon) : '');
  const [minLat, setMinLat] = useState(defaultBbox ? String(defaultBbox.minLat) : '');
  const [maxLon, setMaxLon] = useState(defaultBbox ? String(defaultBbox.maxLon) : '');
  const [maxLat, setMaxLat] = useState(defaultBbox ? String(defaultBbox.maxLat) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoTiffCrsMode, setGeoTiffCrsMode] = useState<GeoTiffCrsMode>(() => readStoredGeoTiffCrsMode());
  const [pmtilesMeta, setPmtilesMeta] = useState<{
    bounds: [number, number, number, number];
    minzoom: number | null;
    maxzoom: number | null;
    sizeMb: number;
  } | null>(null);

  /** Fișiere „*_3857*” → Web Mercator; „dp1970” / „dealul”+„pisc” → Stereo70 Dealul Piscului (EPSG:31700). */
  useEffect(() => {
    if (!file) return;
    const n = file.name.toLowerCase();
    if (!/\.(tif|tiff|geotiff)$/.test(n)) return;
    if (n.includes('3857') || n.includes('webmerc') || n.includes('pseudo')) {
      setGeoTiffCrsMode((prev) => (prev === 'auto' ? 'EPSG:3857' : prev));
      return;
    }
    if (
      n.includes('dp1970') ||
      n.includes('piscului') ||
      (n.includes('dealul') && n.includes('pisc')) ||
      n.includes('stereographic_m_dp')
    ) {
      setGeoTiffCrsMode((prev) => (prev === 'auto' ? 'EPSG:31700' : prev));
    }
  }, [file]);

  useEffect(() => {
    if (!file?.name.toLowerCase().endsWith('.pmtiles')) {
      setPmtilesMeta(null);
      return;
    }
    let cancelled = false;
    void readArchiveMetadata(file)
      .then((m) => {
        if (cancelled) return;
        if (!m.bounds) {
          setPmtilesMeta(null);
          setError('PMTiles fără bounds în antet — regenerează arhiva (gdal / pmtiles convert).');
          return;
        }
        setError(null);
        setPmtilesMeta({
          bounds: m.bounds,
          minzoom: m.minzoom,
          maxzoom: m.maxzoom,
          sizeMb: file.size / (1024 * 1024),
        });
        setKind((k) => (k === 'orthophoto' || k === 'lidar_hillshade' ? k : 'orthophoto'));
      })
      .catch((e) => {
        if (!cancelled) {
          setPmtilesMeta(null);
          setError(e instanceof Error ? e.message : 'Nu pot citi antetul PMTiles');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const isPMTiles = Boolean(file?.name.toLowerCase().endsWith('.pmtiles'));
  const isGeoTiff = Boolean(
    file &&
      (/\.(tif|tiff|geotiff)$/i.test(file.name) ||
        file.type === 'image/tiff' ||
        file.type === 'image/geotiff'),
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Alege un fisier (PNG / JPG / GeoTIFF / PMTiles)');
      return;
    }
    const bbox: BBox = isPMTiles || isGeoTiff
      ? { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 }
      : {
          minLon: parseFloat(minLon),
          minLat: parseFloat(minLat),
          maxLon: parseFloat(maxLon),
          maxLat: parseFloat(maxLat),
        };
    if (!isPMTiles && !isGeoTiff) {
      if (
        !isFinite(bbox.minLon) ||
        !isFinite(bbox.minLat) ||
        !isFinite(bbox.maxLon) ||
        !isFinite(bbox.maxLat)
      ) {
        setError('Coordonate invalide');
        return;
      }
      if (bbox.minLon >= bbox.maxLon || bbox.minLat >= bbox.maxLat) {
        setError('Bounding box invalid (min < max)');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      let uploadFile = file;
      let uploadBbox = bbox;
      let metadata: Record<string, unknown> = isPMTiles
        ? { format: 'pmtiles' }
        : { format: 'image' };

      if (isPMTiles) {
        const pm = await readArchiveMetadata(file);
        if (!pm.bounds) {
          throw new Error('PMTiles fără bounds în antet — regenerează arhiva.');
        }
        const [minLon, minLat, maxLon, maxLat] = pm.bounds;
        uploadBbox = { minLon, minLat, maxLon, maxLat };
        const pmMeta = {
          ...(pm.minzoom != null && { minzoom: pm.minzoom }),
          ...(pm.maxzoom != null && { maxzoom: pm.maxzoom }),
        };
        const useLocalOnly = file.size > MAX_RASTER_CLOUD_UPLOAD_BYTES;

        if (useLocalOnly) {
          const created = await createLocalPmtilesRasterOverlay({
            name: name.trim() || file.name,
            kind,
            bbox: uploadBbox,
            visibility,
            metadata: pmMeta,
          });
          await saveLocalPmtilesRasterFromFile({
            rasterId: created.id,
            name: created.name,
            file,
          });
          await onLocalPmtilesReady?.();
          onCreated(created);
          return;
        }

        metadata = { format: 'pmtiles', ...pmMeta };
      } else if (isGeoTiff) {
        const preview = await buildRasterPreviewFromGeoTiff(file, {
          crsMode: geoTiffCrsMode,
        });
        uploadFile = new File(
          [preview.previewBlob],
          `${file.name.replace(/\.[^.]+$/, '') || 'raster'}-preview.${preview.fileExt}`,
          { type: preview.mimeType },
        );
        uploadBbox = preview.bbox;
        metadata = {
          format: 'image',
          derivedFromGeoTiff: true,
          originalGeoTiffName: file.name,
          geoTiffCrsMode,
          previewWidth: preview.previewSize.width,
          previewHeight: preview.previewSize.height,
          sourceWidth: preview.sourceSize.width,
          sourceHeight: preview.sourceSize.height,
        };
      }

      const created = await uploadRaster({
        name: name.trim() || file.name,
        kind,
        file: uploadFile,
        bbox: uploadBbox,
        visibility,
        metadata,
      });
      onCreated(created);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload esuat';
      if (
        isPMTiles &&
        file &&
        (msg.toLowerCase().includes('maximum allowed size') ||
          msg.toLowerCase().includes('entity too large') ||
          msg.toLowerCase().includes('payload too large'))
      ) {
        setError(
          `${msg} — Fișierul (${(file.size / (1024 * 1024)).toFixed(0)} MB) depășește limita Supabase (~48 MB). ` +
            'Repornește aplicația după update: Handi importă automat PMTiles mari doar local (fără cloud).',
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const useDefault = () => {
    if (!defaultBbox) return;
    setMinLon(String(defaultBbox.minLon.toFixed(6)));
    setMinLat(String(defaultBbox.minLat.toFixed(6)));
    setMaxLon(String(defaultBbox.maxLon.toFixed(6)));
    setMaxLat(String(defaultBbox.maxLat.toFixed(6)));
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="font-semibold">Raster overlay nou</h2>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">Tip</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as RasterKind)}
          className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg"
        >
          {(Object.keys(KIND_LABELS) as RasterKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">Nume</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: Termal Versant Padurea Craiului 2026-04-15"
          className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-brand-500"
        />
      </label>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">
          Fișier (PNG/JPG, GeoTIFF → preview JPEG, sau PMTiles pentru LiDAR mare)
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff,.geotiff,.pmtiles"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-700 file:bg-slate-800 file:text-slate-200"
        />
      </label>

      {isPMTiles && pmtilesMeta && (
        <div
          className={`rounded-lg border p-2 text-[11px] leading-snug ${
            pmtilesMeta.sizeMb * 1024 * 1024 > MAX_RASTER_CLOUD_UPLOAD_BYTES
              ? 'border-amber-800/60 bg-amber-950/30 text-amber-100'
              : 'border-emerald-900/60 bg-emerald-950/30 text-slate-300'
          }`}
        >
          <div>
            <strong
              className={
                pmtilesMeta.sizeMb * 1024 * 1024 > MAX_RASTER_CLOUD_UPLOAD_BYTES
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }
            >
              PMTiles OK
            </strong>{' '}
            — {pmtilesMeta.sizeMb.toFixed(1)} MB, zoom {pmtilesMeta.minzoom ?? '?'}…{pmtilesMeta.maxzoom ?? '?'}
          </div>
          {pmtilesMeta.sizeMb * 1024 * 1024 > MAX_RASTER_CLOUD_UPLOAD_BYTES ? (
            <p className="mt-1">
              Peste limita cloud Supabase (~48 MB) → la <strong>Salvează</strong> se importă{' '}
              <strong>doar pe acest dispozitiv</strong> (IndexedDB). Nu se sincronizează cu alți utilizatori; pe alt PC
              trebuie copiat fișierul din nou. Durează câteva minute la ~450 MB.
            </p>
          ) : (
            <p className="mt-1 text-slate-500">
              Se încarcă în cloud (club). Randare în <span className="font-mono text-slate-400">?maplibre=1</span>.
            </p>
          )}
        </div>
      )}

      {isGeoTiff && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
          <div className="text-[11px] uppercase text-slate-500 mb-1">CRS GeoTIFF (pentru bbox)</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setGeoTiffCrsMode('auto');
                persistGeoTiffCrsMode('auto');
              }}
              className={`py-2 rounded-lg text-xs border ${
                geoTiffCrsMode === 'auto'
                  ? 'bg-brand-600 border-brand-500 text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              Auto (din fișier)
            </button>
            <button
              type="button"
              onClick={() => {
                setGeoTiffCrsMode('EPSG:3857');
                persistGeoTiffCrsMode('EPSG:3857');
              }}
              className={`py-2 rounded-lg text-xs border ${
                geoTiffCrsMode === 'EPSG:3857'
                  ? 'bg-brand-600 border-brand-500 text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              EPSG:3857 (Web Mercator)
            </button>
            <button
              type="button"
              onClick={() => {
                setGeoTiffCrsMode('EPSG:3844');
                persistGeoTiffCrsMode('EPSG:3844');
              }}
              className={`py-2 rounded-lg text-xs border ${
                geoTiffCrsMode === 'EPSG:3844'
                  ? 'bg-brand-600 border-brand-500 text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              EPSG:3844 (Stereo70 / ANCPI, Pulkovo 1942(58))
            </button>
            <button
              type="button"
              onClick={() => {
                setGeoTiffCrsMode('EPSG:31700');
                persistGeoTiffCrsMode('EPSG:31700');
              }}
              className={`py-2 rounded-lg text-xs border ${
                geoTiffCrsMode === 'EPSG:31700'
                  ? 'bg-brand-600 border-brand-500 text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              EPSG:31700 (Dealul Piscului 1970 / Stereo70)
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-500 leading-snug">
            <strong className="text-slate-400">3844</strong> = Pulkovo 1942(58) / ANCPI;{' '}
            <strong className="text-slate-400">31700</strong> = Dealul Piscului 1970 (ex. LiDAR „STEREOGRAPHIC_M_DP1970”,
            GCS_Dealul_Piscului_1970). Ambele folosesc metri Stereo70 (~400000–700000), nu grade WGS84. Ortofoto Web
            Mercator: <strong className="text-slate-400">3857</strong> sau <strong className="text-slate-400">Auto</strong>.
            Numele cu „3857” / „dp1970” / „piscului” setează CRS pe Auto. Bbox corect și pentru{' '}
            <strong className="text-slate-400">RasterPixelIsPoint</strong>; după update,{' '}
            <strong className="text-slate-400">reîncarcă</strong> GeoTIFF-ul ca să se refacă limitele. Transformarea
            trebuie să fie <em>în</em> TIFF (tag-uri GeoTIFF); dacă ArcMap a lăsat doar un .tfw lângă fișier, browserul
            nu îl citește — folosește <strong className="text-slate-400">gdal_translate -of GTiff</strong> sau reexportă
            cu georef încorporat. Preview-ul salvat are rezoluție limitată (implicit max{' '}
            <strong className="text-slate-400">16384 px</strong> pe latura lungă); la zoom mare harta poate părea
            încețoșată — pentru claritate la z16+ folosește <strong className="text-slate-400">PMTiles</strong>.
          </p>
        </div>
      )}

      {!isPMTiles && !isGeoTiff && (
        <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs uppercase text-slate-400">Bounding box (lat/lon)</span>
          {defaultBbox && (
            <button
              type="button"
              onClick={useDefault}
              className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700"
            >
              Foloseste viewport-ul curent
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <input
            type="number"
            step="any"
            value={minLat}
            onChange={(e) => setMinLat(e.target.value)}
            placeholder="min lat (sud)"
            className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded font-mono"
          />
          <input
            type="number"
            step="any"
            value={maxLat}
            onChange={(e) => setMaxLat(e.target.value)}
            placeholder="max lat (nord)"
            className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded font-mono"
          />
          <input
            type="number"
            step="any"
            value={minLon}
            onChange={(e) => setMinLon(e.target.value)}
            placeholder="min lon (vest)"
            className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded font-mono"
          />
          <input
            type="number"
            step="any"
            value={maxLon}
            onChange={(e) => setMaxLon(e.target.value)}
            placeholder="max lon (est)"
            className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded font-mono"
          />
        </div>
        </div>
      )}

      <div>
        <label className="block text-xs uppercase text-slate-400 mb-1">Vizibilitate</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setVisibility('club')}
            className={`px-3 py-2 rounded-lg text-sm border ${
              visibility === 'club'
                ? 'bg-brand-600 border-brand-500 text-white'
                : 'border-slate-700 bg-slate-800 text-slate-300'
            }`}
          >
            Club
          </button>
          <button
            type="button"
            onClick={() => setVisibility('private')}
            className={`px-3 py-2 rounded-lg text-sm border ${
              visibility === 'private'
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'border-slate-700 bg-slate-800 text-slate-300'
            }`}
          >
            Privat
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700"
        >
          Anuleaza
        </button>
        <button
          type="submit"
          disabled={busy || !file}
          className="flex-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 font-medium"
        >
          {busy ? 'Upload...' : 'Salveaza'}
        </button>
      </div>
    </form>
  );
}
