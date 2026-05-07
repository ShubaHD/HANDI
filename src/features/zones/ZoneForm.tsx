import { useState, type FormEvent } from 'react';
import type { Visibility } from '@/lib/types';
import { safeCreateZone } from '@/lib/db/safeApi';

interface Props {
  geom: GeoJSON.Polygon;
  onCreated: () => void;
  onCancel: () => void;
}

export function ZoneForm({ geom, onCreated, onCancel }: Props) {
  const [name, setName] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [status, setStatus] = useState<'todo' | 'in_progress' | 'done' | 'rejected'>('todo');
  const [visibility, setVisibility] = useState<Visibility>('club');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await safeCreateZone({
        name: name.trim() || 'Zona fara nume',
        geom,
        priority,
        status,
        visibility,
        notes: notes.trim() || null,
      });
      if (r.ok === 'queued') alert('Salvat local. Va sincroniza la revenire.');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscuta');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="font-semibold">Zona noua de prospectare</h2>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">Nume</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: Versant nord Padurea Craiului"
          className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-brand-500"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase text-slate-400 block mb-1">Prioritate</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg"
          >
            <option value="low">Scazuta</option>
            <option value="medium">Medie</option>
            <option value="high">Inalta</option>
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-slate-400 block mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg"
          >
            <option value="todo">De prospectat</option>
            <option value="in_progress">In lucru</option>
            <option value="done">Confirmata</option>
            <option value="rejected">Eliminata</option>
          </select>
        </div>
      </div>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">Note</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Geologie, access, indicii termale, plan de actiune..."
          className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-brand-500 resize-none"
        />
      </label>

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
          disabled={busy}
          className="flex-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 font-medium"
        >
          {busy ? 'Salvez...' : 'Salveaza zona'}
        </button>
      </div>
    </form>
  );
}
