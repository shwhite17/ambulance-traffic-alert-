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

/**
 * Live view of active trips for any role, built from socket events.
 * Per-ping `location:update` payloads omit route geometry, so we keep the
 * coordinates from the first full view.
 */
export function useTripsFeed(session: Session | null, opts: { onEnded?: (tripId: number, summary: TripSummary) => void } = {}) {
  const [trips, setTrips] = useState<Map<number, TripView>>(new Map());
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [ended, setEnded] = useState<Map<number, TripSummary>>(new Map());
  const [simState, setSimState] = useState<Map<number, { speedKmh: number; paused: boolean }>>(new Map());

  const log = useCallback((e: Omit<FeedEvent, 'id' | 'ts'>) => {
    setEvents((prev) => [{ ...e, id: ++seq, ts: Date.now() }, ...prev].slice(0, 40));
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

  const onAlert = (kind: FeedEvent['kind'], verb: string) => (a: AlertView) => {
    mergeSignal(a);
    if (kind === 'passed' && !a.alertId) return;
    log({ kind, tripId: a.tripId, text: `${a.signal.name}: ${verb}` });
  };

  const { connected, socket } = useSocket(session?.token, {
    snapshot: (s: { trips: TripView[] }) => {
      setTrips((prev) => {
        const next = new Map<number, TripView>();
        for (const t of s.trips) {
          const old = prev.get(t.id);
          next.set(t.id, t.route.coordinates.length || !old ? t : { ...t, route: old.route });
        }
        return next;
      });
    },
    'trip:started': (v: TripView) => {
      mergeTrip(v);
      log({ kind: 'trip', tripId: v.id, text: `Trip #${v.id} started → ${v.hospital.name}${v.simulated ? ' (simulated)' : ''}` });
    },
    'location:update': mergeTrip,
    'trip:hospital': (v: TripView) => {
      mergeTrip(v);
      log({ kind: 'hospital', tripId: v.id, text: `${v.hospital.name} updated trip #${v.id}` });
    },
    'alert:new': (a: AlertView) => {
      mergeSignal(a);
      log({
        kind: 'alert',
        tripId: a.tripId,
        text: `${a.signal.name}: ALERT at ${a.signal.alertDistanceM} m / ${a.signal.alertEtaS} s (${a.signal.trigger === 'eta' ? 'ETA rule' : a.signal.trigger === 'distance' ? 'distance rule' : 'both rules'})`,
      });
    },
    'alert:escalated': onAlert('escalated', 'NO ACK — escalated to backup + control room'),
    'alert:ack': (a: AlertView) => {
      mergeSignal(a);
      const s = a.signal;
      const secs = s.acknowledgedAt && s.alertedAt ? ((s.acknowledgedAt - s.alertedAt) / 1000).toFixed(1) : '?';
      log({ kind: 'ack', tripId: a.tripId, text: `${s.name}: acknowledged in ${secs} s` });
    },
    'alert:passed': onAlert('passed', 'ambulance passed'),
    'alert:closed': mergeSignal,
    'trip:offline': (p: { tripId: number }) => {
      setTrips((prev) => {
        const t = prev.get(p.tripId);
        return t ? new Map(prev).set(t.id, { ...t, offline: true }) : prev;
      });
      log({ kind: 'offline', tripId: p.tripId, text: `Trip #${p.tripId}: driver offline (no GPS for 10 s)` });
    },
    'trip:online': (p: { tripId: number }) => {
      setTrips((prev) => {
        const t = prev.get(p.tripId);
        return t ? new Map(prev).set(t.id, { ...t, offline: false }) : prev;
      });
      log({ kind: 'online', tripId: p.tripId, text: `Trip #${p.tripId}: driver back online` });
    },
    'trip:ended': (p: { tripId: number; summary: TripSummary }) => {
      setTrips((prev) => {
        const next = new Map(prev);
        next.delete(p.tripId);
        return next;
      });
      setEnded((prev) => new Map(prev).set(p.tripId, p.summary));
      log({ kind: 'trip', tripId: p.tripId, text: `Trip #${p.tripId} ended (${p.summary.endReason.replace(/_/g, ' ')})` });
      opts.onEnded?.(p.tripId, p.summary);
    },
    'sim:state': (s: { tripId: number; speedKmh: number; paused: boolean }) => setSimState((prev) => new Map(prev).set(s.tripId, s)),
  });

  return { trips, events, ended, simState, connected, socket, mergeTrip };
}
