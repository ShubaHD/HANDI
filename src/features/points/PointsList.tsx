import { useCallback, useMemo, useState } from 'react';
import { pointDisplayColor } from '@/features/points/pointStyle';
import { POINT_TYPES, type PointOfInterest, type PointType } from '@/lib/types';
import { safeDeletePoint } from '@/lib/db/safeApi';
import { downloadPointsCsv, pointsToCsv } from '@/features/points/pointsCsv';

interface Props {
  points: PointOfInterest[];
  onAddPoint: () => void;
  onSelect: (p: PointOfInterest) => void;
  onChanged: () => void;
  /** Deschide formularul de editare în tabul Puncte (ex. modal din FieldPage). */
  onEditPoint?: (p: PointOfInterest) => void;
}

export function PointsList({ points, onAddPoint, onSelect, onChanged, onEditPoint }: Props) {
  const [filter, setFilter] = useState<PointType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    return points
      .filter((p) => filter === 'all' || p.type === filter)
      .filter((p) =>
        query.trim() ? p.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
      );
  }, [points, filter, query]);

  const toggleId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedIds(new Set(filtered.map((p) => p.id)));
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const exportSelectedCsv = useCallback(() => {
    const rows = filtered.filter((p) => selectedIds.has(p.id));
    if (rows.length === 0) {
      alert('Bifează cel puțin un punct din listă, apoi „Export CSV”.');
      return;
    }
    downloadPointsCsv(`puncte-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`, pointsToCsv(rows));
  }, [filtered, selectedIds]);

  const remove = async (id: string) => {
    if (!confirm('Stergi acest punct?')) return;
    try {
      const r = await safeDeletePoint(id);
      if (r.ok === 'queued') alert('Stergere pusa in coada offline.');
      setSelectedIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare la stergere');
    }
  };

  const removeAllOfType = async (type: PointType) => {
    const toDelete = points.filter((p) => p.type === type);
    if (toDelete.length === 0) return;
    if (
      !confirm(
        `Ștergi TOATE punctele de tip „${POINT_TYPES.find((t) => t.value === type)?.label ?? type}”? (${toDelete.length} buc.)`,
      )
    )
      return;

    setBulkDeleting(true);
    setBulkProgress({ done: 0, total: toDelete.length });
    try {
      for (let i = 0; i < toDelete.length; i++) {
        await safeDeletePoint(toDelete[i].id);
        setBulkProgress({ done: i + 1, total: toDelete.length });
      }
      clearSelection();
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare la stergere in bulk');
      onChanged();
    } finally {
      setBulkDeleting(false);
      setBulkProgress(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-slate-700 p-3">
        <button
          type="button"
          onClick={onAddPoint}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Adaugă punct
        </button>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={exportSelectedCsv}
            className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700/80"
          >
            Export CSV ({selectedIds.size})
          </button>
          <button
            type="button"
            onClick={selectAllFiltered}
            className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800"
          >
            Bifează afișate
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800"
          >
            Debifează
          </button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cauta..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        {filter !== 'all' && (
          <button
            onClick={() => void removeAllOfType(filter)}
            disabled={bulkDeleting}
            className="w-full rounded-lg border border-red-800 bg-red-900/30 px-3 py-1.5 text-sm text-red-200 transition hover:bg-red-900/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkDeleting && bulkProgress
              ? `Șterg… (${bulkProgress.done}/${bulkProgress.total})`
              : 'Șterge toate punctele din tipul selectat'}
          </button>
        )}
        <div className="flex flex-wrap gap-1">
          <FilterChip
            label="Toate"
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            count={points.length}
          />
          {POINT_TYPES.map((t) => {
            const c = points.filter((p) => p.type === t.value).length;
            if (c === 0) return null;
            return (
              <FilterChip
                key={t.value}
                label={t.label}
                active={filter === t.value}
                onClick={() => setFilter(t.value)}
                count={c}
                color={t.color}
              />
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            {points.length === 0
              ? 'Niciun punct încă. Apasă „Adaugă punct” de mai sus (coordonate, tip, descriere, foto). Pe hartă poți folosi și + (GPS).'
              : 'Niciun rezultat pentru filtrul curent.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {filtered.map((p) => {
              const meta = POINT_TYPES.find((t) => t.value === p.type);
              const checked = selectedIds.has(p.id);
              return (
                <li key={p.id} className="hover:bg-slate-800/60">
                  <div className="flex items-start gap-2 p-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(p.id)}
                      className="mt-2 shrink-0 rounded border-slate-600"
                      aria-label={`Selectează ${p.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => onSelect(p)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <div
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white"
                        style={{ backgroundColor: pointDisplayColor(p) }}
                      >
                        {meta?.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                          <span>{meta?.label}</span>
                          <span className="font-mono text-[10px] text-slate-500">
                            {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                          </span>
                          {p.visibility === 'private' && <span className="text-amber-400">[privat]</span>}
                          {p.elevation_m != null && (
                            <span className="font-mono">{Math.round(p.elevation_m)}m</span>
                          )}
                        </div>
                        {(p.description ?? '').trim() !== '' && (
                          <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{p.description}</div>
                        )}
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col gap-1">
                      {onEditPoint && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditPoint(p);
                          }}
                          className="text-[11px] text-brand-400 hover:underline"
                        >
                          Editează
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(p.id);
                        }}
                        className="min-h-[44px] min-w-[44px] px-2 py-2 text-xs text-slate-500 hover:text-red-400 md:min-h-0 md:min-w-0 md:px-1 md:py-0.5"
                        title="Șterge"
                      >
                        X
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
  color?: string;
}

function FilterChip({ label, active, onClick, count, color }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${
        active
          ? 'border-transparent text-white'
          : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'
      }`}
      style={active ? { backgroundColor: color ?? '#0d9488' } : undefined}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );
}
