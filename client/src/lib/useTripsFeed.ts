import { useCallback, useState } from 'react';
import { useSocket } from './socket';
import type { AlertView, Session, TripSummary, TripView } from './types';

export interface FeedEvent {
  id: number;
  ts: number;
  kind: 'alert' | 'escalated' | 'ack' | 'passed' | 'trip' | 'offline' | 'online' | 'hospital';
  text: string;
  tripId: number;
}

let seq = 0;
const FEED_MAX = 40;

/**
 * One server event → one feed line (or null if not feed-worthy). Used both for
 * live events and for replaying the server's history after a page reload, so
 * the two can never drift apart.
 */
function describe(event: string, p: any, ts: number): FeedEvent | null {
  const line = (kind: FeedEvent['kind'], tripId: number, text: string): FeedEvent => ({ id: ++seq, ts, kind, tripId, text });
  switch (event) {
    case 'trip:started':
      return line('trip', p.id, `Trip #${p.id} started → ${p.hospital.name}${p.simulated ? ' (simulated)' : ''}`);
    case 'trip:hospital':
      return line('hospital', p.id, `${p.hospital.name} updated trip #${p.id}`);
    case 'alert:new': {
      const s = p.signal;
      const rule = s.trigger === 'eta' ? 'ETA rule' : s.trigger === 'distance' ? 'distance rule' : 'both rules';
      return line('alert', p.tripId, `${s.name}: ALERT at ${s.alertDistanceM} m / ${s.alertEtaS} s (${rule})`);
    }
    case 'alert:escalated':
      return line('escalated', p.tripId, `${p.signal.name}: NO ACK — escalated to backup + control room`);
    case 'alert:ack': {
      const s = p.signal;
      const secs = s.acknowledgedAt && s.alertedAt ? ((s.acknowledgedAt - s.alertedAt) / 1000).toFixed(1) : '?';
      return line('ack', p.tripId, `${s.name}: acknowledged in ${secs} s`);
    }
    case 'alert:passed':
      return p.alertId ? line('passed', p.tripId, `${p.signal.name}: ambulance passed`) : null;
    case 'trip:offline':
      return line('offline', p.tripId, `Trip #${p.tripId}: driver offline (no GPS for 10 s)`);
    case 'trip:online':
      return line('online', p.tripId, `Trip #${p.tripId}: driver back online`);
    case 'trip:ended':
      return line('trip', p.tripId, `Trip #${p.tripId} ended (${p.summary.endReason.replace(/_/g, ' ')})`);
    default:
      return null;
  }
}

/**
 * Live view of active trips for any role, built from socket events.
 * Per-ping `location:update` payloads omit route geometry, so we keep the
 * coordinates from the first full view.
 */
export function useTripsFeed(
  session: Session | null,
  opts: { onEnded?: (tripId: number, summary: TripSummary) => void; onReset?: () => void } = {},
) {
  const [trips, setTrips] = useState<Map<number, TripView>>(new Map());
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [ended, setEnded] = useState<Map<number, TripSummary>>(new Map());
  const [simState, setSimState] = useState<Map<number, { speedKmh: number; paused: boolean }>>(new Map());
  /** Officer phones connected per junction id (control room only). */
  const [presence, setPresence] = useState<Record<number, number>>({});

  const log = useCallback((event: string, payload: unknown) => {
    const e = describe(event, payload, Date.now());
    if (e) setEvents((prev) => [e, ...prev].slice(0, FEED_MAX));
  }, []);

  const mergeTrip = useCallback((v: TripView) => {
    setTrips((prev) => {
      const old = prev.get(v.id);
      const coordinates = v.route.coordinates.length ? v.route.coordinates : (old?.route.coordinates ?? []);
      return new Map(prev).set(v.id, { ...v, route: { ...v.route, coordinates } });
    });
  }, []);

  const mergeSignal = useCallback((a: AlertView) => {
    setTrips((prev) => {
      const t = prev.get(a.tripId);
      if (!t) return prev;
      const signals = t.signals.map((s) => (s.signalId === a.signal.signalId ? a.signal : s));
      return new Map(prev).set(t.id, { ...t, signals });
    });
  }, []);

  const setOffline = (tripId: number, offline: boolean) =>
    setTrips((prev) => {
      const t = prev.get(tripId);
      return t ? new Map(prev).set(t.id, { ...t, offline }) : prev;
    });

  const alertHandler = (event: string) => (a: AlertView) => {
    mergeSignal(a);
    log(event, a);
  };

  const { connected, socket } = useSocket(session?.token, {
    presence: (p: Record<number, number>) => setPresence(p),
    snapshot: (s: { trips: TripView[]; events?: { event: string; payload: unknown; ts: number }[]; presence?: Record<number, number> }) => {
      if (s.presence) setPresence(s.presence);
      setTrips((prev) => {
        const next = new Map<number, TripView>();
        for (const t of s.trips) {
          const old = prev.get(t.id);
          next.set(t.id, t.route.coordinates.length || !old ? t : { ...t, route: old.route });
        }
        return next;
      });
      // Control room: rebuild the feed from server history (newest first).
      if (s.events) {
        setEvents(
          s.events
            .map((h) => describe(h.event, h.payload, h.ts))
            .filter((e): e is FeedEvent => e !== null)
            .reverse()
            .slice(0, FEED_MAX),
        );
      }
    },
    'demo:reset': () => {
      setTrips(new Map());
      setEvents([]);
      setEnded(new Map());
      setSimState(new Map());
      opts.onReset?.();
    },
    'trip:started': (v: TripView) => {
      mergeTrip(v);
      log('trip:started', v);
    },
    'location:update': mergeTrip,
    'trip:hospital': (v: TripView) => {
      mergeTrip(v);
      log('trip:hospital', v);
    },
    'alert:new': alertHandler('alert:new'),
    'alert:escalated': alertHandler('alert:escalated'),
    'alert:ack': alertHandler('alert:ack'),
    'alert:passed': alertHandler('alert:passed'),
    'alert:closed': mergeSignal,
    'trip:offline': (p: { tripId: number }) => {
      setOffline(p.tripId, true);
      log('trip:offline', p);
    },
    'trip:online': (p: { tripId: number }) => {
      setOffline(p.tripId, false);
      log('trip:online', p);
    },
    'trip:ended': (p: { tripId: number; summary: TripSummary }) => {
      setTrips((prev) => {
        const next = new Map(prev);
        next.delete(p.tripId);
        return next;
      });
      setEnded((prev) => new Map(prev).set(p.tripId, p.summary));
      log('trip:ended', p);
      opts.onEnded?.(p.tripId, p.summary);
    },
    'sim:state': (s: { tripId: number; speedKmh: number; paused: boolean }) => setSimState((prev) => new Map(prev).set(s.tripId, s)),
  });

  return { trips, events, ended, simState, presence, connected, socket, mergeTrip };
}
