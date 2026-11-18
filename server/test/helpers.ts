import type { LngLat } from '../src/domain/types.js';

/** Origin near Bengaluru so the local-metre conversion is realistic. */
export const ORIGIN = { lat: 12.95, lng: 77.65 };
const M_PER_DEG_LAT = 111_320;

/** Convert local metres (x east, y north) to lng/lat around ORIGIN. */
export function m(x: number, y: number): LngLat {
  return {
    lat: ORIGIN.lat + y / M_PER_DEG_LAT,
    lng: ORIGIN.lng + x / (M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  };
}

export function coords(...pts: [number, number][]): [number, number][] {
  return pts.map(([x, y]) => {
    const p = m(x, y);
    return [p.lng, p.lat];
  });
}
