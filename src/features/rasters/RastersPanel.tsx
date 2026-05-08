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
  onChanged,
}: Props) {
  const remove = async (r: RasterOverlay) => {
    if (!confirm(`Stergi raster overlay "${r.name}"?`)) return;
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
              return (
                <li key={r.id} className="p-3 hover:bg-slate-800/40">
                  <div className="flex items-start gap-2">
                    <div
                      className="w-3 h-8 rounded flex-shrink-0"
                      style={{ backgroundColor: KIND_COLORS[r.kind] }}
                    />
                    <button
                      onClick={() => void onZoomTo(r)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-slate-400">
                        {KIND_LABELS[r.kind]}
                        {r.visibility === 'private' && (
                          <span className="ml-2 text-amber-400">[privat]</span>
                        )}
                        {r.captured_at && (
                          <span className="ml-2 font-mono">
                            {new Date(r.captured_at).toLocaleDateString('ro-RO')}
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
                    <button
                      onClick={() => remove(r)}
                      className="text-slate-500 hover:text-red-400 px-1 py-1 text-xs"
                      title="Sterge"
                    >
                      X
                    </button>
                  </div>
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
