import { describe, expect, it } from 'vitest';
import { TripAlertEngine } from '../src/domain/alertEngine.js';
import { RouteGeometry } from '../src/domain/geo.js';
import type { RouteSignal } from '../src/domain/types.js';
import { coords, m } from './helpers.js';

const CFG = { distanceM: 500, etaS: 60, passMarginM: 15 };
const route = new RouteGeometry(coords([0, 0], [10_000, 0]));
const sig = (id: number, alongM: number): RouteSignal => ({
  id,
  code: `J${id}`,
  name: `Junction ${id}`,
  order: id,
  alongM,
  ...m(alongM, 0),
});

/** Drive at constant speed and record where each signal first alerted. */
function firstAlertAt(speedMps: number, signalAt = 3000) {
  const e = new TripAlertEngine([sig(1, signalAt)], route, CFG);
  for (let x = 0; x <= signalAt; x += 10) {
    const ev = e.evaluate(x, speedMps, x);
    if (ev.some((v) => v.type === 'alert:new')) return { remaining: signalAt - x, status: e.get(1)! };
  }
  throw new Error('never alerted');
}

describe('TripAlertEngine triggers', () => {
  it('slow ambulance alerts on distance (≤ 500 m)', () => {
    const { remaining, status } = firstAlertAt(5); // 18 km/h: ETA at 500 m is 100 s
    expect(remaining).toBe(500);
    expect(status.trigger).toBe('distance');
  });

  it('fast ambulance alerts earlier on ETA (≤ 60 s)', () => {
    const { remaining, status } = firstAlertAt(20); // 72 km/h: 60 s ≈ 1200 m
    expect(remaining).toBe(1200);
    expect(status.trigger).toBe('eta');
    expect(status.alertEtaS).toBe(60);
  });

  it('does not false-alert on straight-line proximity across a U-turn', () => {
    // Signal is 60 m away as the crow flies but ~6 km along the route.
    const u = new RouteGeometry(coords([0, 0], [3000, 0], [3000, 60], [0, 60]));
    const s: RouteSignal = { id: 1, code: 'J1', name: 'J1', order: 1, alongM: 6000, ...m(0, 60) };
    const e = new TripAlertEngine([s], u, CFG);
    expect(e.evaluate(0, 5, 0)).toEqual([]);
    expect(e.get(1)!.distanceM).toBe(6000);
  });

  it('alerts each signal exactly once', () => {
    const e = new TripAlertEngine([sig(1, 1000)], route, CFG);
    const all = [600, 550, 500, 450, 400, 450, 300].flatMap((x, i) => e.evaluate(x, 5, i));
    expect(all.filter((v) => v.type === 'alert:new')).toHaveLength(1);
  });

  it('marks passed beyond the margin, not before', () => {
    const e = new TripAlertEngine([sig(1, 1000)], route, CFG);
    e.evaluate(600, 5, 0);
    expect(e.evaluate(1010, 5, 1)).toEqual([]);
    const ev = e.evaluate(1016, 5, 2);
    expect(ev.map((v) => v.type)).toEqual(['alert:passed']);
    expect(e.get(1)!.state).toBe('PASSED');
    expect(e.nextSignal()).toBeNull();
  });

  it('multiple signals in range alert in route order', () => {
    const e = new TripAlertEngine([sig(2, 900), sig(1, 600)], route, CFG);
    const ev = e.evaluate(450, 20, 0);
    expect(ev.map((v) => v.signal.code)).toEqual(['J1', 'J2']);
  });
});

describe('TripAlertEngine acknowledgment and escalation', () => {
  const alerted = () => {
    const e = new TripAlertEngine([sig(1, 1000)], route, CFG);
    e.evaluate(600, 5, 100);
    return e;
  };

  it('acknowledges an alert once; repeats are no-op duplicates', () => {
    const e = alerted();
    const a = e.acknowledge(1, 42, 200);
    expect(a.ok && !a.duplicate && a.event?.type).toBe('alert:ack');
    expect(e.get(1)).toMatchObject({ state: 'ACKNOWLEDGED', acknowledgedAt: 200, acknowledgedBy: 42 });
    expect(e.acknowledge(1, 42, 300)).toEqual({ ok: true, duplicate: true, event: null });
  });

  it('escalates only an unacknowledged alert', () => {
    const e = alerted();
    expect(e.escalate(1, 10_100)?.type).toBe('alert:escalated');
    expect(e.escalate(1, 10_200)).toBeNull(); // idempotent
    const acked = alerted();
    acked.acknowledge(1, 1, 5000);
    expect(acked.escalate(1, 10_100)).toBeNull();
  });

  it('an escalated alert can still be acknowledged (e.g. by backup)', () => {
    const e = alerted();
    e.escalate(1, 10_100);
    const a = e.acknowledge(1, 7, 12_000);
    expect(a.ok && a.event?.signal).toMatchObject({ state: 'ACKNOWLEDGED', escalatedAt: 10_100, acknowledgedBy: 7 });
  });

  it('rejects acks for pending or passed-without-ack signals', () => {
    const e = new TripAlertEngine([sig(1, 1000)], route, CFG);
    expect(e.acknowledge(1, 1, 0)).toEqual({ ok: false, reason: 'not_alerted' });
    e.evaluate(600, 5, 1);
    e.evaluate(1100, 5, 2);
    expect(e.acknowledge(1, 1, 3)).toEqual({ ok: false, reason: 'already_passed' });
    expect(e.acknowledge(99, 1, 3)).toEqual({ ok: false, reason: 'unknown_signal' });
  });

  it('closing a trip closes every open signal', () => {
    const e = new TripAlertEngine([sig(1, 1000), sig(2, 5000)], route, CFG);
    e.evaluate(600, 5, 0);
    const ev = e.close();
    expect(ev.map((v) => [v.signal.code, v.signal.state])).toEqual([
      ['J1', 'CLOSED'],
      ['J2', 'CLOSED'],
    ]);
    expect(e.escalate(1, 99_999)).toBeNull();
  });
});
