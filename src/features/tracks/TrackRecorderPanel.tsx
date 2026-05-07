import { useEffect, useState } from 'react';
import type { Visibility } from '@/lib/types';
import { useTrackRecorder } from './useTrackRecorder';
import { safeCreateTrack } from '@/lib/db/safeApi';

interface Props {
  onSaved: () => void;
  onLiveCoordsChange: (coords: [number, number][]) => void;
}

export function TrackRecorderPanel({ onSaved, onLiveCoordsChange }: Props) {
  const { state, start, pause, resume, stop, reset, toLineString } = useTrackRecorder();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('club');
  const [busy, setBusy] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const coords: [number, number][] = state.points.map((p) => [p.lng, p.lat]);
    onLiveCoordsChange(coords);
    // doar la schimbare length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.points.length]);

  const save = async () => {
    const line = toLineString();
    if (!line) {
      setError('Nu sunt destule puncte pentru salvare (minim 2)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await safeCreateTrack({
        name: name.trim() || `Traseu ${new Date().toLocaleString('ro-RO')}`,
        geom: line,
        source: 'recorded',
        recorded_at: state.startedAt ? new Date(state.startedAt).toISOString() : null,
        visibility,
      });
      if (r.ok === 'queued') {
        alert('Traseu salvat local. Va sincroniza la revenire online.');
      }
      reset();
      onLiveCoordsChange([]);
      setShowSave(false);
      setName('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la salvare');
    } finally {
      setBusy(false);
    }
  };

  const fmtDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}h ${m}m ${sec}s`
      : m > 0
        ? `${m}m ${sec}s`
        : `${sec}s`;
  };

  const isRecording = state.active;
  const isPaused = state.paused;
  const hasData = state.points.length > 0;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {isRecording && (
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
        <h3 className="font-semibold">
          {isRecording ? 'Inregistrare activa' : isPaused ? 'Pauzat' : 'Recorder traseu'}
        </h3>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
        <Stat label="Puncte" value={String(state.points.length)} />
        <Stat label="Distanta" value={`${(state.distanceM / 1000).toFixed(2)} km`} />
        <Stat label="Durata" value={fmtDuration(state.durationS)} />
      </div>

      <div className="flex gap-2 mb-2">
        {!isRecording && !hasData && (
          <button
            onClick={start}
            className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium"
          >
            Start inregistrare
          </button>
        )}
        {isRecording && (
          <>
            <button
              onClick={pause}
              className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium"
            >
              Pauza
            </button>
            <button
              onClick={() => {
                stop();
                setShowSave(true);
              }}
              className="flex-1 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700"
            >
              Stop
            </button>
          </>
        )}
        {!isRecording && hasData && (
          <>
            <button
              onClick={resume}
              className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium"
            >
              Continua
            </button>
            <button
              onClick={() => setShowSave(true)}
              className="flex-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium"
            >
              Salveaza
            </button>
            <button
              onClick={() => {
                reset();
                onLiveCoordsChange([]);
              }}
              className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700"
              title="Renunta"
            >
              X
            </button>
          </>
        )}
      </div>

      {showSave && (
        <div className="mt-3 pt-3 border-t border-slate-700 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nume traseu"
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setVisibility('club')}
              className={`px-3 py-1.5 rounded-lg text-xs border ${
                visibility === 'club'
                  ? 'bg-brand-600 border-brand-500 text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-300'
              }`}
            >
              Club
            </button>
            <button
              onClick={() => setVisibility('private')}
              className={`px-3 py-1.5 rounded-lg text-xs border ${
                visibility === 'private'
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : 'border-slate-700 bg-slate-800 text-slate-300'
              }`}
            >
              Privat
            </button>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <button
            onClick={save}
            disabled={busy}
            className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 font-medium text-sm"
          >
            {busy ? 'Salvez...' : 'Confirma salvarea'}
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-1.5 bg-slate-800 rounded-lg">
      <div className="text-slate-400">{label}</div>
      <div className="font-mono text-slate-100">{value}</div>
    </div>
  );
}
