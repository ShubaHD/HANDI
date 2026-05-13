import type { MbtilesTileScheme, ParsedMbtilesMeta } from '@/lib/mbtiles/mbtilesMeta';

export type MbtilesWorkerReqBody =
  | { type: 'open-opfs'; key: string; opfsAbsPath: string }
  | { type: 'open-buffer'; key: string; buffer: ArrayBuffer }
  | { type: 'tile'; key: string; z: number; x: number; y: number }
  | { type: 'close'; key: string };

export type MbtilesWorkerReq = { id: number } & MbtilesWorkerReqBody;

export type MbtilesOpenResult = ParsedMbtilesMeta & {
  minzoom: number | null;
  maxzoom: number | null;
  tileScheme: MbtilesTileScheme;
};

export type MbtilesWorkerPayload =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string };
