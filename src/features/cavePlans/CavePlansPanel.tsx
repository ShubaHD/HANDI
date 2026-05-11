import { useEffect, useMemo, useState } from 'react';
import { useAppConfirm } from '@/components/ConfirmProvider';
import type { Visibility } from '@/lib/types';
import {
  deleteCavePlan,
  fetchCavePlans,
  planSourceUrl,
  type CavePlan,
  type CavePlanKind,
  uploadCavePlanDxf,
  updateCavePlan,
} from './api';
import { parseDxfStereo70ToWgs84 } from './dxfStereo70';
import { downloadFile } from '@/features/tracks/gpx';

const KIND_LABELS: Record<CavePlanKind, string> = {
  survey_plan: 'Plan peșteră',
  geology: 'Hartă geologică',
  other: 'Alt layer',
};

interface Props {
  onPlansLoaded: (plans: CavePlan[]) => void;
  onZoomTo: (bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }) => void;
}

export function CavePlansPanel({ onPlansLoaded, onZoomTo }: Props) {
  const ask = useAppConfirm();
  const [plans, setPlans] = useState<CavePlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCavePlans();
      setPlans(data);
      onPlansLoaded(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onImport = async (file: File, kind: CavePlanKind, visibility: Visibility) => {
    setImporting(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseDxfStereo70ToWgs84(file.name, text);
      const created = await uploadCavePlanDxf({
        file,
        name: parsed.name,
        kind,
        description: null,
        visibility,
        geom: parsed.geom,
      });
      const next = [created, ...plans];
      setPlans(next);
      onPlansLoaded(next);
      setVisible((prev) => new Set(prev).add(created.id));
      if (parsed.bbox4326) onZoomTo(parsed.bbox4326);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import esuat');
    } finally {
      setImporting(false);
    }
  };

  const remove = async (p: CavePlan) => {
    if (!(await ask(`Stergi "${p.name}"?`))) return;
    await deleteCavePlan(p);
    const next = plans.filter((x) => x.id !== p.id);
    setPlans(next);
    onPlansLoaded(next);
    setVisible((prev) => {
      const s = new Set(prev);
      s.delete(p.id);
      return s;
    });
  };

  const exportGeoJson = (p: CavePlan) => {
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: p.id, name: p.name, kind: p.kind, visibility: p.visibility },
          geometry: p.geom,
        },
      ],
    };
    downloadFile(`${p.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.geojson`, JSON.stringify(fc), 'application/geo+json');
  };

  const kinds = useMemo(
    () => (Object.keys(KIND_LABELS) as CavePlanKind[]),
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-700 space-y-2">
        <div className="text-xs text-slate-400">
          DXF georeferențiat în <strong>Stereo70 (EPSG:3844)</strong>. Importul îl convertește automat în WGS84 pentru hartă.
        </div>
        <div className="grid grid-cols-2 gap-2">
          {kinds.map((k) => (
            <label
              key={k}
              className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 cursor-pointer text-sm text-center"
            >
              {importing ? 'Import...' : `Import ${KIND_LABELS[k]}`}
              <input
                type="file"
                accept=".dxf,application/dxf,text/plain"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f, k, 'club');
                  e.target.value = '';
                }}
              />
            </label>
          ))}
        </div>
        {error && <div className="text-xs text-red-300">{error}</div>}
        {loading && <div className="text-xs text-slate-500">Se încarcă...</div>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {plans.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">
            Niciun plan importat încă. Importă un DXF (Stereo70) ca să apară ca layer pe hartă.
          </div>
        ) : (
          <ul className="divide-y divide-slate-700">
            {plans.map((p) => {
              const isOn = visible.has(p.id);
              return (
                <li key={p.id} className="p-3 hover:bg-slate-800/40">
                  <div className="flex items-start gap-2">
                    <button className="flex-1 min-w-0 text-left" onClick={() => toggle(p.id)}>
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <span>{KIND_LABELS[p.kind]}</span>
                        {p.visibility === 'private' && <span className="text-amber-400">[privat]</span>}
                      </div>
                      {p.description && (
                        <div className="text-xs text-slate-300 mt-1 line-clamp-2">{p.description}</div>
                      )}
                    </button>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => toggle(p.id)}
                        className="w-4 h-4 accent-brand-500"
                      />
                      Layer
                    </label>
                    <button
                      onClick={() => exportGeoJson(p)}
                      className="text-slate-500 hover:text-brand-400 px-2 py-1 text-xs"
                      title="Export GeoJSON"
                    >
                      JSON
                    </button>
                    {p.source_path && (
                      <a
                        className="text-slate-500 hover:text-brand-400 px-2 py-1 text-xs"
                        href={planSourceUrl(p.source_path)}
                        target="_blank"
                        rel="noreferrer"
                        title="Descarcă DXF"
                      >
                        DXF
                      </a>
                    )}
                    <button
                      onClick={() => remove(p)}
                      className="text-slate-500 hover:text-red-400 px-2 py-1 text-xs"
                      title="Șterge"
                    >
                      X
                    </button>
                  </div>
                  <InlineEdit p={p} onUpdated={() => void load()} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function InlineEdit({ p, onUpdated }: { p: CavePlan; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState(p.description ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await updateCavePlan(p.id, { description: desc.trim() || null });
    setBusy(false);
    setOpen(false);
    onUpdated();
  };

  return (
    <div className="mt-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700"
        >
          Editează descriere
        </button>
      ) : (
        <div className="space-y-2">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm"
            placeholder="Detalii: intrări, lungime, denivelare, observații..."
          />
          <div className="flex gap-2">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-1.5 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700 text-sm"
            >
              Anulează
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 py-1.5 rounded bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 text-sm font-medium"
            >
              {busy ? 'Salvez...' : 'Salvează'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

