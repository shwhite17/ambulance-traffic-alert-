import type { Logger } from 'pino';
import { config } from '../config.js';
import { audit, tx, type Db } from '../db.js';
import { TripAlertEngine, type EngineEvent } from '../domain/alertEngine.js';
import { LocationPipeline, type PipelineResult } from '../domain/pipeline.js';
import type { LngLat, LocationPing, TripSignalStatus } from '../domain/types.js';
import { HttpError, type AuthUser } from '../auth.js';
import type { CatalogRoute, RouteCatalog } from './catalog.js';
import type { PatientBrief } from './briefAi.js';

/** Transport-agnostic fan-out. Socket.IO implements it; tests use a recorder. */
export interface Notifier {
  emit(rooms: string[], event: string, payload: unknown): void;
  /**
   * Demo reset: drop every client from trip channels (trip ids restart after a
   * reset, so a stale subscription would leak another trip's updates) and tell
   * every client to clear its state.
   */
  demoReset(): void;
}

/** The AI pre-arrival brief as stored on a trip: the model's output plus what was said. */
export type TripBrief = PatientBrief & { transcript: string; at: number };

export interface TripProgress {
  tripId: number;
  routeId: string;
  regNo: string;
  progressM: number;
  etaSpeedMps: number;
}
export interface TripObserver {
  started?(t: { tripId: number; routeId: string }): void;
  progress?(p: TripProgress): void;
  ended?(t: { tripId: number; routeId: string }): void;
}

export interface RecordedEvent {
  event: string;
  payload: unknown;
  ts: number;
}

/** Events shown in the control-room feed; replayed after a page reload. */
const FEED_EVENTS = new Set([
  'trip:started', 'trip:ended', 'trip:offline', 'trip:online', 'trip:hospital', 'trip:brief',
  'alert:new', 'alert:escalated', 'alert:ack', 'alert:passed',
]);
const RECENT_MAX = 50;

/** Route geometry is large and already known to clients; don't keep it in history. */
function stripGeometry(payload: unknown): unknown {
  const p = payload as { route?: { coordinates?: unknown } };
  return p && typeof p === 'object' && p.route?.coordinates ? { ...p, route: { ...p.route, coordinates: [] } } : payload;
}

export const rooms = {
  admin: 'admin',
  /** Personal channel: every socket joins its own user's room. */
  user: (id: number) => `user:${id}`,
  /** A Citizen Corridor participant (anonymous car). */
  citizen: (id: string) => `citizen:${id}`,
  trip: (id: number) => `trip:${id}`,
  signal: (id: number) => `signal:${id}`,
  backup: (id: number) => `backup:${id}`,
  hospital: (id: string) => `hospital:${id}`,
};

type Accepted = Extract<PipelineResult, { accepted: true }>;

interface ActiveTrip {
  id: number;
  driverId: number;
  ambulance: { id: number; regNo: string };
  hospital: { id: string; name: string; lat: number; lng: number };
  route: CatalogRoute;
  emergencyType: string;
  simulated: boolean;
  startedAt: number;
  pipeline: LocationPipeline;
  engine: TripAlertEngine;
  officers: Map<number, { officerId: number | null; backupOfficerId: number | null }>;
  last: Accepted | null;
  lastPingAt: number;
  offline: boolean;
  arrived: boolean;
  lastSampleAt: number;
  escalationTimers: Map<number, NodeJS.Timeout>;
  skippedSignals: Set<number>;
  stops: number;
  stoppedSince: number | null;
  stopCounted: boolean;
  hospitalConfirmedAt: number | null;
  hospitalReadyAt: number | null;
  patientNote: string | null;
  brief: TripBrief | null;
}

export type SignalView = TripSignalStatus & LngLat;

export interface TripView {
  id: number;
  status: 'active' | 'ended';
  simulated: boolean;
  emergencyType: string;
  startedAt: number;
  ambulance: { regNo: string };
  hospital: { id: string; name: string; lat: number; lng: number };
  route: { id: string; name: string; city: string; lengthM: number; coordinates: [number, number][] };
  position: {
    lat: number;
    lng: number;
    snapped: LngLat;
    progressM: number;
    speedKmh: number;
    offRoute: boolean;
    lowConfidence: boolean;
    ts: number;
  } | null;
  remainingM: number;
  etaToHospitalS: number | null;
  offline: boolean;
  arrived: boolean;
  nextSignal: SignalView | null;
  signals: SignalView[];
  hospitalConfirmedAt: number | null;
  hospitalReadyAt: number | null;
  patientNote: string | null;
  brief: TripBrief | null;
}

export interface AlertView {
  alertId: number | null;
  tripId: number;
  ambulanceRegNo: string;
  emergencyType: string;
  hospitalName: string;
  simulated: boolean;
  signal: SignalView;
}

export interface TripSummary {
  tripId: number;
  simulated: boolean;
  endReason: string;
  durationS: number;
  distanceM: number;
  stops: number;
  signals: {
    code: string;
    name: string;
    order: number;
    state: string;
    trigger: string | null;
    alertDistanceM: number | null;
    alertEtaS: number | null;
    responseS: number | null;
    escalated: boolean;
    /** Seconds of warning the junction got before the ambulance crossed it. */
    leadTimeS: number | null;
    /** Simulator skipped past this junction, so leadTimeS is not meaningful. */
    skipped: boolean;
  }[];
  totals: { signals: number; alerted: number; acknowledged: number; escalated: number; unacknowledged: number; avgResponseS: number | null };
  timeSaved: { valueS: number; simulated: true; assumption: string };
}

const ACTIVE_ALERT_STATES = new Set(['ALERTED', 'ESCALATED', 'ACKNOWLEDGED']);
const STOP_SPEED_MPS = 1;
const STOP_MIN_MS = 5_000;
const ARRIVED_WITHIN_M = 25;

export class TripService {
  private readonly active = new Map<number, ActiveTrip>();
  private readonly alertIndex = new Map<number, { tripId: number; signalId: number }>();
  private readonly recent: RecordedEvent[] = [];
  private readonly observers: TripObserver[] = [];
  private readonly watchdog: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    private readonly catalog: RouteCatalog,
    private readonly notifier: Notifier,
    private readonly log: Logger,
  ) {
    // Trips can't survive a restart (state is in memory): close them honestly.
    const stale = db.prepare("UPDATE trips SET status='ended', end_reason='server_restart', ended_at=? WHERE status='active'").run(Date.now());
    if (stale.changes) log.warn({ count: stale.changes }, 'closed trips left active by a previous run');
    this.watchdog = setInterval(() => this.checkOffline(), 2_000);
    this.watchdog.unref();
  }

  dispose(): void {
    clearInterval(this.watchdog);
    for (const t of this.active.values()) for (const timer of t.escalationTimers.values()) clearTimeout(timer);
  }

  /** Recent control-room events, replayed to admin sockets on (re)connect. */
  recentEvents(): RecordedEvent[] {
    return [...this.recent];
  }

  /**
   * Demo only: close every active trip without summaries, wipe trip history,
   * and tell every connected screen to start clean. Users, junctions and
   * officer assignments are kept.
   */
  resetAll(byUserId: number): void {
    for (const trip of this.active.values()) {
      for (const ev of trip.engine.close()) this.handleEngineEvent(trip, ev);
      for (const t of trip.escalationTimers.values()) clearTimeout(t);
    }
    this.active.clear();
    this.alertIndex.clear();
    tx(this.db, () => {
      this.db.exec('DELETE FROM location_samples; DELETE FROM alerts; DELETE FROM trip_signals; DELETE FROM trips;');
      audit(this.db, { userId: byUserId, action: 'demo.reset' });
    });
    this.recent.length = 0; // closing alerts above recorded events; start truly empty
    this.notifier.demoReset();
    this.log.info({ byUserId }, 'demo reset');
  }

  /** Fan out, and remember events the control room's feed should be able to replay. */
  private emit(targets: string[], event: string, payload: unknown): void {
    this.notifier.emit(targets, event, payload);
    if (!FEED_EVENTS.has(event)) return;
    if (event === 'alert:passed' && !(payload as AlertView).alertId) return; // never-alerted pass: not feed-worthy
    this.recent.push({ event, payload: stripGeometry(payload), ts: Date.now() });
    if (this.recent.length > RECENT_MAX) this.recent.splice(0, this.recent.length - RECENT_MAX);
  }

  // ───────────────────────── trip lifecycle ─────────────────────────

  startTrip(driver: AuthUser, input: { hospitalId: string; emergencyType: string }, opts: { simulated?: boolean } = {}): TripView {
    if (driver.role !== 'driver') throw new HttpError(403, 'forbidden');
    for (const t of this.active.values()) {
      if (t.driverId === driver.id) throw new HttpError(409, 'trip_already_active', `Trip ${t.id} is already active`);
    }
    const hospital = this.db.prepare('SELECT id, name, lat, lng FROM hospitals WHERE id = ?').get(input.hospitalId) as
      | ActiveTrip['hospital']
      | undefined;
    if (!hospital) throw new HttpError(404, 'hospital_not_found');
    const route = this.catalog.forHospital(hospital.id);
    if (!route) throw new HttpError(422, 'no_route', 'No pre-saved route to this hospital');
    const amb = this.db.prepare('SELECT id, reg_no FROM ambulances WHERE driver_id = ?').get(driver.id) as
      | { id: number; reg_no: string }
      | undefined;
    if (!amb) throw new HttpError(422, 'no_ambulance', 'Driver has no ambulance assigned');

    const now = Date.now();
    const id = tx(this.db, () => {
      const { id } = this.db
        .prepare(
          "INSERT INTO trips (ambulance_id, driver_id, hospital_id, route_id, emergency_type, simulated, status, started_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?) RETURNING id",
        )
        .get(amb.id, driver.id, hospital.id, route.id, input.emergencyType, opts.simulated ? 1 : 0, now) as { id: number };
      const ins = this.db.prepare("INSERT INTO trip_signals (trip_id, signal_id, ord, along_m, state) VALUES (?, ?, ?, ?, 'PENDING')");
      for (const s of route.signals) ins.run(id, s.id, s.order, s.alongM);
      audit(this.db, { userId: driver.id, action: 'trip.start', entity: 'trip', entityId: id, details: { ...input, simulated: !!opts.simulated } });
      return id;
    });

    const officers = new Map<number, { officerId: number | null; backupOfficerId: number | null }>();
    const sigRows = this.db
      .prepare(`SELECT id, officer_id, backup_officer_id FROM signals WHERE route_id = ?`)
      .all(route.id) as { id: number; officer_id: number | null; backup_officer_id: number | null }[];
    for (const r of sigRows) officers.set(r.id, { officerId: r.officer_id, backupOfficerId: r.backup_officer_id });

    const trip: ActiveTrip = {
      id,
      driverId: driver.id,
      ambulance: { id: amb.id, regNo: amb.reg_no },
      hospital,
      route,
      emergencyType: input.emergencyType,
      simulated: !!opts.simulated,
      startedAt: now,
      pipeline: new LocationPipeline(route.geometry, config.pipeline),
      engine: new TripAlertEngine(route.signals, route.geometry, config.alert),
      officers,
      last: null,
      lastPingAt: now,
      offline: false,
      arrived: false,
      lastSampleAt: 0,
      escalationTimers: new Map(),
      skippedSignals: new Set(),
      stops: 0,
      stoppedSince: null,
      stopCounted: false,
      hospitalConfirmedAt: null,
      hospitalReadyAt: null,
      patientNote: null,
      brief: null,
    };
    this.active.set(id, trip);
    for (const o of this.observers) o.started?.({ tripId: id, routeId: route.id });
    const view = this.view(trip);
    // The driver's own channel too: a trip dispatched from the control room
    // (simulator) must appear on a driver phone that is already open.
    this.emit([rooms.admin, rooms.hospital(hospital.id), rooms.user(driver.id)], 'trip:started', view);
    this.log.info({ tripId: id, route: route.id, simulated: trip.simulated }, 'trip started');
    return view;
  }

  ingestLocation(tripId: number, user: AuthUser, ping: LocationPing, opts: { relocate?: boolean } = {}) {
    const trip = this.requireActive(tripId);
    if (user.id !== trip.driverId) throw new HttpError(403, 'not_your_trip');

    const res = opts.relocate ? trip.pipeline.relocate(ping) : trip.pipeline.ingest(ping);
    const now = Date.now();
    trip.lastPingAt = now;
    if (trip.offline) {
      trip.offline = false;
      this.emit([rooms.admin, rooms.trip(trip.id)], 'trip:online', { tripId: trip.id });
    }
    if (!res.accepted) {
      this.log.debug({ tripId, reason: res.reason }, 'ping rejected');
      return { accepted: false as const, reason: res.reason };
    }
    trip.last = res;
    this.trackStops(trip, res, now);

    const events = trip.engine.evaluate(res.progressM, trip.pipeline.etaSpeedMps, now);
    for (const o of this.observers) o.progress?.({ tripId: trip.id, routeId: trip.route.id, regNo: trip.ambulance.regNo, progressM: res.progressM, etaSpeedMps: trip.pipeline.etaSpeedMps });
    for (const ev of events) {
      // A simulator skip "teleports" past junctions; their lead times aren't real.
      if (opts.relocate && ev.type === 'alert:passed') trip.skippedSignals.add(ev.signal.signalId);
      this.handleEngineEvent(trip, ev);
    }

    if (now - trip.lastSampleAt >= config.pipeline.sampleEveryMs) {
      trip.lastSampleAt = now;
      this.db
        .prepare('INSERT INTO location_samples (trip_id, ts, lat, lng, progress_m, speed_mps) VALUES (?, ?, ?, ?, ?, ?)')
        .run(trip.id, res.ts, res.raw.lat, res.raw.lng, res.progressM, res.speedMps);
    }

    if (!trip.arrived && trip.route.geometry.lengthM - res.progressM <= ARRIVED_WITHIN_M) {
      trip.arrived = true;
      this.emit([rooms.trip(trip.id), rooms.admin, rooms.hospital(trip.hospital.id)], 'trip:arrived', { tripId: trip.id });
    }

    const view = this.view(trip);
    // Route geometry is sent once with the trip; per-ping updates stay small.
    const lite = { ...view, route: { ...view.route, coordinates: [] } };
    this.emit([rooms.trip(trip.id), rooms.admin, rooms.hospital(trip.hospital.id)], 'location:update', lite);
    // Live countdown for officers whose junction currently has an alert.
    for (const s of view.signals) {
      if (!ACTIVE_ALERT_STATES.has(s.state)) continue;
      this.emit([rooms.signal(s.signalId), rooms.backup(s.signalId)], 'alert:update', this.alertView(trip, s));
    }
    return { accepted: true as const, progressM: res.progressM, offRoute: res.offRoute, lowConfidence: res.lowConfidence };
  }

  acknowledge(alertId: number, user: AuthUser) {
    const ref = this.alertIndex.get(alertId);
    if (!ref) throw new HttpError(404, 'alert_not_active');
    const trip = this.requireActive(ref.tripId);
    const assign = trip.officers.get(ref.signalId);
    const allowed = user.role === 'admin' || (user.role === 'officer' && (assign?.officerId === user.id || assign?.backupOfficerId === user.id));
    if (!allowed) throw new HttpError(403, 'not_your_junction');

    const res = trip.engine.acknowledge(ref.signalId, user.id, Date.now());
    if (!res.ok) throw new HttpError(409, res.reason);
    if (res.event) this.handleEngineEvent(trip, res.event);
    return { duplicate: res.duplicate, signal: trip.engine.get(ref.signalId) };
  }

  endTrip(tripId: number, user: AuthUser | 'system', reason = 'ended_by_driver'): TripSummary {
    const trip = this.requireActive(tripId);
    if (user !== 'system' && user.role !== 'admin' && user.id !== trip.driverId) throw new HttpError(403, 'not_your_trip');
    for (const ev of trip.engine.close()) this.handleEngineEvent(trip, ev);
    for (const t of trip.escalationTimers.values()) clearTimeout(t);
    trip.escalationTimers.clear();

    const now = Date.now();
    const summary = this.summarize(trip, now, reason);
    tx(this.db, () => {
      this.db
        .prepare("UPDATE trips SET status='ended', ended_at=?, end_reason=?, summary_json=? WHERE id=?")
        .run(now, reason, JSON.stringify(summary), trip.id);
      audit(this.db, { userId: user === 'system' ? null : user.id, action: 'trip.end', entity: 'trip', entityId: trip.id, details: { reason } });
    });
    this.active.delete(trip.id);
    for (const o of this.observers) o.ended?.({ tripId: trip.id, routeId: trip.route.id });
    for (const s of trip.engine.statuses()) if (s.alertId) this.alertIndex.delete(s.alertId);
    this.emit([rooms.trip(trip.id), rooms.admin, rooms.hospital(trip.hospital.id)], 'trip:ended', { tripId: trip.id, summary });
    this.log.info({ tripId: trip.id, reason }, 'trip ended');
    return summary;
  }

  // ───────────────────────── hospital actions ─────────────────────────

  hospitalAction(tripId: number, user: AuthUser, action: 'confirm' | 'ready' | 'note', note?: string): TripView {
    const trip = this.requireActive(tripId);
    if (user.role !== 'admin' && !(user.role === 'hospital' && user.hospitalId === trip.hospital.id)) {
      throw new HttpError(403, 'not_your_hospital');
    }
    const now = Date.now();
    if (action === 'confirm') {
      trip.hospitalConfirmedAt ??= now;
      this.db.prepare('UPDATE trips SET hospital_confirmed_at=? WHERE id=?').run(trip.hospitalConfirmedAt, trip.id);
    } else if (action === 'ready') {
      trip.hospitalReadyAt ??= now;
      this.db.prepare('UPDATE trips SET hospital_ready_at=? WHERE id=?').run(trip.hospitalReadyAt, trip.id);
    } else {
      trip.patientNote = note ?? null;
      this.db.prepare('UPDATE trips SET patient_note=? WHERE id=?').run(trip.patientNote, trip.id);
    }
    audit(this.db, { userId: user.id, action: `trip.hospital_${action}`, entity: 'trip', entityId: trip.id });
    const view = this.view(trip);
    this.emit([rooms.trip(trip.id), rooms.admin, rooms.hospital(trip.hospital.id)], 'trip:hospital', view);
    return view;
  }

  // ───────────────────────── AI paramedic brief ─────────────────────────

  /** Only the trip's own driver (crew) or the control room may brief the hospital. Checked before spending on AI. */
  assertCanBrief(tripId: number, user: AuthUser): void {
    const trip = this.requireActive(tripId);
    if (user.role !== 'admin' && user.id !== trip.driverId) throw new HttpError(403, 'not_your_trip');
  }

  setBrief(tripId: number, user: AuthUser, brief: PatientBrief, transcript: string): TripView {
    const trip = this.requireActive(tripId);
    this.assertCanBrief(tripId, user);
    trip.brief = { ...brief, transcript, at: Date.now() };
    this.db.prepare('UPDATE trips SET brief_json=? WHERE id=?').run(JSON.stringify(trip.brief), trip.id);
    audit(this.db, { userId: user.id, action: 'trip.ai_brief', entity: 'trip', entityId: trip.id, details: { severity: brief.severity, category: brief.category } });
    const view = this.view(trip);
    this.emit([rooms.trip(trip.id), rooms.admin, rooms.hospital(trip.hospital.id)], 'trip:brief', { ...view, route: { ...view.route, coordinates: [] } });
    return view;
  }

  /** Register a listener for trip lifecycle and progress (e.g. the Citizen Corridor). */
  observe(o: TripObserver): void {
    this.observers.push(o);
  }

  // ───────────────────────── queries ─────────────────────────

  getTrip(tripId: number, user: AuthUser): TripView | { id: number; status: 'ended'; summary: TripSummary | null } {
    const trip = this.active.get(tripId);
    if (trip) {
      this.assertCanView(trip.driverId, trip.hospital.id, user);
      return this.view(trip);
    }
    const row = this.db.prepare('SELECT id, driver_id, hospital_id, summary_json FROM trips WHERE id = ?').get(tripId) as
      | { id: number; driver_id: number; hospital_id: string; summary_json: string | null }
      | undefined;
    if (!row) throw new HttpError(404, 'trip_not_found');
    this.assertCanView(row.driver_id, row.hospital_id, user);
    return { id: row.id, status: 'ended', summary: row.summary_json ? (JSON.parse(row.summary_json) as TripSummary) : null };
  }

  /** Active trips visible to this user (used for REST and socket snapshots). */
  activeTripsFor(user: AuthUser): TripView[] {
    return [...this.active.values()]
      .filter(
        (t) =>
          user.role === 'admin' ||
          (user.role === 'driver' && t.driverId === user.id) ||
          (user.role === 'hospital' && t.hospital.id === user.hospitalId),
      )
      .map((t) => this.view(t));
  }

  /** Current alerts at junctions this officer covers (primary, or backup once escalated). */
  officerAlerts(user: AuthUser): AlertView[] {
    const out: AlertView[] = [];
    for (const t of this.active.values()) {
      for (const s of this.signalViews(t)) {
        if (!ACTIVE_ALERT_STATES.has(s.state)) continue;
        const a = t.officers.get(s.signalId);
        if (a?.officerId === user.id || a?.backupOfficerId === user.id) out.push(this.alertView(t, s));
      }
    }
    return out;
  }

  /** Signal ids an officer should hear about: as primary and as backup. */
  officerSignals(userId: number): { primary: number[]; backup: number[] } {
    const rows = this.db.prepare('SELECT id, officer_id, backup_officer_id FROM signals WHERE officer_id = ? OR backup_officer_id = ?').all(userId, userId) as {
      id: number;
      officer_id: number;
      backup_officer_id: number;
    }[];
    return {
      primary: rows.filter((r) => r.officer_id === userId).map((r) => r.id),
      backup: rows.filter((r) => r.backup_officer_id === userId).map((r) => r.id),
    };
  }

  get activeCount(): number {
    return this.active.size;
  }

  isActive(tripId: number): boolean {
    return this.active.has(tripId);
  }

  /** For the simulator: route and progress of an active trip. */
  runtime(tripId: number) {
    const t = this.requireActive(tripId);
    return { route: t.route, progressM: t.last?.progressM ?? 0, nextPendingSignal: t.engine.nextPendingSignal(), driverId: t.driverId };
  }

  // ───────────────────────── internals ─────────────────────────

  private handleEngineEvent(trip: ActiveTrip, ev: EngineEvent): void {
    const s = ev.signal;
    const now = Date.now();
    switch (ev.type) {
      case 'alert:new': {
        const { id } = this.db
          .prepare(
            'INSERT INTO alerts (trip_id, signal_id, trigger, distance_m, eta_s, approach_from, alerted_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
          )
          .get(trip.id, s.signalId, s.trigger, s.alertDistanceM, s.alertEtaS, s.approachFrom, s.alertedAt) as { id: number };
        trip.engine.setAlertId(s.signalId, id);
        s.alertId = id;
        this.alertIndex.set(id, { tripId: trip.id, signalId: s.signalId });
        const timer = setTimeout(() => this.escalate(trip.id, s.signalId), config.alert.escalateAfterMs);
        timer.unref();
        trip.escalationTimers.set(s.signalId, timer);
        this.log.info({ tripId: trip.id, signal: s.code, trigger: s.trigger, distanceM: s.alertDistanceM, etaS: s.alertEtaS }, 'alert fired');
        break;
      }
      case 'alert:escalated':
        this.db.prepare('UPDATE alerts SET escalated_at=? WHERE id=?').run(s.escalatedAt, s.alertId);
        audit(this.db, { action: 'alert.escalate', entity: 'alert', entityId: s.alertId ?? undefined, details: { tripId: trip.id, signal: s.code } });
        this.log.warn({ tripId: trip.id, signal: s.code }, 'alert escalated: no acknowledgment');
        break;
      case 'alert:ack':
        this.clearTimer(trip, s.signalId);
        this.db.prepare('UPDATE alerts SET acknowledged_at=?, acknowledged_by=? WHERE id=?').run(s.acknowledgedAt, s.acknowledgedBy, s.alertId);
        audit(this.db, { userId: s.acknowledgedBy, action: 'alert.ack', entity: 'alert', entityId: s.alertId ?? undefined, details: { tripId: trip.id, signal: s.code } });
        break;
      case 'alert:passed':
        this.clearTimer(trip, s.signalId);
        if (s.alertId) this.db.prepare('UPDATE alerts SET passed_at=? WHERE id=?').run(s.passedAt, s.alertId);
        break;
      case 'alert:closed':
        this.clearTimer(trip, s.signalId);
        if (s.alertId) this.db.prepare('UPDATE alerts SET closed_at=? WHERE id=?').run(now, s.alertId);
        break;
    }
    this.db.prepare('UPDATE trip_signals SET state=? WHERE trip_id=? AND signal_id=?').run(s.state, trip.id, s.signalId);

    const view = this.alertView(trip, this.withCoords(trip, s));
    const targets = [rooms.signal(s.signalId), rooms.backup(s.signalId), rooms.trip(trip.id), rooms.admin];
    this.emit(targets, ev.type, view);
  }

  private escalate(tripId: number, signalId: number): void {
    const trip = this.active.get(tripId);
    if (!trip) return;
    trip.escalationTimers.delete(signalId);
    const ev = trip.engine.escalate(signalId, Date.now());
    if (ev) this.handleEngineEvent(trip, ev);
  }

  private clearTimer(trip: ActiveTrip, signalId: number): void {
    const t = trip.escalationTimers.get(signalId);
    if (t) clearTimeout(t);
    trip.escalationTimers.delete(signalId);
  }

  private trackStops(trip: ActiveTrip, res: Accepted, now: number): void {
    const moving = res.speedMps >= STOP_SPEED_MPS;
    const enRoute = res.progressM > 50 && trip.route.geometry.lengthM - res.progressM > 50;
    if (moving || !enRoute) {
      trip.stoppedSince = null;
      trip.stopCounted = false;
      return;
    }
    trip.stoppedSince ??= now;
    if (!trip.stopCounted && now - trip.stoppedSince >= STOP_MIN_MS) {
      trip.stops++;
      trip.stopCounted = true;
    }
  }

  private checkOffline(): void {
    const now = Date.now();
    for (const t of this.active.values()) {
      if (!t.offline && now - t.lastPingAt > config.pipeline.offlineAfterMs) {
        t.offline = true;
        this.emit([rooms.admin, rooms.trip(t.id), rooms.hospital(t.hospital.id)], 'trip:offline', {
          tripId: t.id,
          lastPosition: t.last?.raw ?? null,
          lastPingAt: t.lastPingAt,
        });
        this.log.warn({ tripId: t.id }, 'driver offline');
      }
    }
  }

  private summarize(trip: ActiveTrip, now: number, endReason: string): TripSummary {
    const statuses = trip.engine.statuses();
    const sec = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round((b - a) / 100) / 10 : null);
    const signals = statuses.map((s) => ({
      code: s.code,
      name: s.name,
      order: s.order,
      state: s.state,
      trigger: s.trigger,
      alertDistanceM: s.alertDistanceM,
      alertEtaS: s.alertEtaS,
      responseS: sec(s.alertedAt, s.acknowledgedAt),
      escalated: s.escalatedAt !== null,
      leadTimeS: trip.skippedSignals.has(s.signalId) ? null : sec(s.alertedAt, s.passedAt),
      skipped: trip.skippedSignals.has(s.signalId),
    }));
    const responses = signals.map((s) => s.responseS).filter((v): v is number => v !== null);
    // Only junctions that were warned AND acknowledged before the ambulance crossed count as "cleared".
    const cleared = statuses.filter((s) => s.state === 'PASSED' && s.acknowledgedAt !== null).length;
    return {
      tripId: trip.id,
      simulated: trip.simulated,
      endReason,
      durationS: Math.round((now - trip.startedAt) / 1000),
      distanceM: Math.round(trip.last?.progressM ?? 0),
      stops: trip.stops,
      signals,
      totals: {
        signals: statuses.length,
        alerted: statuses.filter((s) => s.alertedAt !== null).length,
        acknowledged: statuses.filter((s) => s.acknowledgedAt !== null).length,
        escalated: statuses.filter((s) => s.escalatedAt !== null).length,
        unacknowledged: statuses.filter((s) => s.alertedAt !== null && s.acknowledgedAt === null).length,
        avgResponseS: responses.length ? Math.round((responses.reduce((a, b) => a + b, 0) / responses.length) * 10) / 10 : null,
      },
      timeSaved: {
        valueS: cleared * config.assumedWaitPerJunctionS,
        simulated: true,
        assumption: `Estimate, not measured: assumes ${config.assumedWaitPerJunctionS} s average wait at each signalized junction without advance clearance, counted only for the ${cleared} junction(s) acknowledged before the ambulance crossed.`,
      },
    };
  }

  private withCoords(trip: ActiveTrip, s: TripSignalStatus): SignalView {
    const def = trip.route.signals.find((r) => r.id === s.signalId)!;
    return { ...s, lat: def.lat, lng: def.lng };
  }

  private signalViews(trip: ActiveTrip): SignalView[] {
    return trip.engine.statuses().map((s) => this.withCoords(trip, s));
  }

  private alertView(trip: ActiveTrip, s: SignalView): AlertView {
    return {
      alertId: s.alertId,
      tripId: trip.id,
      ambulanceRegNo: trip.ambulance.regNo,
      emergencyType: trip.emergencyType,
      hospitalName: trip.hospital.name,
      simulated: trip.simulated,
      signal: s,
    };
  }

  private view(trip: ActiveTrip): TripView {
    const last = trip.last;
    const remainingM = Math.max(0, trip.route.geometry.lengthM - (last?.progressM ?? 0));
    const signals = this.signalViews(trip);
    const next = trip.engine.nextSignal();
    return {
      id: trip.id,
      status: 'active',
      simulated: trip.simulated,
      emergencyType: trip.emergencyType,
      startedAt: trip.startedAt,
      ambulance: { regNo: trip.ambulance.regNo },
      hospital: trip.hospital,
      route: {
        id: trip.route.id,
        name: trip.route.name,
        city: trip.route.city,
        lengthM: Math.round(trip.route.geometry.lengthM),
        coordinates: trip.route.coordinates,
      },
      position: last && {
        lat: last.raw.lat,
        lng: last.raw.lng,
        snapped: last.snapped,
        progressM: Math.round(last.progressM),
        speedKmh: Math.round(last.speedMps * 3.6),
        offRoute: last.offRoute,
        lowConfidence: last.lowConfidence,
        ts: last.ts,
      },
      remainingM: Math.round(remainingM),
      etaToHospitalS: last ? Math.round(remainingM / trip.pipeline.etaSpeedMps) : null,
      offline: trip.offline,
      arrived: trip.arrived,
      nextSignal: next && signals.find((s) => s.signalId === next.signalId)!,
      signals,
      hospitalConfirmedAt: trip.hospitalConfirmedAt,
      hospitalReadyAt: trip.hospitalReadyAt,
      patientNote: trip.patientNote,
      brief: trip.brief,
    };
  }

  private requireActive(tripId: number): ActiveTrip {
    const t = this.active.get(tripId);
    if (!t) throw new HttpError(404, 'trip_not_active');
    return t;
  }

  private assertCanView(driverId: number, hospitalId: string, user: AuthUser): void {
    const ok =
      user.role === 'admin' ||
      user.role === 'officer' ||
      (user.role === 'driver' && user.id === driverId) ||
      (user.role === 'hospital' && user.hospitalId === hospitalId);
    if (!ok) throw new HttpError(403, 'forbidden');
  }
}
