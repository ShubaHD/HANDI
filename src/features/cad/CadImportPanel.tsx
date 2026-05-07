import { useState } from 'react';
import {
  bboxFromCadImportBounds,
  cadImportSourceUrl,
  deleteCadImport,
  updateCadLayer,
  type CadImport,
  type CadLayerRow,
} from './api';
import { classifyCadImport } from './classifyCadLayer';
import type { ClassifiedCadLayer } from './classifyCadLayer';
import { parseDxfStereo70Full } from './dxfImport';
import { ImportWizard } from './ImportWizard';
import { CavePlansPanel } from '@/features/cavePlans/CavePlansPanel';
import type { CavePlan } from '@/features/cavePlans/api';

const CAD_KIND_LABEL: Record<CadLayerRow['kind'], string> = {
  caves: 'Peșteri',
  dolines: 'Doline',
  contours: 'Contur',
  labels: 'Nume / etichete',
  springs: 'Izvor',
  avens: 'Aven',
  other: 'Altele',
};

interface Props {
  cadImports: CadImport[];
  cadLayers: CadLayerRow[];
  onRefresh: () => void;
  onZoomTo: (bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }) => void;
  onPlansLoaded: (plans: CavePlan[]) => void;
}

export function CadImportPanel({ cadImports, cadLayers, onRefresh, onZoomTo, onPlansLoaded }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [wizard, setWizard] = useState<{
    file: File;
    importName: string;
    classified: ClassifiedCadLayer[];
    bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  } | null>(null);

  const onPickDxf = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseDxfStereo70Full(file.name, text);
      if (!parsed.bbox4326) {
        throw new Error('Nu pot calcula limitele din DXF (geometrii lipsă?)');
      }
      const classified = classifyCadImport(parsed.layers);
      setWizard({
        file,
        importName: parsed.name,
        classified,
        bbox: parsed.bbox4326,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse DXF eșuat');
    } finally {
      setImporting(false);
    }
  };

  const layersByImport = new Map<string, CadLayerRow[]>();
  for (const row of cadLayers) {
    const arr = layersByImport.get(row.import_id) ?? [];
    arr.push(row);
    layersByImport.set(row.import_id, arr);
  }

  const toggleLayer = async (row: CadLayerRow) => {
    await updateCadLayer(row.id, { visible: !row.visible });
    void onRefresh();
  };

  const removeImport = async (imp: CadImport) => {
    if (!confirm(`Ștergi importul „${imp.name}” și toate layerele CAD?`)) return;
    await deleteCadImport(imp);
    void onRefresh();
  };

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto space-y-6 pb-4">
        <section>
          <div className="px-3 pt-3 pb-2 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-white">Importuri DXF complete</h3>
            <p className="text-xs text-slate-500 mt-1">
              Layere CAD separate pe hartă (după conversie DWG→DXF cu ODA File Converter). Vezi README.
            </p>
          </div>
          <div className="p-3 space-y-2">
            <label className="block w-full py-2.5 rounded-lg bg-brand-600/90 hover:bg-brand-600 text-center text-sm font-medium cursor-pointer border border-brand-500">
              {importing ? 'Citesc DXF…' : 'Import DXF multi-layer'}
              <input
                type="file"
                accept=".dxf,application/dxf,text/plain"
                hidden
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickDxf(f);
                  e.target.value = '';
                }}
              />
            </label>
            {error && <div className="text-xs text-red-300">{error}</div>}

            {cadImports.length === 0 ? (
              <div className="text-center text-slate-500 text-xs py-4">
                Niciun import CAD. Alege un DXF (Stereo 70) cu layere denumite (ex: PESTERI, DOLINE, CONTUR, NUME).
              </div>
            ) : (
              <ul className="space-y-3">
                {cadImports.map((imp) => {
                  const layers = layersByImport.get(imp.id) ?? [];
                  const bb = bboxFromCadImportBounds(imp.bounds_json);
                  return (
                    <li key={imp.id} className="rounded-lg border border-slate-700 bg-slate-800/40 overflow-hidden">
                      <div className="flex items-start gap-2 p-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{imp.name}</div>
                          <div className="text-[10px] text-slate-500">
                            {layers.length} layere CAD · {imp.visibility === 'private' ? 'privat' : 'club'}
                          </div>
                        </div>
                        {bb && (
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-600 hover:bg-slate-700"
                            onClick={() => onZoomTo(bb)}
                          >
                            Zoom
                          </button>
                        )}
                        {imp.source_path && (
                          <a
                            className="text-xs px-2 py-1 text-slate-400 hover:text-brand-400"
                            href={cadImportSourceUrl(imp.source_path)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            DXF
                          </a>
                        )}
                        <button
                          type="button"
                          className="text-xs px-2 py-1 text-red-400 hover:text-red-300"
                          onClick={() => void removeImport(imp)}
                        >
                          Șterge
                        </button>
                      </div>
                      <ul className="border-t border-slate-700/80 divide-y divide-slate-700/80">
                        {layers.map((row) => (
                          <li key={row.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                            <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={row.visible}
                                onChange={() => void toggleLayer(row)}
                                className="w-3.5 h-3.5 accent-brand-500 shrink-0"
                              />
                              <span className="font-mono text-brand-200 truncate">{row.cad_layer}</span>
                              <span className="text-slate-500 shrink-0">· {CAD_KIND_LABEL[row.kind]}</span>
                              <span className="text-slate-600 shrink-0">({row.feature_count})</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="border-t border-slate-800">
          <div className="px-3 pt-3 pb-2">
            <h3 className="text-sm font-semibold text-white">Planuri individuale</h3>
            <p className="text-xs text-slate-500 mt-1">
              Un singur layer MultiLineString per fișier (flux vechi). Folosește secțiunea de mai sus pentru desene
              complete pe layere.
            </p>
          </div>
          <CavePlansPanel onPlansLoaded={onPlansLoaded} onZoomTo={onZoomTo} />
        </section>
      </div>

      {wizard && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="bg-slate-900 border border-slate-700 rounded-t-2xl md:rounded-2xl shadow-2xl p-4 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <ImportWizard
              file={wizard.file}
              importName={wizard.importName}
              classified={wizard.classified}
              bbox={wizard.bbox}
              onCancel={() => setWizard(null)}
              onSaved={() => {
                setWizard(null);
                void onRefresh();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
