import { useEffect, useRef } from 'react';
import { dirName, speak } from './voice';
import type { AlertView, TripView } from './types';

const UNACKED = new Set(['ALERTED', 'ESCALATED']);
/** While unacknowledged, repeat the full alert this often (the siren keeps going between). */
const REPEAT_MS = 15_000;

/**
 * Officer phone: speak when an alert starts, at 30 s and 15 s, on escalation,
 * on acknowledgment and when the ambulance passes. Driven entirely by the
 * alert state the server already sends, so voice can't disagree with screen.
 */
export function useOfficerVoice(current: AlertView | null, opts: { active: boolean; isBackup: boolean }) {
  const mem = useRef({ alertId: null as number | null, state: null as string | null, said30: false, said15: false, lastFull: 0 });

  useEffect(() => {
    if (!opts.active) return;
    const m = mem.current;
    if (!current) {
      mem.current = { alertId: null, state: null, said30: false, said15: false, lastFull: 0 };
      return;
    }
    const s = current.signal;
    const now = Date.now();
    const eta = s.etaS ?? 0;
    const sayFull = () => {
      speak((p, l) => (opts.isBackup ? p.backupAlert : p.alert)(dirName(l, s.approachFrom), eta), { interrupt: true });
      m.lastFull = now;
    };

    // A new alert on this phone.
    if (current.alertId !== m.alertId) {
      // If it starts already close (fast ambulance), skip countdown lines already covered.
      mem.current = { alertId: current.alertId, state: s.state, said30: eta <= 30, said15: eta <= 15, lastFull: now };
      if (UNACKED.has(s.state)) sayFull();
      else if (s.state === 'ACKNOWLEDGED') speak((p) => p.acknowledged, { interrupt: true });
      return;
    }

    if (s.state !== m.state) {
      m.state = s.state;
      if (s.state === 'ESCALATED') {
        if (opts.isBackup) sayFull();
        else {
          speak((p) => p.escalated, { interrupt: true });
          m.lastFull = now;
        }
      } else if (s.state === 'ACKNOWLEDGED') speak((p) => p.acknowledged, { interrupt: true });
      else if (s.state === 'PASSED') speak((p) => p.passed, { interrupt: true });
      return;
    }

    if (s.state === 'PASSED' || s.etaS === null) return;
    if (!m.said30 && eta <= 30 && eta > 15) {
      m.said30 = true;
      speak((p) => p.countdown(eta));
    } else if (!m.said15 && eta <= 15 && eta > 0) {
      m.said15 = m.said30 = true;
      speak((p) => p.countdown(eta));
    } else if (UNACKED.has(s.state) && now - m.lastFull > REPEAT_MS) {
      sayFull();
    }
  }, [current, opts.active, opts.isBackup]);
}

/**
 * Driver phone: short spoken updates about the junctions ahead, so the driver
 * never needs to look at the screen. Existing states are learned silently
 * when the screen opens; only changes are spoken.
 */
export function useDriverVoice(trip: TripView | null, active: boolean) {
  const mem = useRef({ tripId: null as number | null, states: new Map<number, string>(), allPassed: false, arrived: false });

  useEffect(() => {
    if (!trip) return;
    const m = mem.current;
    if (trip.id !== m.tripId) {
      mem.current = { tripId: trip.id, states: new Map(trip.signals.map((s) => [s.signalId, s.state])), allPassed: false, arrived: trip.arrived };
      return;
    }
    for (const s of trip.signals) {
      const prev = m.states.get(s.signalId);
      if (prev === s.state) continue;
      m.states.set(s.signalId, s.state);
      if (!active) continue;
      if (s.state === 'ALERTED') speak((p) => p.driverAlerted(s.order));
      else if (s.state === 'ESCALATED') speak((p) => p.driverEscalated(s.order));
      else if (s.state === 'ACKNOWLEDGED') speak((p) => p.driverClearing(s.order));
    }
    if (!m.allPassed && trip.signals.length > 0 && trip.signals.every((s) => s.state === 'PASSED')) {
      m.allPassed = true;
      if (active) speak((p) => p.driverAllPassed);
    }
    if (!m.arrived && trip.arrived) {
      m.arrived = true;
      if (active) speak((p) => p.driverArriving);
    }
  }, [trip, active]);
}
