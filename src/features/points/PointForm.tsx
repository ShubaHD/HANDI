import { useEffect, useState, type FormEvent } from 'react';
import { POINT_TYPES, type PointType, type Visibility } from '@/lib/types';
import { safeCreatePoint } from '@/lib/db/safeApi';
import { uploadPhotos } from './photos';

interface Props {
  initialLat: number;
  initialLon: number;
  initialElevation?: number | null;
  /** După „Poziția mea (GPS)” — actualizează marcajul pe hartă. */
  onGpsLocated?: (lat: number, lon: number) => void;
  onCreated: () => void;
  onCancel: () => void;
}

function parseCoord(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function PointForm({
  initialLat,
  initialLon,
  initialElevation,
  onGpsLocated,
  onCreated,
  onCancel,
}: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PointType>('cave');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('club');
  const [latStr, setLatStr] = useState('');
  const [lonStr, setLonStr] = useState('');
  const [elevStr, setElevStr] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLatStr(String(initialLat));
    setLonStr(String(initialLon));
    setElevStr(
      initialElevation != null && Number.isFinite(initialElevation)
        ? String(Math.round(initialElevation))
        : '',
    );
  }, [initialLat, initialLon, initialElevation]);

  const fillFromGps = () => {
    if (!navigator.geolocation) {
      alert('Geolocation nu este disponibil pe acest dispozitiv');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        setLatStr(String(la));
        setLonStr(String(lo));
        onGpsLocated?.(la, lo);
        if (pos.coords.altitude != null && Number.isFinite(pos.coords.altitude)) {
          setElevStr(String(Math.round(pos.coords.altitude)));
        }
      },
      (e) => alert('Nu pot obține poziția: ' + e.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const lat = parseCoord(latStr);
    const lon = parseCoord(lonStr);
    if (lat == null || lon == null) {
      setError('Introdu latitudine și longitudine valide (numere zecimale).');
      setBusy(false);
      return;
    }
    if (lat < -90 || lat > 90) {
      setError('Latitudinea trebuie să fie între -90 și 90.');
      setBusy(false);
      return;
    }
    if (lon < -180 || lon > 180) {
      setError('Longitudinea trebuie să fie între -180 și 180.');
      setBusy(false);
      return;
    }
    const elevParsed = elevStr.trim() === '' ? null : parseCoord(elevStr);
    const elevation_m = elevParsed != null ? elevParsed : null;

    try {
      const result = await safeCreatePoint({
        name: name.trim() || `${POINT_TYPES.find((t) => t.value === type)?.label ?? 'Punct'} fara nume`,
        type,
        lat,
        lon,
        elevation_m,
        description: description.trim() || null,
        visibility,
      });
      if (result.ok === 'queued') {
        alert('Salvat local. Va sincroniza automat cand revii online.');
      } else if (result.ok === 'remote' && files.length > 0) {
        try {
          await uploadPhotos(result.data.id, files);
        } catch (err) {
          console.warn('[points] upload poze esuat', err);
        }
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare necunoscuta');
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

      <div>
        <div className="text-xs uppercase text-slate-400 mb-1">Coordonate (WGS84)</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] text-slate-500">Latitudine</span>
            <input
              value={latStr}
              onChange={(e) => setLatStr(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              className="mt-0.5 w-full px-2 py-2 bg-slate-900 border border-slate-700 rounded-lg font-mono text-sm focus:outline-none focus:border-brand-500"
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-500">Longitudine</span>
            <input
              value={lonStr}
              onChange={(e) => setLonStr(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              className="mt-0.5 w-full px-2 py-2 bg-slate-900 border border-slate-700 rounded-lg font-mono text-sm focus:outline-none focus:border-brand-500"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            type="button"
            onClick={fillFromGps}
            className="text-xs px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            Poziția mea (GPS)
          </button>
        </div>
      </div>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">Altitudine (m, opțional)</span>
        <input
          value={elevStr}
          onChange={(e) => setElevStr(e.target.value)}
          inputMode="decimal"
          placeholder="ex: 1120"
          className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg font-mono text-sm focus:outline-none focus:border-brand-500"
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
