import { db, type PendingMutation } from './dexie';
import { createPoint, deletePoint, type NewPointInput } from '@/features/points/api';
import {
  createZone,
  deleteZone,
  updateZoneStatus,
  type NewZoneInput,
} from '@/features/zones/api';
import { createTrack, deleteTrack, type NewTrackInput } from '@/features/tracks/api';
import {
  createAnnotation,
  deleteAnnotation,
  updateAnnotation,
  type NewAnnotationInput,
} from '@/features/annotations/api';

const MAX_ATTEMPTS = 10;

interface PointPayload extends NewPointInput {}
interface ZonePayload extends NewZoneInput {}
interface TrackPayload extends NewTrackInput {}
type AnnotationPayload = NewAnnotationInput;

export async function enqueue(kind: PendingMutation['kind'], payload: unknown): Promise<void> {
  await db.pendingMutations.add({
    kind,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  });
}

export async function pendingCount(): Promise<number> {
  return db.pendingMutations.count();
}

export async function processQueue(): Promise<{ flushed: number; failed: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { flushed: 0, failed: 0 };
  }

  const items = await db.pendingMutations.orderBy('createdAt').toArray();
  let flushed = 0;
  let failed = 0;

  for (const item of items) {
    if (item.id == null) continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    try {
      await applyMutation(item);
      await db.pendingMutations.delete(item.id);
      flushed++;
    } catch (e) {
      failed++;
      await db.pendingMutations.update(item.id, {
        attempts: item.attempts + 1,
        lastError: e instanceof Error ? e.message : 'Eroare',
      });
    }
  }

  return { flushed, failed };
}

async function applyMutation(m: PendingMutation): Promise<void> {
  switch (m.kind) {
    case 'createPoint':
      await createPoint(m.payload as PointPayload);
      return;
    case 'deletePoint':
      await deletePoint((m.payload as { id: string }).id);
      return;
    case 'createZone':
      await createZone(m.payload as ZonePayload);
      return;
    case 'updateZoneStatus': {
      const p = m.payload as { id: string; status: 'todo' | 'in_progress' | 'done' | 'rejected' };
      await updateZoneStatus(p.id, p.status);
      return;
    }
    case 'deleteZone':
      await deleteZone((m.payload as { id: string }).id);
      return;
    case 'createTrack':
      await createTrack(m.payload as TrackPayload);
      return;
    case 'deleteTrack':
      await deleteTrack((m.payload as { id: string }).id);
      return;
    case 'createAnnotation':
      await createAnnotation(m.payload as AnnotationPayload);
      return;
    case 'deleteAnnotation':
      await deleteAnnotation((m.payload as { id: string }).id);
      return;
    case 'updateAnnotation': {
      const p = m.payload as { id: string; patch: unknown };
      await updateAnnotation(p.id, p.patch as never);
      return;
    }
  }
}

export function startBackgroundSync(onChange: () => void): () => void {
  const tick = () => {
    void processQueue().then(({ flushed }) => {
      if (flushed > 0) onChange();
    });
  };
  const interval = window.setInterval(tick, 30_000);
  const onOnline = () => tick();
  window.addEventListener('online', onOnline);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener('online', onOnline);
  };
}
