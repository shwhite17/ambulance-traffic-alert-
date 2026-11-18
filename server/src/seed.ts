import bcrypt from 'bcryptjs';
import { tx, type Db } from './db.js';
import type { RouteSeed } from './services/catalog.js';

/** Every seeded account uses this password. Demo only. */
export const DEMO_PASSWORD = 'demo1234';

const cityKey = (city: string) => (city === 'Bengaluru' ? 'blr' : city.toLowerCase());

/**
 * Seeds hospitals, signals and one account per role per city. Idempotent:
 * does nothing if users already exist.
 *
 * Accounts (password demo1234):
 *   control@demo.in                     admin / control room (all cities)
 *   driver.<city>@demo.in               ambulance driver
 *   hospital.<city>@demo.in             hospital desk
 *   officer.<signal-code>@demo.in       primary officer for that junction
 *   backup.<city>@demo.in               backup / patrol officer for the route
 */
export function seedIfEmpty(db: Db, routes: RouteSeed[]): boolean {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n > 0) return false;

  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insUser = db.prepare(
    'INSERT INTO users (email, password_hash, name, role, city, hospital_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  );
  const user = (email: string, name: string, role: string, city: string | null, hospitalId: string | null = null) =>
    (insUser.get(email, hash, name, role, city, hospitalId) as { id: number }).id;

  tx(db, () => {
    user('control@demo.in', 'Control Room', 'admin', null);

    for (const r of routes) {
      const ck = cityKey(r.city);
      db.prepare('INSERT INTO hospitals (id, name, city, lat, lng) VALUES (?, ?, ?, ?, ?)').run(
        r.hospital.id,
        r.hospital.name,
        r.city,
        r.hospital.lat,
        r.hospital.lng,
      );
      const driverId = user(`driver.${ck}@demo.in`, `Driver (${r.city})`, 'driver', r.city);
      db.prepare('INSERT INTO ambulances (reg_no, driver_id, city) VALUES (?, ?, ?)').run(
        ck === 'blr' ? 'KA-01-AMB-108' : 'MH-12-AMB-108',
        driverId,
        r.city,
      );
      user(`hospital.${ck}@demo.in`, r.hospital.name, 'hospital', r.city, r.hospital.id);
      const backupId = user(`backup.${ck}@demo.in`, `Backup Patrol (${r.city})`, 'officer', r.city);

      for (const s of r.signals) {
        const officerId = user(`officer.${s.code.toLowerCase()}@demo.in`, `Officer @ ${s.name}`, 'officer', r.city);
        db.prepare(
          'INSERT INTO signals (code, name, city, route_id, lat, lng, officer_id, backup_officer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(s.code, s.name, r.city, r.id, s.lat, s.lng, officerId, backupId);
      }
    }
  });
  return true;
}
