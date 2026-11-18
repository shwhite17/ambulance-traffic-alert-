import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { HttpError } from '../auth.js';
import type { RouteCatalog } from './catalog.js';
import type { Notifier, TripObserver, TripProgress } from './tripService.js';
import { rooms } from './tripService.js';

/**
 * Citizen Corridor: ordinary drivers on the route get "ambulance behind you,
 * move left" alerts, timed by the same along-route ETA as the officers. Most
 * junctions have no officer; this warns the road itself.
 *
 * Demo shape: a phone joins via an opt-in link and is placed as a car at a
 * point on the route. (Real adoption would come through a maps-app or fleet
 * integration; that's roadmap.)
 */

export type CitizenState = 'idle' | 'warned' | 'cleared';

interface Citizen {
  id: string;
  routeId: string;
  alongM: number;
  label: string;
  simulated: boolean;
  state: CitizenState;
  tripId: number | null;
  regNo: string | null;
  distanceM: number | null;
  etaS: number | null;
}

export interface CitizenView {
  id: string;
  routeId: string;
  lat: number;
  lng: number;
  label: string;
  simulated: boolean;
  state: CitizenState;
  regNo: string | null;
  distanceM: number | null;
  etaS: number | null;
}

/** Warn this far ahead of the ambulance: 30 s of driving, at least 250 m. */
const WARN_S = 30;
const WARN_MIN_M = 250;
/** Considered passed once the ambulance is this far beyond the car. */
const PASS_MARGIN_M = 10;
const MAX_PER_ROUTE = 250;
const MAX_SIMULATED_PER_ROUTE = 60;

export class CitizenService implements TripObserver {
  private readonly citizens = new Map<string, Citizen>();

  constructor(
    private readonly catalog: RouteCatalog,
    private readonly notifier: Notifier,
    private readonly log: Logger,
  ) {}

  /** A real phone joins as a car somewhere on the route (spread out, near the junctions). */
  join(routeId: string): CitizenView {
    const route = this.requireRoute(routeId);
    if (this.onRoute(routeId).length >= MAX_PER_ROUTE) throw new HttpError(429, 'corridor_full');
    const [lo, hi] = this.span(routeId);
    const c = this.create(routeId, lo + Math.random() * (hi - lo), false);
    this.log.info({ citizen: c.id, route: route.id }, 'citizen joined');
    this.pushAdmin();
    return this.view(c);
  }

  /** Demo: fill the corridor with simulated cars so the map shows the effect at scale. */
  addSimulated(routeId: string, count: number): number {
    this.requireRoute(routeId);
    const existing = this.onRoute(routeId).filter((c) => c.simulated).length;
    const n = Math.max(0, Math.min(count, MAX_SIMULATED_PER_ROUTE - existing));
    const [lo, hi] = this.span(routeId);
    for (let i = 0; i < n; i++) {
      const along = lo + ((i + 0.5) / n) * (hi - lo) + (Math.random() - 0.5) * ((hi - lo) / n) * 0.8;
      this.create(routeId, along, true);
    }
    this.pushAdmin();
    return n;
  }

  get(id: string): CitizenView | null {
    const c = this.citizens.get(id);
    return c ? this.view(c) : null;
  }

  remove(id: string): void {
    if (this.citizens.delete(id)) this.pushAdmin();
  }

  list(): CitizenView[] {
    return [...this.citizens.values()].map((c) => this.view(c));
  }

  /** Demo reset: drop simulated cars, return real ones to idle. */
  reset(): void {
    for (const [id, c] of this.citizens) {
      if (c.simulated) this.citizens.delete(id);
      else this.toIdle(c);
    }
    this.pushAdmin();
  }

  // ── TripObserver ──

  started({ routeId }: { tripId: number; routeId: string }): void {
    for (const c of this.onRoute(routeId)) this.toIdle(c);
    this.pushAdmin();
  }

  ended({ tripId }: { tripId: number; routeId: string }): void {
    let changed = false;
    for (const c of this.citizens.values()) {
      if (c.tripId === tripId && c.state === 'warned') {
        this.toIdle(c);
        changed = true;
      }
    }
    if (changed) this.pushAdmin();
  }

  progress(p: TripProgress): void {
    const radius = Math.max(WARN_MIN_M, p.etaSpeedMps * WARN_S);
    let changed = false;
    for (const c of this.onRoute(p.routeId)) {
      const d = c.alongM - p.progressM; // > 0: ambulance is behind this car
      if (c.state === 'idle' && d > 0 && d <= radius) {
        c.state = 'warned';
        c.tripId = p.tripId;
        c.regNo = p.regNo;
        changed = true;
      } else if (c.state === 'warned' && c.tripId === p.tripId && d < -PASS_MARGIN_M) {
        c.state = 'cleared';
        c.distanceM = null;
        c.etaS = null;
        changed = true;
        this.notifier.emit([rooms.citizen(c.id)], 'citizen:update', this.view(c));
        continue;
      }
      if (c.state === 'warned' && c.tripId === p.tripId) {
        c.distanceM = Math.max(0, Math.round(d));
        c.etaS = Math.round(Math.max(0, d) / p.etaSpeedMps);
        if (!c.simulated) this.notifier.emit([rooms.citizen(c.id)], 'citizen:update', this.view(c));
      }
    }
    if (changed) this.pushAdmin();
  }

  // ── internals ──

  private create(routeId: string, alongM: number, simulated: boolean): Citizen {
    const c: Citizen = {
      id: randomUUID(),
      routeId,
      alongM,
      label: this.nearestJunctionLabel(routeId, alongM),
      simulated,
      state: 'idle',
      tripId: null,
      regNo: null,
      distanceM: null,
      etaS: null,
    };
    this.citizens.set(c.id, c);
    return c;
  }

  private toIdle(c: Citizen): void {
    const was = c.state;
    c.state = 'idle';
    c.tripId = null;
    c.regNo = null;
    c.distanceM = null;
    c.etaS = null;
    if (was !== 'idle' && !c.simulated) this.notifier.emit([rooms.citizen(c.id)], 'citizen:update', this.view(c));
  }

  /** Where cars are placed: from just before the first junction to just before the hospital. */
  private span(routeId: string): [number, number] {
    const route = this.requireRoute(routeId);
    const first = route.signals[0]?.alongM ?? 0;
    return [Math.max(100, first - 400), Math.max(200, route.geometry.lengthM - 150)];
  }

  private nearestJunctionLabel(routeId: string, alongM: number): string {
    const route = this.requireRoute(routeId);
    let best = route.signals[0];
    for (const s of route.signals) if (best && Math.abs(s.alongM - alongM) < Math.abs(best.alongM - alongM)) best = s;
    return best ? `near ${best.name}` : route.name;
  }

  private onRoute(routeId: string): Citizen[] {
    return [...this.citizens.values()].filter((c) => c.routeId === routeId);
  }

  private requireRoute(routeId: string) {
    const r = this.catalog.get(routeId);
    if (!r) throw new HttpError(404, 'route_not_found');
    return r;
  }

  private view(c: Citizen): CitizenView {
    const p = this.requireRoute(c.routeId).geometry.pointAt(c.alongM);
    return {
      id: c.id,
      routeId: c.routeId,
      lat: p.lat,
      lng: p.lng,
      label: c.label,
      simulated: c.simulated,
      state: c.state,
      regNo: c.regNo,
      distanceM: c.distanceM,
      etaS: c.etaS,
    };
  }

  private pushAdmin(): void {
    this.notifier.emit([rooms.admin], 'citizens', this.list());
  }
}
