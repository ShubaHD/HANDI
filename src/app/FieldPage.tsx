import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppConfirm } from '@/components/ConfirmProvider';
import { PMTiles } from 'pmtiles';
import { MapView } from '@/map/MapView';
import { PointForm } from '@/features/points/PointForm';
import { PointEditForm } from '@/features/points/PointEditForm';
import { PointsList } from '@/features/points/PointsList';
import { PointDetail } from '@/features/points/PointDetail';
import { TrackRecorderPanel } from '@/features/tracks/TrackRecorderPanel';
import { TracksPanel } from '@/features/tracks/TracksPanel';
import { RastersPanel } from '@/features/rasters/RastersPanel';
import { RasterUploadForm } from '@/features/rasters/RasterUploadForm';
import {
  fetchRasters,
  isRasterPmtilesOverlay,
  rasterCornersFromBounds,
  rasterPmtilesHttpUrl,
  suggestZoomForBoundsCorners,
  type BBox,
} from '@/features/rasters/api';
import type { PointOfInterest, RasterOverlay, Track, Zone } from '@/lib/types';
import type { RasterLayerState } from '@/map/layers/RasterOverlayLayer';
import { useAuth } from './auth/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  fetchPointsCached,
  fetchZonesCached,
  fetchTracksCached,
  fetchAnnotationsCached,
  removeAnnotationFromLocalCache,
} from '@/lib/db/cache';
import { startBackgroundSync } from '@/lib/db/syncQueue';
import { SyncIndicator } from './SyncIndicator';
import { CadImportPanel } from '@/features/cad/CadImportPanel';
import {
  fetchCadImports,
  fetchCadLayers,
  updateCadLayer,
  type CadImport,
  type CadLayerRow,
} from '@/features/cad/api';
import { CadLabelEditSheet, type CadLabelSavePayload } from '@/features/cad/CadLabelEditSheet';
import { cadLabelLockedFromStyle } from '@/features/cad/cadLayerLabelStyle';
import { deleteCadLabelPhotoStorage, uploadCadLabelPhoto } from '@/features/cad/cadLabelPhotos';
import {
  CAD_FEATURE_ID_KEY,
  type CadLabelEditTapPayload,
  type CadLabelPhotoPatch,
  cadLabelHandiDescriptionFromProps,
  cadLabelHandiPhotoPathFromProps,
  cadLabelHandiPhotoUrlFromProps,
  cadLabelTextFromProps,
  ensureCadFeatureCollectionIds,
  findCadPointLabelFeatureIndex,
  patchCadLabelFeatureMetadata,
  removeCadFeatureAtIndex,
} from '@/features/cad/cadFeatureIds';
import { loadFieldOfflineSnapshot, saveFieldOfflineSnapshot } from '@/lib/db/fieldOfflinePack';
import {
  buildRasterUrlOverrides,
  deleteRasterArchive,
  saveRasterImageOffline,
  saveRemoteRasterArchive,
} from '@/lib/pmtiles';
import { type AppDiagnostics, checkPmtilesUrl } from '@/lib/diagnostics';
import type { Annotation, AnnotationSymbol, Visibility } from '@/lib/types';
import { safeCreateAnnotation, safeDeleteAnnotation, safeUpdateAnnotation } from '@/lib/db/safeApi';

function annotPreviewLabel(a: Annotation): string {
  if (a.kind === 'text') return (a.text ?? '').trim().slice(0, 36) || 'Text';
  if (a.kind === 'arrow') return 'Săgeată';
  if (a.kind === 'sketch') return 'Creion';
  return `Simbol ${a.symbol ?? ''}`;
}

/** PMTiles pe raster tab: afișează notă doar când harta e în mod Leaflet implicit (fără ?maplibre=1). */
function shouldSuggestPmtilesMaplibreUrlHint(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.has('maplibre') && !q.has('leaflet')) return false;
  try {
    if (localStorage.getItem('handi-basemap')?.startsWith('pmtiles-')) return false;
  } catch {
    /* ignore */
  }
  return true;
}

interface PendingPoint {
  lat: number;
  lon: number;
  elevation: number | null;
}

type Tab = 'points' | 'tracks' | 'rasters' | 'cad';

export default function FieldPage() {
  const ask = useAppConfirm();
  const { user, signOut } = useAuth();
  const [points, setPoints] = useState<PointOfInterest[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [rasters, setRasters] = useState<RasterOverlay[]>([]);
  const [cadImports, setCadImports] = useState<CadImport[]>([]);
  const [cadLayers, setCadLayers] = useState<CadLayerRow[]>([]);
  const [cadLabelEdit, setCadLabelEdit] = useState<{
    layerRowId: string;
    featureIndex: number;
    cadLayerName: string;
    initialText: string;
    initialDescription: string;
    initialPhotoUrl: string | null;
    initialPhotoPath: string | null;
  } | null>(null);
  const [cadLabelSaving, setCadLabelSaving] = useState(false);
  const [cadLabelErr, setCadLabelErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>('points');
  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(null);
  /** După „Adaugă punct”: următorul click pe hartă setează poziția. */
  const [awaitingPointOnMap, setAwaitingPointOnMap] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<PointOfInterest | null>(null);
  /** Editare din tabul Puncte (formular separat de overlay-ul de pe hartă). */
  const [pointListEdit, setPointListEdit] = useState<PointOfInterest | null>(null);

  const [annotMode, setAnnotMode] = useState<'off' | 'symbol' | 'text' | 'arrow' | 'sketch'>('off');
  const [annotVisibility, setAnnotVisibility] = useState<Visibility>('club');
  const [annotSymbol, setAnnotSymbol] = useState<AnnotationSymbol>('dolina');
  const [annotText, setAnnotText] = useState('');
  const [annotArrowColor, setAnnotArrowColor] = useState('#22c55e');
  const [annotSketchColor, setAnnotSketchColor] = useState('#f97316');
  const [annotTextSizePx, setAnnotTextSizePx] = useState(16);
  const [annotTextColor, setAnnotTextColor] = useState('#fef08a');
  const [arrowStart, setArrowStart] = useState<{ lon: number; lat: number } | null>(null);
  const [annotEdit, setAnnotEdit] = useState<{
    id: string;
    kind: 'text' | 'arrow' | 'symbol' | 'sketch';
  } | null>(null);
  const [annotEditText, setAnnotEditText] = useState('');
  const [annotEditSizePx, setAnnotEditSizePx] = useState(16);
  const [annotEditColor, setAnnotEditColor] = useState('#fef08a');
  const [annotEditArrowColor, setAnnotEditArrowColor] = useState('#22c55e');
  const [annotEditSymbol, setAnnotEditSymbol] = useState<AnnotationSymbol>('dolina');

  const myRecentAnnotations = useMemo(
    () => (!user?.id ? [] : annotations.filter((a) => a.owner_id === user.id).slice(0, 40)),
    [annotations, user],
  );

  const [liveTrack, setLiveTrack] = useState<[number, number][]>([]);

  const [rasterVisible, setRasterVisible] = useState<Set<string>>(new Set());
  const [rasterOpacity, setRasterOpacity] = useState<Record<string, number>>({});
  const [offlinePmtilesById, setOfflinePmtilesById] = useState<Record<string, string>>({});
  const [pmtilesZoomById, setPmtilesZoomById] = useState<Record<string, { minzoom: number; maxzoom: number }>>({});
  const [showRasterUpload, setShowRasterUpload] = useState(false);
  const [currentBbox, setCurrentBbox] = useState<BBox | null>(null);
  const [lastMapZoom, setLastMapZoom] = useState(14);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Ultima poziție GPS afișată pe hartă (buton + sau GPS pe hartă). */
  const [myLocation, setMyLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number } | null>(null);
  const [fitBounds, setFitBounds] = useState<[[number, number], [number, number]] | null>(null);
  const [syncTick, setSyncTick] = useState(0);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diag, setDiag] = useState<AppDiagnostics | null>(null);
  const [fieldPackSavedAt, setFieldPackSavedAt] = useState<number | null>(null);
  const [fieldPackBusy, setFieldPackBusy] = useState(false);

  const rasterStateWithPmtiles: RasterLayerState = {
    visibleIds: rasterVisible,
    opacity: rasterOpacity,
    pmtilesUrlByRasterId: offlinePmtilesById,
    pmtilesZoomByRasterId: pmtilesZoomById,
  };

  const bumpRasterLayerAfterOfflineSave = useCallback((rasterId: string) => {
    setRasterVisible((prev) => {
      if (!prev.has(rasterId)) return prev;
      const n = new Set(prev);
      n.delete(rasterId);
      window.setTimeout(() => {
        setRasterVisible((p) => new Set(p).add(rasterId));
      }, 0);
      return n;
    });
  }, []);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [pr, zr, tr, ar, rastersResultRaw, cadImpsRaw] = await Promise.all([
        fetchPointsCached(),
        fetchZonesCached(),
        fetchTracksCached(),
        fetchAnnotationsCached(),
        fetchRasters().catch(() => [] as RasterOverlay[]),
        fetchCadImports().catch(() => [] as CadImport[]),
      ]);
      let rastersResult = rastersResultRaw;
      let cadImps = cadImpsRaw;
      let cadLay: CadLayerRow[] =
        cadImps.length > 0
          ? await fetchCadLayers(cadImps.map((i) => i.id)).catch(() => [] as CadLayerRow[])
          : [];

      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (offline) {
        const snap = await loadFieldOfflineSnapshot();
        if (snap) {
          if (rastersResult.length === 0 && snap.rasters.length > 0) {
            rastersResult = snap.rasters;
          }
          if (cadImps.length === 0 && snap.cadImports.length > 0) {
            cadImps = snap.cadImports;
            cadLay = snap.cadLayers.length > 0 ? snap.cadLayers : cadLay;
          } else if (cadLay.length === 0 && snap.cadLayers.length > 0) {
            const importIds = new Set(cadImps.map((i) => i.id));
            const coherent = snap.cadLayers.filter((l) => importIds.has(l.import_id));
            if (coherent.length > 0) cadLay = coherent;
          }
        }
      }

      setPoints(pr.data);
      setZones(zr.data);
      setTracks(tr.data);
      setAnnotations(ar.data);
      setRasters(rastersResult);
      setCadImports(cadImps);
      setCadLayers(cadLay);
      const errs = [pr, zr, tr, ar]
        .filter((r) => r.fromCache && r.error)
        .map((r) => r.error)
        .filter(Boolean);
      if (errs.length > 0) {
        setError(`Offline (date din cache): ${errs[0]}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la incarcare');
    } finally {
      setLoading(false);
      setSyncTick((t) => t + 1);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (activeTab !== 'points') {
      setAnnotMode('off');
      setArrowStart(null);
      setAnnotEdit(null);
      setAwaitingPointOnMap(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (annotMode !== 'off') setAwaitingPointOnMap(false);
  }, [annotMode]);

  useEffect(() => {
    void buildRasterUrlOverrides().then(setOfflinePmtilesById).catch(() => {
      /* ignore */
    });
  }, [syncTick]);

  useEffect(() => {
    void loadFieldOfflineSnapshot().then((s) => {
      setFieldPackSavedAt(s?.savedAt ?? null);
    });
  }, [syncTick]);

  useEffect(() => {
    const stop = startBackgroundSync(() => {
      void reload();
    });
    return stop;
  }, [reload]);

  const handleCadLabelTap = useCallback(
    (p: CadLabelEditTapPayload) => {
      const row = cadLayers.find((r) => r.id === p.layerRowId);
      if (!row) return;
      if (cadLabelLockedFromStyle((row.style ?? {}) as Record<string, unknown>)) return;
      const idx = findCadPointLabelFeatureIndex(row.features, {
        fid: p.featureFid,
        lon: p.lon,
        lat: p.lat,
        eps: 1e-4,
      });
      if (idx < 0) return;
      const feat = row.features.features[idx];
      const props = feat.properties as Record<string, unknown>;
      const initialText = cadLabelTextFromProps(props);
      setCadLabelErr(null);
      setCadLabelEdit({
        layerRowId: p.layerRowId,
        featureIndex: idx,
        cadLayerName: row.cad_layer,
        initialText,
        initialDescription: cadLabelHandiDescriptionFromProps(props).trim(),
        initialPhotoUrl: cadLabelHandiPhotoUrlFromProps(props),
        initialPhotoPath: cadLabelHandiPhotoPathFromProps(props),
      });
    },
    [cadLayers],
  );

  const closeCadLabelEdit = useCallback(() => {
    if (cadLabelSaving) return;
    setCadLabelEdit(null);
    setCadLabelErr(null);
  }, [cadLabelSaving]);

  const saveCadLabelEdit = useCallback(
    async (payload: CadLabelSavePayload) => {
      if (!cadLabelEdit) return;
      const row = cadLayers.find((r) => r.id === cadLabelEdit.layerRowId);
      if (!row) {
        setCadLabelErr('Stratul CAD nu mai este disponibil.');
        return;
      }
      if (!payload.text.trim()) {
        setCadLabelErr('Introdu textul etichetei (numele pe hartă).');
        return;
      }
      if (payload.photoFile && !isSupabaseConfigured) {
        setCadLabelErr('Încărcarea pozelor necesită Supabase.');
        return;
      }
      setCadLabelSaving(true);
      setCadLabelErr(null);
      try {
        const fc0 = ensureCadFeatureCollectionIds(structuredClone(row.features));
        const idx = cadLabelEdit.featureIndex;
        if (idx < 0 || idx >= fc0.features.length) {
          setCadLabelErr('Eticheta nu mai există pe acest strat.');
          return;
        }
        const p0 = (fc0.features[idx].properties ?? {}) as Record<string, unknown>;
        const oldPath = cadLabelHandiPhotoPathFromProps(p0);
        const fid = typeof p0[CAD_FEATURE_ID_KEY] === 'string' ? (p0[CAD_FEATURE_ID_KEY] as string) : '';
        if (!fid) {
          setCadLabelErr('Lipsește identificatorul intern; reîncarcă pagina și încearcă din nou.');
          return;
        }

        let photo: CadLabelPhotoPatch = 'keep';
        if (payload.removePhoto) {
          if (oldPath) await deleteCadLabelPhotoStorage(oldPath);
          photo = 'remove';
        } else if (payload.photoFile) {
          const up = await uploadCadLabelPhoto({
            cadLayerRowId: row.id,
            featureFid: fid,
            file: payload.photoFile,
          });
          if (oldPath && oldPath !== up.storagePath) {
            await deleteCadLabelPhotoStorage(oldPath).catch(() => {});
          }
          photo = { url: up.publicUrl, path: up.storagePath };
        }

        const patched = patchCadLabelFeatureMetadata(fc0, idx, {
          text: payload.text,
          description: payload.description,
          photo,
        });
        await updateCadLayer(row.id, { features: patched });
        setCadLabelEdit(null);
        await reload();
      } catch (e) {
        setCadLabelErr(e instanceof Error ? e.message : 'Salvare esuata');
      } finally {
        setCadLabelSaving(false);
      }
    },
    [cadLabelEdit, cadLayers, reload],
  );

  const deleteCadLabelEdit = useCallback(async () => {
    if (!cadLabelEdit) return;
    if (!(await ask('Ștergi această etichetă de pe stratul CAD?'))) return;
    const row = cadLayers.find((r) => r.id === cadLabelEdit.layerRowId);
    if (!row) {
      setCadLabelErr('Stratul CAD nu mai este disponibil.');
      return;
    }
    setCadLabelSaving(true);
    setCadLabelErr(null);
    try {
      const feat = row.features.features[cadLabelEdit.featureIndex];
      const ph = cadLabelHandiPhotoPathFromProps((feat?.properties ?? {}) as Record<string, unknown>);
      if (ph) await deleteCadLabelPhotoStorage(ph).catch(() => {});
      const patched = removeCadFeatureAtIndex(row.features, cadLabelEdit.featureIndex);
      const withIds = ensureCadFeatureCollectionIds(patched);
      await updateCadLayer(row.id, { features: withIds });
      setCadLabelEdit(null);
      await reload();
    } catch (e) {
      setCadLabelErr(e instanceof Error ? e.message : 'Ștergere eșuată');
    } finally {
      setCadLabelSaving(false);
    }
  }, [ask, cadLabelEdit, cadLayers, reload]);

  const removeAnnot = async (id: string) => {
    if (!(await ask('Stergi aceasta adnotare?'))) return;
    try {
      const r = await safeDeleteAnnotation(id);
      await removeAnnotationFromLocalCache(id);
      if (annotEdit?.id === id) setAnnotEdit(null);
      setAnnotations((prev) => prev.filter((x) => x.id !== id));
      if (r.ok === 'queued') alert('Sters local. Va sincroniza automat.');
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare la stergere');
    }
  };

  const saveTextAnnotEdit = async () => {
    if (!annotEdit || annotEdit.kind !== 'text') return;
    const ann = annotations.find((x) => x.id === annotEdit.id);
    if (!ann || ann.kind !== 'text') return;
    const t = annotEditText.trim();
    if (!t) {
      alert('Introdu textul.');
      return;
    }
    try {
      const r = await safeUpdateAnnotation(annotEdit.id, {
        text: t,
        style: { ...ann.style, textSizePx: annotEditSizePx, textColor: annotEditColor },
      });
      if (r.ok === 'queued') alert('Salvat local. Va sincroniza automat.');
      setAnnotEdit(null);
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare la salvare');
    }
  };

  const saveArrowColorEdit = async () => {
    if (!annotEdit || (annotEdit.kind !== 'arrow' && annotEdit.kind !== 'sketch')) return;
    const ann = annotations.find((x) => x.id === annotEdit.id);
    if (!ann || (ann.kind !== 'arrow' && ann.kind !== 'sketch')) return;
    try {
      const r = await safeUpdateAnnotation(annotEdit.id, {
        style: { ...ann.style, arrowColor: annotEditArrowColor },
      });
      if (r.ok === 'queued') alert('Salvat local. Va sincroniza automat.');
      setAnnotEdit(null);
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare la salvare');
    }
  };

  const handleSketchComplete = useCallback(
    (geom: GeoJSON.LineString) => {
      void (async () => {
        try {
          const r = await safeCreateAnnotation({
            kind: 'sketch',
            geom,
            visibility: annotVisibility,
            style: { arrowColor: annotSketchColor },
          });
          if (r.ok === 'queued') alert('Adnotare pusa in coada offline.');
          void reload();
        } catch (e) {
          alert(e instanceof Error ? e.message : 'Eroare la desen');
        }
      })();
    },
    [annotSketchColor, annotVisibility, reload],
  );

  const saveSymbolEdit = async () => {
    if (!annotEdit || annotEdit.kind !== 'symbol') return;
    const ann = annotations.find((x) => x.id === annotEdit.id);
    if (!ann || ann.kind !== 'symbol') return;
    try {
      const r = await safeUpdateAnnotation(annotEdit.id, { symbol: annotEditSymbol });
      if (r.ok === 'queued') alert('Salvat local. Va sincroniza automat.');
      setAnnotEdit(null);
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Eroare la salvare');
    }
  };

  const onMapClick = (lng: number, lat: number) => {
    if (awaitingPointOnMap && activeTab === 'points' && annotMode === 'off') {
      setPendingPoint({
        lat,
        lon: lng,
        elevation: null,
      });
      setAwaitingPointOnMap(false);
      setFlyTo({ lng, lat, zoom: Math.max(lastMapZoom ?? 0, 16) });
      setSidebarOpen(false);
      return;
    }
    if (activeTab === 'points' && annotMode !== 'off' && annotMode !== 'sketch') {
      void (async () => {
        try {
          if (annotMode === 'arrow') {
            if (!arrowStart) {
              setArrowStart({ lon: lng, lat });
              return;
            }
            const geom: GeoJSON.LineString = {
              type: 'LineString',
              coordinates: [
                [arrowStart.lon, arrowStart.lat],
                [lng, lat],
              ],
            };
            const bearing_deg = computeBearingDeg(arrowStart.lon, arrowStart.lat, lng, lat);
            setArrowStart(null);
            const r = await safeCreateAnnotation({
              kind: 'arrow',
              geom,
              bearing_deg,
              visibility: annotVisibility,
              style: { arrowColor: annotArrowColor },
            });
            if (r.ok === 'queued') alert('Adnotare pusa in coada offline.');
            void reload();
            return;
          }

          if (annotMode === 'text') {
            const text = annotText.trim();
            if (!text) {
              alert('Introdu textul în panoul de adnotări (butonul A).');
              return;
            }
            const r = await safeCreateAnnotation({
              kind: 'text',
              text,
              lat,
              lon: lng,
              visibility: annotVisibility,
              style: { textSizePx: annotTextSizePx, textColor: annotTextColor },
            });
            if (r.ok === 'queued') alert('Adnotare pusa in coada offline.');
            void reload();
            return;
          }

          const r = await safeCreateAnnotation({
            kind: 'symbol',
            symbol: annotSymbol,
            lat,
            lon: lng,
            visibility: annotVisibility,
            style: {},
          });
          if (r.ok === 'queued') alert('Adnotare pusa in coada offline.');
          void reload();
        } catch (e) {
          alert(e instanceof Error ? e.message : 'Eroare la adnotare');
        }
      })();
      return;
    }
    // Punct nou: din tab Puncte („Adaugă punct” → click hartă) sau GPS din listă.
  };

  const openAddPointForm = () => {
    setAwaitingPointOnMap(true);
  };

  const addAtCurrentLocation = () => {
    setAwaitingPointOnMap(false);
    if (!navigator.geolocation) {
      alert('Geolocation nu este disponibil pe acest device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        setMyLocation({ lat, lon });
        setPendingPoint({
          lat,
          lon,
          elevation: pos.coords.altitude,
        });
        setFlyTo({ lng: lon, lat, zoom: 16 });
      },
      (e) => alert('Nu pot obtine pozitia: ' + e.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 w-full flex-col">
      <header className="z-20 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-slate-800 bg-slate-950 px-3 py-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-sm hover:bg-slate-800 md:hidden"
        >
          {sidebarOpen ? 'Harta' : 'Lista'}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center font-bold">
            H
          </div>
          <span className="font-semibold">HANDI</span>
          <span className="text-xs text-slate-500 hidden sm:inline">Speo Field</span>
        </div>
        <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 sm:gap-3">
          <button
            onClick={() => {
              setDiagOpen(true);
              setDiagLoading(true);
              void (async () => {
                try {
                  const qs = new URLSearchParams(window.location.search);
                  const forceLeaflet = Boolean(qs.has('leaflet'));
                  const forceMaplibre = Boolean(qs.has('maplibre'));
                  const renderer: 'maplibre' | 'leaflet' =
                    forceLeaflet && !forceMaplibre ? 'leaflet' : 'maplibre';

                  const pmtilesRasters = rasters
                    .filter((r) => rasterVisible.has(r.id) && isRasterPmtilesOverlay(r))
                    .map((r) => offlinePmtilesById[r.id] ?? rasterPmtilesHttpUrl(r))
                    .filter((x): x is string => Boolean(x));

                  const pmtiles = await Promise.all(pmtilesRasters.map((u) => checkPmtilesUrl(u)));

                  setDiag({
                    timeISO: new Date().toISOString(),
                    url: window.location.href,
                    renderer,
                    serviceWorker: {
                      supported: 'serviceWorker' in navigator,
                      controlled: Boolean(navigator.serviceWorker?.controller),
                    },
                    pmtiles,
                  });
                } finally {
                  setDiagLoading(false);
                }
              })();
            }}
            className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
            title="Diagnostice (fara DevTools)"
          >
            Diag
          </button>
          <button
            type="button"
            disabled={
              fieldPackBusy || (typeof navigator !== 'undefined' && !navigator.onLine) || !isSupabaseConfigured
            }
            onClick={() => {
              setFieldPackBusy(true);
              void (async () => {
                try {
                  const savedAt = await saveFieldOfflineSnapshot({
                    cadImports,
                    cadLayers,
                    rasters,
                  });
                  setFieldPackSavedAt(savedAt);
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Eroare la salvare pachet');
                } finally {
                  setFieldPackBusy(false);
                }
              })();
            }}
            className="max-w-[7.5rem] shrink truncate rounded-lg border border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-800 disabled:opacity-50 sm:max-w-none sm:text-xs"
            title={
              'Salvează local structura CAD și lista de rastere pentru mod fără rețea. ' +
              'Apasă din nou când ai date noi pe server. ' +
              'Pentru tile-uri mari, folosește „Salvează offline” pe fiecare raster. ' +
              'Punctele adăugate offline se sincronizează automat când revine internetul (coadă).'
            }
          >
            {fieldPackBusy ? (
              '…'
            ) : fieldPackSavedAt ? (
              <>
                <span className="sm:hidden">Actual. pachet</span>
                <span className="hidden sm:inline">Actualizează pachet CAD</span>
              </>
            ) : (
              <>
                <span className="sm:hidden">Pachet CAD</span>
                <span className="hidden sm:inline">Pachet offline CAD</span>
              </>
            )}
          </button>
          <div className="shrink-0">
            <SyncIndicator refreshTick={syncTick} onSynced={() => void reload()} />
          </div>
          <span className="text-xs text-slate-400 hidden md:inline">{user?.email}</span>
          <button
            onClick={() => signOut()}
            className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-800 sm:text-xs"
            title="Ieșire din cont"
          >
            Ieșire
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative overflow-hidden">
        <aside
          className={`${
            sidebarOpen ? 'flex' : 'hidden'
          } md:flex flex-col w-full md:w-80 lg:w-96 bg-slate-900 border-r border-slate-800 absolute md:relative inset-0 md:inset-auto z-20 isolate`}
        >
          <nav className="flex border-b border-slate-700 bg-slate-950">
            {(['points', 'tracks', 'rasters', 'cad'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`flex-1 py-2 text-xs font-medium border-b-2 transition ${
                  activeTab === t
                    ? 'border-brand-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {t === 'points'
                  ? `Puncte (${points.length})`
                  : t === 'tracks'
                    ? `Trasee (${tracks.length})`
                    : t === 'rasters'
                      ? `Rasters (${rasters.length})`
                      : `CAD (${cadImports.length})`}
              </button>
            ))}
          </nav>

          {activeTab === 'points' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="max-h-[min(38vh,280px)] shrink-0 space-y-2 overflow-y-auto border-b border-slate-800 bg-slate-900/90 p-3">
                <div className="text-xs font-medium text-slate-200">Adnotări pe hartă</div>
                <p className="text-[10px] leading-snug text-slate-500">
                  Alege modul, apoi click pe hartă. (Disponibil doar în tabul Puncte.)
                </p>
                <div className="flex gap-2">
                  {(['off', 'symbol', 'text', 'arrow', 'sketch'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setAnnotMode(m);
                        setArrowStart(null);
                        if (m !== 'off') setAnnotEdit(null);
                      }}
                      className={`flex-1 rounded-lg border py-1.5 text-[10px] font-medium ${
                        annotMode === m
                          ? 'border-brand-500 bg-brand-600/20 text-white'
                          : 'border-slate-700 text-slate-400 hover:bg-slate-800/40'
                      }`}
                    >
                      {m === 'off'
                        ? 'Off'
                        : m === 'symbol'
                          ? 'Simbol'
                          : m === 'text'
                            ? 'Text'
                            : m === 'sketch'
                              ? 'Creion'
                              : arrowStart
                                ? 'Săgeată 2/2'
                                : 'Săgeată'}
                    </button>
                  ))}
                </div>

                {annotMode !== 'off' && annotMode !== 'sketch' && (
                  <>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-500">Viz:</span>
                      <button
                        type="button"
                        onClick={() => setAnnotVisibility((v) => (v === 'club' ? 'private' : 'club'))}
                        className="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800/40"
                      >
                        {annotVisibility === 'club' ? 'Club' : 'Privat'}
                      </button>
                    </div>

                    {annotMode === 'symbol' && (
                      <select
                        value={annotSymbol}
                        onChange={(e) => setAnnotSymbol(e.target.value as AnnotationSymbol)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
                      >
                        <option value="diaclaza">Diaclaza</option>
                        <option value="dolina">Dolina</option>
                        <option value="abrupt">Abrupt</option>
                        <option value="pestera">Pestera</option>
                        <option value="intrebare">Semn intrebari</option>
                        <option value="mirare">Semn mirari</option>
                        <option value="ravene">Ravene</option>
                        <option value="ponoare">Ponoare</option>
                        <option value="izbuc">Izbucuri</option>
                        <option value="depresiune_hachuri">Depresiune (hasuri interior)</option>
                        <option value="alunecare">Alunecare teren</option>
                      </select>
                    )}

                    {annotMode === 'text' && (
                      <div className="space-y-2">
                        <textarea
                          value={annotText}
                          onChange={(e) => setAnnotText(e.target.value)}
                          placeholder="Text (ex: Nume deal, râu…)"
                          rows={2}
                          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-1 text-[10px] text-slate-500">
                            Mărime
                            <input
                              type="range"
                              min={10}
                              max={36}
                              value={annotTextSizePx}
                              onChange={(e) => setAnnotTextSizePx(Number(e.target.value))}
                              className="w-20"
                            />
                            <span className="tabular-nums text-slate-400">{annotTextSizePx}px</span>
                          </label>
                          <label className="flex items-center gap-1 text-[10px] text-slate-500">
                            Culoare
                            <input
                              type="color"
                              value={annotTextColor}
                              onChange={(e) => setAnnotTextColor(e.target.value)}
                              className="h-7 w-10 cursor-pointer rounded border border-slate-600 bg-slate-900"
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {annotMode === 'arrow' && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-slate-500">Click start, apoi capăt pe hartă.</p>
                        <label className="flex items-center gap-2 text-[10px] text-slate-500">
                          Culoare
                          <input
                            type="color"
                            value={annotArrowColor}
                            onChange={(e) => setAnnotArrowColor(e.target.value)}
                            className="h-7 w-10 cursor-pointer rounded border border-slate-600 bg-slate-900"
                          />
                        </label>
                      </div>
                    )}
                  </>
                )}

                {annotMode === 'sketch' && (
                  <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <p className="text-[10px] leading-snug text-slate-400">
                      Ține apăsat și trasează pe hartă cu degetul sau mouse-ul. Se salvează la ridicare.
                    </p>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-500">Viz:</span>
                      <button
                        type="button"
                        onClick={() => setAnnotVisibility((v) => (v === 'club' ? 'private' : 'club'))}
                        className="rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800/40"
                      >
                        {annotVisibility === 'club' ? 'Club' : 'Privat'}
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-[10px] text-slate-500">
                      Culoare
                      <input
                        type="color"
                        value={annotSketchColor}
                        onChange={(e) => setAnnotSketchColor(e.target.value)}
                        className="h-7 w-10 cursor-pointer rounded border border-slate-600 bg-slate-900"
                      />
                    </label>
                  </div>
                )}

                {annotEdit && (
                  <div className="space-y-2 border-t border-slate-700 pt-2">
                    {annotEdit.kind === 'text' && (
                      <>
                        <div className="text-xs font-medium text-slate-300">Editează text</div>
                        <textarea
                          value={annotEditText}
                          onChange={(e) => setAnnotEditText(e.target.value)}
                          rows={2}
                          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-1 text-[10px] text-slate-500">
                            Mărime
                            <input
                              type="range"
                              min={10}
                              max={36}
                              value={annotEditSizePx}
                              onChange={(e) => setAnnotEditSizePx(Number(e.target.value))}
                              className="w-20"
                            />
                            <span className="text-slate-400">{annotEditSizePx}px</span>
                          </label>
                          <input
                            type="color"
                            value={annotEditColor}
                            onChange={(e) => setAnnotEditColor(e.target.value)}
                            className="h-7 w-10 rounded border border-slate-600"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setAnnotEdit(null)}
                            className="flex-1 rounded-lg border border-slate-600 py-1.5 text-xs text-slate-300"
                          >
                            Anulează
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveTextAnnotEdit()}
                            className="flex-1 rounded-lg bg-brand-600 py-1.5 text-xs font-medium text-white"
                          >
                            Salvează
                          </button>
                        </div>
                      </>
                    )}
                    {(annotEdit.kind === 'arrow' || annotEdit.kind === 'sketch') && (
                      <>
                        <div className="text-xs font-medium text-slate-300">
                          {annotEdit.kind === 'sketch' ? 'Culoare creion' : 'Culoare săgeată'}
                        </div>
                        <input
                          type="color"
                          value={annotEditArrowColor}
                          onChange={(e) => setAnnotEditArrowColor(e.target.value)}
                          className="h-8 w-12 cursor-pointer rounded border border-slate-600 bg-slate-900"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setAnnotEdit(null)}
                            className="flex-1 rounded-lg border border-slate-600 py-1.5 text-xs text-slate-300"
                          >
                            Anulează
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveArrowColorEdit()}
                            className="flex-1 rounded-lg bg-brand-600 py-1.5 text-xs font-medium text-white"
                          >
                            Salvează
                          </button>
                        </div>
                      </>
                    )}
                    {annotEdit.kind === 'symbol' && (
                      <>
                        <div className="text-xs font-medium text-slate-300">Simbol</div>
                        <select
                          value={annotEditSymbol}
                          onChange={(e) => setAnnotEditSymbol(e.target.value as AnnotationSymbol)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
                        >
                          <option value="diaclaza">Diaclaza</option>
                          <option value="dolina">Dolina</option>
                          <option value="abrupt">Abrupt</option>
                          <option value="pestera">Pestera</option>
                          <option value="intrebare">Semn întrebări</option>
                          <option value="mirare">Semn mirări</option>
                          <option value="ravene">Ravene</option>
                          <option value="ponoare">Ponoare</option>
                          <option value="izbuc">Izbucuri</option>
                          <option value="depresiune_hachuri">Depresiune (hașuri)</option>
                          <option value="alunecare">Alunecare teren</option>
                        </select>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setAnnotEdit(null)}
                            className="flex-1 rounded-lg border border-slate-600 py-1.5 text-xs text-slate-300"
                          >
                            Anulează
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveSymbolEdit()}
                            className="flex-1 rounded-lg bg-brand-600 py-1.5 text-xs font-medium text-white"
                          >
                            Salvează
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {user?.id && myRecentAnnotations.length > 0 && (
                  <div className="max-h-28 overflow-y-auto border-t border-slate-700 pt-2">
                    <div className="mb-1 text-[10px] text-slate-500">Adnotările mele (recent)</div>
                    <ul className="space-y-1">
                      {myRecentAnnotations.map((a) => (
                        <li key={a.id} className="flex items-start gap-1 text-[11px] leading-tight text-slate-300">
                          <span className="min-w-0 flex-1 truncate" title={annotPreviewLabel(a)}>
                            {annotPreviewLabel(a)}
                          </span>
                          {a.kind === 'text' && (
                            <button
                              type="button"
                              className="shrink-0 text-brand-400 hover:underline"
                              onClick={() => {
                                setAnnotEdit({ id: a.id, kind: 'text' });
                                setAnnotEditText(a.text ?? '');
                                setAnnotEditSizePx(a.style?.textSizePx ?? 16);
                                setAnnotEditColor(a.style?.textColor ?? '#fef08a');
                              }}
                            >
                              Editează
                            </button>
                          )}
                          {(a.kind === 'arrow' || a.kind === 'sketch') && (
                            <button
                              type="button"
                              className="shrink-0 text-brand-400 hover:underline"
                              onClick={() => {
                                setAnnotEdit({ id: a.id, kind: a.kind === 'sketch' ? 'sketch' : 'arrow' });
                                setAnnotEditArrowColor(
                                  a.style?.arrowColor ?? (a.kind === 'sketch' ? '#f97316' : '#22c55e'),
                                );
                              }}
                            >
                              Culoare
                            </button>
                          )}
                          {a.kind === 'symbol' && (
                            <button
                              type="button"
                              className="shrink-0 text-brand-400 hover:underline"
                              onClick={() => {
                                setAnnotEdit({ id: a.id, kind: 'symbol' });
                                setAnnotEditSymbol(a.symbol ?? 'dolina');
                              }}
                            >
                              Simbol
                            </button>
                          )}
                          <button
                            type="button"
                            className="shrink-0 text-red-400 hover:underline"
                            onClick={() => void removeAnnot(a.id)}
                          >
                            Șterge
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1">
                <PointsList
                  points={points}
                  onAddPoint={openAddPointForm}
                  onAddPointWithGps={addAtCurrentLocation}
                  pointPlacementAwaiting={awaitingPointOnMap}
                  onCancelPointPlacement={() => setAwaitingPointOnMap(false)}
                  onSelect={(p) => {
                    setFlyTo({ lng: p.lon, lat: p.lat, zoom: 16 });
                    setSelectedPoint(p);
                    setSidebarOpen(false);
                  }}
                  onEditPoint={(p) => {
                    setPointListEdit(p);
                    setSidebarOpen(true);
                  }}
                  onChanged={() => void reload()}
                />
              </div>
            </div>
          )}

          {activeTab === 'tracks' && (
            <div className="flex flex-col h-full">
              <div className="p-3 border-b border-slate-700">
                <TrackRecorderPanel
                  onSaved={() => void reload()}
                  onLiveCoordsChange={setLiveTrack}
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                <TracksPanel
                  tracks={tracks}
                  onSelect={(t) => {
                    if (t.geom.coordinates.length === 0) return;
                    const mid = t.geom.coordinates[Math.floor(t.geom.coordinates.length / 2)];
                    setFlyTo({ lng: mid[0], lat: mid[1], zoom: 14 });
                    setSidebarOpen(false);
                  }}
                  onChanged={() => void reload()}
                />
              </div>
            </div>
          )}

          {activeTab === 'rasters' && (
            <RastersPanel
              rasters={rasters}
              visibleIds={rasterVisible}
              opacity={rasterOpacity}
              onAdd={() => setShowRasterUpload(true)}
              onToggle={(id) => {
                setRasterVisible((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });

                try {
                  const r = rasters.find((x) => x.id === id);
                  const enabling = !rasterVisible.has(id);
                  const pmUrl = r ? offlinePmtilesById[r.id] ?? rasterPmtilesHttpUrl(r) : null;
                  const isPMTiles = Boolean(r && isRasterPmtilesOverlay(r) && pmUrl);

                  // When enabling, also read PMTiles header to set correct min/max zoom (many archives are z16-only).
                  if (enabling && isPMTiles && !pmUrl && r && isRasterPmtilesOverlay(r)) {
                    setError(
                      'PMTiles: apasă „Actualizează offline” (copie locală) sau reîncarcă pagina după upload în Supabase.',
                    );
                  }

                  if (enabling && isPMTiles && pmUrl) {
                    if (shouldSuggestPmtilesMaplibreUrlHint()) {
                      const u = new URL(window.location.href);
                      u.searchParams.set('maplibre', '1');
                      u.searchParams.delete('leaflet');
                      window.location.assign(u.toString());
                      return;
                    }
                    void (async () => {
                      try {
                        const arch = new PMTiles(pmUrl);
                        const h = await arch.getHeader();
                        const minzoom = typeof h.minZoom === 'number' ? h.minZoom : 0;
                        const maxzoom = typeof h.maxZoom === 'number' ? h.maxZoom : minzoom;
                        setPmtilesZoomById((p) => ({ ...p, [id]: { minzoom, maxzoom } }));
                        // Jump to overlay so user sees it immediately.
                        setFitBounds([
                          [h.minLon, h.minLat],
                          [h.maxLon, h.maxLat],
                        ]);
                        setFlyTo({
                          lng: (h.minLon + h.maxLon) / 2,
                          lat: (h.minLat + h.maxLat) / 2,
                          zoom: maxzoom,
                        });
                      } catch {
                        /* ignore */
                      }
                    })();
                  } else if (enabling && r && !isPMTiles) {
                    const c = rasterCornersFromBounds(r.bounds);
                    if (c) {
                      setFitBounds([
                        [c.minLon, c.minLat],
                        [c.maxLon, c.maxLat],
                      ]);
                      const z = suggestZoomForBoundsCorners(c);
                      setFlyTo({
                        lng: (c.minLon + c.maxLon) / 2,
                        lat: (c.minLat + c.maxLat) / 2,
                        zoom: z,
                      });
                    }
                  }
                } catch {
                  /* ignore */
                }
              }}
              onSetOpacity={(id, v) => setRasterOpacity((p) => ({ ...p, [id]: v }))}
              offlinePmtilesById={offlinePmtilesById}
              onSaveOfflinePmtiles={async (r, onProgress) => {
                const pm = rasterPmtilesHttpUrl(r);
                if (pm) {
                  await saveRemoteRasterArchive({
                    rasterId: r.id,
                    name: r.name,
                    url: pm,
                    onProgress,
                  });
                } else if (r.storage_path) {
                  await saveRasterImageOffline({
                    rasterId: r.id,
                    name: r.name,
                    storagePath: r.storage_path,
                    bounds: r.bounds,
                    onProgress,
                  });
                } else {
                  throw new Error('Raster fără URL descărcabil (lipsește storage_path).');
                }
                setOfflinePmtilesById(await buildRasterUrlOverrides());
              }}
              onDeleteOfflinePmtiles={async (r) => {
                await deleteRasterArchive(r.id);
                setOfflinePmtilesById(await buildRasterUrlOverrides());
              }}
              onOfflineRasterSaveComplete={bumpRasterLayerAfterOfflineSave}
              pmtilesMaplibreHint={shouldSuggestPmtilesMaplibreUrlHint()}
              onZoomTo={async (r) => {
                const pmUrl = offlinePmtilesById[r.id] ?? rasterPmtilesHttpUrl(r);
                if (pmUrl && isRasterPmtilesOverlay(r)) {
                  try {
                    const arch = new PMTiles(pmUrl);
                    const h = await arch.getHeader();
                    setFitBounds([
                      [h.minLon, h.minLat],
                      [h.maxLon, h.maxLat],
                    ]);
                    setFlyTo({
                      lng: (h.minLon + h.maxLon) / 2,
                      lat: (h.minLat + h.maxLat) / 2,
                      zoom: h.maxZoom ?? 16,
                    });
                    setRasterVisible((prev) => new Set(prev).add(r.id));
                    setSidebarOpen(false);
                    return;
                  } catch {
                    // fall back to stored bounds if remote header read fails
                  }
                }
                const c = rasterCornersFromBounds(r.bounds);
                if (!c) return;
                setFitBounds([
                  [c.minLon, c.minLat],
                  [c.maxLon, c.maxLat],
                ]);
                setFlyTo({
                  lng: (c.minLon + c.maxLon) / 2,
                  lat: (c.minLat + c.maxLat) / 2,
                  zoom: suggestZoomForBoundsCorners(c),
                });
                setRasterVisible((prev) => new Set(prev).add(r.id));
                setSidebarOpen(false);
              }}
              onChanged={() => void reload()}
            />
          )}

          {activeTab === 'cad' && (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex-1 min-h-0 flex flex-col">
                <CadImportPanel
                  cadImports={cadImports}
                  cadLayers={cadLayers}
                  onRefresh={() => void reload()}
                  onZoomTo={(b) =>
                    setFitBounds([
                      [b.minLon, b.minLat],
                      [b.maxLon, b.maxLat],
                    ])
                  }
                />
              </div>
            </div>
          )}

          {error && (
            <div className="m-3 p-3 rounded-lg bg-red-900/40 border border-red-700 text-red-200 text-xs">
              {error}
            </div>
          )}
          {loading && (
            <div className="p-3 text-center text-slate-500 text-xs">Se incarca...</div>
          )}
        </aside>

        <main className="relative z-0 flex h-full min-h-0 min-w-0 flex-1 pb-[env(safe-area-inset-bottom,0px)]">
          <MapView
            points={points}
            zones={zones}
            tracks={tracks}
            annotations={annotations}
            rasters={rasters}
            rasterState={rasterStateWithPmtiles}
            cadLayers={cadLayers}
            liveTrack={liveTrack}
            drawZoneMode={false}
            onZoneDrawn={() => {}}
            annotationPlacementMode={activeTab === 'points' && annotMode !== 'off' && annotMode !== 'sketch'}
            sketchMode={activeTab === 'points' && annotMode === 'sketch'}
            sketchStrokeColor={annotSketchColor}
            onSketchComplete={handleSketchComplete}
            pointPlacementPickMode={awaitingPointOnMap && activeTab === 'points' && annotMode === 'off'}
            onMapClick={onMapClick}
            onCadLabelTap={handleCadLabelTap}
            onPointClick={(id) => {
              const p = points.find((x) => x.id === id);
              if (p) {
                setFlyTo({ lng: p.lon, lat: p.lat, zoom: 17 });
                setSelectedPoint(p);
              }
            }}
            onBoundsChange={(b) => {
              setCurrentBbox({
                minLon: b.minLon,
                minLat: b.minLat,
                maxLon: b.maxLon,
                maxLat: b.maxLat,
              });
              if (typeof b.zoom === 'number' && Number.isFinite(b.zoom)) {
                setLastMapZoom(b.zoom);
              }
            }}
            viewportBbox={currentBbox}
            viewportZoom={lastMapZoom}
            flyTo={flyTo}
            fitBounds={fitBounds}
            myLocation={myLocation}
            onMyLocation={(lat, lon) => setMyLocation({ lat, lon })}
            onGpsFlyTo={(lng, lat, zoom) => setFlyTo({ lng, lat, zoom: zoom ?? 16 })}
            betweenMapAndControls={
              selectedPoint && !pendingPoint ? (
                <div className="absolute inset-0 z-30 bg-slate-950/60 flex items-end md:items-center justify-center p-0 md:p-6 pointer-events-none">
                  <div className="pointer-events-auto">
                    <PointDetail
                      point={selectedPoint}
                      onClose={() => setSelectedPoint(null)}
                      onChanged={() => void reload()}
                    />
                  </div>
                </div>
              ) : null
            }
          />

          {!isSupabaseConfigured && (
            <div className="absolute top-3 right-3 bg-amber-900/90 border border-amber-700 text-amber-100 rounded-xl p-3 max-w-xs text-xs">
              Supabase nu e configurat. Copiaza .env.example in .env si adauga cheile proiectului.
            </div>
          )}
        </main>

        {pointListEdit && (
          <Modal>
            <h2 className="mb-3 font-semibold">Editează punct</h2>
            <PointEditForm
              point={pointListEdit}
              onSaved={() => {
                setPointListEdit(null);
                void reload();
              }}
              onCancel={() => setPointListEdit(null)}
            />
          </Modal>
        )}

        {pendingPoint && (
          <Modal>
            <h2 className="font-semibold mb-3">Punct nou</h2>
            <PointForm
              initialLat={pendingPoint.lat}
              initialLon={pendingPoint.lon}
              initialElevation={pendingPoint.elevation}
              onGpsLocated={(lat, lon) => {
                setMyLocation({ lat, lon });
                setFlyTo({ lng: lon, lat, zoom: 16 });
              }}
              onCreated={() => {
                setPendingPoint(null);
                setAwaitingPointOnMap(false);
                void reload();
              }}
              onCancel={() => {
                setPendingPoint(null);
                setAwaitingPointOnMap(false);
              }}
            />
          </Modal>
        )}

        {showRasterUpload && (
          <Modal>
            <RasterUploadForm
              defaultBbox={currentBbox}
              onLocalPmtilesReady={async () => {
                setOfflinePmtilesById(await buildRasterUrlOverrides());
              }}
              onCreated={(created) => {
                setShowRasterUpload(false);
                const c = rasterCornersFromBounds(created.bounds);
                if (c) {
                  setFitBounds([
                    [c.minLon, c.minLat],
                    [c.maxLon, c.maxLat],
                  ]);
                  const meta = created.metadata as { maxzoom?: number } | null | undefined;
                  const z =
                    typeof meta?.maxzoom === 'number' && Number.isFinite(meta.maxzoom)
                      ? meta.maxzoom
                      : suggestZoomForBoundsCorners(c);
                  setFlyTo({
                    lng: (c.minLon + c.maxLon) / 2,
                    lat: (c.minLat + c.maxLat) / 2,
                    zoom: z,
                  });
                }
                setRasterVisible((prev) => new Set(prev).add(created.id));
                void reload();
              }}
              onCancel={() => setShowRasterUpload(false)}
            />
          </Modal>
        )}

        {diagOpen && (
          <Modal>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Diagnostice</h2>
              <button
                onClick={() => setDiagOpen(false)}
                className="text-xs px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800"
              >
                Inchide
              </button>
            </div>
            <div className="mt-3 text-xs text-slate-300 space-y-2">
              {diagLoading && <div>Rulez verificari…</div>}
              {diag && (
                <>
                  <button
                    onClick={() => {
                      void (async () => {
                        if (
                          !(await ask(
                            'Reset cache (Service Worker + caches) si reload?\n\nFoloseste asta cand aplicatia pare blocata dupa deploy.',
                          ))
                        )
                          return;
                        try {
                          if ('serviceWorker' in navigator) {
                            const regs = await navigator.serviceWorker.getRegistrations();
                            await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
                          }
                          if ('caches' in window) {
                            const keys = await caches.keys();
                            await Promise.all(keys.map((k) => caches.delete(k)));
                          }
                        } finally {
                          window.location.reload();
                        }
                      })();
                    }}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800"
                  >
                    Reset cache + reload
                  </button>
                  <div className="text-slate-400">{diag.timeISO}</div>
                  <div>
                    <span className="text-slate-400">Renderer:</span> {diag.renderer}
                  </div>
                  <div>
                    <span className="text-slate-400">ServiceWorker:</span>{' '}
                    {diag.serviceWorker.supported ? 'supported' : 'missing'} /{' '}
                    {diag.serviceWorker.controlled ? 'controlled (cache active)' : 'not controlling'}
                  </div>
                  <div className="break-all">
                    <span className="text-slate-400">URL:</span> {diag.url}
                  </div>
                  <div className="mt-2 font-semibold">PMTiles (vizibile)</div>
                  {diag.pmtiles.length === 0 ? (
                    <div className="text-slate-400">
                      Niciun PMTiles activ. Bifeaza un LiDAR si apasa din nou Diag.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {diag.pmtiles.map((p) => (
                        <div key={p.url} className="rounded-lg border border-slate-700 bg-slate-950/40 p-2">
                          <div className="break-all">
                            <span className="text-slate-400">url:</span> {p.url}
                          </div>
                          <div>
                            <span className="text-slate-400">HTTP Range probe:</span>{' '}
                            {p.status ?? 'n/a'}
                            {p.contentRange ? ` (${p.contentRange})` : ''}
                            {p.acceptRanges ? (
                              <span className="text-slate-500"> accept-ranges={p.acceptRanges}</span>
                            ) : null}
                          </div>
                          {p.header && (
                            <div>
                              <span className="text-slate-400">zoom (din arhiva):</span> {p.header.minZoom}..{p.header.maxZoom}{' '}
                              <span className="text-slate-400 ml-2">tileType:</span> {p.header.tileType}
                            </div>
                          )}
                          <div>
                            <span className="text-slate-400">arhiva PMTiles:</span> {p.ok ? 'OK' : 'NU'}
                            {p.error ? <span className="text-red-300 ml-2">{p.error}</span> : null}
                          </div>
                          <div>
                            <span className="text-slate-400">206 + Content-Range vizibil:</span>{' '}
                            {p.byteRangeProbeOk ? 'DA' : 'NU'}
                            {!p.byteRangeProbeOk && p.ok ? (
                              <span className="text-amber-200/90 ml-2">
                                (adesea CORS pe Storage; tile-urile pot merge oricum)
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </Modal>
        )}

        <CadLabelEditSheet
          open={Boolean(cadLabelEdit)}
          cadLayerName={cadLabelEdit?.cadLayerName ?? ''}
          initialText={cadLabelEdit?.initialText ?? ''}
          initialDescription={cadLabelEdit?.initialDescription ?? ''}
          initialPhotoUrl={cadLabelEdit?.initialPhotoUrl ?? null}
          photoUploadAvailable={isSupabaseConfigured}
          saving={cadLabelSaving}
          error={cadLabelErr}
          onClose={closeCadLabelEdit}
          onSave={(p) => void saveCadLabelEdit(p)}
          onDelete={() => void deleteCadLabelEdit()}
        />

      </div>
    </div>
  );
}

function computeBearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 bg-slate-950/80 flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl md:rounded-2xl shadow-2xl p-4 w-full max-w-md max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
