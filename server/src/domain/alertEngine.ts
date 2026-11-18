import type { RouteGeometry } from './geo.js';
import type { RouteSignal, SignalState, TripSignalStatus } from './types.js';

export interface AlertConfig {
  distanceM: number;
  etaS: number;
  passMarginM: number;
}

export type EngineEventType = 'alert:new' | 'alert:escalated' | 'alert:ack' | 'alert:passed' | 'alert:closed';

export interface EngineEvent {
  type: EngineEventType;
  signal: TripSignalStatus;
}

export type AckResult =
  | { ok: true; duplicate: boolean; event: EngineEvent | null }
  | { ok: false; reason: 'unknown_signal' | 'not_alerted' | 'already_passed' };

/**
 * Per-trip, per-signal state machine:
 *
 *   PENDING ──(dist ≤ D or ETA ≤ T)──▶ ALERTED ──(ack)──▶ ACKNOWLEDGED ──▶ PASSED
 *                                         │                    ▲
 *                                   (no ack in N s)            │
 *                                         ▼                    │
 *                                     ESCALATED ───(ack)───────┘
 *
 * Any non-terminal state → PASSED when the ambulance moves beyond the signal,
 * and → CLOSED when the trip ends. Transitions are idempotent: a signal is
 * alerted at most once per trip, and repeat acks are no-ops.
 *
 * Pure: no timers, no I/O. The caller schedules escalation and persists events.
 */
export class TripAlertEngine {
  private readonly bySignal = new Map<number, TripSignalStatus>();

  constructor(
    signals: RouteSignal[],
    route: RouteGeometry,
    private readonly cfg: AlertConfig,
  ) {
    for (const s of [...signals].sort((a, b) => a.alongM - b.alongM)) {
      this.bySignal.set(s.id, {
        signalId: s.id,
        code: s.code,
        name: s.name,
        order: s.order,
        alongM: s.alongM,
        state: 'PENDING',
        alertId: null,
        distanceM: null,
        etaS: null,
        alertedAt: null,
        escalatedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        passedAt: null,
        trigger: null,
        alertDistanceM: null,
        alertEtaS: null,
        approachFrom: route.approachFrom(s.alongM),
      });
    }
  }

  statuses(): TripSignalStatus[] {
    return [...this.bySignal.values()].map((s) => ({ ...s }));
  }

  get(signalId: number): TripSignalStatus | undefined {
    const s = this.bySignal.get(signalId);
    return s && { ...s };
  }

  /** Lets the caller attach the persisted alert id after an alert:new event. */
  setAlertId(signalId: number, alertId: number): void {
    const s = this.bySignal.get(signalId);
    if (s) s.alertId = alertId;
  }

  /** The next signal the ambulance has not yet passed. */
  nextSignal(): TripSignalStatus | null {
    for (const s of this.bySignal.values()) if (s.state !== 'PASSED' && s.state !== 'CLOSED') return { ...s };
    return null;
  }

  /** The next signal not yet alerted (used by the simulator's "skip ahead"). */
  nextPendingSignal(): TripSignalStatus | null {
    for (const s of this.bySignal.values()) if (s.state === 'PENDING') return { ...s };
    return null;
  }

  /**
   * Feed the latest progress and speed. Returns the transitions that happened.
   * `etaSpeedMps` must already be floored by the caller (see LocationPipeline).
   */
  evaluate(progressM: number, etaSpeedMps: number, now: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    for (const s of this.bySignal.values()) {
      if (s.state === 'PASSED' || s.state === 'CLOSED') continue;
      const remaining = s.alongM - progressM;

      if (remaining < -this.cfg.passMarginM) {
        s.state = 'PASSED';
        s.passedAt = now;
        s.distanceM = null;
        s.etaS = null;
        events.push(this.event('alert:passed', s));
        continue;
      }

      const dist = Math.max(0, remaining);
      const eta = dist / etaSpeedMps;
      s.distanceM = Math.round(dist);
      s.etaS = Math.round(eta);

      if (s.state === 'PENDING') {
        const byDistance = dist <= this.cfg.distanceM;
        const byEta = eta <= this.cfg.etaS;
        if (byDistance || byEta) {
          s.state = 'ALERTED';
          s.alertedAt = now;
          s.trigger = byDistance && byEta ? 'both' : byDistance ? 'distance' : 'eta';
          s.alertDistanceM = Math.round(dist);
          s.alertEtaS = Math.round(eta);
          events.push(this.event('alert:new', s));
        }
      }
    }
    return events;
  }

  /** Called by the escalation timer. No-op unless the signal is still unacknowledged. */
  escalate(signalId: number, now: number): EngineEvent | null {
    const s = this.bySignal.get(signalId);
    if (!s || s.state !== 'ALERTED') return null;
    s.state = 'ESCALATED';
    s.escalatedAt = now;
    return this.event('alert:escalated', s);
  }

  acknowledge(signalId: number, userId: number, now: number): AckResult {
    const s = this.bySignal.get(signalId);
    if (!s) return { ok: false, reason: 'unknown_signal' };
    if (s.state === 'ACKNOWLEDGED') return { ok: true, duplicate: true, event: null };
    if (s.state === 'PASSED' || s.state === 'CLOSED') {
      return s.acknowledgedAt ? { ok: true, duplicate: true, event: null } : { ok: false, reason: 'already_passed' };
    }
    if (s.state === 'PENDING') return { ok: false, reason: 'not_alerted' };
    s.state = 'ACKNOWLEDGED';
    s.acknowledgedAt = now;
    s.acknowledgedBy = userId;
    return { ok: true, duplicate: false, event: this.event('alert:ack', s) };
  }

  /** Trip ended: close everything not yet passed. */
  close(): EngineEvent[] {
    const events: EngineEvent[] = [];
    for (const s of this.bySignal.values()) {
      if (s.state === 'PASSED' || s.state === 'CLOSED') continue;
      s.state = 'CLOSED';
      s.distanceM = null;
      s.etaS = null;
      events.push(this.event('alert:closed', s));
    }
    return events;
  }

  private event(type: EngineEventType, s: TripSignalStatus): EngineEvent {
    return { type, signal: { ...s } };
  }
}

export const TERMINAL_STATES: ReadonlySet<SignalState> = new Set(['PASSED', 'CLOSED']);
