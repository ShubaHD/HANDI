import MbtilesWorker from '@/lib/mbtiles/mbtiles.worker?worker';
import type { MbtilesOpenResult, MbtilesWorkerPayload, MbtilesWorkerReqBody } from '@/lib/mbtiles/mbtilesWorkerTypes';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new MbtilesWorker();
    worker.onmessage = (ev: MessageEvent<MbtilesWorkerPayload>) => {
      const d = ev.data;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d.result);
      else p.reject(new Error(d.error));
    };
    worker.onerror = (err) => {
      for (const [, pr] of pending) pr.reject(new Error(err.message));
      pending.clear();
    };
  }
  return worker;
}

function rpc<R>(msg: MbtilesWorkerReqBody, transfer?: Transferable[]): Promise<R> {
  const id = ++seq;
  const w = getWorker();
  return new Promise<R>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ ...msg, id } as { id: number } & MbtilesWorkerReqBody, transfer ?? []);
  });
}

export function mbtilesWorkerOpenOpfs(key: string, opfsAbsPath: string): Promise<MbtilesOpenResult> {
  return rpc({ type: 'open-opfs', key, opfsAbsPath });
}

export function mbtilesWorkerOpenBuffer(key: string, buffer: ArrayBuffer): Promise<MbtilesOpenResult> {
  return rpc({ type: 'open-buffer', key, buffer }, [buffer]);
}

export async function mbtilesWorkerTile(
  key: string,
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer | null> {
  const r = await rpc<{ data: ArrayBuffer | null }>({ type: 'tile', key, z, x, y });
  return r?.data ?? null;
}

export function mbtilesWorkerClose(key: string): Promise<void> {
  return rpc<void>({ type: 'close', key });
}
