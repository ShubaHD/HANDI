import type { StyleSpecification } from 'maplibre-gl';

export interface BaseMapDef {
  id: string;
  label: string;
  description: string;
  attribution: string;
  tileUrls: string[];
  maxzoom: number;
  default?: boolean;
  /** Daca e setat, sursa va folosi `url: pmtilesUrl` (PMTiles raster), nu `tiles`. */
  pmtiles?: boolean;
  pmtilesUrl?: string;
}

export const BASE_MAPS: BaseMapDef[] = [
  {
    id: 'carto-voyager',
    label: 'Carto Voyager',
    description: 'Basemap rapid, CORS ok (default)',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    tileUrls: [
      'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
      'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    ],
    maxzoom: 20,
    default: true,
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

export function buildBaseStyle(base: BaseMapDef): StyleSpecification {
  if (base.pmtiles && base.pmtilesUrl) {
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        base: {
          type: 'raster',
          url: `pmtiles://${base.pmtilesUrl}`,
          tileSize: 256,
          attribution: base.attribution,
        },
      },
      layers: [
        {
          id: 'base-layer',
          type: 'raster',
          source: 'base',
        },
      ],
    };
  }

  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
