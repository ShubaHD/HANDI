import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MlMap, NavigationControl, ScaleControl } from 'maplibre-gl';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { ensurePMTilesProtocol } from '@/lib/pmtiles';
import { buildBaseStyle, getBaseMapById, getDefaultBaseMap, type BaseMapDef } from './layers/BaseLayers';
import { LeafletView } from './LeafletView';

ensurePMTilesProtocol();
import {
  addHillshadeOverlay,
  setHillshadeOpacity,
  setHillshadeVisible,
} from './layers/HillshadeOverlay';
import { addPointsLayer, POINTS_LAYER_ID, updatePointsLayer } from './layers/PointsLayer';
import { addZonesLayer, updateZonesLayer, ZONES_LAYER_ID } from './layers/ZonesLayer';
import { addTracksLayer, updateLiveTrack, updateTracksLayer } from './layers/TracksLayer';
import { syncRasterLayers, type RasterLayerState } from './layers/RasterOverlayLayer';
import { updateCadLayersOnMap } from './layers/CadLayersRenderer';
import type { CadLayerRow } from '@/features/cad/api';
import { BaseMapSwitcher } from './controls/BaseMapSwitcher';
import type { PointOfInterest, RasterOverlay, Track, Zone } from '@/lib/types';

interface Props {
  points: PointOfInterest[];
  zones: Zone[];
  tracks: Track[];
  rasters: RasterOverlay[];
  rasterState: RasterLayerState;
  cadLayers: CadLayerRow[];
  liveTrack: [number, number][];
  drawZoneMode: boolean;
  onZoneDrawn: (polygon: GeoJSON.Polygon) => void;
  onMapClick?: (lng: number, lat: number) => void;
  onPointClick?: (id: string) => void;
  onZoneClick?: (id: string) => void;
  onBoundsChange?: (b: { minLon: number; minLat: number; maxLon: number; maxLat: number }) => void;
  flyTo?: { lng: number; lat: number; zoom?: number } | null;
  fitBounds?: [[number, number], [number, number]] | null;
}

export interface ViewportState {
  lng: number;
  lat: number;
  zoom: number;
}

const ROMANIA_CENTER: ViewportState = { lng: 22.9, lat: 45.9, zoom: 6 };
const BASEMAP_KEY = 'handi-basemap';

export function MapView({
  points,
  zones,
  tracks,
  rasters,
  rasterState,
  cadLayers,
  liveTrack,
  drawZoneMode,
  onZoneDrawn,
  onMapClick,
  onPointClick,
  onZoneClick,
  onBoundsChange,
  flyTo,
  fitBounds,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [hud, setHud] = useState<{ lng: number; lat: number; zoom: number } | null>(null);
  const [base, setBase] = useState<BaseMapDef>(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.has('debugMap')) {
        // In debug mode, force a known-good basemap to avoid misleading cached selection.
        return getBaseMapById('maplibre-demo') ?? getDefaultBaseMap();
      }
      const saved = localStorage.getItem(BASEMAP_KEY);
      return getBaseMapById(saved) ?? getDefaultBaseMap();
    } catch {
      return getDefaultBaseMap();
    }
  });
  const [hillshadeOn, setHillshadeOn] = useState(false);
  const [hillshadeStrength, setHillshadeStrength] = useState(0.6);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [locating, setLocating] = useState(false);
  const [mapDebug, setMapDebug] = useState<{ msg: string } | null>(null);
  const [mapDebugDetails, setMapDebugDetails] = useState<{ lines: string[] } | null>(null);
  const renderTicksRef = useRef(0);

  // Persist basemap selection for both Leaflet and MapLibre modes
  useEffect(() => {
    try {
      localStorage.setItem(BASEMAP_KEY, base.id);
    } catch {
      /* ignore */
    }
  }, [base.id]);

  const handlersRef = useRef({
    onMapClick,
    onPointClick,
    onZoneClick,
    onZoneDrawn,
    onBoundsChange,
  });
  handlersRef.current = {
    onMapClick,
    onPointClick,
    onZoneClick,
    onZoneDrawn,
    onBoundsChange,
  };

  const installLayers = (map: MlMap) => {
    addHillshadeOverlay(map);
    setHillshadeVisible(map, hillshadeOn);
    setHillshadeOpacity(map, hillshadeStrength);
    addZonesLayer(map);
    addTracksLayer(map);
    addPointsLayer(map);
    updatePointsLayer(map, points);
    updateZonesLayer(map, zones);
    updateTracksLayer(map, tracks);
    updateLiveTrack(map, liveTrack);
    syncRasterLayers(map, rasters, rasterState);
    updateCadLayersOnMap(map, cadLayers);
  };

  const ensureInputsEnabled = (map: MlMap) => {
    try {
      map.scrollZoom.enable();
      map.dragPan.enable();
      map.dragRotate.enable();
      map.doubleClickZoom.enable();
      map.keyboard.enable();
      map.boxZoom.enable();
      map.touchZoomRotate.enable();
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const last = readLastViewport();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: base.styleUrl ?? buildBaseStyle(base),
      center: [last.lng, last.lat],
      zoom: last.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    const safeResize = () => {
      try {
        map.resize();
      } catch {
        /* ignore */
      }
    };

    // Keep MapLibre canvas in sync with container sizing.
    // This prevents "blank map" and lost pan/zoom after layout changes (sidebar/devtools/PWA).
    const el = containerRef.current;
    let raf = 0;
    const scheduleResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        safeResize();
        updateDebugDetails();
      });
    };
    try {
      const ro = new ResizeObserver(() => scheduleResize());
      ro.observe(el);
      resizeObserverRef.current = ro;
    } catch {
      // ResizeObserver may be unavailable in some browsers; fall back to window resize only.
    }

    let gotIdle = false;
    const debugTimer = window.setTimeout(() => {
      if (gotIdle) return;
      const canvas = map.getCanvas();
      setMapDebug({
        msg: `Basemap nu a randat (idle) in timp util. Canvas ${canvas?.width ?? 0}x${canvas?.height ?? 0}. Verifica WebGL / CORS in Console.`,
      });
    }, 3500);

    const debugEnabled =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('debugMap');

    const updateDebugDetails = () => {
      if (!debugEnabled) return;
      const canvas = map.getCanvas();
      const gl =
        (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
        (canvas.getContext('webgl') as WebGLRenderingContext | null);
      const lost = gl ? (gl as WebGLRenderingContext).isContextLost() : null;
      const rect = canvas.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      const rootEl = document.getElementById('root');
      const rootRect = rootEl?.getBoundingClientRect();
      const bodyRect = document.body?.getBoundingClientRect();
      const htmlRect = document.documentElement?.getBoundingClientRect();
      const containerIsMaplibre =
        containerRef.current?.classList?.contains('maplibregl-map') ?? false;
      const mapRect = containerIsMaplibre
        ? containerRef.current?.getBoundingClientRect()
        : null;
      const cs = window.getComputedStyle(canvas);
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      const topEl = document.elementFromPoint(cx, cy);
      const topElDesc = topEl
        ? `${topEl.tagName.toLowerCase()}${topEl.id ? `#${topEl.id}` : ''}${
            (topEl as HTMLElement).className ? `.${String((topEl as HTMLElement).className).split(/\s+/).slice(0, 2).join('.')}` : ''
          }`
        : 'n/a';
      let renderer = 'n/a';
      try {
        if (gl) {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info') as
            | { UNMASKED_RENDERER_WEBGL: number; UNMASKED_VENDOR_WEBGL: number }
            | null;
          if (dbg) {
            const v = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string;
            const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
            renderer = `${v} / ${r}`;
          } else {
            renderer = String(gl.getParameter(gl.RENDERER));
          }
        }
      } catch {
        /* ignore */
      }
      const layersCount = map.getStyle()?.layers?.length ?? 0;
      const sourcesCount = Object.keys(map.getStyle()?.sources ?? {}).length;
      setMapDebugDetails({
        lines: [
          `debugMap=1`,
          `canvas attr: ${canvas.width}x${canvas.height}`,
          `canvas rect: ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          `container rect: ${containerRect ? `${Math.round(containerRect.width)}x${Math.round(containerRect.height)}` : 'n/a'}`,
          `root rect: ${rootRect ? `${Math.round(rootRect.width)}x${Math.round(rootRect.height)}` : 'n/a'}`,
          `body rect: ${bodyRect ? `${Math.round(bodyRect.width)}x${Math.round(bodyRect.height)}` : 'n/a'}`,
          `html rect: ${htmlRect ? `${Math.round(htmlRect.width)}x${Math.round(htmlRect.height)}` : 'n/a'}`,
          `container has .maplibregl-map: ${containerIsMaplibre ? 'yes' : 'no'}`,
          `maplibre rect: ${mapRect ? `${Math.round(mapRect.width)}x${Math.round(mapRect.height)}` : 'n/a'}`,
          `canvas css: display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity}`,
          `elementFromPoint(center): ${topElDesc}`,
          `webgl: ${gl ? 'ok' : 'MISSING'} contextLost=${lost}`,
          `renderer: ${renderer}`,
          `renders: ${renderTicksRef.current}`,
          `style: layers=${layersCount} sources=${sourcesCount}`,
          `base source: ${map.getSource('base') ? 'yes' : 'no'}`,
        ],
      });
    };

    map.on('error', (e) => {
      // Surface MapLibre issues in production where basemap looks blank.
      console.error('[map] error', e?.error ?? e);
      const err = (e as unknown as { error?: { message?: string } }).error?.message;
      if (err) setMapDebug({ msg: `Map error: ${err}` });
    });

    map.on('idle', () => {
      gotIdle = true;
      window.clearTimeout(debugTimer);
      setMapDebug(null);
      updateDebugDetails();
    });

    if (debugEnabled) {
      map.on('render', () => {
        if (renderTicksRef.current < 1_000_000) renderTicksRef.current += 1;
      });
    }

    map.on('load', () => {
      ensureInputsEnabled(map);
      installLayers(map);
      // Some browsers / PWA + sidebar layouts can initialize with a wrong canvas size.
      // Force a few resizes to ensure the raster base renders.
      safeResize();
      requestAnimationFrame(safeResize);
      setTimeout(safeResize, 250);
      setTimeout(safeResize, 1200);
      setTimeout(updateDebugDetails, 1500);
    });

    const onWinResize = () => safeResize();
    window.addEventListener('resize', onWinResize);

    map.on('moveend', () => {
      const c = map.getCenter();
      writeLastViewport({ lng: c.lng, lat: c.lat, zoom: map.getZoom() });
      const b = map.getBounds();
      handlersRef.current.onBoundsChange?.({
        minLon: b.getWest(),
        minLat: b.getSouth(),
        maxLon: b.getEast(),
        maxLat: b.getNorth(),
      });
    });

    if (debugEnabled) {
      map.on('move', () => {
        const c = map.getCenter();
        setHud({ lng: c.lng, lat: c.lat, zoom: map.getZoom() });
      });
      // initialize HUD quickly
      const c0 = map.getCenter();
      setHud({ lng: c0.lng, lat: c0.lat, zoom: map.getZoom() });
    }

    map.on('click', (e) => {
      if (drawRef.current?.enabled) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: [POINTS_LAYER_ID, ZONES_LAYER_ID],
      });
      if (features.length > 0) {
        const f = features[0];
        const id = f.properties?.id as string | undefined;
        if (!id) return;
        if (f.layer.id === POINTS_LAYER_ID) {
          handlersRef.current.onPointClick?.(id);
        } else if (f.layer.id === ZONES_LAYER_ID) {
          handlersRef.current.onZoneClick?.(id);
        }
        return;
      }
      handlersRef.current.onMapClick?.(e.lngLat.lng, e.lngLat.lat);
    });

    map.on('mouseenter', POINTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', POINTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', ZONES_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', ZONES_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });

    mapRef.current = map;
    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      window.removeEventListener('resize', onWinResize);
      window.clearTimeout(debugTimer);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(base.styleUrl ?? buildBaseStyle(base));
    map.once('styledata', () => {
      ensureInputsEnabled(map);
      installLayers(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setHillshadeVisible(map, hillshadeOn);
  }, [hillshadeOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setHillshadeOpacity(map, hillshadeStrength);
  }, [hillshadeStrength]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) updatePointsLayer(map, points);
    else map.once('idle', () => updatePointsLayer(map, points));
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) updateZonesLayer(map, zones);
    else map.once('idle', () => updateZonesLayer(map, zones));
  }, [zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) updateTracksLayer(map, tracks);
    else map.once('idle', () => updateTracksLayer(map, tracks));
  }, [tracks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateLiveTrack(map, liveTrack);
  }, [liveTrack]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) syncRasterLayers(map, rasters, rasterState);
    else map.once('idle', () => syncRasterLayers(map, rasters, rasterState));
  }, [rasters, rasterState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) updateCadLayersOnMap(map, cadLayers);
    else map.once('idle', () => updateCadLayersOnMap(map, cadLayers));
  }, [cadLayers]);

  useEffect(() => {
    if (!flyTo) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom ?? 16, duration: 1200 });
  }, [flyTo]);

  useEffect(() => {
    if (!fitBounds) return;
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(fitBounds, { padding: 60, duration: 1200 });
  }, [fitBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawZoneMode) {
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            styles: {
              fillColor: '#22c55e',
              fillOpacity: 0.25,
              outlineColor: '#16a34a',
              outlineWidth: 2,
              closingPointColor: '#22c55e',
            },
          }),
        ],
      });
      draw.start();
      draw.setMode('polygon');
      draw.on('finish', (id) => {
        const snapshot = draw.getSnapshot();
        const feat = snapshot.find((f) => f.id === id);
        if (feat && feat.geometry.type === 'Polygon') {
          handlersRef.current.onZoneDrawn(feat.geometry);
        }
      });
      drawRef.current = draw;
      return () => {
        draw.stop();
        drawRef.current = null;
      };
    }
  }, [drawZoneMode]);

  const locateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 16,
          duration: 1500,
        });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  // Default renderer: Leaflet (most compatible).
  // Use MapLibre explicitly via ?maplibre=1 (needed for PMTiles raster overlays).
  // Force Leaflet via ?leaflet=1.
  const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const forceLeaflet = Boolean(qs?.has('leaflet'));
  const forceMaplibre = Boolean(qs?.has('maplibre'));
  const useLeaflet = forceLeaflet || !forceMaplibre;

  if (useLeaflet) {
    return (
      <div className="relative h-full w-full min-h-0">
        <div className="absolute inset-0 z-0">
          <LeafletView
            base={base}
            points={points}
            zones={zones}
            tracks={tracks}
            cadLayers={cadLayers}
            onMapClick={onMapClick}
            onBoundsChange={onBoundsChange}
            flyTo={flyTo}
            fitBounds={fitBounds}
          />
        </div>

        <div className="absolute top-3 left-3 z-50 flex flex-col gap-2 pointer-events-auto">
          <button
            onClick={() => setShowSwitcher((v) => !v)}
            className="bg-slate-950/95 backdrop-blur border border-slate-600 rounded-xl shadow-2xl px-3 py-2 text-sm font-semibold hover:bg-slate-800"
            title="Schimba harta"
          >
            {base.label}
          </button>
          {showSwitcher && (
            <BaseMapSwitcher
              current={base.id}
              onChange={(b) => {
                setBase(b);
                setShowSwitcher(false);
              }}
              hillshadeOn={hillshadeOn}
              onToggleHillshade={setHillshadeOn}
              hillshadeStrength={hillshadeStrength}
              onChangeHillshadeStrength={setHillshadeStrength}
            />
          )}
        </div>

        <button
          onClick={locateMe}
          disabled={locating}
          className="absolute bottom-24 right-3 z-50 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-full w-12 h-12 shadow-xl hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center text-xs font-bold pointer-events-auto"
          title="Pozitia mea"
        >
          {locating ? '...' : 'GPS'}
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full min-h-0">
      <div ref={containerRef} className="absolute inset-0" />

      {mapDebug && (
        <div className="absolute top-3 right-3 z-20 bg-red-900/80 border border-red-700 text-red-100 rounded-xl p-3 max-w-sm text-xs">
          {mapDebug.msg}
        </div>
      )}
      {mapDebugDetails && (
        <div className="absolute bottom-3 left-3 z-20 bg-slate-950/80 border border-slate-700 text-slate-100 rounded-xl p-3 max-w-sm text-[11px] leading-snug space-y-1">
          {mapDebugDetails.lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}
      {hud && (
        <div className="absolute bottom-3 right-3 z-20 bg-slate-950/70 border border-slate-700 text-slate-100 rounded-xl px-3 py-2 text-[11px] font-mono">
          z={hud.zoom.toFixed(2)} lng={hud.lng.toFixed(5)} lat={hud.lat.toFixed(5)}
        </div>
      )}

      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        <button
          onClick={() => setShowSwitcher((v) => !v)}
          className="bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl shadow-xl px-3 py-2 text-sm font-medium hover:bg-slate-800"
          title="Schimba harta"
        >
          {base.label}
        </button>
        {showSwitcher && (
          <BaseMapSwitcher
            current={base.id}
            onChange={(b) => {
              setBase(b);
              setShowSwitcher(false);
            }}
            hillshadeOn={hillshadeOn}
            onToggleHillshade={setHillshadeOn}
            hillshadeStrength={hillshadeStrength}
            onChangeHillshadeStrength={setHillshadeStrength}
          />
        )}
      </div>

      {drawZoneMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-xl">
          Apasa pe harta ca sa adaugi varfuri. Dublu-click pentru finalizare.
        </div>
      )}

      <button
        onClick={locateMe}
        disabled={locating}
        className="absolute bottom-24 right-3 z-10 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-full w-12 h-12 shadow-xl hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center text-xs font-bold"
        title="Pozitia mea"
      >
        {locating ? '...' : 'GPS'}
      </button>
    </div>
  );
}

const VIEWPORT_KEY = 'handi-viewport';

function readLastViewport(): ViewportState {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY);
    if (!raw) return ROMANIA_CENTER;
    const v = JSON.parse(raw) as ViewportState;
    if (typeof v.lng !== 'number' || typeof v.lat !== 'number' || typeof v.zoom !== 'number') {
      return ROMANIA_CENTER;
    }
    return v;
  } catch {
    return ROMANIA_CENTER;
  }
}

function writeLastViewport(v: ViewportState) {
  try {
    localStorage.setItem(VIEWPORT_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
