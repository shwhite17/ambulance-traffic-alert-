import turfDistance from '@turf/distance';
import turfBearing from '@turf/bearing';
import type { LngLat } from './types.js';

const M_PER_DEG_LAT = 111_320;

export function haversineM(a: LngLat, b: LngLat): number {
  return turfDistance([a.lng, a.lat], [b.lng, b.lat], { units: 'meters' });
}

/** Initial bearing a → b in degrees, 0..360 (0 = north). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  return (turfBearing([a.lng, a.lat], [b.lng, b.lat]) + 360) % 360;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
export function compass(deg: number): (typeof COMPASS)[number] {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

export interface Projection {
  /** Distance from route start to the snapped point, along the route. */
  alongM: number;
  /** Perpendicular distance from the input point to the route. */
  offsetM: number;
  point: LngLat;
}

/**
 * A route polyline with precomputed cumulative distances. All "distance to a
 * signal" logic is measured ALONG this line, never straight-line, so a parallel
 * road can't trigger a false alert.
 */
export class RouteGeometry {
  readonly points: LngLat[];
  /** cum[i] = distance from start to points[i]. */
  readonly cum: number[];
  readonly lengthM: number;

  constructor(coordinates: ReadonlyArray<readonly [number, number]>) {
    if (coordinates.length < 2) throw new Error('Route needs at least 2 points');
    this.points = coordinates.map(([lng, lat]) => ({ lng, lat }));
    this.cum = [0];
    for (let i = 1; i < this.points.length; i++) {
      this.cum.push(this.cum[i - 1]! + haversineM(this.points[i - 1]!, this.points[i]!));
    }
    this.lengthM = this.cum[this.cum.length - 1]!;
  }

  /**
   * Snap a point to the route. If a window is given, only segments overlapping
   * [minAlongM, maxAlongM] are considered, which prevents snapping to an earlier
   * or much later part of a route that passes near itself. Falls back to the
   * whole route if nothing in the window is close.
   */
  project(p: LngLat, window?: { minAlongM: number; maxAlongM: number; maxOffsetM: number }): Projection {
    if (window) {
      const best = this.projectRange(p, window.minAlongM, window.maxAlongM);
      if (best && best.offsetM <= window.maxOffsetM) return best;
    }
    return this.projectRange(p, -Infinity, Infinity)!;
  }

  private projectRange(p: LngLat, minAlong: number, maxAlong: number): Projection | null {
    let best: Projection | null = null;
    for (let i = 0; i < this.points.length - 1; i++) {
      if (this.cum[i + 1]! < minAlong || this.cum[i]! > maxAlong) continue;
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      // Local equirectangular frame centred on a: accurate to well under 1 m
      // for segment lengths seen on city roads.
      const kx = M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
      const bx = (b.lng - a.lng) * kx;
      const by = (b.lat - a.lat) * M_PER_DEG_LAT;
      const px = (p.lng - a.lng) * kx;
      const py = (p.lat - a.lat) * M_PER_DEG_LAT;
      const len2 = bx * bx + by * by;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
      const dx = px - t * bx;
      const dy = py - t * by;
      const offsetM = Math.hypot(dx, dy);
      if (!best || offsetM < best.offsetM) {
        const segLen = this.cum[i + 1]! - this.cum[i]!;
        best = {
          alongM: this.cum[i]! + t * segLen,
          offsetM,
          point: { lng: a.lng + t * (b.lng - a.lng), lat: a.lat + t * (b.lat - a.lat) },
        };
      }
    }
    return best;
  }

  /** Point at a given along-route distance (clamped to the route). */
  pointAt(alongM: number): LngLat {
    const d = Math.max(0, Math.min(this.lengthM, alongM));
    // Binary search for the segment containing d.
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const a = this.points[lo]!;
    const b = this.points[hi]!;
    const seg = this.cum[hi]! - this.cum[lo]!;
    const t = seg === 0 ? 0 : (d - this.cum[lo]!) / seg;
    return { lng: a.lng + t * (b.lng - a.lng), lat: a.lat + t * (b.lat - a.lat) };
  }

  /**
   * Compass direction an ambulance approaches a point from, e.g. "east" means
   * it is coming from the east. Uses the route shape just before the point.
   */
  approachFrom(alongM: number, lookbackM = 100): string {
    const at = this.pointAt(alongM);
    const before = this.pointAt(alongM - lookbackM);
    if (haversineM(at, before) < 1) return 'unknown';
    return compass(bearingDeg(at, before));
  }
}
