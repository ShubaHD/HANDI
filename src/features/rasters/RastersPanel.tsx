import { useMemo, useState } from 'react';
import { useAppConfirm } from '@/components/ConfirmProvider';
import type { RasterKind, RasterOverlay } from '@/lib/types';
import { deleteRaster } from './api';

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
  onChanged: () => void;
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
  onChanged,
}: Props) {
  const ask = useAppConfirm();
  const [saving, setSaving] = useState<Record<string, { loaded: number; total?: number }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const isPmtiles = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const r of rasters) {
      const meta = r.metadata as { format?: unknown; pmtiles_url?: unknown } | null | undefined;
      m[r.id] = meta?.format === 'pmtiles' && typeof meta?.pmtiles_url === 'string';
    }
    return m;
  }, [rasters]);

  const remove = async (r: RasterOverlay) => {
    if (!(await ask(`Stergi raster overlay "${r.name}"?`))) return;
    try {
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
          + Upload raster (termal / LIDAR / ortofoto)
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
                    {isPmtiles[r.id] && (
                      <button
                        onClick={() => {
                          if (busyId) return;
                          const hasLocal = Boolean(offlinePmtilesById[r.id]);
                          if (!hasLocal) {
                            setBusyId(r.id);
                            setSaving((p) => ({ ...p, [r.id]: { loaded: 0 } }));
                            void onSaveOfflinePmtiles(r, (prog) => {
                              setSaving((p) => ({ ...p, [r.id]: prog }));
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
                          } else {
                            void (async () => {
                              if (!(await ask('Stergi copia offline pentru acest LiDAR?'))) return;
                              setBusyId(r.id);
                              void onDeleteOfflinePmtiles(r)
                                .catch((e) => alert(e instanceof Error ? e.message : 'Eroare'))
                                .finally(() => setBusyId(null));
                            })();
                          }
                        }}
                        className="text-xs px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-50"
                        disabled={busyId !== null}
                        title="Salveaza / sterge copia offline"
                      >
                        {offlinePmtilesById[r.id] ? 'LiDAR offline: ON' : 'Save LiDAR offline'}
                      </button>
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
