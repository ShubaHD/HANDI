import { useCallback, useEffect, useState } from 'react';
import { PMTiles } from 'pmtiles';
import { MapView } from '@/map/MapView';
import { PointForm } from '@/features/points/PointForm';
import { PointsList } from '@/features/points/PointsList';
import { PointDetail } from '@/features/points/PointDetail';
import { ZoneForm } from '@/features/zones/ZoneForm';
import { ZonesList } from '@/features/zones/ZonesList';
import { TrackRecorderPanel } from '@/features/tracks/TrackRecorderPanel';
import { TracksPanel } from '@/features/tracks/TracksPanel';
import { RastersPanel } from '@/features/rasters/RastersPanel';
import { RasterUploadForm } from '@/features/rasters/RasterUploadForm';
import {
  fetchRasters,
  rasterCornersFromBounds,
  type BBox,
} from '@/features/rasters/api';
import type { PointOfInterest, RasterOverlay, Track, Zone } from '@/lib/types';
import type { RasterLayerState } from '@/map/layers/RasterOverlayLayer';
import { useAuth } from './auth/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase';
import { centroid as turfCentroid } from '@turf/turf';
import {
  fetchPointsCached,
  fetchZonesCached,
  fetchTracksCached,
  fetchAnnotationsCached,
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
import { CadLabelEditSheet } from '@/features/cad/CadLabelEditSheet';
import {
  type CadLabelEditTapPayload,
  cadLabelTextFromProps,
  ensureCadFeatureCollectionIds,
  findCadPointLabelFeatureIndex,
  updateCadPointLabelInCollection,
} from '@/features/cad/cadFeatureIds';
import {
  buildRasterUrlOverrides,
  deleteRasterArchive,
  saveRemoteRasterArchive,
} from '@/lib/pmtiles';
import { type AppDiagnostics, checkPmtilesUrl } from '@/lib/diagnostics';
import type { Annotation, AnnotationSymbol, Visibility } from '@/lib/types';
import { safeCreateAnnotation } from '@/lib/db/safeApi';

interface PendingPoint {
  lat: number;
  lon: number;
  elevation: number | null;
}

type Tab = 'points' | 'zones' | 'tracks' | 'rasters' | 'cad';

export default function FieldPage() {
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
  } | null>(null);
  const [cadLabelSaving, setCadLabelSaving] = useState(false);
  const [cadLabelErr, setCadLabelErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>('points');
  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<PointOfInterest | null>(null);

  const [drawZoneMode, setDrawZoneMode] = useState(false);
  const [pendingZone, setPendingZone] = useState<GeoJSON.Polygon | null>(null);

  const [annotMode, setAnnotMode] = useState<'off' | 'symbol' | 'text' | 'arrow'>('off');
  const [annotVisibility, setAnnotVisibility] = useState<Visibility>('club');
  const [annotSymbol, setAnnotSymbol] = useState<AnnotationSymbol>('dolina');
  const [annotText, setAnnotText] = useState('');
  const [arrowStart, setArrowStart] = useState<{ lon: number; lat: number } | null>(null);
  const [annotOpen, setAnnotOpen] = useState(false);

  const [liveTrack, setLiveTrack] = useState<[number, number][]>([]);

  const [rasterVisible, setRasterVisible] = useState<Set<string>>(new Set());
  const [rasterOpacity, setRasterOpacity] = useState<Record<string, number>>({});
  const [offlinePmtilesById, setOfflinePmtilesById] = useState<Record<string, string>>({});
  const [pmtilesZoomById, setPmtilesZoomById] = useState<Record<string, { minzoom: number; maxzoom: number }>>({});
  const [showRasterUpload, setShowRasterUpload] = useState(false);
  const [currentBbox, setCurrentBbox] = useState<BBox | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number } | null>(null);
  const [fitBounds, setFitBounds] = useState<[[number, number], [number, number]] | null>(null);
  const [syncTick, setSyncTick] = useState(0);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diag, setDiag] = useState<AppDiagnostics | null>(null);

  const rasterStateWithPmtiles: RasterLayerState = {
    visibleIds: rasterVisible,
    opacity: rasterOpacity,
    pmtilesUrlByRasterId: offlinePmtilesById,
    pmtilesZoomByRasterId: pmtilesZoomById,
  };

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [pr, zr, tr, ar, rastersResult, cadImps] = await Promise.all([
        fetchPointsCached(),
        fetchZonesCached(),
        fetchTracksCached(),
        fetchAnnotationsCached(),
        fetchRasters().catch(() => [] as RasterOverlay[]),
        fetchCadImports().catch(() => [] as CadImport[]),
      ]);
      setPoints(pr.data);
      setZones(zr.data);
      setTracks(tr.data);
      setAnnotations(ar.data);
      setRasters(rastersResult);
      setCadImports(cadImps);
      const cadLay =
        cadImps.length > 0
          ? await fetchCadLayers(cadImps.map((i) => i.id)).catch(() => [] as CadLayerRow[])
          : [];
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
    void buildRasterUrlOverrides().then(setOfflinePmtilesById).catch(() => {
      /* ignore */
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
      const idx = findCadPointLabelFeatureIndex(row.features, {
        fid: p.featureFid,
        lon: p.lon,
        lat: p.lat,
        eps: 1e-4,
      });
      if (idx < 0) return;
      const feat = row.features.features[idx];
      const initialText = cadLabelTextFromProps(feat.properties as Record<string, unknown>);
      setCadLabelErr(null);
      setCadLabelEdit({
        layerRowId: p.layerRowId,
        featureIndex: idx,
        cadLayerName: row.cad_layer,
        initialText,
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
    async (text: string) => {
      if (!cadLabelEdit) return;
      const row = cadLayers.find((r) => r.id === cadLabelEdit.layerRowId);
      if (!row) {
        setCadLabelErr('Stratul CAD nu mai este disponibil.');
        return;
      }
      setCadLabelSaving(true);
      setCadLabelErr(null);
      try {
        const patched = updateCadPointLabelInCollection(row.features, cadLabelEdit.featureIndex, text);
        const withIds = ensureCadFeatureCollectionIds(patched);
        await updateCadLayer(row.id, { features: withIds });
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

  const onMapClick = (lng: number, lat: number) => {
    if (drawZoneMode) return;
    if (annotOpen && annotMode !== 'off') {
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
            });
            if (r.ok === 'queued') alert('Adnotare pusa in coada offline.');
            void reload();
            return;
          }

          if (annotMode === 'text') {
            const text = annotText.trim();
            if (!text) {
              alert('Introdu textul in sidebar (tab Zone).');
              return;
            }
            const r = await safeCreateAnnotation({
              kind: 'text',
              text,
              lat,
              lon: lng,
              visibility: annotVisibility,
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
          });
          if (r.ok === 'queued') alert('Adnotare pusa in coada offline.');
          void reload();
        } catch (e) {
          alert(e instanceof Error ? e.message : 'Eroare la adnotare');
        }
      })();
      return;
    }
    // Nu deschidem „Punct nou” la click liber pe hartă — evită conflicte cu CAD / explorare.
    // Adăugarea se face din tab-ul Puncte sau din FAB-ul GPS (+).
  };

  const openAddPointForm = () => {
    if (currentBbox) {
      setPendingPoint({
        lat: (currentBbox.minLat + currentBbox.maxLat) / 2,
        lon: (currentBbox.minLon + currentBbox.maxLon) / 2,
        elevation: null,
      });
    } else {
      setPendingPoint({ lat: 45.9, lon: 22.9, elevation: null });
    }
  };

  const mapCenterForPointForm = (): { lat: number; lon: number } | null => {
    if (!currentBbox) return null;
    return {
      lat: (currentBbox.minLat + currentBbox.maxLat) / 2,
      lon: (currentBbox.minLon + currentBbox.maxLon) / 2,
    };
  };

  const addAtCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation nu este disponibil pe acest device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPendingPoint({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          elevation: pos.coords.altitude,
        });
        setFlyTo({ lng: pos.coords.longitude, lat: pos.coords.latitude, zoom: 16 });
      },
      (e) => alert('Nu pot obtine pozitia: ' + e.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  return (
    <div className="h-screen w-full flex flex-col">
      <header className="flex items-center gap-3 px-3 py-2 bg-slate-950 border-b border-slate-800 z-20">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="md:hidden px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-sm"
        >
          {sidebarOpen ? 'Harta' : 'Lista'}
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center font-bold">
            H
          </div>
          <span className="font-semibold">HANDI</span>
          <span className="text-xs text-slate-500 hidden sm:inline">Speo Field</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => {
              setDiagOpen(true);
              setDiagLoading(true);
              void (async () => {
                try {
                  const qs = new URLSearchParams(window.location.search);
                  const forceLeaflet = Boolean(qs.has('leaflet'));
                  const forceMaplibre = Boolean(qs.has('maplibre'));
                  const renderer: 'maplibre' | 'leaflet' = forceLeaflet || !forceMaplibre ? 'leaflet' : 'maplibre';

                  const pmtilesRasters = rasters
                    .filter((r) => rasterVisible.has(r.id))
                    .map((r) => {
                      const meta = r.metadata as { format?: unknown; pmtiles_url?: unknown } | null | undefined;
                      const url = typeof meta?.pmtiles_url === 'string' ? meta.pmtiles_url : null;
                      return meta?.format === 'pmtiles' && url ? url : null;
                    })
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
            className="text-xs px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800"
            title="Diagnostice (fara DevTools)"
          >
            Diag
          </button>
          <SyncIndicator refreshTick={syncTick} onSynced={() => void reload()} />
          <span className="text-xs text-slate-400 hidden md:inline">{user?.email}</span>
          <button
            onClick={() => signOut()}
            className="text-xs px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800"
          >
            Iesire
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative overflow-hidden">
        <aside
          className={`${
            sidebarOpen ? 'flex' : 'hidden'
          } md:flex flex-col w-full md:w-80 lg:w-96 bg-slate-900 border-r border-slate-800 absolute md:relative inset-0 md:inset-auto z-10`}
        >
          <nav className="flex border-b border-slate-700 bg-slate-950">
            {(['points', 'zones', 'tracks', 'rasters', 'cad'] as Tab[]).map((t) => (
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
                  : t === 'zones'
                    ? `Zone (${zones.length})`
                    : t === 'tracks'
                      ? `Trasee (${tracks.length})`
                      : t === 'rasters'
                        ? `Rasters (${rasters.length})`
                        : `CAD (${cadImports.length})`}
              </button>
            ))}
          </nav>

          {activeTab === 'points' && (
            <PointsList
              points={points}
              onAddPoint={openAddPointForm}
              onSelect={(p) => {
                setFlyTo({ lng: p.lon, lat: p.lat, zoom: 16 });
                setSelectedPoint(p);
                setSidebarOpen(false);
              }}
              onChanged={() => void reload()}
            />
          )}

          {activeTab === 'zones' && (
            <div className="flex flex-col h-full">
              <div className="p-3 border-b border-slate-700">
                <button
                  onClick={() => setDrawZoneMode(true)}
                  disabled={drawZoneMode}
                  className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 text-white font-medium text-sm"
                >
                  {drawZoneMode ? 'Desenare in curs...' : 'Deseneaza zona pe harta'}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ZonesList
                  zones={zones}
                  onSelect={(z) => {
                    const c = turfCentroid({
                      type: 'Feature',
                      geometry: z.geom,
                      properties: {},
                    });
                    if (c.geometry.type === 'Point') {
                      setFlyTo({
                        lng: c.geometry.coordinates[0],
                        lat: c.geometry.coordinates[1],
                        zoom: 14,
                      });
                    }
                    setSidebarOpen(false);
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

                // If user enables a PMTiles raster, force MapLibre renderer (Leaflet cannot render PMTiles).
                try {
                  const r = rasters.find((x) => x.id === id);
                  const meta = r?.metadata as { format?: unknown; pmtiles_url?: unknown } | null | undefined;
                  const enabling = !rasterVisible.has(id);
                  const isPMTiles = meta?.format === 'pmtiles';
                  const qs = new URLSearchParams(window.location.search);
                  if (enabling && isPMTiles && !qs.has('maplibre') && !qs.has('leaflet')) {
                    qs.set('maplibre', '1');
                    const nextUrl = `${window.location.pathname}?${qs.toString()}${window.location.hash ?? ''}`;
                    window.history.replaceState({}, '', nextUrl);
                  }

                  // When enabling, also read PMTiles header to set correct min/max zoom (many archives are z16-only).
                  const pmUrl = typeof meta?.pmtiles_url === 'string' ? meta.pmtiles_url : null;
                  if (enabling && isPMTiles && pmUrl) {
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
                  }
                } catch {
                  /* ignore */
                }
              }}
              onSetOpacity={(id, v) => setRasterOpacity((p) => ({ ...p, [id]: v }))}
              offlinePmtilesById={offlinePmtilesById}
              onSaveOfflinePmtiles={async (r, onProgress) => {
                const meta = r.metadata as { format?: unknown; pmtiles_url?: unknown } | null | undefined;
                if (meta?.format !== 'pmtiles' || typeof meta?.pmtiles_url !== 'string') {
                  throw new Error('Raster-ul nu are pmtiles_url');
                }
                await saveRemoteRasterArchive({
                  rasterId: r.id,
                  name: r.name,
                  url: meta.pmtiles_url,
                  onProgress,
                });
                setOfflinePmtilesById(await buildRasterUrlOverrides());
              }}
              onDeleteOfflinePmtiles={async (r) => {
                await deleteRasterArchive(r.id);
                setOfflinePmtilesById(await buildRasterUrlOverrides());
              }}
              onZoomTo={async (r) => {
                const meta = r.metadata as { format?: unknown; pmtiles_url?: unknown } | null | undefined;
                const pmUrl = typeof meta?.pmtiles_url === 'string' ? meta.pmtiles_url : null;
                const isPMTiles = meta?.format === 'pmtiles' && Boolean(pmUrl);
                if (isPMTiles && pmUrl) {
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

        <main className="flex-1 relative h-full min-h-0">
          <MapView
            points={points}
            zones={zones}
            tracks={tracks}
            annotations={annotations}
            rasters={rasters}
            rasterState={rasterStateWithPmtiles}
            cadLayers={cadLayers}
            liveTrack={liveTrack}
            drawZoneMode={drawZoneMode}
            onZoneDrawn={(poly) => {
              setDrawZoneMode(false);
              setPendingZone(poly);
            }}
            onMapClick={onMapClick}
            onCadLabelTap={handleCadLabelTap}
            onPointClick={(id) => {
              const p = points.find((x) => x.id === id);
              if (p) {
                setFlyTo({ lng: p.lon, lat: p.lat, zoom: 17 });
                setSelectedPoint(p);
              }
            }}
            onBoundsChange={setCurrentBbox}
            flyTo={flyTo}
            fitBounds={fitBounds}
          />

          <div className="absolute bottom-6 left-3 z-20 pointer-events-auto">
            <button
              onClick={() => {
                setAnnotOpen((v) => {
                  const next = !v;
                  if (!next) {
                    setAnnotMode('off');
                    setArrowStart(null);
                  } else {
                    if (annotMode === 'off') setAnnotMode('symbol');
                  }
                  return next;
                });
              }}
              className={`w-14 h-14 rounded-full shadow-xl border flex items-center justify-center font-bold ${
                annotOpen ? 'bg-brand-600 border-brand-500 text-white' : 'bg-slate-900/95 border-slate-700 text-slate-200'
              }`}
              title="Adnotari (simbol/text/sageata)"
            >
              A
            </button>

            {annotOpen && (
              <div className="mt-2 w-72 rounded-2xl border border-slate-700 bg-slate-950/95 backdrop-blur p-3 shadow-2xl">
                <div className="text-xs text-slate-400 mb-2">Adnotari</div>
                <div className="flex gap-2 mb-2">
                  {(['symbol', 'text', 'arrow'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setAnnotMode(m);
                        setArrowStart(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg border text-xs ${
                        annotMode === m
                          ? 'border-brand-500 bg-brand-600/20 text-white'
                          : 'border-slate-700 text-slate-300 hover:bg-slate-800/40'
                      }`}
                      title="Selecteaza modul"
                    >
                      {m === 'symbol' ? 'Simbol' : m === 'text' ? 'Text' : arrowStart ? 'Sageata: 2/2' : 'Sageata'}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-xs mb-2">
                  <span className="text-slate-400">Viz:</span>
                  <button
                    onClick={() => setAnnotVisibility((v) => (v === 'club' ? 'private' : 'club'))}
                    className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800/40"
                    title="Vizibilitate"
                  >
                    {annotVisibility === 'club' ? 'Club' : 'Privat'}
                  </button>
                  <span className="text-slate-500 ml-auto">Click pe hartă pentru plasare</span>
                </div>

                {annotMode === 'symbol' && (
                  <select
                    value={annotSymbol}
                    onChange={(e) => setAnnotSymbol(e.target.value as AnnotationSymbol)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-sm"
                    title="Alege simbolul, apoi click pe harta"
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
                  <input
                    value={annotText}
                    onChange={(e) => setAnnotText(e.target.value)}
                    placeholder="Text (ex: Nume deal, rau...)"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-sm"
                  />
                )}

                {annotMode === 'arrow' && (
                  <div className="text-xs text-slate-400">
                    Click pe hartă pentru start, apoi click pentru capăt.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FAB explicit GPS: nu echivalează cu click pe hartă (evită deschiderea accidentală la explorare). */}
          {!drawZoneMode && (
            <button
              onClick={addAtCurrentLocation}
              className="absolute bottom-6 right-3 z-10 bg-brand-600 hover:bg-brand-700 rounded-full w-14 h-14 shadow-xl text-2xl font-bold flex items-center justify-center"
              title="Adauga punct la pozitia mea (GPS)"
            >
              +
            </button>
          )}

          {drawZoneMode && (
            <button
              onClick={() => setDrawZoneMode(false)}
              className="absolute bottom-6 right-3 z-10 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-xl px-4 py-2 shadow-xl text-sm"
            >
              Anuleaza desenarea
            </button>
          )}

          {!isSupabaseConfigured && (
            <div className="absolute top-3 right-3 bg-amber-900/90 border border-amber-700 text-amber-100 rounded-xl p-3 max-w-xs text-xs">
              Supabase nu e configurat. Copiaza .env.example in .env si adauga cheile proiectului.
            </div>
          )}
        </main>

        {pendingPoint && (
          <Modal>
            <h2 className="font-semibold mb-3">Punct nou</h2>
            <PointForm
              initialLat={pendingPoint.lat}
              initialLon={pendingPoint.lon}
              initialElevation={pendingPoint.elevation}
              getMapCenter={mapCenterForPointForm}
              onCreated={() => {
                setPendingPoint(null);
                void reload();
              }}
              onCancel={() => setPendingPoint(null)}
            />
          </Modal>
        )}

        {pendingZone && (
          <Modal>
            <ZoneForm
              geom={pendingZone}
              onCreated={() => {
                setPendingZone(null);
                void reload();
              }}
              onCancel={() => setPendingZone(null)}
            />
          </Modal>
        )}

        {showRasterUpload && (
          <Modal>
            <RasterUploadForm
              defaultBbox={currentBbox}
              onCreated={() => {
                setShowRasterUpload(false);
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
                      const ok = confirm(
                        'Reset cache (Service Worker + caches) si reload?\\n\\nFoloseste asta cand aplicatia pare blocata dupa deploy.',
                      );
                      if (!ok) return;
                      void (async () => {
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
                            <span className="text-slate-400">range:</span>{' '}
                            {p.status ?? 'n/a'} {p.contentRange ? `(${p.contentRange})` : ''}
                          </div>
                          {p.header && (
                            <div>
                              <span className="text-slate-400">zoom:</span> {p.header.minZoom}..{p.header.maxZoom}{' '}
                              <span className="text-slate-400 ml-2">tileType:</span> {p.header.tileType}
                            </div>
                          )}
                          <div>
                            <span className="text-slate-400">ok:</span> {p.ok ? 'YES' : 'NO'}
                            {p.error ? <span className="text-red-300 ml-2">{p.error}</span> : null}
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
          saving={cadLabelSaving}
          error={cadLabelErr}
          onClose={closeCadLabelEdit}
          onSave={(text) => void saveCadLabelEdit(text)}
        />

        {selectedPoint && !pendingPoint && (
          <div className="absolute inset-0 z-30 bg-slate-950/60 flex items-end md:items-center justify-center p-0 md:p-6 pointer-events-none">
            <div className="pointer-events-auto">
              <PointDetail
                point={selectedPoint}
                onClose={() => setSelectedPoint(null)}
                onChanged={() => void reload()}
              />
            </div>
          </div>
        )}
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
