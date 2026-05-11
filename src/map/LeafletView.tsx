import { useCallback, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { POINT_TYPES, type Annotation, type PointOfInterest, type Track, type Zone } from '@/lib/types';
import type { BaseMapDef } from './layers/BaseLayers';
import type { CadLayerRow } from '@/features/cad/api';
import { isJunkCadPlaceholderLabel, normalizeCadMapLabelString } from '@/features/cad/cadMapLabels';

interface ViewportState {
  lng: number;
  lat: number;
  zoom: number;
}

const VIEWPORT_KEY = 'handi-viewport';
const DEFAULT_VIEW: ViewportState = { lng: 22.9, lat: 45.9, zoom: 6 };

function readLastViewport(): ViewportState {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY);
    if (!raw) return DEFAULT_VIEW;
    const v = JSON.parse(raw) as ViewportState;
    if (typeof v.lng !== 'number' || typeof v.lat !== 'number' || typeof v.zoom !== 'number') {
      return DEFAULT_VIEW;
    }
    return v;
  } catch {
    return DEFAULT_VIEW;
  }
}

function writeLastViewport(v: ViewportState) {
  try {
    localStorage.setItem(VIEWPORT_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

interface Props {
  base: BaseMapDef;
  points: PointOfInterest[];
  zones: Zone[];
  tracks: Track[];
  annotations: Annotation[];
  cadLayers: CadLayerRow[];
  onMapClick?: (lng: number, lat: number) => void;
  onBoundsChange?: (b: { minLon: number; minLat: number; maxLon: number; maxLat: number }) => void;
  flyTo?: { lng: number; lat: number; zoom?: number } | null;
  fitBounds?: [[number, number], [number, number]] | null;
}

function toPointFC(points: PointOfInterest[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, type: p.type, name: p.name ?? '' },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  };
}

function toZoneFC(zones: Zone[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      properties: { id: z.id, status: z.status, priority: z.priority, name: z.name ?? '' },
      geometry: z.geom,
    })),
  };
}

function toTrackFC(tracks: Track[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks.map((t) => ({
      type: 'Feature',
      properties: { id: t.id, name: t.name ?? '' },
      geometry: t.geom,
    })),
  };
}

function styleCad(row: CadLayerRow): L.PathOptions {
  const s = row.style as { color?: string; width?: number; opacity?: number };
  const color = typeof s.color === 'string' ? s.color : '#94a3b8';
  const weight = typeof s.width === 'number' ? s.width : 2;
  const opacity = typeof s.opacity === 'number' ? s.opacity : 0.85;
  return {
    color,
    weight,
    opacity,
    fillColor: color,
    fillOpacity: row.kind === 'dolines' ? Math.min(0.45, opacity * 0.5) : 0,
  };
}

/** Vite bundles URLs; Leaflet's default marker PNGs must be wired or GeoJSON Points show broken <img>. */
function fixLeafletDefaultIcons() {
  const proto = L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown };
  delete proto._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: markerIcon,
    iconRetinaUrl: markerIcon2x,
    shadowUrl: markerShadow,
  });
}

function cadFeatureLabelText(props: Record<string, unknown> | null): string {
  if (!props) return '';
  const raw =
    (typeof props.cad_label === 'string' ? props.cad_label : '') ||
    (typeof props.dxfText === 'string' ? props.dxfText : '') ||
    (typeof props.text === 'string' ? props.text : '') ||
    (typeof props.block === 'string' ? props.block : '') ||
    (typeof (props as { name?: unknown }).name === 'string' ? String((props as { name?: unknown }).name) : '');
  return normalizeCadMapLabelString(raw);
}

export function LeafletView({
  base,
  points,
  zones,
  tracks,
  annotations,
  cadLayers,
  onMapClick,
  onBoundsChange,
  flyTo,
  fitBounds,
}: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverTooltipRef = useRef<L.Tooltip | null>(null);
  const layersRef = useRef<{
    tile?: L.TileLayer;
    points?: L.GeoJSON;
    zones?: L.GeoJSON;
    tracks?: L.GeoJSON;
    annotations?: L.LayerGroup;
    cad?: L.LayerGroup;
  }>({});

  const pointsFC = useMemo(() => toPointFC(points), [points]);
  const zonesFC = useMemo(() => toZoneFC(zones), [zones]);
  const tracksFC = useMemo(() => toTrackFC(tracks), [tracks]);

  const clearHover = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    const map = mapRef.current;
    const tt = hoverTooltipRef.current;
    if (map && tt) map.closeTooltip(tt);
  }, []);

  const scheduleHover = useCallback((latlng: L.LatLng, html: string, minZoom = 0) => {
    const map = mapRef.current;
    const tt = hoverTooltipRef.current;
    if (!map || !tt) return;
    clearHover();
    hoverTimerRef.current = window.setTimeout(() => {
      if (!mapRef.current || !hoverTooltipRef.current) return;
      if (map.getZoom() < minZoom) return;
      hoverTooltipRef.current.setLatLng(latlng);
      hoverTooltipRef.current.setContent(html);
      map.openTooltip(hoverTooltipRef.current);
    }, 500);
  }, [clearHover]);

  useEffect(() => {
    if (!divRef.current) return;
    if (mapRef.current) return;

    fixLeafletDefaultIcons();

    const map = L.map(divRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    mapRef.current = map;
    hoverTooltipRef.current = L.tooltip({
      sticky: true,
      direction: 'top',
      offset: L.point(0, -10),
      opacity: 0.95,
      className: 'handi-hover-tooltip',
    });

    const last = readLastViewport();
    map.setView([last.lat, last.lng], last.zoom);

    map.on('click', (e) => onMapClick?.(e.latlng.lng, e.latlng.lat));
    map.on('moveend', () => {
      const c = map.getCenter();
      writeLastViewport({ lng: c.lng, lat: c.lat, zoom: map.getZoom() });
      const b = map.getBounds();
      onBoundsChange?.({
        minLon: b.getWest(),
        minLat: b.getSouth(),
        maxLon: b.getEast(),
        maxLat: b.getNorth(),
      });
    });

    const tile = L.tileLayer(base.tileUrls[0] ?? '', {
      maxZoom: base.maxzoom,
      attribution: base.attribution,
      crossOrigin: true,
    });
    tile.addTo(map);
    layersRef.current.tile = tile;

    return () => {
      clearHover();
      map.remove();
      mapRef.current = null;
      hoverTooltipRef.current = null;
      layersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // basemap switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.tile;
    if (prev) map.removeLayer(prev);
    const tile = L.tileLayer(base.tileUrls[0] ?? '', {
      maxZoom: base.maxzoom,
      attribution: base.attribution,
      crossOrigin: true,
    });
    tile.addTo(map);
    layersRef.current.tile = tile;
  }, [base]);

  // overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.points;
    if (prev) map.removeLayer(prev);
    const layer = L.geoJSON(pointsFC, {
      pointToLayer: (f, latlng) => {
        const type = (f.properties as { type?: string } | null)?.type ?? 'other';
        if (type === 'label') {
          return L.circleMarker(latlng, { radius: 0, opacity: 0, fillOpacity: 0 });
        }
        const color = POINT_TYPES.find((t) => t.value === type)?.color ?? '#22c55e';
        return L.circleMarker(latlng, {
          radius: 6,
          color,
          weight: 2,
          fillOpacity: 0.6,
          fillColor: color,
        });
      },
      onEachFeature: (f, lyr) => {
        const props = (f.properties as { name?: string; type?: string } | null) ?? null;
        const name = props?.name ?? '';
        const type = props?.type ?? 'other';
        if (!name) return;
        // Permanent label (like MapLibre) from zoom>=12
        const tooltip = L.tooltip({
          permanent: true,
          direction: 'top',
          offset: L.point(0, -10),
          opacity: 0.95,
          className: 'handi-point-label',
        }).setContent(escapeHtml(name));

        lyr.bindTooltip(tooltip);

        const meta = POINT_TYPES.find((t) => t.value === type)?.label ?? type;
        const hoverHtml = [
          `<div style="font-weight:600">${escapeHtml(name)}</div>`,
          `<div style="font-size:11px;opacity:.8">Punct • ${escapeHtml(meta)}</div>`,
        ].join('');
        lyr.on('mouseover', (e: L.LeafletMouseEvent) => scheduleHover(e.latlng, hoverHtml, 12));
        lyr.on('mouseout', () => clearHover());
      },
    });
    layer.addTo(map);
    layersRef.current.points = layer;

    const syncPointLabels = () => {
      const z = map.getZoom();
      layer.eachLayer((l) => {
        const anyL = l as unknown as { getTooltip?: () => unknown; openTooltip?: () => void; closeTooltip?: () => void };
        const tt = anyL.getTooltip?.();
        if (!tt) return;
        if (z >= 12) anyL.openTooltip?.();
        else anyL.closeTooltip?.();
      });
    };
    syncPointLabels();
    map.on('zoomend', syncPointLabels);
    return () => {
      map.off('zoomend', syncPointLabels);
    };
  }, [pointsFC, clearHover, scheduleHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.zones;
    if (prev) map.removeLayer(prev);
    const layer = L.geoJSON(zonesFC, {
      style: () => ({ color: '#38bdf8', weight: 2, fillOpacity: 0.12 }),
      onEachFeature: (f, lyr) => {
        const props = (f.properties as { name?: string; status?: string; priority?: string } | null) ?? null;
        const name = props?.name ?? '';
        if (!name) return;
        const html = [
          `<div style="font-weight:600">${escapeHtml(name)}</div>`,
          `<div style="font-size:11px;opacity:.8">Zonă • ${escapeHtml(props?.status ?? '')} • ${escapeHtml(props?.priority ?? '')}</div>`,
        ].join('');
        lyr.on('mouseover', (e: L.LeafletMouseEvent) => scheduleHover(e.latlng, html, 11));
        lyr.on('mouseout', () => clearHover());
      },
    });
    layer.addTo(map);
    layersRef.current.zones = layer;
  }, [zonesFC, clearHover, scheduleHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.tracks;
    if (prev) map.removeLayer(prev);
    const layer = L.geoJSON(tracksFC, {
      style: () => ({ color: '#f59e0b', weight: 3, opacity: 0.9 }),
      onEachFeature: (f, lyr) => {
        const props = (f.properties as { name?: string } | null) ?? null;
        const name = props?.name ?? '';
        if (!name) return;
        const html = [
          `<div style="font-weight:600">${escapeHtml(name)}</div>`,
          `<div style="font-size:11px;opacity:.8">Traseu</div>`,
        ].join('');
        lyr.on('mouseover', (e: L.LeafletMouseEvent) => scheduleHover(e.latlng, html, 0));
        lyr.on('mouseout', () => clearHover());
      },
    });
    layer.addTo(map);
    layersRef.current.tracks = layer;
  }, [tracksFC, clearHover, scheduleHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.annotations;
    if (prev) map.removeLayer(prev);
    const group = L.layerGroup();

    for (const a of annotations) {
      if (a.kind === 'symbol' || a.kind === 'text') {
        if (a.geom.type !== 'Point') continue;
        const [lon, lat] = a.geom.coordinates;
        const latlng = L.latLng(lat, lon);
        if (a.kind === 'text') {
          const html = `<div style="font-weight:600">${escapeHtml(a.text ?? '')}</div>`;
          const marker = L.circleMarker(latlng, { radius: 0, opacity: 0, fillOpacity: 0 });
          marker.on('mouseover', () => scheduleHover(latlng, html, 11));
          marker.on('mouseout', () => clearHover());
          group.addLayer(marker);
          continue;
        }

        const sym = symbolLabel(a.symbol ?? 'other');
        const icon = L.divIcon({
          className: 'handi-annotation-icon',
          html: `<div style="font-size:18px;line-height:18px;color:#a855f7">${escapeHtml(sym)}</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const marker = L.marker(latlng, { icon, interactive: true });
        const title = a.text || a.symbol || 'Simbol';
        const html = `<div style="font-weight:600">${escapeHtml(title)}</div><div style="font-size:11px;opacity:.8">Adnotare</div>`;
        marker.on('mouseover', () => scheduleHover(latlng, html, 10));
        marker.on('mouseout', () => clearHover());
        group.addLayer(marker);
        continue;
      }

      if (a.kind === 'arrow' && a.geom.type === 'LineString') {
        const coords = a.geom.coordinates;
        if (coords.length < 2) continue;
        const latlngs = coords.map((c) => L.latLng(c[1], c[0]));
        const line = L.polyline(latlngs, { color: '#22c55e', weight: 3, opacity: 0.9 });
        line.on('mouseover', (e) =>
          scheduleHover(e.latlng, `<div style="font-weight:600">Săgeată</div>`, 0),
        );
        line.on('mouseout', () => clearHover());
        group.addLayer(line);

        const p1 = coords[coords.length - 2];
        const p2 = coords[coords.length - 1];
        const bearing = a.bearing_deg ?? computeBearingDeg(p1[0], p1[1], p2[0], p2[1]);
        const headIcon = L.divIcon({
          className: 'handi-arrow-head',
          html: `<div style="transform: rotate(${bearing}deg); font-size:16px; line-height:16px">➤</div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        group.addLayer(L.marker(L.latLng(p2[1], p2[0]), { icon: headIcon, interactive: false }));
      }
    }

    group.addTo(map);
    layersRef.current.annotations = group;
  }, [annotations, clearHover, scheduleHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.cad;
    if (prev) map.removeLayer(prev);
    const group = L.layerGroup();
    for (const row of cadLayers) {
      if (!row.visible) continue;
      const st = styleCad(row);
      const layer = L.geoJSON(row.features as GeoJSON.GeoJsonObject, {
        style: () => st,
        pointToLayer: (feat, latlng) => {
          if (feat.geometry?.type !== 'Point') {
            return L.marker(latlng);
          }
          const props = (feat.properties as Record<string, unknown> | null) ?? {};
          const label = cadFeatureLabelText(props);

          if ((row.kind === 'labels' || row.kind === 'caves') && label && !isJunkCadPlaceholderLabel(label)) {
            const m = L.circleMarker(latlng, {
              radius: 4,
              color: st.color,
              weight: 1,
              opacity: st.opacity ?? 1,
              fillColor: st.color,
              fillOpacity: Math.min(0.9, (st.opacity ?? 0.85) * 0.85),
            });
            m.bindTooltip(escapeHtml(label), {
              permanent: true,
              direction: 'top',
              offset: [0, -6],
              opacity: 0.95,
              className: 'handi-cad-leaflet-label',
            });
            return m;
          }

          if (row.kind === 'springs' || row.kind === 'avens') {
            return L.circleMarker(latlng, {
              radius: 5,
              color: st.color,
              weight: 1,
              opacity: st.opacity ?? 1,
              fillColor: st.color,
              fillOpacity: Math.min(0.95, (st.opacity ?? 0.85) * 0.9),
            });
          }

          // POINT entities on non-label layers, or empty label rows: no default pin.
          return L.circleMarker(latlng, {
            radius: row.kind === 'labels' || row.kind === 'caves' ? 0 : 3,
            opacity: 0,
            fillOpacity: 0,
            weight: 0,
          });
        },
        onEachFeature: (f, lyr) => {
          const props = (f.properties as Record<string, unknown> | null) ?? {};
          const label = cadFeatureLabelText(props);
          const title = (label && !isJunkCadPlaceholderLabel(label) ? label : '') || row.cad_layer;
          if (!title) return;
          const html = [
            `<div style="font-weight:600">${escapeHtml(title)}</div>`,
            `<div style="font-size:11px;opacity:.8">CAD • ${escapeHtml(row.cad_layer)}</div>`,
          ].join('');
          lyr.on('mouseover', (e: L.LeafletMouseEvent) => scheduleHover(e.latlng, html, 0));
          lyr.on('mouseout', () => clearHover());
        },
      });
      group.addLayer(layer);
    }
    group.addTo(map);
    layersRef.current.cad = group;
  }, [cadLayers, clearHover, scheduleHover]);

  // viewport controls
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.setView([flyTo.lat, flyTo.lng], flyTo.zoom ?? map.getZoom(), { animate: true });
  }, [flyTo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitBounds) return;
    map.fitBounds([
      [fitBounds[0][1], fitBounds[0][0]],
      [fitBounds[1][1], fitBounds[1][0]],
    ]);
  }, [fitBounds]);

  return <div ref={divRef} className="absolute inset-0" />;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function symbolLabel(symbol: string): string {
  switch (symbol) {
    case 'diaclaza':
      return '⟂';
    case 'dolina':
      return '◯';
    case 'abrupt':
      return '⛰';
    case 'pestera':
      return '⊙';
    case 'intrebare':
      return '?';
    case 'mirare':
      return '!';
    case 'ravene':
      return 'V';
    case 'ponoare':
      return '⊘';
    case 'izbuc':
      return '⛲';
    case 'depresiune_hachuri':
      return '⌵';
    case 'alunecare':
      return '⇣';
    default:
      return '•';
  }
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

