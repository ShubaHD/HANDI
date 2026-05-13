import type { StyleSpecification } from 'maplibre-gl';
import { getMapGlyphsUrl } from '@/map/mapStyleGlyphs';

export interface BaseMapDef {
  id: string;
  label: string;
  description: string;
  attribution: string;
  tileUrls: string[];
  maxzoom: number;
  default?: boolean;
  /** If set, use a remote style URL instead of building a raster style locally. */
  styleUrl?: string;
  /** Daca e setat, sursa va folosi `url: pmtilesUrl` (PMTiles raster), nu `tiles`. */
  pmtiles?: boolean;
  pmtilesUrl?: string;
  /** West, South, East, North (WGS84) din arhiva PMTiles — pentru fitBounds după încărcare. */
  pmtilesBounds?: [number, number, number, number] | null;
  /** Din antetul PMTiles; folosit pe sursa raster ca MapLibre să ceară zoom corect. */
  pmtilesMinZoom?: number | null;
  /** MBTiles local (SQLite in worker + protocol `mbtiles-handi://`). */
  mbtiles?: boolean;
  /** Cheie Dexie pentru arhiva MBTiles (nu URL). */
  mbtilesArchiveKey?: string;
}

/** Basemap offline raster: PMTiles (blob) sau MBTiles (OPFS/blob). */
export function isOfflineRasterBasemapBase(base: BaseMapDef): boolean {
  return Boolean(
    (base.pmtiles && base.pmtilesUrl) || (base.mbtiles && base.mbtilesArchiveKey),
  );
}

function overlayUsesOfflineRaster(ov: BaseMapDef): boolean {
  return Boolean(
    (ov.pmtiles && ov.pmtilesUrl) || (ov.mbtiles && ov.mbtilesArchiveKey),
  );
}

export const BASE_MAPS: BaseMapDef[] = [
  {
    id: 'maplibre-demo',
    label: 'MapLibre Demo',
    description: 'Basemap test (CORS garantat) – pentru debugging',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Tiles: MapLibre demo',
    tileUrls: ['https://demotiles.maplibre.org/tiles/tiles/{z}/{x}/{y}.png'],
    maxzoom: 19,
    /** Nu folosi styleUrl de la demotiles: style-ul lor trage glyph-uri 404 pentru Open Sans. */
    default: true,
  },
  {
    id: 'carto-voyager',
    label: 'Carto Voyager',
    description: 'Basemap rapid, CORS ok',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    tileUrls: [
      'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    ],
    maxzoom: 20,
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    description: 'Topografic - curbe nivel + relief (poate fi blocat de unele browsere/CORS)',
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    tileUrls: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    maxzoom: 17,
  },
  {
    id: 'esri-sat',
    label: 'Satelit (Esri)',
    description: 'Imagini satelitare pentru spotting vizual doline',
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    tileUrls: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    maxzoom: 19,
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    description: 'Drumuri, refugii, izvoare - util pentru access',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    tileUrls: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
  },
  {
    id: 'cyclosm',
    label: 'CyclOSM',
    description: 'Poteci, drumuri neasfaltate, access pedestru',
    attribution:
      'CyclOSM | Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    tileUrls: [
      'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      'https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    ],
    maxzoom: 18,
  },
];

export function getBaseMapById(id: string | null | undefined): BaseMapDef | null {
  if (!id) return null;
  return BASE_MAPS.find((b) => b.id === id) ?? null;
}

export interface BuildBaseStyleOptions {
  /** PMTiles local peste basemap-ul online (ignorat dacă `base` e deja PMTiles). */
  overlay?: BaseMapDef | null;
  overlayOpacity?: number;
}

export function buildBaseStyle(base: BaseMapDef, options?: BuildBaseStyleOptions): StyleSpecification {
  if (base.mbtiles && base.mbtilesArchiveKey) {
    const enc = encodeURIComponent(base.mbtilesArchiveKey);
    const minz = base.pmtilesMinZoom;
    const maxz = base.maxzoom;
    return {
      version: 8,
      glyphs: getMapGlyphsUrl(),
      sources: {
        base: {
          type: 'raster',
          tiles: [`mbtiles-handi://${enc}/{z}/{x}/{y}`],
          tileSize: 256,
          attribution: base.attribution,
          ...(typeof minz === 'number' && Number.isFinite(minz) ? { minzoom: minz } : {}),
          ...(typeof maxz === 'number' && Number.isFinite(maxz) ? { maxzoom: maxz } : {}),
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#0f172a' },
        },
        {
          id: 'base-layer',
          type: 'raster',
          source: 'base',
        },
      ],
    };
  }

  if (base.pmtiles && base.pmtilesUrl) {
    const minz = base.pmtilesMinZoom;
    const maxz = base.maxzoom;
    return {
      version: 8,
      glyphs: getMapGlyphsUrl(),
      sources: {
        base: {
          type: 'raster',
          url: `pmtiles://${base.pmtilesUrl}`,
          tileSize: 256,
          attribution: base.attribution,
          ...(typeof minz === 'number' && Number.isFinite(minz) ? { minzoom: minz } : {}),
          ...(typeof maxz === 'number' && Number.isFinite(maxz) ? { maxzoom: maxz } : {}),
        },
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#0f172a' },
        },
        {
          id: 'base-layer',
          type: 'raster',
          source: 'base',
        },
      ],
    };
  }

  const ov = options?.overlay;
  const hasOverlay = Boolean(ov && overlayUsesOfflineRaster(ov));
  const overlayOpacityRaw = options?.overlayOpacity;
  const overlayOpacity =
    typeof overlayOpacityRaw === 'number' && Number.isFinite(overlayOpacityRaw)
      ? Math.min(1, Math.max(0, overlayOpacityRaw))
      : 0.85;

  if (hasOverlay && ov) {
    const minzO = ov.pmtilesMinZoom;
    const maxzO = ov.maxzoom;
    const overlaySource =
      ov.mbtiles && ov.mbtilesArchiveKey
        ? {
            type: 'raster' as const,
            tiles: [`mbtiles-handi://${encodeURIComponent(ov.mbtilesArchiveKey)}/{z}/{x}/{y}`],
            tileSize: 256,
            attribution: ov.attribution,
            ...(typeof minzO === 'number' && Number.isFinite(minzO) ? { minzoom: minzO } : {}),
            ...(typeof maxzO === 'number' && Number.isFinite(maxzO) ? { maxzoom: maxzO } : {}),
          }
        : {
            type: 'raster' as const,
            url: `pmtiles://${ov.pmtilesUrl ?? ''}`,
            tileSize: 256,
            attribution: ov.attribution,
            ...(typeof minzO === 'number' && Number.isFinite(minzO) ? { minzoom: minzO } : {}),
            ...(typeof maxzO === 'number' && Number.isFinite(maxzO) ? { maxzoom: maxzO } : {}),
          };
    return {
      version: 8,
      glyphs: getMapGlyphsUrl(),
      sources: {
        base: {
          type: 'raster',
          tiles: base.tileUrls,
          tileSize: 256,
          maxzoom: base.maxzoom,
          attribution: base.attribution,
        },
        basemapPmtilesOverlay: overlaySource,
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#0f172a' },
        },
        {
          id: 'base-layer',
          type: 'raster',
          source: 'base',
        },
        {
          id: 'basemap-pmtiles-overlay',
          type: 'raster',
          source: 'basemapPmtilesOverlay',
          paint: { 'raster-opacity': overlayOpacity },
        },
      ],
    };
  }

  return {
    version: 8,
    glyphs: getMapGlyphsUrl(),
    sources: {
      base: {
        type: 'raster',
        tiles: base.tileUrls,
        tileSize: 256,
        maxzoom: base.maxzoom,
        attribution: base.attribution,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0f172a' },
      },
      {
        id: 'base-layer',
        type: 'raster',
        source: 'base',
      },
    ],
  };
}

export function getDefaultBaseMap(): BaseMapDef {
  return BASE_MAPS.find((b) => b.default) ?? BASE_MAPS[0];
}
