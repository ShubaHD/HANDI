/// <reference lib="webworker" />

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import sqlJsWasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import {
  assertRasterMbtilesFormat,
  inferMbtilesTileScheme,
  parseMetadataMap,
  type MbtilesTileScheme,
} from '@/lib/mbtiles/mbtilesMeta';
import type { MbtilesOpenResult, MbtilesWorkerReq } from '@/lib/mbtiles/mbtilesWorkerTypes';

type Entry =
  | {
      kind: 'opfs';
      db: { prepare: (s: string) => any; close: () => void; exec: (o: unknown) => void };
      tileScheme: MbtilesTileScheme;
    }
  | { kind: 'sqljs'; db: import('sql.js').Database; tileScheme: MbtilesTileScheme };

const entries = new Map<string, Entry>();
let sqlite3Mod: Awaited<ReturnType<typeof sqlite3InitModule>> | null = null;
let sqlJsMod: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function ensureSqliteWasm(): Promise<Awaited<ReturnType<typeof sqlite3InitModule>>> {
  if (sqlite3Mod) return sqlite3Mod;
  // locateFile e acceptat la runtime de sqlite-wasm; tipurile npm uneori omit primul argument.
  sqlite3Mod = await (
    sqlite3InitModule as (cfg?: { locateFile?: (f: string) => string }) => Promise<
      Awaited<ReturnType<typeof sqlite3InitModule>>
    >
  )({
    locateFile: (f: string) => (f.endsWith('.wasm') ? wasmUrl : f),
  });
  return sqlite3Mod;
}

async function ensureSqlJs(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (sqlJsMod) return sqlJsMod;
  sqlJsMod = await initSqlJs({ locateFile: (f: string) => (f.endsWith('.wasm') ? sqlJsWasmUrl : f) });
  return sqlJsMod;
}

function validateSchemaOo1(db: { prepare: (s: string) => any }) {
  const stmt = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tiles' LIMIT 1",
  );
  try {
    if (!stmt.step()) throw new Error('MBTiles invalid: lipseste tabelul tiles.');
  } finally {
    stmt.finalize();
  }
}

function validateSchemaSqlJs(db: import('sql.js').Database) {
  const r = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tiles','metadata')",
  );
  const names = new Set<string>();
  for (const block of r) {
    for (const row of block.values) {
      if (row[0]) names.add(String(row[0]));
    }
  }
  if (!names.has('tiles')) throw new Error('MBTiles invalid: lipseste tabelul tiles.');
}

function metaMapOo1(db: { prepare: (s: string) => any }): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const stmt = db.prepare('SELECT name, value FROM metadata');
    try {
      while (stmt.step()) {
        const k = stmt.getString(0);
        const v = stmt.getString(1);
        if (k != null) out[k] = v ?? '';
      }
    } finally {
      stmt.finalize();
    }
  } catch {
    /* fără tabel metadata */
  }
  return out;
}

function metaMapSqlJs(db: import('sql.js').Database): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const res = db.exec('SELECT name, value FROM metadata');
    for (const block of res) {
      for (const row of block.values) {
        if (row[0] != null) out[String(row[0])] = String(row[1] ?? '');
      }
    }
  } catch {
    /* metadata lipsă */
  }
  return out;
}

function zoomRangeOo1(db: { prepare: (s: string) => any }): { min: number | null; max: number | null } {
  const stmt = db.prepare('SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles');
  try {
    if (!stmt.step()) return { min: null, max: null };
    const a = stmt.get(0);
    const b = stmt.get(1);
    const min = typeof a === 'number' && Number.isFinite(a) ? Math.round(a) : null;
    const max = typeof b === 'number' && Number.isFinite(b) ? Math.round(b) : null;
    return { min, max };
  } finally {
    stmt.finalize();
  }
}

function zoomRangeSqlJs(db: import('sql.js').Database): { min: number | null; max: number | null } {
  const res = db.exec('SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles');
  if (!res[0]?.values?.length) return { min: null, max: null };
  const row = res[0].values[0];
  const min = row[0] != null && Number.isFinite(Number(row[0])) ? Math.round(Number(row[0])) : null;
  const max = row[1] != null && Number.isFinite(Number(row[1])) ? Math.round(Number(row[1])) : null;
  return { min, max };
}

function parseOpenMeta(metaMap: Record<string, string>, zoomFallback: { min: number | null; max: number | null }) {
  const base = parseMetadataMap(metaMap);
  assertRasterMbtilesFormat(base.format);
  let minz = base.minzoom;
  let maxz = base.maxzoom;
  if (minz == null) minz = zoomFallback.min;
  if (maxz == null) maxz = zoomFallback.max;
  const tileScheme = inferMbtilesTileScheme(metaMap);
  return {
    bounds: base.bounds,
    minzoom: minz,
    maxzoom: maxz,
    format: base.format,
    name: base.name,
    tileScheme,
  } satisfies MbtilesOpenResult;
}

function tileOo1(
  db: { prepare: (s: string) => any },
  z: number,
  x: number,
  yXyz: number,
  scheme: MbtilesTileScheme,
): Uint8Array | null {
  const tileRow = scheme === 'xyz' ? yXyz : (1 << z) - 1 - yXyz;
  const stmt = db.prepare(
    'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
  );
  try {
    stmt.bind([z, x, tileRow]);
    if (!stmt.step()) return null;
    return stmt.getBlob(0) as Uint8Array;
  } finally {
    stmt.finalize();
  }
}

function tileSqlJs(
  db: import('sql.js').Database,
  z: number,
  x: number,
  yXyz: number,
  scheme: MbtilesTileScheme,
): Uint8Array | null {
  const tileRow = scheme === 'xyz' ? yXyz : (1 << z) - 1 - yXyz;
  const stmt = db.prepare(
    'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
  );
  stmt.bind([z, x, tileRow]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.get() as unknown[];
  stmt.free();
  const cell = row[0];
  return cell instanceof Uint8Array ? cell : null;
}

async function handleOpenOpfs(key: string, opfsAbsPath: string): Promise<MbtilesOpenResult> {
  const sqlite3 = await ensureSqliteWasm();
  const OpfsDb = sqlite3.oo1.OpfsDb as
    | (new (filename: string, flags?: string) => {
        prepare: (s: string) => any;
        close: () => void;
        exec: (o: unknown) => void;
      })
    | undefined;
  if (!OpfsDb) {
    throw new Error(
      'MBTiles OPFS indisponibil (SharedArrayBuffer / headers COOP+COEP). Reîncarcă pagina sau foloseste HTTPS.',
    );
  }
  const db = new OpfsDb(opfsAbsPath, 'r');
  try {
    validateSchemaOo1(db);
  } catch (e) {
    db.close();
    throw e;
  }
  const metaMap = metaMapOo1(db);
  const zr = zoomRangeOo1(db);
  const parsed = parseOpenMeta(metaMap, zr);
  entries.set(key, { kind: 'opfs', db, tileScheme: parsed.tileScheme });
  return parsed;
}

async function handleOpenBuffer(key: string, buffer: ArrayBuffer): Promise<MbtilesOpenResult> {
  const SQL = await ensureSqlJs();
  const db = new SQL.Database(new Uint8Array(buffer));
  validateSchemaSqlJs(db);
  const metaMap = metaMapSqlJs(db);
  const zr = zoomRangeSqlJs(db);
  const parsed = parseOpenMeta(metaMap, zr);
  entries.set(key, { kind: 'sqljs', db, tileScheme: parsed.tileScheme });
  return parsed;
}

function handleTile(key: string, z: number, x: number, y: number): Uint8Array | null {
  const e = entries.get(key);
  if (!e) throw new Error('MBTiles: baza nu e deschisa.');
  if (e.kind === 'opfs') return tileOo1(e.db, z, x, y, e.tileScheme);
  return tileSqlJs(e.db, z, x, y, e.tileScheme);
}

function handleClose(key: string) {
  const e = entries.get(key);
  if (!e) return;
  try {
    e.db.close();
  } finally {
    entries.delete(key);
  }
}

function postErr(id: number, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  postMessage({ id, ok: false as const, error: msg });
}

self.onmessage = async (ev: MessageEvent<MbtilesWorkerReq>) => {
  const msg = ev.data;
  const { id } = msg;
  try {
    if (msg.type === 'open-opfs') {
      const result = await handleOpenOpfs(msg.key, msg.opfsAbsPath);
      postMessage({ id, ok: true as const, result });
      return;
    }
    if (msg.type === 'open-buffer') {
      const result = await handleOpenBuffer(msg.key, msg.buffer);
      postMessage({ id, ok: true as const, result });
      return;
    }
    if (msg.type === 'tile') {
      const data = handleTile(msg.key, msg.z, msg.x, msg.y);
      if (!data) {
        postMessage({ id, ok: true as const, result: { data: null } });
        return;
      }
      const ab =
        data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
          ? data.buffer
          : data.slice().buffer;
      postMessage({ id, ok: true as const, result: { data: ab } }, [ab]);
      return;
    }
    if (msg.type === 'close') {
      handleClose(msg.key);
      postMessage({ id, ok: true as const });
      return;
    }
    postErr(id, new Error('Mesaj worker necunoscut'));
  } catch (e) {
    postErr(id, e);
  }
};
