import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStack } from './fixture.js';
import { signCitizenToken, verifyCitizenToken, verifyToken } from '../src/auth.js';
import type { PatientBrief } from '../src/services/briefAi.js';

const ROUTE = 'blr-old-airport-road';

describe('Citizen Corridor', () => {
  let stack: ReturnType<typeof makeStack>;
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-19T10:00:00Z') });
    stack = makeStack();
  });
  afterEach(() => {
    stack.dispose();
    vi.useRealTimers();
  });

  it('warns a car shortly before the ambulance reaches it, counts down, then clears it', () => {
    const { citizens, simulator, emitted } = stack;
    const car = citizens.join(ROUTE);
    const mine = () => emitted.filter((e) => e.rooms.includes(`citizen:${car.id}`)).map((e) => e.payload);

    simulator.start({ routeId: ROUTE, speedKmh: 40 });
    for (let i = 0; i < 700 && !mine().some((p) => p.state === 'cleared'); i++) vi.advanceTimersByTime(1_000);

    const updates = mine();
    const firstWarn = updates.find((p) => p.state === 'warned');
    expect(firstWarn, 'car should be warned').toBeDefined();
    // 40 km/h ≈ 11.1 m/s → warn radius max(250, 11.1 × 30 ≈ 333 m): warned roughly 30 s ahead.
    expect(firstWarn.distanceM).toBeLessThanOrEqual(340);
    expect(firstWarn.distanceM).toBeGreaterThan(250);
    expect(firstWarn.regNo).toBe('KA-01-AMB-108');
    // Countdown goes down while warned.
    const etas = updates.filter((p) => p.state === 'warned').map((p) => p.etaS);
    expect(etas.at(-1)!).toBeLessThan(etas[0]!);
    expect(updates.at(-1).state).toBe('cleared');
  });

  it('simulated cars are placed along the corridor and change state on the control-room map', () => {
    const { citizens, simulator, emitted } = stack;
    expect(citizens.addSimulated(ROUTE, 20)).toBe(20);
    expect(citizens.addSimulated(ROUTE, 100)).toBe(40); // capped at 60 per route
    simulator.start({ routeId: ROUTE, speedKmh: 60 });
    vi.advanceTimersByTime(120_000);
    const last = emitted.filter((e) => e.event === 'citizens').at(-1)!.payload as { state: string; simulated: boolean }[];
    expect(last.every((c) => c.simulated)).toBe(true);
    expect(last.some((c) => c.state === 'cleared')).toBe(true);
    expect(last.some((c) => c.state === 'idle')).toBe(true); // further down the road
  });

  it('demo reset removes simulated cars and returns real ones to idle', () => {
    const { citizens, simulator } = stack;
    const real = citizens.join(ROUTE);
    citizens.addSimulated(ROUTE, 10);
    simulator.start({ routeId: ROUTE, speedKmh: 90, startAtM: 0 });
    vi.advanceTimersByTime(200_000);
    citizens.reset();
    const all = citizens.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: real.id, state: 'idle', distanceM: null });
  });

  it('a new trip starts every car fresh', () => {
    const { citizens, simulator, trips } = stack;
    const car = citizens.join(ROUTE);
    const t = simulator.start({ routeId: ROUTE, speedKmh: 90, startAtM: 0 });
    vi.advanceTimersByTime(400_000);
    if (trips.isActive(t.id)) trips.endTrip(t.id, 'system', 'test');
    simulator.start({ routeId: ROUTE, speedKmh: 40 });
    expect(citizens.get(car.id)!.state).toBe('idle');
  });

  it('citizen tokens only identify a car: not usable as a login', () => {
    const t = signCitizenToken('abc');
    expect(verifyCitizenToken(t)).toEqual({ citizenId: 'abc' });
    expect(() => verifyToken(t)).toThrow(/audience/);
  });

  it('rejects joining an unknown route', () => {
    expect(() => stack.citizens.join('nope')).toThrow(/route_not_found/);
  });
});

describe('AI paramedic brief storage and permissions', () => {
  let stack: ReturnType<typeof makeStack>;
  beforeEach(() => {
    stack = makeStack();
  });
  afterEach(() => stack.dispose());

  const brief: PatientBrief = {
    severity: 'critical',
    category: 'cardiac',
    suspectedCondition: 'Possible heart attack (STEMI)',
    patient: { ageYears: 58, sex: 'male' },
    chiefComplaint: 'Chest pain',
    onset: '40 minutes ago',
    vitals: { bloodPressure: '90/60', heartRate: 110, spo2: null, respiratoryRate: null, gcs: null, bloodGlucose: null },
    redFlags: ['Hypotension'],
    prepChecklist: ['12-lead ECG on arrival', 'Cath lab standby'],
    missingInfo: ['SpO2', 'Allergies'],
    handoverSummary: '58M, chest pain 40 min, BP 90/60, HR 110.',
    detectedLanguage: 'Hindi',
  };

  it('stores the brief on the trip, persists it, and notifies the hospital and control room', () => {
    const { trips, userByEmail, emitted, db } = stack;
    const driver = userByEmail('driver.blr@demo.in');
    const t = trips.startTrip(driver, { hospitalId: 'blr-manipal', emergencyType: 'Cardiac' });
    const view = trips.setBrief(t.id, driver, brief, 'मरीज़ 58 साल…');
    expect(view.brief).toMatchObject({ severity: 'critical', transcript: 'मरीज़ 58 साल…' });
    const ev = emitted.find((e) => e.event === 'trip:brief')!;
    expect(ev.rooms).toEqual(expect.arrayContaining(['admin', 'hospital:blr-manipal', `trip:${t.id}`]));
    const row = db.prepare('SELECT brief_json FROM trips WHERE id = ?').get(t.id) as { brief_json: string };
    expect(JSON.parse(row.brief_json).category).toBe('cardiac');
    expect(trips.recentEvents().some((r) => r.event === 'trip:brief')).toBe(true);
  });

  it('only the trip crew or the control room can brief', () => {
    const { trips, userByEmail } = stack;
    const t = trips.startTrip(userByEmail('driver.blr@demo.in'), { hospitalId: 'blr-manipal', emergencyType: 'Cardiac' });
    expect(() => trips.assertCanBrief(t.id, userByEmail('driver.pune@demo.in'))).toThrow(/not_your_trip/);
    expect(() => trips.assertCanBrief(t.id, userByEmail('hospital.blr@demo.in'))).toThrow(/not_your_trip/);
    expect(() => trips.assertCanBrief(t.id, userByEmail('control@demo.in'))).not.toThrow();
  });
});
