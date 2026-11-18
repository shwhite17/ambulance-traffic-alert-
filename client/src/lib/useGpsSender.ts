import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

const SEND_EVERY_MS = 2_000;
const MAX_QUEUE = 60;

export type GpsStatus = 'idle' | 'waiting' | 'ok' | 'denied' | 'unavailable';

/**
 * Streams the phone's GPS to the server every ~2 s. Fixes are queued while the
 * network is down and flushed in order when it returns, so the server's
 * pipeline still sees a consistent track (it rejects out-of-order fixes).
 */
export function useGpsSender(tripId: number | null, token: string, enabled: boolean) {
  const [status, setStatus] = useState<GpsStatus>('idle');
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const queue = useRef<{ lat: number; lng: number; accuracy: number; ts: number }[]>([]);
  const lastQueuedAt = useRef(0);

  useEffect(() => {
    if (!enabled || tripId === null) return;
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      return;
    }
    setStatus('waiting');
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus('ok');
        setAccuracy(Math.round(pos.coords.accuracy));
        const now = Date.now();
        if (now - lastQueuedAt.current < SEND_EVERY_MS) return;
        lastQueuedAt.current = now;
        queue.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, ts: pos.timestamp || now });
        if (queue.current.length > MAX_QUEUE) queue.current.splice(0, queue.current.length - MAX_QUEUE);
        setQueued(queue.current.length);
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );

    let flushing = false;
    const flush = async () => {
      if (flushing) return;
      flushing = true;
      try {
        while (queue.current.length) {
          const fix = queue.current[0]!;
          try {
            await api(`/trips/${tripId}/location`, { body: fix, token });
            setOnline(true);
          } catch (e) {
            // Network error: keep the fix and retry later. Server rejected it
            // (validation, rate limit): drop it so the queue can't jam.
            if (e instanceof ApiError && e.status === 0) {
              setOnline(false);
              break;
            }
          }
          queue.current.shift();
          setQueued(queue.current.length);
        }
      } finally {
        flushing = false;
      }
    };
    const timer = window.setInterval(flush, 1_000);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
    };
  }, [tripId, token, enabled]);

  return { status, queued, online, accuracy };
}

/** Ask for permission up front so we can show a clear error before starting a trip. */
export function checkGps(): Promise<'ok' | 'denied' | 'unavailable'> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve('unavailable');
    navigator.geolocation.getCurrentPosition(
      () => resolve('ok'),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}
