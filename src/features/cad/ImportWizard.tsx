import { useMemo, useState } from 'react';
import type { Visibility } from '@/lib/types';
import {
  type CadLayerKind,
  type ClassifiedCadLayer,
  defaultStyleForKind,
} from './classifyCadLayer';
import { uploadCadImport } from './api';
import type { DxfParseDiagnostics } from './dxfImport';

const KIND_OPTIONS: { value: CadLayerKind; label: string }[] = [
  { value: 'caves', label: 'Peșteri (linii)' },
  { value: 'dolines', label: 'Doline (poligon/linie)' },
  { value: 'contours', label: 'Curbe nivel' },
  { value: 'labels', label: 'Etichete / nume (generic)' },
  { value: 'labels_caves', label: 'Etichete: peșteri' },
  { value: 'labels_ridges', label: 'Etichete: dealuri / culmi' },
  { value: 'labels_places', label: 'Etichete: localități' },
  { value: 'springs', label: 'Izvor' },
  { value: 'avens', label: 'Aven' },
  { value: 'other', label: 'Altele' },
];

interface Props {
  file: File;
  importName: string;
  classified: ClassifiedCadLayer[];
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  diagnostics: DxfParseDiagnostics;
  onCancel: () => void;
  onSaved: () => void;
}

export function ImportWizard({
  file,
  importName: initialName,
  classified,
  bbox,
  diagnostics,
  onCancel,
  onSaved,
}: Props) {
  const [name, setName] = useState(initialName);
  const [visibility, setVisibility] = useState<Visibility>('club');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialOverrides = useMemo(() => {
    const o: Record<
      string,
      { kind: CadLayerKind; color: string; width: number; opacity: number; visible: boolean }
    > = {};
    for (const l of classified) {
      const d = defaultStyleForKind(l.kind);
      o[l.cadLayer] = {
        kind: l.kind,
        color: d.color,
        width: d.width,
        opacity: d.opacity,
        visible: true,
      };
    }
    return o;
  }, [classified]);

  const [overrides, setOverrides] = useState(initialOverrides);

  const setLayer = (cadLayer: string, patch: Partial<(typeof overrides)['string']>) => {
    setOverrides((prev) => ({
      ...prev,
      [cadLayer]: { ...prev[cadLayer], ...patch },
    }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await uploadCadImport({
        name: name.trim() || file.name.replace(/\.dxf$/i, ''),
        file,
        visibility,
        layers: classified,
        layerOverrides: overrides,
        bbox,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Salvare esuata');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-lg">Import DXF (layere CAD)</h2>
      <p className="text-xs text-slate-400">
        Verifica tipul detectat pentru fiecare layer CAD. Poti schimba culoarea, grosimea si opacitatea inainte de salvare.
      </p>

      <p className="text-[11px] text-slate-500 border border-slate-800 rounded-lg px-2 py-1.5 bg-slate-950/50">
        Sumar DXF: entități (secțiune + blocuri, după tip) în total{' '}
        <span className="text-slate-300 font-mono">
          {Object.values(diagnostics.countsByType).reduce((a, b) => a + b, 0)}
        </span>
        {' · '}
        rânduri ENTITIES: <span className="text-slate-300 font-mono">{diagnostics.totalEntities}</span>
        {' · '}
        explodate din blocuri:{' '}
        <span className="text-slate-300 font-mono">{diagnostics.explodedFromBlocks}</span>
        {' · '}
        layere CAD: <span className="text-slate-300 font-mono">{classified.length}</span>
      </p>

      <label className="block">
        <span className="text-xs uppercase text-slate-400">Nume import</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setVisibility('club')}
          className={`py-2 rounded-lg text-sm border ${
            visibility === 'club'
              ? 'bg-brand-600 border-brand-500 text-white'
              : 'border-slate-700 bg-slate-800'
          }`}
        >
          Club
        </button>
        <button
          type="button"
          onClick={() => setVisibility('private')}
          className={`py-2 rounded-lg text-sm border ${
            visibility === 'private'
              ? 'bg-amber-600 border-amber-500 text-white'
              : 'border-slate-700 bg-slate-800'
          }`}
        >
          Privat
        </button>
      </div>

      <div className="max-h-[45vh] overflow-y-auto space-y-2 border border-slate-700 rounded-lg p-2">
        {classified.map((l) => {
          const ov = overrides[l.cadLayer];
          if (!ov) return null;
          return (
            <div key={l.cadLayer} className="p-2 rounded-lg bg-slate-800/80 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium text-brand-300">{l.cadLayer}</span>
                <span className="text-xs text-slate-500">{l.features.length} entitati</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-slate-400 col-span-2">Tip</label>
                <select
                  value={ov.kind}
                  onChange={(e) => setLayer(l.cadLayer, { kind: e.target.value as CadLayerKind })}
                  className="col-span-2 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm"
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs col-span-2">
                  <input
                    type="checkbox"
                    checked={ov.visible}
                    onChange={(e) => setLayer(l.cadLayer, { visible: e.target.checked })}
                  />
                  Vizibil pe harta
                </label>
                <div>
                  <span className="text-xs text-slate-400">Culoare</span>
                  <input
                    type="color"
                    value={ov.color}
                    onChange={(e) => setLayer(l.cadLayer, { color: e.target.value })}
                    className="w-full h-8 rounded border border-slate-700"
                  />
                </div>
                <div>
                  <span className="text-xs text-slate-400">Grosime</span>
                  <input
                    type="number"
                    min={0.5}
                    max={12}
                    step={0.5}
                    value={ov.width}
                    onChange={(e) => setLayer(l.cadLayer, { width: parseFloat(e.target.value) })}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <span className="text-xs text-slate-400">Opacitate {Math.round(ov.opacity * 100)}%</span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={ov.opacity}
                    onChange={(e) => setLayer(l.cadLayer, { opacity: parseFloat(e.target.value) })}
                    className="w-full accent-brand-500"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg bg-slate-800 border border-slate-700"
        >
          Anuleaza
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="flex-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 font-medium"
        >
          {busy ? 'Salvez...' : 'Salveaza import'}
        </button>
      </div>
    </div>
  );
}
