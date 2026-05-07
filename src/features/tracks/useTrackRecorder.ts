import { useCallback, useEffect, useRef, useState } from 'react';
import { length as turfLength } from '@turf/turf';

const STORAGE_KEY = 'handi-track-recording';

export interface RecordedPoint {
  lng: number;
  lat: number;
  ele: number | null;
  ts: number;
  acc: number | null;
}

export interface RecorderState {
  active: boolean;
  paused: boolean;
  points: RecordedPoint[];
  distanceM: number;
  durationS: number;
  startedAt: number | null;
}

interface PersistedState {
  startedAt: number | null;
  points: RecordedPoint[];
  paused: boolean;
}

const MIN_DIST_M = 5;
const MIN_INTERVAL_MS = 2000;

export function useTrackRecorder() {
  const [state, setState] = useState<RecorderState>(() => loadState());
  const watchRef = useRef<number | null>(null);
  const lastSavedRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  const persist = useCallback((s: RecorderState) => {
    if (s.active || s.points.length > 0) {
      const data: PersistedState = {
        startedAt: s.startedAt,
        points: s.points,
        paused: s.paused,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const start = useCallback(() => {
    setState((prev) => {
      const next: RecorderState = {
        active: true,
        paused: false,
        points: prev.points.length > 0 && prev.startedAt ? prev.points : [],
        distanceM: prev.points.length > 0 ? prev.distanceM : 0,
        durationS: 0,
        startedAt: prev.startedAt ?? Date.now(),
      };
      persist(next);
      return next;
    });
  }, [persist]);

  const pause = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, active: false, paused: true };
      persist(next);
      return next;
    });
  }, [persist]);

  const resume = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, active: true, paused: false };
      persist(next);
      return next;
    });
  }, [persist]);

  const stop = useCallback(() => {
    setState((prev) => {
      const next: RecorderState = { ...prev, active: false, paused: false };
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState({
      active: false,
      paused: false,
      points: [],
      distanceM: 0,
      durationS: 0,
      startedAt: null,
    });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (state.active && navigator.geolocation) {
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const p: RecordedPoint = {
            lng: pos.coords.longitude,
            lat: pos.coords.latitude,
            ele: pos.coords.altitude ?? null,
            ts: pos.timestamp,
            acc: pos.coords.accuracy ?? null,
          };
          setState((prev) => {
            if (!prev.active) return prev;
            const last = prev.points[prev.points.length - 1];
            if (last) {
              const dt = p.ts - last.ts;
              if (dt < MIN_INTERVAL_MS) return prev;
              const d = haversine(last.lng, last.lat, p.lng, p.lat);
              if (d < MIN_DIST_M) return prev;
            }
            const points = [...prev.points, p];
            const distanceM = computeDistance(points);
            const next = { ...prev, points, distanceM };
            const now = Date.now();
            if (now - lastSavedRef.current > 5000) {
              lastSavedRef.current = now;
              persist(next);
            }
            return next;
          });
        },
        (err) => {
          console.warn('[recorder] geolocation error', err);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
      );
      watchRef.current = id;
      return () => {
        if (watchRef.current != null) {
          navigator.geolocation.clearWatch(watchRef.current);
          watchRef.current = null;
        }
      };
    }
  }, [state.active, persist]);

  useEffect(() => {
    if (state.active && state.startedAt) {
      const tick = () => {
        setState((prev) => {
          if (!prev.active || !prev.startedAt) return prev;
          return { ...prev, durationS: Math.round((Date.now() - prev.startedAt) / 1000) };
        });
      };
      tickRef.current = window.setInterval(tick, 1000);
      tick();
      return () => {
        if (tickRef.current != null) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
      };
    }
  }, [state.active, state.startedAt]);

  const toLineString = useCallback((): GeoJSON.LineString | null => {
    if (state.points.length < 2) return null;
    return {
      type: 'LineString',
      coordinates: state.points.map((p) => (p.ele != null ? [p.lng, p.lat, p.ele] : [p.lng, p.lat])),
    };
  }, [state.points]);

  return { state, start, pause, resume, stop, reset, toLineString };
}

function loadState(): RecorderState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        active: false,
        paused: false,
        points: [],
        distanceM: 0,
        durationS: 0,
        startedAt: null,
      };
    }
    const data = JSON.parse(raw) as PersistedState;
    return {
      active: false,
      paused: data.paused ?? !!data.points.length,
      points: data.points,
      distanceM: computeDistance(data.points),
      durationS: 0,
      startedAt: data.startedAt,
    };
  } catch {
    return {
      active: false,
      paused: false,
      points: [],
      distanceM: 0,
      durationS: 0,
      startedAt: null,
    };
  }
}

function computeDistance(points: RecordedPoint[]): number {
  if (points.length < 2) return 0;
  const line: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
  };
  return turfLength(line, { units: 'kilometers' }) * 1000;
}

function haversine(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
