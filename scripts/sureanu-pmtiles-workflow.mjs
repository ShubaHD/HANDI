/**
 * Flux recomandat: PMTiles pentru Munții Șureanu fără fetch în browser (CORS).
 * Rulează: npm run verify:offline-pmtiles-workflow
 * Cu fișier: node scripts/sureanu-pmtiles-workflow.mjs cale\\catre\\arhiva.pmtiles
 */
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { PMTiles } from 'pmtiles';

const SUREANU_BBOX = {
  label: 'Munții Șureanu (orientativ WGS84, rafinați în QGIS)',
  west: 23.25,
  south: 45.33,
  east: 23.78,
  north: 45.58,
};

function printInstructions() {
  console.log('=== HANDI — PMTiles offline (zonă Șureanu) ===\n');
  console.log('BBox orientativ:', SUREANU_BBOX);
  console.log('');
  console.log('Pași:');
  console.log('  1) În QGIS / GDAL, exportați raster tiles sau MBTiles pentru bbox-ul de mai sus.');
  console.log('  2) Convertiți la PMTiles cu go-pmtiles (vezi lidar/README.md), de ex.:');
  console.log('       pmtiles convert zona.mbtiles sureanu.pmtiles');
  console.log('  3) În aplicație (MapLibre): panou hartă → „+ adauga” → alegeți .pmtiles.');
  console.log('  4) Opțional: „Strat offline peste harta” pentru a suprapune peste Carto/OSM online.');
  console.log('');
}

async function validateFile(fileArg) {
  const abs = resolve(fileArg);
  const buf = await readFile(abs);
  const blob = new Blob([buf]);
  const url = URL.createObjectURL(blob);
  try {
    const pm = new PMTiles(url);
    const h = await pm.getHeader();
    console.log('Fișier:', abs);
    console.log('  bounds WGS84:', [h.minLon, h.minLat, h.maxLon, h.maxLat]);
    console.log('  zoom:', `${h.minZoom}..${h.maxZoom}`);
    console.log('  tileType:', h.tileType);
    console.log('OK — arhiva se poate importa în HANDI.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function main() {
  printInstructions();
  const filePath = process.argv[2];
  if (!filePath) {
    console.log('(Opțional) Validează un PMTiles local:');
    console.log('  node scripts/sureanu-pmtiles-workflow.mjs .\\sureanu.pmtiles');
    return;
  }
  try {
    await validateFile(filePath);
  } catch (e) {
    console.error('Eroare la citirea PMTiles:', e?.message ?? e);
    process.exit(1);
  }
}

main();
