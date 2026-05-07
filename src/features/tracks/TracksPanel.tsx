import { useState } from 'react';
import type { Track } from '@/lib/types';
import { safeCreateTrack, safeDeleteTrack } from '@/lib/db/safeApi';
import { downloadFile, parseGpxFile, tracksToGpx } from './gpx';

interface Props {
  tracks: Track[];
  onSelect: (t: Track) => void;
  onChanged: () => void;
}

export function TracksPanel({ tracks, onSelect, onChanged }: Props) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onImport = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseGpxFile(text);
      if (parsed.length === 0) {
        setError('Niciun traseu gasit in fisier');
        return;
      }
      let queued = 0;
      for (const t of parsed) {
        const r = await safeCreateTrack({
          name: t.name,
          geom: t.geom,
          source: 'gpx_import',
          recorded_at: t.recordedAt,
          visibility: 'club',
        });
        if (r.ok === 'queued') queued++;
      }
      if (queued > 0) {
        alert(`${queued} trasee puse in coada offline.`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import esuat');
    } finally {
      setImporting(false);
    }
  };

  const exportAll = () => {
    if (tracks.length === 0) return;
    const xml = tracksToGpx(tracks);
    downloadFile(`handi-tracks-${new Date().toISOString().slice(0, 10)}.gpx`, xml);
  };

  const exportOne = (t: Track) => {
    const xml = tracksToGpx([t]);
    downloadFile(`${t.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.gpx`, xml);
  };

  const remove = async (id: string) => {
    if (!confirm('Stergi acest traseu?')) return;
    try {
      const r = await safeDeleteTrack(id);
      if (r.ok === 'queued') alert('Stergere pusa in coada offline.');
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-700 flex items-center gap-2">
        <label className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-sm cursor-pointer text-center">
          {importing ? 'Se importa...' : 'Import GPX'}
          <input
            type="file"
            accept=".gpx,application/gpx+xml,text/xml,application/xml"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = '';
            }}
          />
        </label>
        <button
          onClick={exportAll}
          disabled={tracks.length === 0}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 text-sm"
        >
          Export tot
        </button>
      </div>

      {error && (
        <div className="m-3 p-2 rounded-lg bg-red-900/40 border border-red-700 text-red-200 text-xs">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {tracks.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            Niciun traseu inca. Importa un GPX sau inregistreaza unul nou.
          </div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {tracks.map((t) => (
              <li key={t.id} className="hover:bg-slate-800/60">
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => onSelect(t)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="font-medium truncate">{t.name}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          t.source === 'recorded' ? 'bg-red-500' : 'bg-blue-500'
                        }`}
                      />
                      <span>{t.source === 'recorded' ? 'Inregistrat' : 'GPX import'}</span>
                      {t.distance_m != null && (
                        <span className="font-mono">
                          {(t.distance_m / 1000).toFixed(2)} km
                        </span>
                      )}
                      {t.elev_gain_m != null && (
                        <span className="font-mono">+{Math.round(t.elev_gain_m)}m</span>
                      )}
                      {t.visibility === 'private' && (
                        <span className="text-amber-400">[privat]</span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => exportOne(t)}
                    className="text-slate-500 hover:text-brand-400 px-2 py-1 text-xs"
                    title="Export GPX"
                  >
                    GPX
                  </button>
                  <button
                    onClick={() => remove(t.id)}
                    className="text-slate-500 hover:text-red-400 px-2 py-1 text-xs"
                    title="Sterge"
                  >
                    X
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
