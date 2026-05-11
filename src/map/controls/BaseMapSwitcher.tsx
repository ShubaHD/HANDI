import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppConfirm } from '@/components/ConfirmProvider';
import { BASE_MAPS, type BaseMapDef } from '@/map/layers/BaseLayers';
import {
  buildBaseMapsFromArchives,
  deleteLocalArchive,
  saveGeneratedBasemapBlob,
  saveLocalArchive,
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
}: Props) {
  const ask = useAppConfirm();
  const [offlineBases, setOfflineBases] = useState<BaseMapDef[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [packOpen, setPackOpen] = useState(false);
  const [packSource, setPackSource] = useState<OfflinePackSourceId>('opentopomap');
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
    const tag = packSource === 'opentopomap' ? 'OTM' : 'Esri';
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
      await saveLocalArchive(file);
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
              Descarca tile-uri pentru dreptunghiul curent al hartii (OpenTopoMap sau Esri), apoi salveaza ca
              PMTiles local. Respecta termenii furnizorilor. La selectare, basemap-ul offline foloseste automat
              randarea MapLibre (PMTiles nu merge pe Leaflet).
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

      <div className="flex items-center justify-between mt-4 mb-2">
        <h3 className="text-xs font-semibold uppercase text-slate-400">Harta offline (PMTiles)</h3>
        <label className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700 cursor-pointer">
          {importing ? '...' : '+ adauga'}
          <input
            type="file"
            accept=".pmtiles,application/octet-stream"
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
          Nicio harta offline. Adauga un fisier .pmtiles ca sa lucrezi fara semnal.
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
