import { pino } from 'pino';
import { openDb } from '../src/db.js';
import { seedIfEmpty } from '../src/seed.js';
import { RouteCatalog, loadRouteSeeds } from '../src/services/catalog.js';
import { TripService, type Notifier } from '../src/services/tripService.js';
import { Simulator } from '../src/services/simulator.js';
import type { AuthUser } from '../src/auth.js';

export interface Emitted {
  rooms: string[];
  event: string;
  payload: any;
}

/** Full service stack on an in-memory DB with a recording notifier. */
export function makeStack() {
  const db = openDb(':memory:');
  const seeds = loadRouteSeeds(new URL('../data/routes.json', import.meta.url));
  seedIfEmpty(db, seeds);
  const catalog = new RouteCatalog(seeds, db);
  const log = pino({ level: 'silent' });
  const emitted: Emitted[] = [];
  const listeners: ((e: Emitted) => void)[] = [];
  const record = (e: Emitted) => {
    emitted.push(e);
    for (const l of listeners) l(e);
  };
  const notifier: Notifier = {
    emit: (rooms, event, payload) => record({ rooms, event, payload }),
    demoReset: () => record({ rooms: ['*'], event: 'demo:reset', payload: {} }),
  };
  const trips = new TripService(db, catalog, notifier, log);
  const simulator = new Simulator(db, catalog, trips, notifier, log);

  const userByEmail = (email: string): AuthUser => {
    const u = db.prepare('SELECT id, role, name, city, hospital_id FROM users WHERE email = ?').get(email) as any;
    if (!u) throw new Error(`no user ${email}`);
    return { id: u.id, role: u.role, name: u.name, city: u.city, hospitalId: u.hospital_id };
  };

  return {
    db,
    catalog,
    trips,
    simulator,
    emitted,
    onEmit: (l: (e: Emitted) => void) => listeners.push(l),
    userByEmail,
    dispose: () => {
      simulator.dispose();
      trips.dispose();
      db.close();
    },
  };
}
