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
} from '@/lib/db/cache';
import { startBackgroundSync } from '@/lib/db/syncQueue';
import { SyncIndicator } from './SyncIndicator';
import { CadImportPanel } from '@/features/cad/CadImportPanel';
import { fetchCadImports, fetchCadLayers, type CadImport, type CadLayerRow } from '@/features/cad/api';
import {
  buildRasterUrlOverrides,
  deleteRasterArchive,
  saveRemoteRasterArchive,
} from '@/lib/pmtiles';

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
  const [rasters, setRasters] = useState<RasterOverlay[]>([]);
  const [cadImports, setCadImports] = useState<CadImport[]>([]);
  const [cadLayers, setCadLayers] = useState<CadLayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>('points');
  const [pendingPoint, setPendingPoint] = useState<PendingPoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<PointOfInterest | null>(null);

  const [drawZoneMode, setDrawZoneMode] = useState(false);
  const [pendingZone, setPendingZone] = useState<GeoJSON.Polygon | null>(null);

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
      const [pr, zr, tr, rastersResult, cadImps] = await Promise.all([
        fetchPointsCached(),
        fetchZonesCached(),
        fetchTracksCached(),
        fetchRasters().catch(() => [] as RasterOverlay[]),
        fetchCadImports().catch(() => [] as CadImport[]),
      ]);
      setPoints(pr.data);
      setZones(zr.data);
      setTracks(tr.data);
      setRasters(rastersResult);
      setCadImports(cadImps);
      const cadLay =
        cadImps.length > 0
          ? await fetchCadLayers(cadImps.map((i) => i.id)).catch(() => [] as CadLayerRow[])
          : [];
      setCadLayers(cadLay);
      const errs = [pr, zr, tr]
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

  const onMapClick = (lng: number, lat: number) => {
    if (drawZoneMode) return;
    setPendingPoint({ lat, lon: lng, elevation: null });
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

          {!drawZoneMode && (
            <button
              onClick={addAtCurrentLocation}
              className="absolute bottom-6 right-3 z-10 bg-brand-600 hover:bg-brand-700 rounded-full w-14 h-14 shadow-xl text-2xl font-bold flex items-center justify-center"
              title="Adauga punct la pozitia mea"
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

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 bg-slate-950/80 flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl md:rounded-2xl shadow-2xl p-4 w-full max-w-md max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
