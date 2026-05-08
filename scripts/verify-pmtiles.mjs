import { PMTiles } from 'pmtiles';

function hex(u8, n = 16) {
  return Array.from(u8.slice(0, n))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

function isPng(u8) {
  return (
    u8.length >= 8 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47 &&
    u8[4] === 0x0d &&
    u8[5] === 0x0a &&
    u8[6] === 0x1a &&
    u8[7] === 0x0a
  );
}

function isJpeg(u8) {
  return u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;
}

async function checkRange(url) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  const contentRange = res.headers.get('content-range');
  const acceptRanges = res.headers.get('accept-ranges');
  const len = res.headers.get('content-length');
  return {
    ok: res.status === 206,
    status: res.status,
    acceptRanges,
    contentRange,
    contentLength: len,
  };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/verify-pmtiles.mjs <pmtiles_url>');
    process.exit(2);
  }

  console.log(`PMTiles URL: ${url}`);

  const range = await checkRange(url);
  console.log('Range check:');
  console.log(`  status: ${range.status} (expect 206)`);
  console.log(`  accept-ranges: ${range.acceptRanges ?? '(missing)'}`);
  console.log(`  content-range: ${range.contentRange ?? '(missing)'}`);
  console.log(`  content-length: ${range.contentLength ?? '(missing)'}`);
  if (!range.ok) {
    console.log('FAIL: Server does not support HTTP Range correctly (PMTiles will not stream).');
    process.exit(1);
  }

  const pm = new PMTiles(url);
  const header = await pm.getHeader();
  console.log('Header:');
  console.log(
    `  bounds: [${header.minLon}, ${header.minLat}] - [${header.maxLon}, ${header.maxLat}]`,
  );
  console.log(`  zoom: ${header.minZoom}..${header.maxZoom}`);
  console.log(`  tileType: ${header.tileType}`);
  console.log(`  tileCompression: ${header.tileCompression}`);
  console.log(`  internalCompression: ${header.internalCompression}`);

  // Try to fetch the center tile at max zoom.
  const z = header.maxZoom ?? header.minZoom;
  if (typeof z !== 'number' || !Number.isFinite(z)) {
    console.log('FAIL: Missing zoom info in header.');
    process.exit(1);
  }

  const lon = (header.minLon + header.maxLon) / 2;
  const lat = (header.minLat + header.maxLat) / 2;
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );

  console.log(`Tile probe: z=${z} x=${x} y=${y}`);
  const tile = await pm.getZxy(z, x, y);
  if (!tile) {
    console.log('FAIL: getZxy returned null (no tile at computed center).');
    process.exit(1);
  }

  const u8 = new Uint8Array(tile.data);
  console.log(`Tile bytes: ${u8.byteLength}`);
  console.log(`Tile head: ${hex(u8, 32)}`);
  if (isPng(u8)) console.log('Tile signature: PNG OK');
  else if (isJpeg(u8)) console.log('Tile signature: JPEG OK');
  else console.log('Tile signature: UNKNOWN (may be invalid image bytes)');

  console.log('DONE');
}

main().catch((e) => {
  console.error('ERROR:', e?.stack || e);
  process.exit(1);
});

