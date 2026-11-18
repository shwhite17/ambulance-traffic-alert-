// Client-side route geometry for visuals: smooth along-road motion and
// highlighting route slices (travelled / alert zone). Alert decisions stay on
// the server; this only draws them.

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface RouteLine {
  /** [lng, lat] */
  coords: [number, number][];
  cum: number[];
  length: number;
}

export function buildLine(coords: [number, number][]): RouteLine {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1]! + haversine(coords[i - 1]!, coords[i]!));
  return { coords, cum, length: cum[cum.length - 1] ?? 0 };
}

function seg(line: RouteLine, d: number): number {
  let lo = 0;
  let hi = line.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** [lat, lng] at a distance along the route (Leaflet order). */
export function pointAt(line: RouteLine, along: number): [number, number] {
  if (line.coords.length === 0) return [0, 0];
  const d = Math.max(0, Math.min(line.length, along));
  const i = seg(line, d);
  const a = line.coords[i]!;
  const b = line.coords[Math.min(i + 1, line.coords.length - 1)]!;
  const len = line.cum[i + 1] !== undefined ? line.cum[i + 1]! - line.cum[i]! : 0;
  const t = len === 0 ? 0 : (d - line.cum[i]!) / len;
  return [a[1] + t * (b[1] - a[1]), a[0] + t * (b[0] - a[0])];
}

/** Heading in degrees (0 = north) of the route at a distance. */
export function headingAt(line: RouteLine, along: number): number {
  const [lat1, lng1] = pointAt(line, along - 15);
  const [lat2, lng2] = pointAt(line, along + 15);
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Sub-polyline between two distances, as Leaflet [lat, lng] points. */
export function slice(line: RouteLine, from: number, to: number): [number, number][] {
  const a = Math.max(0, Math.min(line.length, from));
  const b = Math.max(0, Math.min(line.length, to));
  if (b <= a) return [];
  const out: [number, number][] = [pointAt(line, a)];
  for (let i = seg(line, a) + 1; i < line.coords.length && line.cum[i]! < b; i++) {
    const c = line.coords[i]!;
    out.push([c[1], c[0]]);
  }
  out.push(pointAt(line, b));
  return out;
}
