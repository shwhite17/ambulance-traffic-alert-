import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStack } from './fixture.js';
import type { TripSummary } from '../src/services/tripService.js';

describe('scripted simulator run through the real pipeline (Bengaluru route)', () => {
  let stack: ReturnType<typeof makeStack>;
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-18T10:00:00Z') });
    stack = makeStack();
  });
  afterEach(() => {
    stack.dispose();
    vi.useRealTimers();
  });

  it('alerts every junction once, escalates the ignored one, and summarises honestly', () => {
    const { trips, simulator, emitted, onEmit, userByEmail, db } = stack;

    // Officers acknowledge 3 s after an alert, except at J3 (the demo's escalation moment).
    onEmit((e) => {
      if (e.event !== 'alert:new') return;
      const code: string = e.payload.signal.code;
      if (code === 'BLR-J3') return;
      setTimeout(() => trips.acknowledge(e.payload.alertId, userByEmail(`officer.${code.toLowerCase()}@demo.in`)), 3_000);
    });

    const view = simulator.start({ routeId: 'blr-old-airport-road', speedKmh: 40 });
    expect(view.signals).toHaveLength(5);

    let summary: TripSummary | undefined;
    onEmit((e) => {
      if (e.event === 'trip:ended') summary = e.payload.summary;
    });
    // 5.8 km at 40 km/h ≈ 520 s.
    for (let i = 0; i < 700 && !summary; i++) vi.advanceTimersByTime(1_000);
    expect(summary, 'trip should end on arrival').toBeDefined();
    const s = summary!;

    // Each junction alerted exactly once, in route order.
    const alerts = emitted.filter((e) => e.event === 'alert:new');
    expect(alerts.map((e) => e.payload.signal.code)).toEqual(['BLR-J1', 'BLR-J2', 'BLR-J3', 'BLR-J4', 'BLR-J5']);

    // 40 km/h ≈ 11.1 m/s, so ETA ≤ 60 s fires before 500 m (≈ 667 m out).
    for (const a of alerts) {
      expect(a.payload.signal.trigger).toBe('eta');
      expect(a.payload.signal.alertDistanceM).toBeGreaterThan(600);
      expect(a.payload.signal.alertDistanceM).toBeLessThan(700);
    }

    // J3 was ignored: escalated to the backup room and the control room.
    const esc = emitted.filter((e) => e.event === 'alert:escalated');
    expect(esc.map((e) => e.payload.signal.code)).toEqual(['BLR-J3']);
    const j3 = alerts[2]!.payload.signal.signalId;
    expect(esc[0]!.rooms).toEqual(expect.arrayContaining([`backup:${j3}`, 'admin']));
    const escalatedAfter = esc[0]!.payload.signal.escalatedAt - esc[0]!.payload.signal.alertedAt;
    expect(escalatedAfter).toBe(10_000);

    expect(s).toMatchObject({
      simulated: true,
      endReason: 'arrived',
      stops: 0,
      totals: { signals: 5, alerted: 5, acknowledged: 4, escalated: 1, unacknowledged: 1, avgResponseS: 3 },
    });
    expect(s.signals.every((x) => x.state === 'PASSED')).toBe(true);
    expect(s.timeSaved.valueS).toBe(4 * 45);
    expect(s.timeSaved.assumption).toMatch(/Estimate, not measured/);
    // Every junction got roughly a minute of warning.
    for (const x of s.signals) expect(x.leadTimeS!).toBeGreaterThan(55);

    // Persisted for accountability.
    const rows = db.prepare('SELECT COUNT(*) n, SUM(acknowledged_at IS NOT NULL) acked, SUM(escalated_at IS NOT NULL) esc FROM alerts').get() as any;
    expect(rows).toMatchObject({ n: 5, acked: 4, esc: 1 });
    const auditActions = (db.prepare('SELECT action FROM audit_log').all() as any[]).map((r) => r.action);
    expect(auditActions).toEqual(expect.arrayContaining(['trip.start', 'alert.ack', 'alert.escalate', 'trip.end']));
  });

  it('"skip to next junction" jumps past an already-alerted junction to the next pending one', () => {
    const { simulator, emitted } = stack;
    const v = simulator.start({ routeId: 'blr-old-airport-road', speedKmh: 40 });
    while (!emitted.some((e) => e.event === 'alert:new')) vi.advanceTimersByTime(1_000);
    // J1 is now ALERTED (not passed). Skipping must target J2, not J1.
    const before = simulator.list()[0]!.alongM;
    simulator.control(v.id, { skipToNextSignal: true });
    expect(simulator.list()[0]!.alongM).toBeGreaterThan(before + 500);
    // Lands ~8 s of driving outside J2's alert radius (≈667 m at 40 km/h).
    vi.advanceTimersByTime(12_000);
    const codes = emitted.filter((e) => e.event === 'alert:new').map((e) => e.payload.signal.code);
    expect(codes).toEqual(['BLR-J1', 'BLR-J2']);
    expect(emitted.some((e) => e.event === 'alert:passed' && e.payload.signal.code === 'BLR-J1')).toBe(true);
    // The summary must not report a fake "warning before crossing" for the skipped junction.
    const s = stack.trips.endTrip(v.id, 'system', 'test');
    expect(s.signals[0]).toMatchObject({ code: 'BLR-J1', skipped: true, leadTimeS: null });
    expect(s.signals[1]).toMatchObject({ code: 'BLR-J2', skipped: false });
  });

  it('a backup officer can acknowledge an escalated alert; other officers cannot', () => {
    const { trips, simulator, emitted, userByEmail } = stack;
    simulator.start({ routeId: 'blr-old-airport-road', speedKmh: 40 });
    while (!emitted.some((e) => e.event === 'alert:escalated')) vi.advanceTimersByTime(1_000);
    const alertId = emitted.find((e) => e.event === 'alert:escalated')!.payload.alertId;

    expect(() => trips.acknowledge(alertId, userByEmail('officer.blr-j4@demo.in'))).toThrow(/not_your_junction/);
    expect(() => trips.acknowledge(alertId, userByEmail('backup.pune@demo.in'))).toThrow(/not_your_junction/);
    const r = trips.acknowledge(alertId, userByEmail('backup.blr@demo.in'));
    expect(r.signal).toMatchObject({ state: 'ACKNOWLEDGED' });
    expect(r.signal?.escalatedAt).not.toBeNull();
  });

  it('flags a driver offline after 10 s without pings and back online on the next one', () => {
    const { trips, emitted, userByEmail } = stack;
    const driver = userByEmail('driver.pune@demo.in');
    const trip = trips.startTrip(driver, { hospitalId: 'pune-rubyhall', emergencyType: 'Trauma' });
    trips.ingestLocation(trip.id, driver, { lat: 18.5089, lng: 73.926, ts: Date.now() });
    vi.advanceTimersByTime(12_100);
    expect(emitted.some((e) => e.event === 'trip:offline' && e.payload.tripId === trip.id)).toBe(true);
    trips.ingestLocation(trip.id, driver, { lat: 18.5089, lng: 73.926, ts: Date.now() });
    expect(emitted.some((e) => e.event === 'trip:online')).toBe(true);
  });

  it('ending a trip closes open alerts and cancels pending escalations', () => {
    const { trips, simulator, emitted } = stack;
    const v = simulator.start({ routeId: 'blr-old-airport-road', speedKmh: 40 });
    while (!emitted.some((e) => e.event === 'alert:new')) vi.advanceTimersByTime(1_000);
    trips.endTrip(v.id, 'system', 'test');
    vi.advanceTimersByTime(30_000);
    expect(emitted.filter((e) => e.event === 'alert:closed').length).toBeGreaterThan(0);
    expect(emitted.some((e) => e.event === 'alert:escalated')).toBe(false);
  });

  it('keeps a replayable feed history without route geometry, and skips never-alerted passes', () => {
    const { trips, simulator, emitted } = stack;
    simulator.start({ routeId: 'blr-old-airport-road', speedKmh: 40, startAtM: 2_000 });
    while (!emitted.some((e) => e.event === 'alert:new')) vi.advanceTimersByTime(1_000);
    const hist = trips.recentEvents();
    expect(hist.map((h) => h.event)).toEqual(['trip:started', 'alert:new']);
    expect((hist[0]!.payload as any).route.coordinates).toEqual([]);
    // Starting at 2 km passed J1 without alerting it: that must not appear in the feed.
    expect(emitted.some((e) => e.event === 'alert:passed' && !e.payload.alertId)).toBe(true);
  });

  it('demo reset closes everything, wipes trip history, cancels escalations and allows a fresh start', () => {
    const { trips, simulator, emitted, db, userByEmail } = stack;
    simulator.start({ routeId: 'blr-old-airport-road', speedKmh: 40 });
    while (!emitted.some((e) => e.event === 'alert:new')) vi.advanceTimersByTime(1_000);

    simulator.stopAll();
    trips.resetAll(userByEmail('control@demo.in').id);

    expect(trips.activeCount).toBe(0);
    expect(trips.recentEvents()).toEqual([]);
    expect(emitted.some((e) => e.event === 'demo:reset')).toBe(true);
    expect(emitted.some((e) => e.event === 'alert:closed')).toBe(true); // officer screens get cleared
    const counts = db.prepare('SELECT (SELECT COUNT(*) FROM trips) t, (SELECT COUNT(*) FROM alerts) a, (SELECT COUNT(*) FROM location_samples) l').get() as any;
    expect(counts).toMatchObject({ t: 0, a: 0, l: 0 });
    const lastAudit = db.prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1').get() as any;
    expect(lastAudit.action).toBe('demo.reset');

    // The pending escalation must not fire after the reset.
    vi.advanceTimersByTime(30_000);
    expect(emitted.some((e) => e.event === 'alert:escalated')).toBe(false);

    // And a new trip starts cleanly (same driver, no "already active"),
    // announced on the driver's personal channel so an open driver phone shows it.
    const v = simulator.start({ routeId: 'blr-old-airport-road', speedKmh: 40 });
    expect(v.signals.every((s) => s.state === 'PENDING')).toBe(true);
    const started = emitted.filter((e) => e.event === 'trip:started').at(-1)!;
    expect(started.rooms).toContain(`user:${userByEmail('driver.blr@demo.in').id}`);
  });

  it('a driver cannot post to someone else\'s trip or start two trips', () => {
    const { trips, userByEmail } = stack;
    const blr = userByEmail('driver.blr@demo.in');
    const pune = userByEmail('driver.pune@demo.in');
    const t = trips.startTrip(blr, { hospitalId: 'blr-manipal', emergencyType: 'Cardiac' });
    expect(() => trips.ingestLocation(t.id, pune, { lat: 12.95, lng: 77.7, ts: Date.now() })).toThrow(/not_your_trip/);
    expect(() => trips.startTrip(blr, { hospitalId: 'blr-manipal', emergencyType: 'Cardiac' })).toThrow(/already/);
  });
});
