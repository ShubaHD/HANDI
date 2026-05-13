import { useMemo, useState } from 'react';
import { useAppConfirm } from '@/components/ConfirmProvider';
import {
  bboxFromCadImportBounds,
  cadImportSourceUrl,
  deleteCadImport,
  updateCadLayer,
  type CadImport,
  type CadLayerRow,
} from './api';
import {
  cadLabelLockedFromStyle,
  cadLabelMaxZoomFromStyle,
  cadLabelMinZoomFromStyle,
  cadLabelPlainFromStyle,
  cadLabelTextColorFromStyle,
  cadLabelTextSizeFromStyle,
} from './cadLayerLabelStyle';
import {
  classifyCadImport,
  isCadLabelKind,
  mergeCadStyleForNewKind,
  usesCadLabelRendering,
  type ClassifiedCadLayer,
} from './classifyCadLayer';
import { parseDxfStereo70Full, type DxfParseDiagnostics, type Stereo70SourceCrs } from './dxfImport';
import { ImportWizard } from './ImportWizard';
import { createPointsBulk } from '@/features/points/api';
import { parsePointsCsvToInputs } from '@/features/points/csvImport';
import { POINT_TYPES, type PointType } from '@/lib/types';

const CAD_CRS_STORAGE_KEY = 'handi-cad-source-crs';

function readStoredCadSourceCrs(): Stereo70SourceCrs {
  try {
    const v = localStorage.getItem(CAD_CRS_STORAGE_KEY);
    if (v === 'EPSG:31700' || v === 'EPSG:3844') return v;
  } catch {
    /* ignore */
  }
  return 'EPSG:3844';
}

function persistCadSourceCrs(c: Stereo70SourceCrs) {
  try {
    localStorage.setItem(CAD_CRS_STORAGE_KEY, c);
  } catch {
    /* ignore */
  }
}

const CAD_KIND_LABEL: Record<CadLayerRow['kind'], string> = {
  caves: 'Peșteri',
  dolines: 'Doline',
  contours: 'Contur',
  labels: 'Nume / etichete',
  labels_caves: 'Nume peșteri',
  labels_ridges: 'Nume dealuri / culmi',
  labels_places: 'Nume localități',
  springs: 'Izvor',
  avens: 'Aven',
  other: 'Altele',
};

const CAD_KIND_OPTIONS: Array<{ value: CadLayerRow['kind']; label: string }> = [
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
  cadImports: CadImport[];
  cadLayers: CadLayerRow[];
  onRefresh: () => void;
  onZoomTo: (bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }) => void;
}

/** Valoare validă pentru `<input type="color">` (#rrggbb). */
function hexForColorInput(style: Record<string, unknown>, layerColor: string): string {
  return cadLabelTextColorFromStyle(style, layerColor);
}

function cadStyleDefaults(row: CadLayerRow): { color: string; width: number; opacity: number } {
  const s = row.style as { color?: string; width?: number; opacity?: number };
  return {
    color: typeof s?.color === 'string' ? s.color : '#94a3b8',
    width: typeof s?.width === 'number' ? s.width : 2,
    opacity: typeof s?.opacity === 'number' ? s.opacity : 0.85,
  };
}

function formatDxfDiagReport(fileName: string, d: DxfParseDiagnostics): string {
  const lines = Object.entries(d.countsByType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${k}: ${v}`);
  return [
    'HANDI — raport diagnostic DXF',
    `Fișier: ${fileName}`,
    `CRS sursă (Stereo70): ${d.sourceCrs}`,
    `Entități în ENTITIES + blocuri (după tip): vezi countsByType`,
    `Total rânduri ENTITIES: ${d.totalEntities}`,
    `Blocuri (definitions): ${d.blocksCount}`,
    `Entități procesate din explozia blocurilor: ${d.explodedFromBlocks}`,
    'countsByType:',
    ...lines,
    `Tipuri nesuportate (ignorate): ${d.skippedTypes.length ? d.skippedTypes.join(', ') : '—'}`,
  ].join('\n');
}

export function CadImportPanel({ cadImports, cadLayers, onRefresh, onZoomTo }: Props) {
  const ask = useAppConfirm();
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [lastDiag, setLastDiag] = useState<{ fileName: string; d: DxfParseDiagnostics } | null>(null);
  const [sourceCrs, setSourceCrs] = useState<Stereo70SourceCrs>(() => readStoredCadSourceCrs());
  const [importingPoints, setImportingPoints] = useState(false);
  const [pointsMsg, setPointsMsg] = useState<string | null>(null);
  const [csvPointType, setCsvPointType] = useState<PointType>('cave');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{
    file: File;
    importName: string;
    classified: ClassifiedCadLayer[];
    bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
    diagnostics: DxfParseDiagnostics;
  } | null>(null);

  const onPickDxf = async (file: File) => {
    setImporting(true);
    setError(null);
    setLastDiag(null);
    try {
      const text = await readDxfText(file);
      const parsed = parseDxfStereo70Full(file.name, text, { sourceCrs });

      if (parsed.layers.length === 0) {
        setLastDiag({ fileName: file.name, d: parsed.diagnostics });
        setError('Nu s-au găsit entități suportate în DXF. Vezi raportul de diagnostic mai jos.');
        return;
      }

      if (!parsed.bbox4326) {
        setLastDiag({ fileName: file.name, d: parsed.diagnostics });
        setError('Nu pot calcula limitele din DXF (geometrii invalide sau CRS?).');
        return;
      }

      const classified = classifyCadImport(parsed.layers);
      setWizard({
        file,
        importName: parsed.name,
        classified,
        bbox: parsed.bbox4326,
        diagnostics: parsed.diagnostics,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse DXF eșuat');
    } finally {
      setImporting(false);
    }
  };

  async function readDxfText(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const preview = new TextDecoder('latin1').decode(buf.slice(0, Math.min(buf.byteLength, 64_000)));

    // DXF header typically contains $DWGCODEPAGE + ANSI_125x
    // Example:
    //   9
    //   $DWGCODEPAGE
    //   3
    //   ANSI_1252
    const m = preview.match(/\$DWGCODEPAGE[\s\S]{0,200}?\n\s*3\s*\n\s*([A-Za-z0-9_:-]+)/m);
    const code = (m?.[1] ?? '').trim();

    const enc =
      code === 'ANSI_1250'
        ? 'windows-1250'
        : code === 'ANSI_1252'
          ? 'windows-1252'
          : code === 'UTF-8' || code === 'UTF8'
            ? 'utf-8'
            : 'windows-1252';

    try {
      return new TextDecoder(enc).decode(buf);
    } catch {
      // Fallback for browsers missing encoding support.
      return new TextDecoder('utf-8').decode(buf);
    }
  }

  const onPickPointsCsv = async (file: File) => {
    setImportingPoints(true);
    setPointsMsg(null);
    setError(null);
    try {
      const csvText = await file.text();
      const { inputs, diag } = parsePointsCsvToInputs({
        csvText,
        sourceCrs,
        defaultType: csvPointType,
        defaultVisibility: 'club',
      });

      if (diag.errors.length) {
        setPointsMsg(diag.errors.join(' '));
        return;
      }
      if (inputs.length === 0) {
        setPointsMsg('Nu am găsit rânduri valide în CSV.');
        return;
      }

      await createPointsBulk(inputs);
      setPointsMsg(`Import OK: ${inputs.length} puncte create (sărite: ${diag.skipped}).`);
      onRefresh();
    } catch (e) {
      setPointsMsg(e instanceof Error ? e.message : 'Import CSV eșuat');
    } finally {
      setImportingPoints(false);
    }
  };

  const csvTypeOptions = useMemo(
    () => POINT_TYPES.map((t) => ({ value: t.value, label: t.label })),
    [],
  );

  const copyDiag = async () => {
    if (!lastDiag) return;
    const text = formatDxfDiagReport(lastDiag.fileName, lastDiag.d);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        await navigator.clipboard.writeText(JSON.stringify(lastDiag.d, null, 2));
      } catch {
        window.prompt('Copiază manual:', text);
      }
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

  const saveLayerStyle = async (
    row: CadLayerRow,
    patch: Partial<Pick<CadLayerRow, 'kind' | 'style' | 'visible'>>,
  ) => {
    setEditingBusy(true);
    setEditingError(null);
    try {
      await updateCadLayer(row.id, patch);
      void onRefresh();
    } catch (e) {
      setEditingError(e instanceof Error ? e.message : 'Salvare eșuată');
    } finally {
      setEditingBusy(false);
    }
  };

  const removeImport = async (imp: CadImport) => {
    if (!(await ask(`Ștergi importul „${imp.name}” și toate layerele CAD?`))) return;
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
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
              <div className="text-[11px] uppercase text-slate-500 mb-1">CRS import (Stereo70)</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSourceCrs('EPSG:3844');
                    persistCadSourceCrs('EPSG:3844');
                  }}
                  className={`py-2 rounded-lg text-xs border ${
                    sourceCrs === 'EPSG:3844'
                      ? 'bg-brand-600 border-brand-500 text-white'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  EPSG:3844 (Stereo70 ANCPI)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceCrs('EPSG:31700');
                    persistCadSourceCrs('EPSG:31700');
                  }}
                  className={`py-2 rounded-lg text-xs border ${
                    sourceCrs === 'EPSG:31700'
                      ? 'bg-brand-600 border-brand-500 text-white'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  EPSG:31700 (Dealul Piscului / Krassovsky)
                </button>
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                Alegerea se păstrează pe acest dispozitiv (inclusiv după schimbarea tab-ului). Dacă ai decalaj ~120m
                spre Est pe basemap, încearcă EPSG:31700.
              </div>
            </div>

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
            <label className="block w-full py-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-center text-sm font-medium cursor-pointer border border-slate-700">
              {importingPoints ? 'Citesc CSV…' : 'Import puncte CSV (name + x/y sau lon/lat)'}
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                hidden
                disabled={importingPoints}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickPointsCsv(f);
                  e.target.value = '';
                }}
              />
            </label>
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
              <div className="text-[11px] uppercase text-slate-500 mb-1">Simbol puncte CSV</div>
              <select
                className="w-full rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs px-2 py-2"
                value={csvPointType}
                onChange={(e) => setCsvPointType(e.target.value as PointType)}
              >
                {csvTypeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[10px] text-slate-500">Se aplică tuturor punctelor din fișier.</div>
            </div>
            {pointsMsg && <div className="text-xs text-slate-300">{pointsMsg}</div>}
            {error && <div className="text-xs text-red-300">{error}</div>}

            {lastDiag && (
              <div className="rounded-lg border border-amber-800/80 bg-amber-950/40 p-3 space-y-2 text-xs">
                <div className="font-medium text-amber-200">Diagnostic DXF</div>
                <div className="text-slate-400 space-y-0.5">
                  <div>
                    Fișier: <span className="text-slate-200 font-mono">{lastDiag.fileName}</span>
                  </div>
                  <div>ENTITIES (rânduri): {lastDiag.d.totalEntities}</div>
                  <div>Definiții bloc: {lastDiag.d.blocksCount}</div>
                  <div>Entități explodate din blocuri: {lastDiag.d.explodedFromBlocks}</div>
                  {lastDiag.d.skippedTypes.length > 0 && (
                    <div className="text-amber-300/90">
                      Tipuri ignorate (nesuportate): {lastDiag.d.skippedTypes.join(', ')}
                    </div>
                  )}
                </div>
                <div className="max-h-28 overflow-y-auto rounded bg-slate-950/80 p-2 font-mono text-[10px] text-slate-400 border border-slate-800">
                  {Object.entries(lastDiag.d.countsByType)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => (
                      <div key={k}>
                        {k}: {v}
                      </div>
                    ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700"
                    onClick={() => void copyDiag()}
                  >
                    Copiază raport
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800"
                    onClick={() => setLastDiag(null)}
                  >
                    Închide
                  </button>
                </div>
              </div>
            )}

            {cadImports.length === 0 ? (
              <div className="text-center text-slate-500 text-xs py-4">
                Niciun import CAD. Alege un DXF (Stereo 70) cu layere denumite (ex: PESTERI, DOLINE, CONTUR, NUME).
              </div>
            ) : (
              <ul className="space-y-3">
                {cadImports.length > 1 && (
                  <li className="text-[11px] text-amber-200/90 bg-amber-950/40 border border-amber-800/60 rounded-lg px-2 py-1.5">
                    Mai multe importuri CAD sunt afișate simultan pe hartă. Dacă vezi etichete vechi sau duplicate,
                    debifează layerele sau șterge importurile DXF pe care nu le mai folosești.
                  </li>
                )}
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
                        {layers.map((row) => {
                          const open = editingLayerId === row.id;
                          const st = cadStyleDefaults(row);
                          const rowStyleObj = (row.style ?? {}) as Record<string, unknown>;
                          const cadMinZUi = cadLabelMinZoomFromStyle(rowStyleObj);
                          const cadMaxZUi = cadLabelMaxZoomFromStyle(rowStyleObj);
                          const cadLabelTextPxUi = cadLabelTextSizeFromStyle(rowStyleObj);
                          return (
                            <li key={row.id} className="px-2 py-1.5 text-xs">
                              <div className="flex items-center gap-2">
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
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700"
                                  onClick={() => {
                                    setEditingError(null);
                                    setEditingLayerId((cur) => (cur === row.id ? null : row.id));
                                  }}
                                  title="Editează stilul layer-ului"
                                >
                                  {open ? 'Închide' : 'Edit'}
                                </button>
                              </div>

                              {open && (
                                <div className="mt-2 p-2 rounded-lg bg-slate-900/60 border border-slate-700 space-y-2">
                                  <div className="grid grid-cols-2 gap-2">
                                    <label className="text-[11px] text-slate-400">
                                      Tip
                                      <select
                                        className="mt-1 w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs"
                                        value={row.kind}
                                        disabled={editingBusy}
                                        onChange={(e) => {
                                          const newKind = e.target.value as CadLayerRow['kind'];
                                          void saveLayerStyle(row, {
                                            kind: newKind,
                                            style: mergeCadStyleForNewKind(
                                              (row.style ?? {}) as Record<string, unknown>,
                                              newKind,
                                            ),
                                          });
                                        }}
                                      >
                                        {CAD_KIND_OPTIONS.map((k) => (
                                          <option key={k.value} value={k.value}>
                                            {k.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="text-[11px] text-slate-400">
                                      Culoare
                                      <input
                                        type="color"
                                        className="mt-1 w-full h-8 rounded border border-slate-700 bg-slate-950"
                                        defaultValue={st.color}
                                        disabled={editingBusy}
                                        onChange={(e) =>
                                          void saveLayerStyle(row, {
                                            style: { ...(row.style ?? {}), color: e.target.value },
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="text-[11px] text-slate-400">
                                      Grosime
                                      <input
                                        type="number"
                                        min={0.5}
                                        max={12}
                                        step={0.5}
                                        className="mt-1 w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs"
                                        defaultValue={st.width}
                                        disabled={editingBusy}
                                        onChange={(e) =>
                                          void saveLayerStyle(row, {
                                            style: { ...(row.style ?? {}), width: parseFloat(e.target.value) },
                                          })
                                        }
                                      />
                                    </label>
                                    <label className="text-[11px] text-slate-400 col-span-2">
                                      Opacitate {Math.round(st.opacity * 100)}%
                                      <input
                                        type="range"
                                        min={0.1}
                                        max={1}
                                        step={0.05}
                                        className="mt-1 w-full accent-brand-500"
                                        defaultValue={st.opacity}
                                        disabled={editingBusy}
                                        onChange={(e) =>
                                          void saveLayerStyle(row, {
                                            style: { ...(row.style ?? {}), opacity: parseFloat(e.target.value) },
                                          })
                                        }
                                      />
                                    </label>
                                  </div>

                                  {usesCadLabelRendering(row.kind) && (
                                    <div className="space-y-2 pt-1 border-t border-slate-800/80">
                                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                        Aspect etichete
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <label className="text-[11px] text-slate-400 shrink-0">
                                          Culoare text
                                          <input
                                            type="color"
                                            className="mt-1 block h-8 w-14 rounded border border-slate-700 bg-slate-950 cursor-pointer"
                                            value={hexForColorInput(rowStyleObj, st.color)}
                                            disabled={editingBusy}
                                            onChange={(e) =>
                                              void saveLayerStyle(row, {
                                                style: { ...(row.style ?? {}), cadLabelTextColor: e.target.value },
                                              })
                                            }
                                          />
                                        </label>
                                        <button
                                          type="button"
                                          className="mt-5 text-[10px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                                          disabled={editingBusy}
                                          onClick={() => {
                                            const next = { ...(row.style ?? {}) } as Record<string, unknown>;
                                            delete next.cadLabelTextColor;
                                            void saveLayerStyle(row, { style: next });
                                          }}
                                        >
                                          = culoare layer
                                        </button>
                                      </div>
                                      <label className="block text-[11px] text-slate-400">
                                        Mărime text (px, 8–28, opțional)
                                        <input
                                          type="number"
                                          min={8}
                                          max={28}
                                          step={1}
                                          className="mt-1 w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs"
                                          placeholder="implicit 12–13"
                                          value={cadLabelTextPxUi == null ? '' : cadLabelTextPxUi}
                                          disabled={editingBusy}
                                          onChange={(e) => {
                                            const raw = e.target.value.trim();
                                            const next = { ...(row.style ?? {}) } as Record<string, unknown>;
                                            if (raw === '') delete next.cadLabelTextSize;
                                            else {
                                              const n = parseInt(raw, 10);
                                              if (Number.isFinite(n)) next.cadLabelTextSize = n;
                                            }
                                            void saveLayerStyle(row, { style: next });
                                          }}
                                        />
                                      </label>
                                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                                        <input
                                          type="checkbox"
                                          className="w-3.5 h-3.5 accent-brand-500 shrink-0"
                                          checked={cadLabelPlainFromStyle(rowStyleObj)}
                                          disabled={editingBusy}
                                          onChange={(e) =>
                                            void saveLayerStyle(row, {
                                              style: { ...(row.style ?? {}), cadLabelPlain: e.target.checked },
                                            })
                                          }
                                        />
                                        Text simplu: fără fundal (Leaflet) / fără contur (MapLibre)
                                      </label>
                                      {isCadLabelKind(row.kind) && (
                                        <>
                                      <label className="flex items-center gap-2 text-[11px] text-slate-300">
                                        <input
                                          type="checkbox"
                                          className="w-3.5 h-3.5 accent-brand-500 shrink-0"
                                          checked={cadLabelLockedFromStyle(rowStyleObj)}
                                          disabled={editingBusy}
                                          onChange={(e) =>
                                            void saveLayerStyle(row, {
                                              style: { ...(row.style ?? {}), cadLabelLocked: e.target.checked },
                                            })
                                          }
                                        />
                                        Blocat: nu se editează din hartă (tap)
                                      </label>
                                      <label className="block text-[11px] text-slate-400">
                                        Arată etichete doar de la zoom ≥ (opțional)
                                        <input
                                          type="number"
                                          min={0}
                                          max={24}
                                          step={1}
                                          className="mt-1 w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs"
                                          placeholder="lipsă = orice zoom"
                                          value={cadMinZUi == null ? '' : cadMinZUi}
                                          disabled={editingBusy}
                                          onChange={(e) => {
                                            const raw = e.target.value.trim();
                                            const next = { ...(row.style ?? {}) } as Record<string, unknown>;
                                            if (raw === '') delete next.cadLabelMinZoom;
                                            else {
                                              const n = parseInt(raw, 10);
                                              if (Number.isFinite(n)) next.cadLabelMinZoom = n;
                                            }
                                            void saveLayerStyle(row, { style: next });
                                          }}
                                        />
                                      </label>
                                      <label className="block text-[11px] text-slate-400">
                                        Ascunde etichete la zoom ≥ (ex. 17 = dispar când ești foarte aproape)
                                        <input
                                          type="number"
                                          min={0}
                                          max={24}
                                          step={1}
                                          className="mt-1 w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs"
                                          placeholder="lipsă = mereu vizibile"
                                          value={cadMaxZUi == null ? '' : cadMaxZUi}
                                          disabled={editingBusy}
                                          onChange={(e) => {
                                            const raw = e.target.value.trim();
                                            const next = { ...(row.style ?? {}) } as Record<string, unknown>;
                                            if (raw === '') delete next.cadLabelMaxZoom;
                                            else {
                                              const n = parseInt(raw, 10);
                                              if (Number.isFinite(n)) next.cadLabelMaxZoom = n;
                                            }
                                            void saveLayerStyle(row, { style: next });
                                          }}
                                        />
                                      </label>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {editingError && (
                                    <div className="text-[11px] text-red-300 bg-red-950/30 border border-red-900/60 rounded p-2">
                                      {editingError}
                                    </div>
                                  )}
                                  <div className="text-[10px] text-slate-500">
                                    Se salvează automat la schimbare{editingBusy ? '…' : '.'}
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
              diagnostics={wizard.diagnostics}
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
