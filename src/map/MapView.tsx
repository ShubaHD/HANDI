import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibregl, { Map as MlMap, NavigationControl, ScaleControl } from 'maplibre-gl';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { cadLabelLockedFromStyle } from '@/features/cad/cadLayerLabelStyle';
import { buildBaseMapsFromArchives, ensurePMTilesProtocol } from '@/lib/pmtiles';
import { ensureMBTilesProtocol } from '@/lib/mbtiles/mbtilesProtocol';
import { mapAcceptsOverlayLayers } from '@/map/mapOverlayReadiness';
import {
  buildBaseStyle,
  getBaseMapById,
  getDefaultBaseMap,
  isOfflineRasterBasemapBase,
  type BaseMapDef,
} from './layers/BaseLayers';
import { LeafletView } from './LeafletView';

import {
  addHillshadeOverlay,
  setHillshadeOpacity,
  setHillshadeVisible,
} from './layers/HillshadeOverlay';
import { addPointsLayer, POINTS_LAYER_ID, updatePointsLayer } from './layers/PointsLayer';
import { addZonesLayer, updateZonesLayer, ZONES_LAYER_ID } from './layers/ZonesLayer';
import { addTracksLayer, updateLiveTrack, updateTracksLayer } from './layers/TracksLayer';
import { syncRasterLayers, type RasterLayerState } from './layers/RasterOverlayLayer';
import {
  cadLayerRowIdFromSymbolLayerId,
  getCadLayerPrefix,
  updateCadLayersOnMap,
} from './layers/CadLayersRenderer';
import {
  CAD_FEATURE_ID_KEY,
  cadLabelTextFromProps,
  type CadLabelEditTapPayload,
} from '@/features/cad/cadFeatureIds';
import { isJunkCadPlaceholderLabel } from '@/features/cad/cadMapLabels';
import { addAnnotationsLayer, updateAnnotationsLayer } from './layers/AnnotationsLayer';
import type { CadLayerRow } from '@/features/cad/api';
import { BaseMapSwitcher } from './controls/BaseMapSwitcher';
import type { Annotation, PointOfInterest, RasterOverlay, Track, Zone } from '@/lib/types';
import {
  MapHoverTooltip,
  type HoverTooltipData,
  asText,
  subtitleFromLayer,
  titleFromProps,
} from './MapHoverTooltip';

ensurePMTilesProtocol();
ensureMBTilesProtocol();

/** fitBounds poate coborî zoom-ul sub minzoom-ul arhivei offline raster → raster negru. */
function clampZoomForPmtilesBasemap(map: MlMap, base: BaseMapDef) {
  if (!isOfflineRasterBasemapBase(base)) return;
  const minZ =
    typeof base.pmtilesMinZoom === 'number' && Number.isFinite(base.pmtilesMinZoom)
      ? base.pmtilesMinZoom
      : 0;
  const maxZ =
    typeof base.maxzoom === 'number' && Number.isFinite(base.maxzoom) ? base.maxzoom : 24;
  if (minZ <= 0 && maxZ >= 24) return;
  const z = map.getZoom();
  const next = Math.min(maxZ, Math.max(minZ, z));
  if (Math.abs(next - z) > 1e-4) {
    map.setZoom(next, { duration: 0 });
  }
}

function scheduleClampZoomAfterPmtilesFit(map: MlMap, base: BaseMapDef) {
  const run = () => clampZoomForPmtilesBasemap(map, base);
  map.once('moveend', run);
  window.setTimeout(run, 750);
}

interface Props {
  points: PointOfInterest[];
  zones: Zone[];
  tracks: Track[];
  annotations: Annotation[];
  rasters: RasterOverlay[];
  rasterState: RasterLayerState;
  cadLayers: CadLayerRow[];
  liveTrack: [number, number][];
  drawZoneMode: boolean;
  onZoneDrawn: (polygon: GeoJSON.Polygon) => void;
  /** Când e activ (ex. panoul A), click-ul pe hartă merge la onMapClick chiar dacă există CAD / punct / zonă sub cursor. */
  annotationPlacementMode?: boolean;
  /** Când e activ, click-ul (inclusiv peste puncte/zone) plasează poziția pentru punct nou. */
  pointPlacementPickMode?: boolean;
  /** Mod creion: traseu liber pe hartă → salvat ca adnotare `sketch`. */
  sketchMode?: boolean;
  sketchStrokeColor?: string;
  onSketchComplete?: (line: GeoJSON.LineString) => void;
  onMapClick?: (lng: number, lat: number) => void;
  onPointClick?: (id: string) => void;
  onZoneClick?: (id: string) => void;
  /** Tap / click on a CAD text label (MapLibre: symbol layer). */
  onCadLabelTap?: (payload: CadLabelEditTapPayload) => void;
  onBoundsChange?: (b: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
    zoom?: number;
  }) => void;
  /** Pentru pachet offline: ultimul bbox + zoom de pe hartă. */
  viewportBbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null;
  viewportZoom?: number;
  flyTo?: { lng: number; lat: number; zoom?: number } | null;
  fitBounds?: [[number, number], [number, number]] | null;
  /** Marcaj al ultimei poziții GPS pe hartă. */
  myLocation?: { lat: number; lon: number } | null;
  /** Apelat când utilizatorul apasă GPS pe hartă (în plus față de actualizarea marcajului din `myLocation`). */
  onMyLocation?: (lat: number, lon: number) => void;
  /** Pe Leaflet, harta MapLibre nu există — folosește `flyTo` din părinte ca să zbori la coordonatele GPS. */
  onGpsFlyTo?: (lng: number, lat: number, zoom?: number) => void;
  /**
   * Randat deasupra tile-urilor hărții, dar sub basemap / GPS / zoom (ex. fundal semi-transparent pentru detaliu punct).
   * Fără asta, un overlay ca frate al lui `main` acoperă tot MapView, inclusiv selectorul de basemap.
   */
  betweenMapAndControls?: ReactNode;
}

export interface ViewportState {
  lng: number;
  lat: number;
  zoom: number;
}

const ROMANIA_CENTER: ViewportState = { lng: 22.9, lat: 45.9, zoom: 6 };
const BASEMAP_KEY = 'handi-basemap';
const BASEMAP_OVERLAY_KEY = 'handi-basemap-overlay-id';
const BASEMAP_OVERLAY_OPACITY_KEY = 'handi-basemap-overlay-opacity';

export function MapView({
  points,
  zones,
  tracks,
  annotations,
  rasters,
  rasterState,
  cadLayers,
  liveTrack,
  drawZoneMode,
  onZoneDrawn,
  annotationPlacementMode = false,
  pointPlacementPickMode = false,
  sketchMode = false,
  sketchStrokeColor = '#f97316',
  onSketchComplete,
  onMapClick,
  onPointClick,
  onZoneClick,
  onCadLabelTap,
  onBoundsChange,
  viewportBbox = null,
  viewportZoom,
  flyTo,
  fitBounds,
  myLocation = null,
  onMyLocation,
  onGpsFlyTo,
  betweenMapAndControls,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
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
  /** False cât timp LS are `pmtiles-*` dar încă nu am încărcat arhiva din Dexie (altfel pornim cu maplibre-demo + demotiles). */
  const [basemapReady, setBasemapReady] = useState(() => {
    try {
      if (typeof window === 'undefined') return true;
      if (new URLSearchParams(window.location.search).has('debugMap')) return true;
      const s = localStorage.getItem(BASEMAP_KEY);
      return !s?.startsWith('pmtiles-');
    } catch {
      return true;
    }
  });
  /** PMTiles local peste basemap online (MapLibre). */
  const [basemapOverlay, setBasemapOverlay] = useState<BaseMapDef | null>(null);
  const [basemapOverlayOpacity, setBasemapOverlayOpacity] = useState(0.85);
  const [hillshadeOn, setHillshadeOn] = useState(false);
  const [hillshadeStrength, setHillshadeStrength] = useState(0.6);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [locating, setLocating] = useState(false);
  const [mapDebug, setMapDebug] = useState<{ msg: string } | null>(null);
  const [mapDebugDetails, setMapDebugDetails] = useState<{ lines: string[] } | null>(null);
  const renderTicksRef = useRef(0);
  const hoverTimerRef = useRef<number | null>(null);
  const lastHoverKeyRef = useRef<string>('');
  const [hover, setHover] = useState<{ x: number; y: number; data: HoverTooltipData } | null>(null);

  const maplibreQs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const forceLeaflet = Boolean(maplibreQs?.has('leaflet'));
  const forceMaplibre = Boolean(maplibreQs?.has('maplibre'));
  const basemapNeedsMapLibre =
    !basemapReady || isOfflineRasterBasemapBase(base);
  /** Leaflet implicit (basemap online fiabil). MapLibre: ?maplibre=1 sau basemap PMTiles offline. */
  const useLeaflet = !basemapNeedsMapLibre && (forceLeaflet || !forceMaplibre);

  const clearHover = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    lastHoverKeyRef.current = '';
    setHover(null);
  };

  /** După încercarea de rehidrat basemap PMTiles din Dexie (evită să rescriem LS cu „default” înainte de rehidrate). */
  const basemapLsHydrateDoneRef = useRef(false);
  /** Evită `setStyle` imediat după `new Map(...)` cu același basemap — altfel se întrerupe încărcarea și `installLayers` poate rula prea devreme (hartă albastră, fără CAD). */
  const skipNextBasemapStyleApplyRef = useRef(false);

  // Persist basemap selection for both Leaflet and MapLibre modes
  useEffect(() => {
    try {
      if (!basemapLsHydrateDoneRef.current) {
        const prev = localStorage.getItem(BASEMAP_KEY);
        if (
          prev?.startsWith('pmtiles-') &&
          !base.id.startsWith('pmtiles-') &&
          getBaseMapById(base.id)
        ) {
          return;
        }
      }
      localStorage.setItem(BASEMAP_KEY, base.id);
    } catch {
      /* ignore */
    }
  }, [base.id]);

  /** ID-urile `pmtiles-*` nu sunt în BASE_MAPS; reîncarcă basemap-ul salvat din Dexie după refresh. */
  useEffect(() => {
    void (async () => {
      try {
        if (typeof window === 'undefined') return;
        if (new URLSearchParams(window.location.search).has('debugMap')) {
          basemapLsHydrateDoneRef.current = true;
          setBasemapReady(true);
          return;
        }
        const saved = localStorage.getItem(BASEMAP_KEY);
        if (!saved?.startsWith('pmtiles-')) {
          basemapLsHydrateDoneRef.current = true;
          setBasemapReady(true);
          return;
        }
        if (getBaseMapById(saved)) {
          basemapLsHydrateDoneRef.current = true;
          setBasemapReady(true);
          return;
        }
        const offline = await buildBaseMapsFromArchives();
        const found = offline.find((b) => b.id === saved);
        if (found) {
          setBase(found);
        } else {
          setBase(getDefaultBaseMap());
          try {
            localStorage.setItem(BASEMAP_KEY, getDefaultBaseMap().id);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      } finally {
        basemapLsHydrateDoneRef.current = true;
        setBasemapReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!basemapReady || useLeaflet) return;
    void (async () => {
      try {
        const oa = localStorage.getItem(BASEMAP_OVERLAY_OPACITY_KEY);
        if (oa) {
          const n = parseFloat(oa);
          if (Number.isFinite(n)) setBasemapOverlayOpacity(Math.min(1, Math.max(0.2, n)));
        }
        const savedId = localStorage.getItem(BASEMAP_OVERLAY_KEY);
        if (!savedId) return;
        const offline = await buildBaseMapsFromArchives();
        const found = offline.find((b) => b.id === savedId);
        if (found) setBasemapOverlay(found);
        else localStorage.removeItem(BASEMAP_OVERLAY_KEY);
      } catch {
        /* ignore */
      }
    })();
  }, [basemapReady, useLeaflet]);

  useEffect(() => {
    if (isOfflineRasterBasemapBase(base)) setBasemapOverlay(null);
  }, [base.id, base.pmtiles, base.pmtilesUrl, base.mbtiles, base.mbtilesArchiveKey]);

  useEffect(() => {
    try {
      if (!basemapOverlay) localStorage.removeItem(BASEMAP_OVERLAY_KEY);
      else localStorage.setItem(BASEMAP_OVERLAY_KEY, basemapOverlay.id);
    } catch {
      /* ignore */
    }
  }, [basemapOverlay]);

  useEffect(() => {
    try {
      localStorage.setItem(BASEMAP_OVERLAY_OPACITY_KEY, String(basemapOverlayOpacity));
    } catch {
      /* ignore */
    }
  }, [basemapOverlayOpacity]);

  const cadLayersRef = useRef(cadLayers);
  cadLayersRef.current = cadLayers;

  const sketchModeRef = useRef(sketchMode);
  sketchModeRef.current = sketchMode;
  const onSketchCompleteRef = useRef(onSketchComplete);
  onSketchCompleteRef.current = onSketchComplete;

  const handlersRef = useRef({
    onMapClick,
    onPointClick,
    onZoneClick,
    onCadLabelTap,
    onZoneDrawn,
    onBoundsChange,
    annotationPlacementMode,
    pointPlacementPickMode,
  });
  handlersRef.current = {
    onMapClick,
    onPointClick,
    onZoneClick,
    onCadLabelTap,
    onZoneDrawn,
    onBoundsChange,
    annotationPlacementMode,
    pointPlacementPickMode,
  };

  const installLayers = (map: MlMap) => {
    addHillshadeOverlay(map);
    setHillshadeVisible(map, hillshadeOn);
    setHillshadeOpacity(map, hillshadeStrength);
    addZonesLayer(map);
    addTracksLayer(map);
    addPointsLayer(map);
    addAnnotationsLayer(map);
    updatePointsLayer(map, points);
    updateZonesLayer(map, zones);
    updateTracksLayer(map, tracks);
    updateAnnotationsLayer(map, annotations);
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
    if (useLeaflet) {
      const existing = mapRef.current;
      if (existing) {
        try {
          existing.remove();
        } catch {
          /* ignore */
        }
        mapRef.current = null;
      }
      return;
    }
    if (!containerRef.current) return;
    if (mapRef.current) return;
    if (!basemapReady) return;

    const last = readLastViewport();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style:
        base.styleUrl ??
        buildBaseStyle(base, { overlay: basemapOverlay, overlayOpacity: basemapOverlayOpacity }),
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
    let basemapFallbackDone = false;
    const tryFallbackBasemap = (reason: string) => {
      if (basemapFallbackDone || gotIdle) return;
      if (base.id === 'opentopomap' || base.id === 'esri-sat' || base.id === 'osm') {
        basemapFallbackDone = true;
        const carto = getBaseMapById('carto-voyager');
        if (carto) {
          console.warn(`[MapView] ${reason} — comut la Carto Voyager`);
          setBase(carto);
          setMapDebug({
            msg: 'OpenTopoMap/OSM indisponibil în browser — am trecut la Carto Voyager. Schimbă harta din stânga sus.',
          });
        }
      }
    };
    const debugTimer = window.setTimeout(() => {
      if (gotIdle) return;
      tryFallbackBasemap('Basemap fără idle');
      if (gotIdle || basemapFallbackDone) return;
      const canvas = map.getCanvas();
      setMapDebug({
        msg: `Basemap nu a randat (idle) in timp util. Canvas ${canvas?.width ?? 0}x${canvas?.height ?? 0}. Încearcă Carto Voyager sau ?leaflet=1`,
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
      console.error('[map] error', e?.error ?? e);
      const err = (e as unknown as { error?: { message?: string } }).error?.message;
      if (err?.toLowerCase().includes('failed to fetch') || err?.toLowerCase().includes('tile')) {
        tryFallbackBasemap(err);
      } else if (err) {
        setMapDebug({ msg: `Map error: ${err}` });
      }
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
      // Straturi (CAD, puncte, …) se instalează în efectul [base] după ce stilul e stabil (idle),
      // ca să nu se piardă la un setStyle imediat după crearea hărții.
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
        zoom: map.getZoom(),
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
      if (sketchModeRef.current) return;
      if (handlersRef.current.pointPlacementPickMode) {
        handlersRef.current.onMapClick?.(e.lngLat.lng, e.lngLat.lat);
        return;
      }
      if (handlersRef.current.annotationPlacementMode) {
        handlersRef.current.onMapClick?.(e.lngLat.lng, e.lngLat.lat);
        return;
      }
      const cadSymLayers = (map.getStyle().layers ?? [])
        .map((l) => l.id)
        .filter((id) => id.startsWith(getCadLayerPrefix()) && id.endsWith('-sym'));
      if (cadSymLayers.length > 0) {
        const { x, y } = e.point;
        const pad = 24;
        const cadHits = map.queryRenderedFeatures(
          [
            [x - pad, y - pad],
            [x + pad, y + pad],
          ],
          { layers: cadSymLayers as never },
        );
        if (cadHits.length > 0) {
          const f = cadHits[0];
          const rowId = cadLayerRowIdFromSymbolLayerId(f.layer.id);
          const props = (f.properties ?? {}) as Record<string, unknown>;
          const label = cadLabelTextFromProps(props);
          if (
            rowId &&
            label &&
            !isJunkCadPlaceholderLabel(label) &&
            f.geometry &&
            f.geometry.type === 'Point'
          ) {
            const row = cadLayersRef.current.find((r) => r.id === rowId);
            if (row && cadLabelLockedFromStyle((row.style ?? {}) as Record<string, unknown>)) {
              return;
            }
            const [lon, lat] = f.geometry.coordinates;
            const fid =
              typeof props[CAD_FEATURE_ID_KEY] === 'string'
                ? (props[CAD_FEATURE_ID_KEY] as string)
                : undefined;
            handlersRef.current.onCadLabelTap?.({ layerRowId: rowId, lon, lat, featureFid: fid });
            return;
          }
        }
      }
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

    const HOVER_DELAY_MS = 500;
    const hoverLayers = [
      'poi-circles',
      'poi-labels',
      'zones-fill',
      'zones-outline',
      'zones-label',
      'tracks-line',
      'live-track-line',
      'annotations-symbols',
      'annotations-text',
      'annotations-arrows',
      'annotations-arrow-heads',
    ];

    const pickHoverData = (layerId: string, props: Record<string, unknown>): HoverTooltipData | null => {
      const title = titleFromProps(props);
      if (!title || title === '—') return null;

      if (layerId.startsWith('poi-')) {
        return {
          title,
          subtitle: 'Punct',
          lines: [
            { label: 'Tip', value: asText(props.type) },
            { label: 'Viz', value: asText(props.visibility) },
          ],
        };
      }
      if (layerId.startsWith('zones-')) {
        return {
          title,
          subtitle: 'Zonă',
          lines: [
            { label: 'Status', value: asText(props.status) },
            { label: 'Prio', value: asText(props.priority) },
            { label: 'Viz', value: asText(props.visibility) },
          ],
        };
      }
      if (layerId.startsWith('tracks-') || layerId.startsWith('live-track-')) {
        return {
          title,
          subtitle: 'Traseu',
          lines: [
            { label: 'Sursă', value: asText(props.source) },
            { label: 'Viz', value: asText(props.visibility) },
          ],
        };
      }
      if (layerId.startsWith(getCadLayerPrefix())) {
        const desc = asText(props.handi_description).trim();
        const lines =
          desc.length > 0
            ? [{ label: 'Descriere', value: desc.length > 140 ? `${desc.slice(0, 137)}…` : desc }]
            : undefined;
        return {
          title,
          subtitle: 'Etichetă / nume CAD',
          lines,
        };
      }
      return { title, subtitle: subtitleFromLayer(layerId) };
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (drawRef.current?.enabled) return;
      const map = mapRef.current;
      if (!map) return;

      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
      const point = e.point;

      // Include CAD layers dynamically (added after style load).
      const styleLayers = map.getStyle()?.layers?.map((l) => l.id) ?? [];
      const cadIds = styleLayers.filter((id) => id.startsWith(getCadLayerPrefix()));
      const layers = [...hoverLayers, ...cadIds];

      const feats = map.queryRenderedFeatures(point, { layers: layers as never });
      const f = feats[0];
      if (!f) {
        clearHover();
        return;
      }

      const layerId = f.layer.id;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const id = asText(props.id);
      const key = `${layerId}:${id}:${titleFromProps(props)}`;

      hoverTimerRef.current = window.setTimeout(() => {
        if (lastHoverKeyRef.current === key && hover) return;
        const data = pickHoverData(layerId, props);
        if (!data) return;
        lastHoverKeyRef.current = key;
        setHover({ x: point.x, y: point.y, data });
      }, HOVER_DELAY_MS);
    };

    const onMouseLeave = () => clearHover();
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseLeave);

    skipNextBasemapStyleApplyRef.current = true;
    mapRef.current = map;
    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      window.removeEventListener('resize', onWinResize);
      window.clearTimeout(debugTimer);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseLeave);
      clearHover();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useLeaflet, basemapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    if (skipNextBasemapStyleApplyRef.current) {
      skipNextBasemapStyleApplyRef.current = false;
    } else {
      map.setStyle(
        base.styleUrl ??
          buildBaseStyle(base, { overlay: basemapOverlay, overlayOpacity: basemapOverlayOpacity }),
      );
    }

    /**
     * `isStyleLoaded()` poate rămâne false cât timp tile-urile raster nu sosesc (offline).
     * Totuși sursa `base` există — putem desena CAD / puncte / trasee peste fundal.
     */
    const runInstallWhenStyleReady = () => {
      const applyPmtilesViewport = () => {
        if (!isOfflineRasterBasemapBase(base)) return;
        const b = base.pmtilesBounds;
        if (Array.isArray(b) && b.length === 4 && b.every((x) => typeof x === 'number' && Number.isFinite(x))) {
          const maxZ = Math.min(base.maxzoom ?? 18, 19);
          map.fitBounds(
            [
              [b[0], b[1]],
              [b[2], b[3]],
            ],
            { padding: 48, maxZoom: maxZ, duration: 700 },
          );
          scheduleClampZoomAfterPmtilesFit(map, base);
        } else {
          clampZoomForPmtilesBasemap(map, base);
        }
      };

      let frames = 0;
      const tick = () => {
        if (cancelled) return;
        const ready = mapAcceptsOverlayLayers(map);
        if (!ready) {
          frames += 1;
          if (frames > 420) {
            console.warn(
              '[MapView] basemap: forțăm installLayers (tile-uri pot lipsi; straturile tale ar trebui să apară peste fundal).',
            );
            try {
              ensureInputsEnabled(map);
              installLayers(map);
              applyPmtilesViewport();
            } catch (e) {
              console.error('[map] installLayers (forced)', e);
            }
            return;
          }
          requestAnimationFrame(tick);
          return;
        }
        try {
          ensureInputsEnabled(map);
          installLayers(map);
          applyPmtilesViewport();
        } catch (e) {
          console.error('[map] installLayers', e);
        }
      };
      requestAnimationFrame(tick);
    };

    runInstallWhenStyleReady();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, basemapOverlay, basemapOverlayOpacity]);

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
    if (mapAcceptsOverlayLayers(map)) updatePointsLayer(map, points);
    else map.once('idle', () => updatePointsLayer(map, points));
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapAcceptsOverlayLayers(map)) updateZonesLayer(map, zones);
    else map.once('idle', () => updateZonesLayer(map, zones));
  }, [zones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapAcceptsOverlayLayers(map)) updateTracksLayer(map, tracks);
    else map.once('idle', () => updateTracksLayer(map, tracks));
  }, [tracks]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapAcceptsOverlayLayers(map)) updateAnnotationsLayer(map, annotations);
    else map.once('idle', () => updateAnnotationsLayer(map, annotations));
  }, [annotations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateLiveTrack(map, liveTrack);
  }, [liveTrack]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapAcceptsOverlayLayers(map)) syncRasterLayers(map, rasters, rasterState);
    else map.once('idle', () => syncRasterLayers(map, rasters, rasterState));
  }, [rasters, rasterState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapAcceptsOverlayLayers(map)) updateCadLayersOnMap(map, cadLayers);
    else map.once('idle', () => updateCadLayersOnMap(map, cadLayers));
  }, [cadLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sketchMode) return;
    const canvas = map.getCanvas();
    let path: [number, number][] = [];
    let drawing = false;

    const toLngLat = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return map.unproject([clientX - rect.left, clientY - rect.top]);
    };

    const minDistSq = 2e-11;

    const push = (lng: number, lat: number) => {
      const last = path[path.length - 1];
      if (last) {
        const dx = lng - last[0];
        const dy = lat - last[1];
        if (dx * dx + dy * dy < minDistSq) return;
      }
      path.push([lng, lat]);
    };

    const finish = () => {
      if (!drawing) return;
      drawing = false;
      try {
        map.dragPan.enable();
        map.doubleClickZoom.enable();
        map.touchZoomRotate.enable();
      } catch {
        /* ignore */
      }
      if (path.length >= 2) {
        onSketchCompleteRef.current?.({ type: 'LineString', coordinates: [...path] });
      }
      path = [];
    };

    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drawing = true;
      path = [];
      const ll = toLngLat(e.clientX, e.clientY);
      path.push([ll.lng, ll.lat]);
      try {
        map.dragPan.disable();
        map.doubleClickZoom.disable();
        map.touchZoomRotate.disable();
      } catch {
        /* ignore */
      }
    };

    const move = (e: MouseEvent) => {
      if (!drawing) return;
      e.preventDefault();
      const ll = toLngLat(e.clientX, e.clientY);
      push(ll.lng, ll.lat);
    };

    const up = () => finish();

    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      down(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY, button: 0, bubbles: true }));
    };
    const touchMove = (e: TouchEvent) => {
      if (!drawing || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      move(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY, bubbles: true }));
    };
    const touchEnd = () => finish();

    canvas.addEventListener('mousedown', down, { capture: true });
    window.addEventListener('mousemove', move, { capture: true });
    window.addEventListener('mouseup', up, { capture: true });
    canvas.addEventListener('touchstart', touchStart, { capture: true, passive: false });
    window.addEventListener('touchmove', touchMove, { capture: true, passive: false });
    window.addEventListener('touchend', touchEnd, { capture: true });
    window.addEventListener('touchcancel', touchEnd, { capture: true });

    return () => {
      canvas.removeEventListener('mousedown', down, { capture: true } as AddEventListenerOptions);
      window.removeEventListener('mousemove', move, { capture: true } as AddEventListenerOptions);
      window.removeEventListener('mouseup', up, { capture: true } as AddEventListenerOptions);
      canvas.removeEventListener('touchstart', touchStart, { capture: true } as AddEventListenerOptions);
      window.removeEventListener('touchmove', touchMove, { capture: true } as AddEventListenerOptions);
      window.removeEventListener('touchend', touchEnd, { capture: true } as AddEventListenerOptions);
      window.removeEventListener('touchcancel', touchEnd, { capture: true } as AddEventListenerOptions);
      try {
        map.dragPan.enable();
        map.doubleClickZoom.enable();
        map.touchZoomRotate.enable();
      } catch {
        /* ignore */
      }
    };
  }, [sketchMode]);

  useEffect(() => {
    if (!flyTo) return;
    const map = mapRef.current;
    if (!map) return;
    const { lng, lat, zoom } = flyTo;
    const run = () => {
      try {
        map.flyTo({ center: [lng, lat], zoom: zoom ?? 16, duration: 1200 });
      } catch {
        /* ignore */
      }
    };
    if (map.isStyleLoaded()) run();
    else map.once('idle', run);
    return () => {
      map.off('idle', run);
    };
  }, [flyTo]);

  useEffect(() => {
    if (!fitBounds) return;
    const map = mapRef.current;
    if (!map) return;
    const b = fitBounds;
    const run = () => {
      try {
        map.fitBounds(b, { padding: 60, duration: 1200 });
      } catch {
        /* ignore */
      }
    };
    if (map.isStyleLoaded()) run();
    else map.once('idle', run);
    return () => {
      map.off('idle', run);
    };
  }, [fitBounds]);

  useEffect(() => {
    const map = mapRef.current;
    const remove = () => {
      userLocationMarkerRef.current?.remove();
      userLocationMarkerRef.current = null;
    };
    remove();
    if (!map || !myLocation) return;

    const place = () => {
      const m = mapRef.current;
      const loc = myLocation;
      if (!m || !loc) return;
      remove();
      const el = document.createElement('div');
      el.setAttribute('aria-label', 'Poziția mea');
      el.style.cssText =
        'width:20px;height:20px;border:3px solid #fff;border-radius:50%;background:#2563eb;box-shadow:0 2px 8px rgba(0,0,0,0.35);pointer-events:none;';
      userLocationMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([loc.lon, loc.lat])
        .addTo(m);
    };

    if (map.loaded()) place();
    else map.once('load', place);

    return remove;
  }, [myLocation]);

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
    if (!navigator.geolocation) {
      alert('Geolocation nu este disponibil pe acest device');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        onMyLocation?.(lat, lon);
        const zoom = 16;
        if (useLeaflet) {
          onGpsFlyTo?.(lon, lat, zoom);
          return;
        }
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [lon, lat],
          zoom,
          duration: 1500,
        });
      },
      (err) => {
        setLocating(false);
        alert(err?.message ? `Nu pot obtine pozitia: ${err.message}` : 'Nu pot obtine pozitia (permisiuni GPS?)');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  if (!basemapReady) {
    return (
      <div className="relative flex h-full w-full min-h-0 items-center justify-center bg-slate-950 px-4 text-center text-sm text-slate-400">
        Se încarcă harta offline din memoria locală…
      </div>
    );
  }

  if (useLeaflet) {
    return (
      <div className="relative h-full w-full min-h-0">
        <div
          className={`absolute inset-0 z-0${annotationPlacementMode ? ' handi-cursor-annot-placement' : ''}${pointPlacementPickMode || sketchMode ? ' cursor-crosshair' : ''}`}
        >
          <LeafletView
            base={base}
            points={points}
            zones={zones}
            tracks={tracks}
            annotations={annotations}
            cadLayers={cadLayers}
            rasters={rasters}
            rasterState={rasterState}
            annotationPlacementMode={annotationPlacementMode}
            sketchMode={sketchMode}
            sketchStrokeColor={sketchStrokeColor}
            onSketchComplete={onSketchComplete}
            pointPlacementPickMode={pointPlacementPickMode}
            onMapClick={onMapClick}
            onCadLabelTap={onCadLabelTap}
            onBoundsChange={onBoundsChange}
            flyTo={flyTo}
            fitBounds={fitBounds}
            myLocation={myLocation}
          />
        </div>

        {betweenMapAndControls}

        <div className="pointer-events-auto fixed left-3 top-[calc(env(safe-area-inset-top,0px)+3.75rem)] z-[500] flex flex-col gap-2 md:left-[calc(20rem+0.75rem)] lg:left-[calc(24rem+0.75rem)]">
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
              viewportBbox={viewportBbox}
              viewportZoom={viewportZoom}
              onOfflinePackComplete={(b) => {
                setBase(b);
                setShowSwitcher(false);
              }}
              enablePmtilesOverlay={false}
            />
          )}
        </div>

        <button
          onClick={locateMe}
          disabled={locating}
          className="pointer-events-auto fixed bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] right-3 z-[500] flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900/95 text-xs font-bold shadow-xl backdrop-blur hover:bg-slate-800 disabled:opacity-50 md:bottom-24"
          title="Pozitia mea"
        >
          {locating ? '...' : 'GPS'}
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full min-h-0">
      <div
        ref={containerRef}
        className={`absolute inset-0${annotationPlacementMode ? ' handi-cursor-annot-placement' : ''}${pointPlacementPickMode || sketchMode ? ' cursor-crosshair' : ''}`}
      />
      {betweenMapAndControls}
      {hover && <MapHoverTooltip x={hover.x} y={hover.y} data={hover.data} />}

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

      <div className="pointer-events-auto fixed left-3 top-[calc(env(safe-area-inset-top,0px)+3.75rem)] z-[500] flex flex-col gap-2 md:left-[calc(20rem+0.75rem)] lg:left-[calc(24rem+0.75rem)]">
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
            viewportBbox={viewportBbox}
            viewportZoom={viewportZoom}
            onOfflinePackComplete={(b) => {
              setBase(b);
              setShowSwitcher(false);
            }}
            enablePmtilesOverlay={!isOfflineRasterBasemapBase(base)}
            basemapOverlay={basemapOverlay}
            onBasemapOverlayChange={setBasemapOverlay}
            basemapOverlayOpacity={basemapOverlayOpacity}
            onBasemapOverlayOpacityChange={setBasemapOverlayOpacity}
          />
        )}
      </div>

      {drawZoneMode && (
        <div className="absolute top-3 left-1/2 z-50 -translate-x-1/2 bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-xl">
          Apasa pe harta ca sa adaugi varfuri. Dublu-click pentru finalizare.
        </div>
      )}

      <button
        onClick={locateMe}
        disabled={locating}
        className="pointer-events-auto fixed bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] right-3 z-[500] flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900/95 text-xs font-bold shadow-xl backdrop-blur hover:bg-slate-800 disabled:opacity-50 md:bottom-24"
        title="Pozitia mea"
      >
        {locating ? '...' : 'GPS'}
      </button>

      <div className="pointer-events-auto fixed bottom-[calc(10rem+env(safe-area-inset-bottom,0px))] right-3 z-[500] md:bottom-40">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut({ duration: 250 })}
          className="bg-slate-900/95 backdrop-blur border border-slate-700 rounded-full w-12 h-12 shadow-xl hover:bg-slate-800 flex items-center justify-center text-lg font-bold"
          title="Zoom out"
        >
          −
        </button>
      </div>
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
