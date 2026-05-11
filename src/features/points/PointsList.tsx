import { useMemo, useState } from 'react';
import { POINT_TYPES, type PointOfInterest, type PointType } from '@/lib/types';
import { safeDeletePoint } from '@/lib/db/safeApi';

interface Props {
  points: PointOfInterest[];
  onAddPoint: () => void;
  onSelect: (p: PointOfInterest) => void;
  onChanged: () => void;
}

export function PointsList({ points, onAddPoint, onSelect, onChanged }: Props) {
  const [filter, setFilter] = useState<PointType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const filtered = useMemo(() => {
    return points
      .filter((p) => filter === 'all' || p.type === filter)
      .filter((p) =>
        query.trim() ? p.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
      );
  }, [points, filter, query]);

  const remove = async (id: string) => {
    if (!confirm('Stergi acest punct?')) return;
    try {
      const r = await safeDeletePoint(id);
      if (r.ok === 'queued') alert('Stergere pusa in coada offline.');
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
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-700 space-y-2">
        <button
          type="button"
          onClick={onAddPoint}
          className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          Adaugă punct
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cauta..."
          className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-brand-500"
        />
        {filter !== 'all' && (
          <button
            onClick={() => void removeAllOfType(filter)}
            disabled={bulkDeleting}
            className="w-full px-3 py-1.5 rounded-lg text-sm border transition bg-red-900/30 border-red-800 text-red-200 hover:bg-red-900/45 disabled:opacity-50 disabled:cursor-not-allowed"
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

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            {points.length === 0
              ? 'Niciun punct încă. Apasă „Adaugă punct” de mai sus (coordonate, tip, descriere, foto). Pe hartă poți folosi și + (GPS).'
              : 'Niciun rezultat pentru filtrul curent.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {filtered.map((p) => {
              const meta = POINT_TYPES.find((t) => t.value === p.type);
              return (
                <li key={p.id} className="hover:bg-slate-800/60">
                  <div className="flex items-start gap-3 p-3">
                    <button
                      onClick={() => onSelect(p)}
                      className="flex-1 text-left flex items-start gap-3"
                    >
                      <div
                        className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: meta?.color ?? '#475569' }}
                      >
                        {meta?.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-2">
                          <span>{meta?.label}</span>
                          {p.visibility === 'private' && (
                            <span className="text-amber-400">[privat]</span>
                          )}
                          {p.elevation_m != null && (
                            <span className="font-mono">{Math.round(p.elevation_m)}m</span>
                          )}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => remove(p.id)}
                      className="text-slate-500 hover:text-red-400 px-2 py-1 text-xs"
                      title="Sterge"
                    >
                      X
                    </button>
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
      className={`px-2 py-0.5 rounded-full text-xs font-medium border transition ${
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
