import { useEffect, useState, type FormEvent } from 'react';
import { POINT_TYPES, type PointOfInterest, type PointType, type Visibility } from '@/lib/types';
import { pointDisplayColor } from '@/features/points/pointStyle';
import { safeUpdatePoint } from '@/lib/db/safeApi';

function parseCoord(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface Props {
  point: PointOfInterest;
  onSaved: () => void;
  onCancel: () => void;
}

export function PointEditForm({ point, onSaved, onCancel }: Props) {
  const [name, setName] = useState(point.name);
  const [type, setType] = useState<PointType>(point.type);
  const [description, setDescription] = useState(point.description ?? '');
  const [visibility, setVisibility] = useState<Visibility>(point.visibility);
  const [latStr, setLatStr] = useState(String(point.lat));
  const [lonStr, setLonStr] = useState(String(point.lon));
  const [elevStr, setElevStr] = useState(
    point.elevation_m != null && Number.isFinite(point.elevation_m) ? String(Math.round(point.elevation_m)) : '',
  );
  const [markerColor, setMarkerColor] = useState(() => {
    const c = point.marker_color?.trim();
    if (c && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    return pointDisplayColor({ type: point.type, marker_color: null });
  });
  const [useCustomColor, setUseCustomColor] = useState(() => {
    const c = point.marker_color?.trim();
    return Boolean(c && /^#[0-9a-fA-F]{6}$/.test(c));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(point.name);
    setType(point.type);
    setDescription(point.description ?? '');
    setVisibility(point.visibility);
    setLatStr(String(point.lat));
    setLonStr(String(point.lon));
    setElevStr(
      point.elevation_m != null && Number.isFinite(point.elevation_m) ? String(Math.round(point.elevation_m)) : '',
    );
    const c = point.marker_color?.trim();
    const hasCustom = Boolean(c && /^#[0-9a-fA-F]{6}$/.test(c));
    setUseCustomColor(hasCustom);
    setMarkerColor(hasCustom ? (c as string) : pointDisplayColor({ type: point.type, marker_color: null }));
  }, [point]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const lat = parseCoord(latStr);
    const lon = parseCoord(lonStr);
    if (lat == null || lon == null) {
      setError('Introdu latitudine și longitudine valide.');
      setBusy(false);
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setError('Coordonate în afara domeniului WGS84.');
      setBusy(false);
      return;
    }
    const nameTrim = name.trim();
    if (!nameTrim) {
      setError('Numele este obligatoriu.');
      setBusy(false);
      return;
    }
    let elevation_m: number | null = null;
    if (elevStr.trim()) {
      const el = Number(elevStr.trim().replace(',', '.'));
      if (!Number.isFinite(el)) {
        setError('Altitudine invalidă.');
        setBusy(false);
        return;
      }
      elevation_m = Math.round(el);
    }
    const patch = {
      name: nameTrim,
      type,
      lat,
      lon,
      elevation_m,
      description: description.trim() || null,
      visibility,
      marker_color: useCustomColor && /^#[0-9a-fA-F]{6}$/.test(markerColor.trim()) ? markerColor.trim() : null,
    };
    try {
      const r = await safeUpdatePoint(point.id, patch);
      if (r.ok === 'queued') alert('Salvat local. Va sincroniza automat.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare la salvare');
    } finally {
      setBusy(false);
    }
  };

  const defaultForType = pointDisplayColor({ type, marker_color: null });

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 text-sm">
      {error && <div className="rounded-lg border border-red-800 bg-red-900/30 px-2 py-1.5 text-xs text-red-200">{error}</div>}

      <label className="block">
        <span className="text-xs text-slate-400">Nume</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"
        />
      </label>

      <label className="block">
        <span className="text-xs text-slate-400">Tip punct</span>
        <select
          value={type}
          onChange={(e) => {
            const v = e.target.value as PointType;
            setType(v);
            if (!useCustomColor) setMarkerColor(pointDisplayColor({ type: v, marker_color: null }));
          }}
          className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"
        >
          {POINT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="text-xs text-slate-400">Culoare marcaj</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={useCustomColor}
              onChange={(e) => {
                const on = e.target.checked;
                setUseCustomColor(on);
                if (!on) setMarkerColor(defaultForType);
              }}
            />
            Culoare personalizată
          </label>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(markerColor) ? markerColor : defaultForType}
            onChange={(e) => {
              setUseCustomColor(true);
              setMarkerColor(e.target.value);
            }}
            disabled={!useCustomColor}
            className="h-9 w-14 cursor-pointer rounded border border-slate-600 bg-slate-900 disabled:opacity-40"
          />
          <button
            type="button"
            className="text-xs text-slate-500 underline"
            onClick={() => {
              setUseCustomColor(false);
              setMarkerColor(defaultForType);
            }}
          >
            Folosește culoarea tipului
          </button>
        </div>
      </div>

      <label className="block">
        <span className="text-xs text-slate-400">Observații / descriere</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-0.5 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"
          placeholder="Notițe pentru export sau documentare…"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-slate-400">Lat</span>
          <input
            value={latStr}
            onChange={(e) => setLatStr(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-400">Lon</span>
          <input
            value={lonStr}
            onChange={(e) => setLonStr(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-slate-400">Altitudine (m, opțional)</span>
        <input
          value={elevStr}
          onChange={(e) => setElevStr(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs"
        />
      </label>

      <label className="block">
        <span className="text-xs text-slate-400">Vizibilitate</span>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
          className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2"
        >
          <option value="club">Club</option>
          <option value="private">Privat</option>
        </select>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-slate-600 py-2 text-slate-300"
        >
          Anulează
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-lg bg-brand-600 py-2 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Salvez…' : 'Salvează'}
        </button>
      </div>
    </form>
  );
}
