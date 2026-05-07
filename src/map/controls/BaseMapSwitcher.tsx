import { useEffect, useState } from 'react';
import { BASE_MAPS, type BaseMapDef } from '@/map/layers/BaseLayers';
import {
  buildBaseMapsFromArchives,
  deleteLocalArchive,
  saveLocalArchive,
} from '@/lib/pmtiles';

interface Props {
  current: string;
  onChange: (b: BaseMapDef) => void;
  hillshadeOn: boolean;
  onToggleHillshade: (v: boolean) => void;
  hillshadeStrength: number;
  onChangeHillshadeStrength: (v: number) => void;
}

export function BaseMapSwitcher({
  current,
  onChange,
  hillshadeOn,
  onToggleHillshade,
  hillshadeStrength,
  onChangeHillshadeStrength,
}: Props) {
  const [offlineBases, setOfflineBases] = useState<BaseMapDef[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshOffline = async () => {
    try {
      const items = await buildBaseMapsFromArchives();
      setOfflineBases(items);
    } catch (e) {
      console.warn('[basemaps] offline list', e);
    }
  };

  useEffect(() => {
    void refreshOffline();
  }, []);

  const onUpload = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      await saveLocalArchive(file);
      await refreshOffline();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import esuat');
    } finally {
      setImporting(false);
    }
  };

  const removeOffline = async (id: string) => {
    if (!confirm('Stergi aceasta harta offline?')) return;
    const key = id.replace(/^pmtiles-/, '');
    await deleteLocalArchive(key);
    await refreshOffline();
  };

  return (
    <div className="bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-xl p-3 w-72 max-h-[70vh] overflow-y-auto">
      <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2">Harta de baza (online)</h3>
      <div className="space-y-1.5">
        {BASE_MAPS.map((b) => (
          <BaseMapButton key={b.id} b={b} active={current === b.id} onClick={() => onChange(b)} />
        ))}
      </div>

      <div className="flex items-center justify-between mt-4 mb-2">
        <h3 className="text-xs font-semibold uppercase text-slate-400">Harta offline (PMTiles)</h3>
        <label className="text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700 cursor-pointer">
          {importing ? '...' : '+ adauga'}
          <input
            type="file"
            accept=".pmtiles,application/octet-stream"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {offlineBases.length === 0 ? (
        <div className="text-xs text-slate-500 italic px-2 py-1.5">
          Nicio harta offline. Adauga un fisier .pmtiles ca sa lucrezi fara semnal.
        </div>
      ) : (
        <div className="space-y-1.5">
          {offlineBases.map((b) => (
            <div key={b.id} className="flex gap-1.5">
              <BaseMapButton b={b} active={current === b.id} onClick={() => onChange(b)} />
              <button
                onClick={() => removeOffline(b.id)}
                className="px-2 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-red-900/40 text-xs"
                title="Sterge"
              >
                X
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="text-xs text-red-300 mt-2">{error}</div>}

      <h3 className="text-xs font-semibold uppercase text-slate-400 mt-4 mb-2">Suprapuneri</h3>
      <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
        <span className="text-sm">Hillshade (umbre relief)</span>
        <input
          type="checkbox"
          checked={hillshadeOn}
          onChange={(e) => onToggleHillshade(e.target.checked)}
          className="w-4 h-4 accent-brand-500"
        />
      </label>
      {hillshadeOn && (
        <div className="px-3 py-2 mt-1.5 bg-slate-800/60 rounded-lg">
          <label className="text-xs text-slate-400">
            Intensitate: {hillshadeStrength.toFixed(1)}
          </label>
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.1}
            value={hillshadeStrength}
            onChange={(e) => onChangeHillshadeStrength(parseFloat(e.target.value))}
            className="w-full accent-brand-500"
          />
        </div>
      )}
    </div>
  );
}

interface BaseMapButtonProps {
  b: BaseMapDef;
  active: boolean;
  onClick: () => void;
}

function BaseMapButton({ b, active, onClick }: BaseMapButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-left px-3 py-2 rounded-lg border transition ${
        active
          ? 'bg-brand-600 border-brand-500 text-white'
          : 'bg-slate-800 border-slate-700 hover:border-slate-500'
      }`}
    >
      <div className="text-sm font-medium">{b.label}</div>
      <div className={`text-xs ${active ? 'text-brand-50' : 'text-slate-400'}`}>
        {b.description}
      </div>
    </button>
  );
}
