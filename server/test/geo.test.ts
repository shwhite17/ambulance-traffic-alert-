import { describe, expect, it } from 'vitest';
import { RouteGeometry, compass } from '../src/domain/geo.js';
import seed from '../data/routes.json' with { type: 'json' };
import { coords, m } from './helpers.js';

describe('RouteGeometry', () => {
  const straight = new RouteGeometry(coords([0, 0], [1000, 0], [2000, 0]));

  it('measures length along the polyline', () => {
    expect(straight.lengthM).toBeCloseTo(2000, -1);
  });

  it('snaps a point to the route and reports along + offset', () => {
    const p = straight.project(m(750, 40));
    expect(p.alongM).toBeCloseTo(750, -1);
    expect(p.offsetM).toBeCloseTo(40, 0);
  });

  it('pointAt and project round-trip', () => {
    for (const d of [0, 123, 999, 1500, straight.lengthM]) {
      expect(straight.project(straight.pointAt(d)).alongM).toBeCloseTo(d, 0);
    }
  });

  it('clamps pointAt outside the route', () => {
    expect(straight.project(straight.pointAt(-50)).alongM).toBeCloseTo(0, 0);
    expect(straight.project(straight.pointAt(99_999)).alongM).toBeCloseTo(straight.lengthM, 0);
  });

  it('windowed snapping stays on the current leg of a route that doubles back', () => {
    // U-turn: east 3 km, north 60 m, west 3 km. Point is closer to the return leg.
    const u = new RouteGeometry(coords([0, 0], [3000, 0], [3000, 60], [0, 60]));
    const p = m(500, 35);
    expect(u.project(p).alongM).toBeGreaterThan(5000); // naive global match: wrong leg
    const windowed = u.project(p, { minAlongM: 300, maxAlongM: 2400, maxOffsetM: 75 });
    expect(windowed.alongM).toBeCloseTo(500, -1);
  });

  it('reports the approach direction', () => {
    // Travelling east, so the ambulance approaches from the west.
    expect(straight.approachFrom(1000)).toBe('west');
    expect(compass(0)).toBe('north');
    expect(compass(359)).toBe('north');
    expect(compass(90)).toBe('east');
  });

  it('seeded real routes match OSRM length and all signals sit on the route', () => {
    for (const r of seed.routes) {
      const g = new RouteGeometry(r.coordinates as [number, number][]);
      expect(Math.abs(g.lengthM - r.distanceM) / r.distanceM).toBeLessThan(0.01);
      let prev = -1;
      for (const s of r.signals) {
        const p = g.project(s);
        expect(p.offsetM, `${s.code} off route`).toBeLessThan(25);
        expect(p.alongM, `${s.code} out of order`).toBeGreaterThan(prev);
        prev = p.alongM;
      }
    }
  });
});
