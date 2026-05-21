import { useMemo, useState } from 'react';
import { useAppConfirm } from '@/components/ConfirmProvider';
import type { RasterKind, RasterOverlay } from '@/lib/types';
import { deleteRasterArchive } from '@/lib/pmtiles';
import {
  deleteRaster,
  isLocalOnlyPmtilesRaster,
  isRasterPmtilesOverlay,
  rasterPmtilesHttpUrl,
} from './api';

const KIND_LABELS: Record<RasterKind, string> = {
  thermal: 'Termal',
  lidar_hillshade: 'LIDAR',
  orthophoto: 'Ortofoto',
  other: 'Raster',
};

const KIND_COLORS: Record<RasterKind, string> = {
  thermal: '#ef4444',
  lidar_hillshade: '#a855f7',
  orthophoto: '#0ea5e9',
  other: '#64748b',
};

interface Props {
  rasters: RasterOverlay[];
  visibleIds: Set<string>;
  opacity: Record<string, number>;
  onAdd: () => void;
  onToggle: (id: string) => void;
  onSetOpacity: (id: string, v: number) => void;
  onZoomTo: (r: RasterOverlay) => void | Promise<void>;
  onSaveOfflinePmtiles: (r: RasterOverlay, onProgress: (p: { loaded: number; total?: number }) => void) => Promise<void>;
  onDeleteOfflinePmtiles: (r: RasterOverlay) => Promise<void>;
  offlinePmtilesById: Record<string, string>;
  /** După salvare/actualizare copie locală: reîncarcă sursa pe hartă dacă rasterul e vizibil. */
  onOfflineRasterSaveComplete?: (rasterId: string) => void;
  onChanged: () => void;
  /** Pe Leaflet implicit, PMTiles nu se randă; afișează notă cu ?maplibre=1. */
  pmtilesMaplibreHint?: boolean;
}

export function RastersPanel({
  rasters,
  visibleIds,
  opacity,
  onAdd,
  onToggle,
  onSetOpacity,
  onZoomTo,
  onSaveOfflinePmtiles,
  onDeleteOfflinePmtiles,
  offlinePmtilesById,
  onOfflineRasterSaveComplete,
  onChanged,
  pmtilesMaplibreHint = false,
}: Props) {
  const ask = useAppConfirm();
  const [saving, setSaving] = useState<Record<string, { loaded: number; total?: number }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const isPmtilesRaster = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of rasters) {
      m[r.id] = isRasterPmtilesOverlay(r);
    }
    return m;
  }, [rasters]);

  const canSaveOfflineBlob = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of rasters) {
      m[r.id] = Boolean(rasterPmtilesHttpUrl(r) && !isLocalOnlyPmtilesRaster(r));
    }
    return m;
  }, [rasters]);

  const remove = async (r: RasterOverlay) => {
    if (!(await ask(`Stergi raster overlay "${r.name}"?`))) return;
    try {
      await deleteRasterArchive(r.id).catch(() => {});
      await deleteRaster(r);
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-700">
        <button
          onClick={onAdd}
          className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm"
        >
          + Upload raster (PNG/JPG / GeoTIFF preview / PMTiles)
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {rasters.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            Niciun raster overlay inca. Incarca un PNG / JPG georeferentiat (cu bbox).
          </div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {rasters.map((r) => {
              const isOn = visibleIds.has(r.id);
              const op = opacity[r.id] ?? 0.7;
              const captured = r.captured_at
                ? new Date(r.captured_at).toLocaleDateString('ro-RO')
                : '';
              const hint = `${r.name}\n${KIND_LABELS[r.kind]}${r.visibility === 'private' ? ' [privat]' : ''}${
                captured ? ` • ${captured}` : ''
              }\n(Hover pe hartă nu merge pentru raster; folosește acest tooltip + Zoom-to)`;
              return (
                <li key={r.id} className="p-3 hover:bg-slate-800/40" title={hint}>
                  <div className="flex items-start gap-2">
                    <div
                      className="w-3 h-8 rounded flex-shrink-0"
                      style={{ backgroundColor: KIND_COLORS[r.kind] }}
                    />
                    <button
                      onClick={() => void onZoomTo(r)}
                      className="flex-1 min-w-0 text-left"
                      title={hint}
                    >
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-slate-400">
                        {KIND_LABELS[r.kind]}
                        {r.visibility === 'private' && (
                          <span className="ml-2 text-amber-400">[privat]</span>
                        )}
                        {isLocalOnlyPmtilesRaster(r) && (
                          <span className="ml-2 text-sky-400">[local]</span>
                        )}
                        {r.captured_at && (
                          <span className="ml-2 font-mono">
                            {captured}
                          </span>
                        )}
                      </div>
                    </button>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => onToggle(r.id)}
                        className="w-4 h-4 accent-brand-500"
                      />
                      Vizibil
                    </label>
                    {canSaveOfflineBlob[r.id] && (
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (busyId) return;
                              setBusyId(r.id);
                              setSaving((p) => ({ ...p, [r.id]: { loaded: 0 } }));
                              void onSaveOfflinePmtiles(r, (prog) => {
                                setSaving((p) => ({ ...p, [r.id]: prog }));
                              })
                                .then(() => {
                                  onOfflineRasterSaveComplete?.(r.id);
                                })
                                .catch((e) => alert(e instanceof Error ? e.message : 'Eroare'))
                                .finally(() => {
                                  setBusyId(null);
                                  setSaving((p) => {
                                    const n = { ...p };
                                    delete n[r.id];
                                    return n;
                                  });
                                });
                            }}
                            className="text-xs px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                            disabled={busyId !== null}
                            title={
                              offlinePmtilesById[r.id]
                                ? 'Re-descarcă fișierul (actualizează copia locală)'
                                : 'Descarcă în acest dispozitiv pentru folosire fără rețea'
                            }
                          >
                            {offlinePmtilesById[r.id] ? 'Actualizează offline' : 'Salvează offline'}
                          </button>
                          {offlinePmtilesById[r.id] && (
                            <button
                              type="button"
                              onClick={() => {
                                if (busyId) return;
                                void (async () => {
                                  if (!(await ask(`Ștergi copia locală pentru „${r.name}”?`))) return;
                                  setBusyId(r.id);
                                  void onDeleteOfflinePmtiles(r)
                                    .catch((e) => alert(e instanceof Error ? e.message : 'Eroare'))
                                    .finally(() => setBusyId(null));
                                })();
                              }}
                              className="text-xs px-1.5 py-1 rounded border border-slate-700 text-slate-400 hover:text-red-300 hover:border-red-900/60 disabled:opacity-50"
                              disabled={busyId !== null}
                              title="Șterge copia locală"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => remove(r)}
                      className="text-slate-500 hover:text-red-400 px-1 py-1 text-xs"
                      title="Sterge"
                    >
                      X
                    </button>
                  </div>
                  {saving[r.id] && (
                    <div className="mt-2 ml-5 text-xs text-slate-400">
                      Download: {Math.round((saving[r.id].loaded / 1024 / 1024) * 10) / 10} MB
                      {saving[r.id].total
                        ? ` / ${Math.round((saving[r.id].total! / 1024 / 1024) * 10) / 10} MB`
                        : ''}
                    </div>
                  )}
                  {pmtilesMaplibreHint && isPmtilesRaster[r.id] && (
                    <div className="mt-1 ml-5 text-[10px] leading-snug text-amber-200/90 space-y-1">
                      <p>
                        PMTiles nu apare pe Leaflet. Folosește MapLibre (
                        <span className="font-mono text-slate-400">?maplibre=1</span>).
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const u = new URL(window.location.href);
                          u.searchParams.set('maplibre', '1');
                          u.searchParams.delete('leaflet');
                          window.location.assign(u.toString());
                        }}
                        className="text-xs px-2 py-1 rounded bg-amber-700/80 hover:bg-amber-600 text-white"
                      >
                        Activează MapLibre
                      </button>
                    </div>
                  )}
                  {isOn && (
                    <div className="mt-2 ml-5">
                      <label className="text-xs text-slate-400">
                        Opacitate: {Math.round(op * 100)}%
                      </label>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={op}
                        onChange={(e) => onSetOpacity(r.id, parseFloat(e.target.value))}
                        className="w-full accent-brand-500"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
