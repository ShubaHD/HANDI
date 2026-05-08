import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { PointOfInterest, Track, Zone } from '@/lib/types';
import type { BaseMapDef } from './layers/BaseLayers';
import type { CadLayerRow } from '@/features/cad/api';

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

export function LeafletView({
  base,
  points,
  zones,
  tracks,
  cadLayers,
  onMapClick,
  onBoundsChange,
  flyTo,
  fitBounds,
}: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    tile?: L.TileLayer;
    points?: L.GeoJSON;
    zones?: L.GeoJSON;
    tracks?: L.GeoJSON;
    cad?: L.LayerGroup;
  }>({});

  const pointsFC = useMemo(() => toPointFC(points), [points]);
  const zonesFC = useMemo(() => toZoneFC(zones), [zones]);
  const tracksFC = useMemo(() => toTrackFC(tracks), [tracks]);

  useEffect(() => {
    if (!divRef.current) return;
    if (mapRef.current) return;

    const map = L.map(divRef.current, {
      zoomControl: false,
      attributionControl: true,
    });
    mapRef.current = map;

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
      map.remove();
      mapRef.current = null;
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
      pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 6, color: '#22c55e', weight: 2, fillOpacity: 0.6 }),
    });
    layer.addTo(map);
    layersRef.current.points = layer;
  }, [pointsFC]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.zones;
    if (prev) map.removeLayer(prev);
    const layer = L.geoJSON(zonesFC, {
      style: () => ({ color: '#38bdf8', weight: 2, fillOpacity: 0.12 }),
    });
    layer.addTo(map);
    layersRef.current.zones = layer;
  }, [zonesFC]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.tracks;
    if (prev) map.removeLayer(prev);
    const layer = L.geoJSON(tracksFC, {
      style: () => ({ color: '#f59e0b', weight: 3, opacity: 0.9 }),
    });
    layer.addTo(map);
    layersRef.current.tracks = layer;
  }, [tracksFC]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = layersRef.current.cad;
    if (prev) map.removeLayer(prev);
    const group = L.layerGroup();
    for (const row of cadLayers) {
      if (!row.visible) continue;
      const layer = L.geoJSON(row.features as GeoJSON.GeoJsonObject, { style: () => styleCad(row) });
      group.addLayer(layer);
    }
    group.addTo(map);
    layersRef.current.cad = group;
  }, [cadLayers]);

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

