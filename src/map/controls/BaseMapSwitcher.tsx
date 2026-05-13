import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppConfirm } from '@/components/ConfirmProvider';
import { BASE_MAPS, type BaseMapDef } from '@/map/layers/BaseLayers';
import {
  buildBaseMapsFromArchives,
  deleteLocalArchive,
  saveGeneratedBasemapBlob,
  saveLocalArchive,
  saveLocalMbtilesArchive,
} from '@/lib/pmtiles';
import {
  baseMapMetaForPack,
  buildOfflineBasemapPackBlob,
  countPackTiles,
  type OfflinePackSourceId,
} from '@/lib/offlineBasemapPack';

interface ViewportBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

interface Props {
  current: string;
  onChange: (b: BaseMapDef) => void;
  hillshadeOn: boolean;
  onToggleHillshade: (v: boolean) => void;
  hillshadeStrength: number;
  onChangeHillshadeStrength: (v: number) => void;
  viewportBbox?: ViewportBbox | null;
  viewportZoom?: number;
  /** După generare: selectează noul basemap offline. */
  onOfflinePackComplete?: (b: BaseMapDef) => void;
  /** Doar MapLibre: PMTiles peste basemap online. */
  enablePmtilesOverlay?: boolean;
  basemapOverlay?: BaseMapDef | null;
  onBasemapOverlayChange?: (b: BaseMapDef | null) => void;
  basemapOverlayOpacity?: number;
  onBasemapOverlayOpacityChange?: (v: number) => void;
}

export function BaseMapSwitcher({
  current,
  onChange,
  hillshadeOn,
  onToggleHillshade,
  hillshadeStrength,
  onChangeHillshadeStrength,
  viewportBbox = null,
  viewportZoom,
  onOfflinePackComplete,
  enablePmtilesOverlay = true,
  basemapOverlay = null,
  onBasemapOverlayChange,
  basemapOverlayOpacity = 0.85,
  onBasemapOverlayOpacityChange,
}: Props) {
  const ask = useAppConfirm();
  const [offlineBases, setOfflineBases] = useState<BaseMapDef[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [packOpen, setPackOpen] = useState(false);
  const [packSource, setPackSource] = useState<OfflinePackSourceId>('carto-voyager');
  const [packMinZ, setPackMinZ] = useState(12);
  const [packMaxZ, setPackMaxZ] = useState(15);
  const [packName, setPackName] = useState('Zona');
  const [packing, setPacking] = useState(false);
  const [packProgress, setPackProgress] = useState<{ loaded: number; total: number; phase: string } | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  const refreshOffline = async () => {
    try {
      const items = await buildBaseMapsFromArchives();
      setOfflineBases(items);
    } catch (e) {
      console.warn('[basemaps] offline list', e);
    }
  };

  useEffect(() => {
    void refreshOffline();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!packOpen || !viewportBbox) return;
    const z = Math.round(viewportZoom ?? 14);
    const meta = baseMapMetaForPack(packSource);
    setPackMinZ(Math.max(0, z - 2));
    setPackMaxZ(Math.min(meta.maxzoom, z + 1));
    const tag =
      packSource === 'opentopomap'
        ? 'OTM'
        : packSource === 'esri-sat'
          ? 'Esri'
          : packSource === 'cyclosm'
            ? 'CyclOSM'
            : 'Carto';
    setPackName(`${tag}-${new Date().toISOString().slice(0, 10)}`);
  }, [packOpen, viewportBbox, viewportZoom, packSource]);

  const packMeta = baseMapMetaForPack(packSource);
  const tileEstimate = useMemo(() => {
    if (!viewportBbox) return 0;
    if (packMinZ > packMaxZ) return 0;
    return countPackTiles(viewportBbox, packMinZ, packMaxZ);
  }, [viewportBbox, packMinZ, packMaxZ]);

  const onUpload = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      if (file.name.toLowerCase().endsWith('.mbtiles')) {
        await saveLocalMbtilesArchive(file);
      } else {
        await saveLocalArchive(file);
      }
      await refreshOffline();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import esuat');
    } finally {
      setImporting(false);
    }
  };

  const removeOffline = async (id: string) => {
    if (!(await ask('Stergi aceasta harta offline?'))) return;
    const key = id.replace(/^pmtiles-/, '');
    await deleteLocalArchive(key);
    await refreshOffline();
  };

  const startOfflinePack = async () => {
    if (!viewportBbox) {
      setError('Muta sau zoom-uieste harta ca sa existe o zona vizibila.');
      return;
    }
    if (packMinZ > packMaxZ) {
      setError('Zoom minim trebuie ≤ zoom maxim.');
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPacking(true);
    setError(null);
    setPackProgress({ loaded: 0, total: 0, phase: 'start' });
    try {
      const blob = await buildOfflineBasemapPackBlob({
        source: packSource,
        bbox: viewportBbox,
        minZoom: packMinZ,
        maxZoom: packMaxZ,
        name: packName.trim() || 'Zona',
        signal: ac.signal,
        onProgress: (p) => {
          setPackProgress({
            loaded: p.loaded,
            total: p.total,
            phase: p.phase,
          });
        },
      });
      const def = await saveGeneratedBasemapBlob(blob, packName.trim() || 'Zona');
      await refreshOffline();
      onOfflinePackComplete?.(def);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : (e as Error)?.name;
      if (name === 'AbortError') {
        setError('Anulat.');
      } else {
        setError(e instanceof Error ? e.message : 'Pachet esuat');
      }
    } finally {
      setPacking(false);
      setPackProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-xl p-3 w-80 max-h-[70vh] overflow-y-auto">
      <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2">Harta de baza (online)</h3>
      <div className="space-y-1.5">
        {BASE_MAPS.map((b) => (
          <BaseMapButton key={b.id} b={b} active={current === b.id} onClick={() => onChange(b)} />
        ))}
      </div>

      <div className="mt-4 border-t border-slate-700 pt-3">
        <button
          type="button"
          onClick={() => setPackOpen((v) => !v)}
          className="w-full text-left text-xs font-semibold uppercase text-slate-400 hover:text-slate-200 flex justify-between items-center"
        >
          <span>Pachet offline (zona vizibila)</span>
          <span className="text-slate-500">{packOpen ? '−' : '+'}</span>
        </button>
        {packOpen && (
          <div className="mt-2 space-y-2 text-xs">
            <p className="text-slate-500 leading-snug">
              Descarca tile-uri pentru dreptunghiul curent (Carto / CyclOSM / OpenTopoMap / Esri), apoi salveaza
              ca PMTiles local. Daca OTM sau Esri esueaza (CORS), incearca Carto. Pentru zone mari sau politici
              stricte: genereaza PMTiles pe PC (vezi{' '}
              <code className="text-slate-300">npm run verify:offline-pmtiles-workflow</code>
              ) si importa .pmtiles sau .mbtiles mai jos. PMTiles/MBTiles raster e doar in{' '}
              <span className="text-slate-300">MapLibre</span> — dupa „Genereaza & salveaza” comutam la MapLibre
              si selectam noul basemap.
            </p>
            {!viewportBbox ? (
              <div className="text-amber-200/90">Nu avem inca bbox — misca harta putin.</div>
            ) : (
              <div className="text-slate-400">
                ~{tileEstimate.toLocaleString()} tile-uri (estimare). Limita app: 14k.
              </div>
            )}
            <label className="block text-slate-400">
              Sursa
              <select
                value={packSource}
                onChange={(e) => setPackSource(e.target.value as OfflinePackSourceId)}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-2 py-1.5 text-slate-100"
                disabled={packing}
              >
                <option value="carto-voyager">Carto Voyager (recomandat, max z20)</option>
                <option value="cyclosm">CyclOSM (max z18)</option>
                <option value="opentopomap">OpenTopoMap (max z17)</option>
                <option value="esri-sat">Satelit Esri (max z19)</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-slate-400">
                Zoom min
                <input
                  type="number"
                  min={0}
                  max={packMeta.maxzoom}
                  value={packMinZ}
                  onChange={(e) => setPackMinZ(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-2 py-1"
                  disabled={packing}
                />
              </label>
              <label className="text-slate-400">
                Zoom max
                <input
                  type="number"
                  min={0}
                  max={packMeta.maxzoom}
                  value={packMaxZ}
                  onChange={(e) => setPackMaxZ(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-2 py-1"
                  disabled={packing}
                />
              </label>
            </div>
            <label className="block text-slate-400">
              Nume fisier
              <input
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-2 py-1.5 text-slate-100"
                disabled={packing}
              />
            </label>
            {packProgress && (
              <div className="text-slate-300">
                {packProgress.phase === 'fetching'
                  ? `Descarc ${packProgress.loaded}/${packProgress.total}…`
                  : packProgress.phase === 'building'
                    ? 'Construiesc arhiva…'
                    : 'Pornesc…'}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void startOfflinePack()}
                disabled={packing || !viewportBbox || tileEstimate === 0}
                className="flex-1 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:pointer-events-none py-2 text-sm font-medium text-white"
              >
                {packing ? 'Lucrez…' : 'Genereaza & salveaza'}
              </button>
              {packing && (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="px-3 rounded-lg bg-slate-800 border border-slate-600 text-slate-200"
                >
                  Stop
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {enablePmtilesOverlay && onBasemapOverlayChange && !current.startsWith('pmtiles-') && (
        <div className="mt-4 border-t border-slate-700 pt-3 space-y-2">
          <h3 className="text-xs font-semibold uppercase text-slate-400">Strat offline peste harta</h3>
          <p className="text-slate-500 text-[11px] leading-snug">
            Afiseaza un PMTiles salvat mai sus peste basemap-ul online (ex. Sureanu peste Carto), cu opacitate
            reglabila. Straturile CAD raman deasupra.
          </p>
          <label className="block text-slate-400 text-xs">
            Pachet PMTiles
            <select
              value={basemapOverlay?.id ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  onBasemapOverlayChange(null);
                  return;
                }
                const pick =
                  offlineBases.find((b) => b.id === v) ??
                  (basemapOverlay?.id === v ? basemapOverlay : null);
                onBasemapOverlayChange(pick);
              }}
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 px-2 py-1.5 text-slate-100"
            >
              <option value="">Fara</option>
              {basemapOverlay && !offlineBases.some((b) => b.id === basemapOverlay.id) && (
                <option value={basemapOverlay.id}>{basemapOverlay.label}</option>
              )}
              {offlineBases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          {basemapOverlay && onBasemapOverlayOpacityChange && (
            <label className="block text-slate-400 text-xs">
              Opacitate strat: {basemapOverlayOpacity.toFixed(2)}
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={basemapOverlayOpacity}
                onChange={(e) => onBasemapOverlayOpacityChange(parseFloat(e.target.value))}
                className="w-full accent-brand-500 mt-1"
              />
            </label>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-4 mb-2">
        <h3 className="text-xs font-semibold uppercase text-slate-400">Harta offline (PMTiles / MBTiles)</h3>
        <label className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700 cursor-pointer">
          {importing ? '...' : '+ adauga'}
          <input
            type="file"
            accept=".pmtiles,.mbtiles,application/octet-stream"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {offlineBases.length === 0 ? (
        <div className="text-xs text-slate-500 italic px-2 py-1.5">
          Nicio harta offline. Adauga un fisier .pmtiles sau .mbtiles ca sa lucrezi fara semnal.
        </div>
      ) : (
        <div className="space-y-1.5">
          {offlineBases.map((b) => (
            <div key={b.id} className="flex gap-1.5">
              <BaseMapButton b={b} active={current === b.id} onClick={() => onChange(b)} />
              <button
                type="button"
                onClick={() => void removeOffline(b.id)}
                className="px-2 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-red-900/40 text-xs"
                title="Sterge"
              >
                X
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="text-xs text-red-300 mt-2">{error}</div>}

      <h3 className="text-xs font-semibold uppercase text-slate-400 mt-4 mb-2">Suprapuneri</h3>
      <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
        <span className="text-sm">Hillshade (umbre relief)</span>
        <input
          type="checkbox"
          checked={hillshadeOn}
          onChange={(e) => onToggleHillshade(e.target.checked)}
          className="w-4 h-4 accent-brand-500"
        />
      </label>
      {hillshadeOn && (
        <div className="px-3 py-2 mt-1.5 bg-slate-800/60 rounded-lg">
          <label className="text-xs text-slate-400">
            Intensitate: {hillshadeStrength.toFixed(1)}
          </label>
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.1}
            value={hillshadeStrength}
            onChange={(e) => onChangeHillshadeStrength(parseFloat(e.target.value))}
            className="w-full accent-brand-500"
          />
        </div>
      )}
    </div>
  );
}

interface BaseMapButtonProps {
  b: BaseMapDef;
  active: boolean;
  onClick: () => void;
}

function BaseMapButton({ b, active, onClick }: BaseMapButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-left px-3 py-2 rounded-lg border transition ${
        active
          ? 'bg-brand-600 border-brand-500 text-white'
          : 'bg-slate-800 border-slate-700 hover:border-slate-500'
      }`}
    >
      <div className="text-sm font-medium">{b.label}</div>
      <div className={`text-xs ${active ? 'text-brand-50' : 'text-slate-400'}`}>{b.description}</div>
    </button>
  );
}
