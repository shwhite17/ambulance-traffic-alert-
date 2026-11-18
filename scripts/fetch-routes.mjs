// One-off helper: fetch real road routes from the public OSRM server and list
// candidate junctions (intersections with 4+ approaches) along each route.
// Output is written to scripts/out/<id>.raw.json for manual curation into
// server/data/routes.json. Run: node scripts/fetch-routes.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const ROUTES = [
  {
    id: 'blr-old-airport-road',
    city: 'Bengaluru',
    start: { name: 'Marathahalli Bridge', lat: 12.9569, lng: 77.7011 },
    end: { name: 'Manipal Hospital, Old Airport Road', lat: 12.9592, lng: 77.6489 },
    hospital: { id: 'blr-manipal', name: 'Manipal Hospital, Old Airport Road' },
    // Curated from the OSRM intersection list (4+ approaches). Names are road +
    // sequence only; landmarks must be confirmed on a map before claiming them.
    signals: [
      { code: 'BLR-J1', name: 'Varthur Rd Junction 1', lat: 12.955764, lng: 77.69179 },
      { code: 'BLR-J2', name: 'Varthur Rd Junction 2', lat: 12.954513, lng: 77.679888 },
      { code: 'BLR-J3', name: 'Old Airport Rd Junction 3', lat: 12.958591, lng: 77.664979 },
      { code: 'BLR-J4', name: 'Old Airport Rd Junction 4', lat: 12.959333, lng: 77.65428 },
      { code: 'BLR-J5', name: 'Manipal Hospital Junction', lat: 12.959735, lng: 77.649114 },
    ],
  },
  {
    id: 'pune-solapur-road',
    city: 'Pune',
    start: { name: 'Hadapsar (Magarpatta)', lat: 18.5089, lng: 73.926 },
    end: { name: 'Ruby Hall Clinic', lat: 18.5332, lng: 73.877 },
    hospital: { id: 'pune-rubyhall', name: 'Ruby Hall Clinic' },
    signals: [
      { code: 'PUN-J1', name: 'Solapur Rd Junction 1', lat: 18.502833, lng: 73.925522 },
      { code: 'PUN-J2', name: 'Pune-Solapur Rd Junction 2', lat: 18.506179, lng: 73.912605 },
      { code: 'PUN-J3', name: 'Solapur Rd Junction 3', lat: 18.506561, lng: 73.898494 },
      { code: 'PUN-J4', name: 'Prince of Wales Dr Junction 4', lat: 18.516491, lng: 73.893813 },
      { code: 'PUN-J5', name: 'Maneckji Mehta Rd Junction 5', lat: 18.524556, lng: 73.878733 },
      { code: 'PUN-J6', name: 'Bund Garden Rd Junction 6', lat: 18.530696, lng: 73.875606 },
    ],
  },
];
const seed = [];

for (const r of ROUTES) {
  const coords = `${r.start.lng},${r.start.lat};${r.end.lng},${r.end.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ambulance-alert-hackathon-seed/0.1' } });
  if (!res.ok) throw new Error(`${r.id}: OSRM ${res.status}`);
  const json = await res.json();
  const route = json.routes[0];
  writeFileSync(join(outDir, `${r.id}.raw.json`), JSON.stringify({ meta: r, route }, null, 2));

  console.log(`\n== ${r.id}: ${(route.distance / 1000).toFixed(2)} km, ${Math.round(route.duration)} s, ${route.geometry.coordinates.length} pts`);
  let cum = 0;
  for (const step of route.legs[0].steps) {
    let stepStart = cum;
    for (const ix of step.intersections) {
      const approaches = ix.bearings.length;
      if (approaches >= 4) {
        const [lng, lat] = ix.location;
        console.log(`  ~${(stepStart / 1000).toFixed(2)} km  ${lat.toFixed(6)},${lng.toFixed(6)}  approaches=${approaches}  road="${step.name}"`);
      }
    }
    cum += step.distance;
  }

  seed.push({
    id: r.id,
    city: r.city,
    name: `${r.start.name} → ${r.end.name}`,
    hospital: { ...r.hospital, lat: r.end.lat, lng: r.end.lng },
    distanceM: Math.round(route.distance),
    osrmDurationS: Math.round(route.duration),
    // GeoJSON order: [lng, lat]
    coordinates: route.geometry.coordinates.map(([lng, lat]) => [+lng.toFixed(6), +lat.toFixed(6)]),
    signals: r.signals,
  });
}

const seedPath = join(here, '..', 'server', 'data', 'routes.json');
writeFileSync(seedPath, JSON.stringify({ source: 'OSRM public server, fetched ' + new Date().toISOString().slice(0, 10), routes: seed }, null, 2));
console.log(`\nWrote ${seedPath}`);
