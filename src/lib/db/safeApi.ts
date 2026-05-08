import { createPoint as remoteCreatePoint, deletePoint as remoteDeletePoint } from '@/features/points/api';
import {
  createZone as remoteCreateZone,
  deleteZone as remoteDeleteZone,
  updateZoneStatus as remoteUpdateZoneStatus,
} from '@/features/zones/api';
import { createTrack as remoteCreateTrack, deleteTrack as remoteDeleteTrack } from '@/features/tracks/api';
import {
  createAnnotation as remoteCreateAnnotation,
  deleteAnnotation as remoteDeleteAnnotation,
  type NewAnnotationInput,
} from '@/features/annotations/api';
import type { NewPointInput } from '@/features/points/api';
import type { NewZoneInput } from '@/features/zones/api';
import type { NewTrackInput } from '@/features/tracks/api';
import type { Annotation, PointOfInterest, Track, Zone } from '@/lib/types';
import { enqueue } from './syncQueue';

function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) return true;
  if (e instanceof Error && /networkerror|fetch/i.test(e.message)) return true;
  return false;
}

export type SafeResult<T> =
  | { ok: 'remote'; data: T }
  | { ok: 'queued' };

export async function safeCreatePoint(
  input: NewPointInput,
): Promise<SafeResult<PointOfInterest>> {
  try {
    const data = await remoteCreatePoint(input);
    return { ok: 'remote', data };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('createPoint', input);
      return { ok: 'queued' };
    }
    throw e;
  }
}

export async function safeDeletePoint(id: string): Promise<SafeResult<void>> {
  try {
    await remoteDeletePoint(id);
    return { ok: 'remote', data: undefined };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('deletePoint', { id });
      return { ok: 'queued' };
    }
    throw e;
  }
}

export async function safeCreateZone(input: NewZoneInput): Promise<SafeResult<Zone>> {
  try {
    const data = await remoteCreateZone(input);
    return { ok: 'remote', data };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('createZone', input);
      return { ok: 'queued' };
    }
    throw e;
  }
}

export async function safeDeleteZone(id: string): Promise<SafeResult<void>> {
  try {
    await remoteDeleteZone(id);
    return { ok: 'remote', data: undefined };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('deleteZone', { id });
      return { ok: 'queued' };
    }
    throw e;
  }
}

export async function safeUpdateZoneStatus(
  id: string,
  status: 'todo' | 'in_progress' | 'done' | 'rejected',
): Promise<SafeResult<void>> {
  try {
    await remoteUpdateZoneStatus(id, status);
    return { ok: 'remote', data: undefined };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('updateZoneStatus', { id, status });
      return { ok: 'queued' };
    }
    throw e;
  }
}

export async function safeCreateTrack(input: NewTrackInput): Promise<SafeResult<Track>> {
  try {
    const data = await remoteCreateTrack(input);
    return { ok: 'remote', data };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('createTrack', input);
      return { ok: 'queued' };
    }
    throw e;
  }
}

export async function safeDeleteTrack(id: string): Promise<SafeResult<void>> {
  try {
    await remoteDeleteTrack(id);
    return { ok: 'remote', data: undefined };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('deleteTrack', { id });
      return { ok: 'queued' };
    }
    throw e;
  }
}

export async function safeCreateAnnotation(
  input: NewAnnotationInput,
): Promise<SafeResult<Annotation>> {
  try {
    const data = await remoteCreateAnnotation(input);
    return { ok: 'remote', data };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('createAnnotation', input);
      return { ok: 'queued' };
    }
    throw e;
  }
}

export async function safeDeleteAnnotation(id: string): Promise<SafeResult<void>> {
  try {
    await remoteDeleteAnnotation(id);
    return { ok: 'remote', data: undefined };
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue('deleteAnnotation', { id });
      return { ok: 'queued' };
    }
    throw e;
  }
}
