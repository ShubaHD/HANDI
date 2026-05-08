import { useState, type FormEvent } from 'react';
import { POINT_TYPES, type PointType, type Visibility } from '@/lib/types';
import { safeCreatePoint } from '@/lib/db/safeApi';
import { uploadPhotos } from './photos';

interface Props {
  initialLat: number;
  initialLon: number;
  initialElevation?: number | null;
  onCreated: () => void;
  onCancel: () => void;
}

export function PointForm({
  initialLat,
  initialLon,
  initialElevation,
  onCreated,
  onCancel,
}: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PointType>('cave');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('club');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await safeCreatePoint({
        name: name.trim() || `${POINT_TYPES.find((t) => t.value === type)?.label ?? 'Punct'} fara nume`,
        type,
        lat: initialLat,
        lon: initialLon,
        elevation_m: initialElevation ?? null,
        description: description.trim() || null,
        visibility,
      });
      if (result.ok === 'queued') {
        alert('Salvat local. Va sincroniza automat cand revii online.');
      } else if (files.length > 0) {
        try {
          await uploadPhotos(result.data.id, files);
        } catch (e) {
          console.warn('[points] upload poze esuat', e);
        }
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscuta');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs uppercase text-slate-400 mb-1">Tip</label>
        <div className="grid grid-cols-3 gap-1.5">
          {POINT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={`px-2 py-2 rounded-lg text-xs font-medium border transition ${
                type === t.value
                  ? 'border-brand-500 text-white'
                  : 'border-slate-700 bg-slate-800 hover:border-slate-500 text-slate-300'
              }`}
              style={type === t.value ? { backgroundColor: t.color } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">Nume</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: Avenul Răchițeaua"
          className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-brand-500"
        />
      </label>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">Descriere / note</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Curent rece, posibila exfiltratie, necesita sapat 2m..."
          className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-brand-500 resize-none"
        />
      </label>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="px-3 py-2 bg-slate-800 rounded-lg">
          <div className="text-slate-400">Lat / Lon</div>
          <div className="font-mono text-slate-200">
            {initialLat.toFixed(5)}, {initialLon.toFixed(5)}
          </div>
        </div>
        <div className="px-3 py-2 bg-slate-800 rounded-lg">
          <div className="text-slate-400">Altitudine</div>
          <div className="font-mono text-slate-200">
            {initialElevation != null ? `${Math.round(initialElevation)} m` : '-'}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase text-slate-400 mb-1">Foto (optional)</label>
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-700 file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
        />
        {files.length > 0 && (
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {files.map((f, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 truncate max-w-[140px]"
                title={f.name}
              >
                {f.name}
              </span>
            ))}
          </div>
        )}
      </div>

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
            Club (toti membrii)
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
            Privat (doar eu)
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
          {busy ? 'Salvez...' : 'Salveaza'}
        </button>
      </div>
    </form>
  );
}
