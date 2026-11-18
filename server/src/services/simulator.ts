import type { Logger } from 'pino';
import { config } from '../config.js';
import type { Db } from '../db.js';
import { HttpError, type AuthUser } from '../auth.js';
import type { Notifier, TripService, TripView } from './tripService.js';
import { rooms } from './tripService.js';
import type { RouteCatalog } from './catalog.js';

export interface SimOptions {
  routeId: string;
  speedKmh: number;
  /** Start this far along the route (skip the boring bit). */
  startAtM?: number;
  /** Random GPS noise radius in metres, to exercise smoothing. */
  noiseM?: number;
  emergencyType?: string;
}

interface SimRun {
  tripId: number;
  driver: AuthUser;
  alongM: number;
  speedMps: number;
  noiseM: number;
  paused: boolean;
  timer: NodeJS.Timeout;
  lastTick: number;
}

const TICK_MS = 1_000;
/** "Skip ahead" lands this many seconds of driving before the alert would fire. */
const SKIP_APPROACH_S = 8;

/** Where the alert fires at this speed: whichever rule triggers first. */
const alertRadiusM = (speedMps: number) => Math.max(config.alert.distanceM, speedMps * config.alert.etaS);

/**
 * Replays a route by generating GPS fixes and feeding them through
 * TripService.ingestLocation, the exact code path used by a real phone.
 * Only available in demo mode.
 */
export class Simulator {
  private readonly runs = new Map<number, SimRun>();

  constructor(
    private readonly db: Db,
    private readonly catalog: RouteCatalog,
    private readonly trips: TripService,
    private readonly notifier: Notifier,
    private readonly log: Logger,
  ) {}

  start(opts: SimOptions): TripView {
    const route = this.catalog.get(opts.routeId);
    if (!route) throw new HttpError(404, 'route_not_found');
    // The simulated trip is driven by the route city's seeded driver account,
    // so permissions and attribution work exactly like a real trip.
    const d = this.db
      .prepare("SELECT id, name, city FROM users WHERE role='driver' AND city = ? ORDER BY id LIMIT 1")
      .get(route.city) as { id: number; name: string; city: string } | undefined;
    if (!d) throw new HttpError(422, 'no_driver_for_city');
    const driver: AuthUser = { id: d.id, role: 'driver', name: d.name, city: d.city, hospitalId: null };

    const view = this.trips.startTrip(driver, { hospitalId: route.hospitalId, emergencyType: opts.emergencyType ?? 'Cardiac' }, { simulated: true });
    const run: SimRun = {
      tripId: view.id,
      driver,
      alongM: Math.max(0, Math.min(opts.startAtM ?? 0, route.geometry.lengthM)),
      speedMps: opts.speedKmh / 3.6,
      noiseM: opts.noiseM ?? 0,
      paused: false,
      lastTick: Date.now(),
      timer: setInterval(() => this.tick(run), TICK_MS),
    };
    run.timer.unref();
    this.runs.set(view.id, run);
    this.emitPing(run, true);
    this.log.info({ tripId: view.id, route: route.id, speedKmh: opts.speedKmh }, 'simulator started');
    return view;
  }

  control(tripId: number, action: { speedKmh?: number; paused?: boolean; skipToNextSignal?: boolean }) {
    const run = this.runs.get(tripId);
    if (!run) throw new HttpError(404, 'simulation_not_running');
    if (action.speedKmh !== undefined) run.speedMps = action.speedKmh / 3.6;
    if (action.paused !== undefined) {
      run.paused = action.paused;
      run.lastTick = Date.now();
    }
    if (action.skipToNextSignal) {
      // Skip to just before the next junction that hasn't been alerted yet.
      // (The next *unpassed* one may already be alerted and right ahead of us.)
      const rt = this.trips.runtime(tripId);
      if (rt.nextPendingSignal) {
        // Land just outside the alert radius so the demo shows the approach
        // without dead air, at any speed.
        const target = rt.nextPendingSignal.alongM - alertRadiusM(run.speedMps) - run.speedMps * SKIP_APPROACH_S;
        if (target > run.alongM) {
          run.alongM = target;
          this.emitPing(run, true);
        }
      }
    }
    const state = this.state(run);
    this.notifier.emit([rooms.admin, rooms.trip(tripId)], 'sim:state', state);
    return state;
  }

  stop(tripId: number, reason = 'simulation_stopped') {
    const run = this.runs.get(tripId);
    if (!run) throw new HttpError(404, 'simulation_not_running');
    this.finish(run, reason);
  }

  list() {
    return [...this.runs.values()].map((r) => this.state(r));
  }

  dispose(): void {
    for (const r of this.runs.values()) clearInterval(r.timer);
    this.runs.clear();
  }

  private state(run: SimRun) {
    return { tripId: run.tripId, speedKmh: Math.round(run.speedMps * 3.6), paused: run.paused, alongM: Math.round(run.alongM) };
  }

  private tick(run: SimRun): void {
    const now = Date.now();
    const dt = (now - run.lastTick) / 1000;
    run.lastTick = now;
    if (!this.trips.isActive(run.tripId)) {
      // Ended elsewhere (driver/admin): just stop ticking.
      clearInterval(run.timer);
      this.runs.delete(run.tripId);
      return;
    }
    if (run.paused) {
      // Keep the trip "online" while paused: report the same spot.
      this.emitPing(run, false);
      return;
    }
    const { route } = this.trips.runtime(run.tripId);
    run.alongM = Math.min(route.geometry.lengthM, run.alongM + run.speedMps * dt);
    this.emitPing(run, false);
    if (run.alongM >= route.geometry.lengthM) this.finish(run, 'arrived');
  }

  private emitPing(run: SimRun, relocate: boolean): void {
    const { route } = this.trips.runtime(run.tripId);
    const p = route.geometry.pointAt(run.alongM);
    if (run.noiseM > 0) {
      const r = run.noiseM * Math.sqrt(Math.random());
      const a = Math.random() * 2 * Math.PI;
      p.lat += (r * Math.sin(a)) / 111_320;
      p.lng += (r * Math.cos(a)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
    }
    try {
      this.trips.ingestLocation(run.tripId, run.driver, { ...p, accuracy: Math.max(5, run.noiseM), ts: Date.now() }, { relocate });
    } catch (err) {
      this.log.error({ err, tripId: run.tripId }, 'simulator ping failed');
    }
  }

  private finish(run: SimRun, reason: string): void {
    clearInterval(run.timer);
    this.runs.delete(run.tripId);
    if (this.trips.isActive(run.tripId)) this.trips.endTrip(run.tripId, 'system', reason);
  }
}
