import { useAppConfirm } from '@/components/ConfirmProvider';
import type { Zone } from '@/lib/types';
import { safeDeleteZone, safeUpdateZoneStatus } from '@/lib/db/safeApi';

const STATUS_LABELS: Record<Zone['status'], string> = {
  todo: 'De prospectat',
  in_progress: 'In lucru',
  done: 'Confirmata',
  rejected: 'Eliminata',
};

const STATUS_COLORS: Record<Zone['status'], string> = {
  todo: '#facc15',
  in_progress: '#fb923c',
  done: '#22c55e',
  rejected: '#64748b',
};

const PRIORITY_LABELS: Record<Zone['priority'], string> = {
  low: 'Scazuta',
  medium: 'Medie',
  high: 'Inalta',
};

interface Props {
  zones: Zone[];
  onSelect: (z: Zone) => void;
  onChanged: () => void;
}

export function ZonesList({ zones, onSelect, onChanged }: Props) {
  const ask = useAppConfirm();
  const remove = async (id: string) => {
    if (!(await ask('Stergi aceasta zona?'))) return;
    try {
      const r = await safeDeleteZone(id);
      if (r.ok === 'queued') alert('Stergere pusa in coada offline.');
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare la stergere');
    }
  };

  const cycleStatus = async (z: Zone) => {
    const order: Zone['status'][] = ['todo', 'in_progress', 'done', 'rejected'];
    const next = order[(order.indexOf(z.status) + 1) % order.length];
    try {
      const r = await safeUpdateZoneStatus(z.id, next);
      if (r.ok === 'queued') alert('Schimbare pusa in coada offline.');
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare la update');
    }
  };

  if (zones.length === 0) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">
        Nicio zona inca. Foloseste butonul „Deseneaza zona" ca sa marchezi un poligon de prospectat.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-700">
      {zones.map((z) => (
        <li key={z.id} className="hover:bg-slate-800/60">
          <div className="flex items-start gap-3 p-3">
            <button
              onClick={() => onSelect(z)}
              className="flex-1 text-left flex items-start gap-3"
            >
              <div
                className="w-3 h-8 rounded flex-shrink-0"
                style={{ backgroundColor: STATUS_COLORS[z.status] }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{z.name}</div>
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <span>{STATUS_LABELS[z.status]}</span>
                  <span>·</span>
                  <span>Prio: {PRIORITY_LABELS[z.priority]}</span>
                  {z.visibility === 'private' && (
                    <span className="text-amber-400">[privat]</span>
                  )}
                </div>
              </div>
            </button>
            <button
              onClick={() => cycleStatus(z)}
              className="text-slate-500 hover:text-brand-400 px-2 py-1 text-xs"
              title="Schimba status"
            >
              {'->'}
            </button>
            <button
              onClick={() => remove(z.id)}
              className="text-slate-500 hover:text-red-400 px-2 py-1 text-xs"
              title="Sterge"
            >
              X
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
