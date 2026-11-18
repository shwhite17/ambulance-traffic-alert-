import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import bcrypt from 'bcryptjs';
import { existsSync } from 'node:fs';
import { z, ZodError } from 'zod';
import { config } from '../config.js';
import { audit, type Db } from '../db.js';
import { HttpError, requireAuth, signToken, userOf, type AuthUser } from '../auth.js';
import type { RouteCatalog } from '../services/catalog.js';
import type { TripService } from '../services/tripService.js';
import type { Simulator } from '../services/simulator.js';

interface Deps {
  db: Db;
  catalog: RouteCatalog;
  trips: TripService;
  simulator: Simulator;
  log: Logger;
  clientDist?: string;
}

const LoginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const StartTripBody = z.object({ hospitalId: z.string().min(1).max(64), emergencyType: z.string().min(1).max(40) });
const LocationBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10_000).optional(),
  ts: z.number().int().positive(),
});
const HospitalBody = z.object({ action: z.enum(['confirm', 'ready', 'note']), note: z.string().max(500).optional() });
const SimStartBody = z.object({
  routeId: z.string().min(1),
  speedKmh: z.number().min(5).max(150),
  startAtM: z.number().min(0).optional(),
  noiseM: z.number().min(0).max(50).optional(),
  emergencyType: z.string().max(40).optional(),
});
const SimControlBody = z.object({
  speedKmh: z.number().min(5).max(150).optional(),
  paused: z.boolean().optional(),
  skipToNextSignal: z.boolean().optional(),
});

/** Client clocks drift; reject only clearly bogus timestamps. */
const MAX_CLOCK_SKEW_MS = 10 * 60_000;

const idParam = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'invalid_id');
  return n;
};

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: AuthUser['role'];
  city: string | null;
  hospital_id: string | null;
}
const toAuthUser = (u: UserRow): AuthUser => ({ id: u.id, role: u.role, name: u.name, city: u.city, hospitalId: u.hospital_id });

export function createApp({ db, catalog, trips, simulator, log, clientDist }: Deps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin: config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '32kb' }));
  app.use(
    pinoHttp({
      logger: log,
      // Location pings arrive every 1-3 s per trip; logging each one is noise.
      autoLogging: { ignore: (req) => req.url?.includes('/location') === true || req.url === '/health' },
    }),
  );

  const startedAt = Date.now();
  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptimeS: Math.round((Date.now() - startedAt) / 1000), activeTrips: trips.activeCount, demoMode: config.demoMode });
  });

  const api = express.Router();

  // ── auth ──
  const loginLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
  api.post('/auth/login', loginLimiter, (req, res) => {
    const { email, password } = LoginBody.parse(req.body);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
    if (!u || !bcrypt.compareSync(password, u.password_hash)) throw new HttpError(401, 'invalid_credentials');
    audit(db, { userId: u.id, action: 'auth.login' });
    const user = toAuthUser(u);
    res.json({ token: signToken(user), role: user.role, user });
  });

  api.get('/me', requireAuth(), (req, res) => res.json(userOf(req)));

  // ── demo helpers (only when DEMO_MODE=true) ──
  const demoOnly = (_req: Request, _res: Response, next: NextFunction) =>
    config.demoMode ? next() : next(new HttpError(404, 'not_found'));

  api.get('/demo/accounts', demoOnly, (_req, res) => {
    res.json(db.prepare('SELECT email, name, role, city, hospital_id AS hospitalId FROM users ORDER BY role, city, email').all());
  });
  api.post('/demo/login', demoOnly, loginLimiter, (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
    if (!u) throw new HttpError(404, 'unknown_demo_account');
    audit(db, { userId: u.id, action: 'auth.demo_login' });
    const user = toAuthUser(u);
    res.json({ token: signToken(user), role: user.role, user });
  });

  // ── reference data ──
  api.get('/hospitals', requireAuth(), (_req, res) => {
    res.json(db.prepare('SELECT id, name, city, lat, lng FROM hospitals ORDER BY city').all());
  });
  api.get('/routes', requireAuth(), (_req, res) => {
    res.json(
      catalog.all().map((r) => ({
        id: r.id,
        city: r.city,
        name: r.name,
        hospitalId: r.hospitalId,
        lengthM: Math.round(r.geometry.lengthM),
        coordinates: r.coordinates,
        signals: r.signals,
      })),
    );
  });
  api.get('/signals', requireAuth(), (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT s.id, s.code, s.name, s.city, s.route_id AS routeId, s.lat, s.lng,
                  o.name AS officer, b.name AS backupOfficer
             FROM signals s LEFT JOIN users o ON o.id = s.officer_id LEFT JOIN users b ON b.id = s.backup_officer_id
            ORDER BY s.code`,
        )
        .all(),
    );
  });

  // ── trips ──
  api.post('/trips', requireAuth('driver'), (req, res) => {
    res.status(201).json(trips.startTrip(userOf(req), StartTripBody.parse(req.body)));
  });
  api.get('/trips/active', requireAuth(), (req, res) => res.json(trips.activeTripsFor(userOf(req))));
  api.get('/trips', requireAuth('admin'), (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT t.id, t.status, t.simulated, t.emergency_type AS emergencyType, t.started_at AS startedAt, t.ended_at AS endedAt,
                  t.end_reason AS endReason, t.route_id AS routeId, h.name AS hospital, a.reg_no AS ambulance
             FROM trips t JOIN hospitals h ON h.id = t.hospital_id JOIN ambulances a ON a.id = t.ambulance_id
            ORDER BY t.id DESC LIMIT 50`,
        )
        .all(),
    );
  });
  api.get('/trips/:id', requireAuth(), (req, res) => res.json(trips.getTrip(idParam(req), userOf(req))));

  const locationLimiter = rateLimit({
    windowMs: 10_000,
    limit: 30, // ~3/s ceiling; a phone sends one every 2-3 s
    keyGenerator: (req) => `u${req.user?.id ?? 'anon'}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  api.post('/trips/:id/location', requireAuth('driver'), locationLimiter, (req, res) => {
    const body = LocationBody.parse(req.body);
    if (Math.abs(body.ts - Date.now()) > MAX_CLOCK_SKEW_MS) throw new HttpError(400, 'timestamp_out_of_range');
    res.json(trips.ingestLocation(idParam(req), userOf(req), body));
  });
  api.post('/trips/:id/end', requireAuth('driver', 'admin'), (req, res) => {
    res.json(trips.endTrip(idParam(req), userOf(req)));
  });
  api.post('/trips/:id/hospital', requireAuth('hospital', 'admin'), (req, res) => {
    const { action, note } = HospitalBody.parse(req.body);
    res.json(trips.hospitalAction(idParam(req), userOf(req), action, note));
  });

  // ── officer ──
  api.post('/alerts/:id/ack', requireAuth('officer', 'admin'), (req, res) => {
    res.json(trips.acknowledge(idParam(req), userOf(req)));
  });
  api.get('/officer/alerts', requireAuth('officer'), (req, res) => {
    const user = userOf(req);
    const mine = trips.officerSignals(user.id);
    const ids = [...mine.primary, ...mine.backup];
    const signals = ids.length
      ? db.prepare(`SELECT id, code, name, city, lat, lng FROM signals WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY code`).all(...ids)
      : [];
    const recent = ids.length
      ? db
          .prepare(
            `SELECT a.id, a.trip_id AS tripId, s.code, s.name, a.trigger, a.distance_m AS distanceM, a.eta_s AS etaS,
                    a.alerted_at AS alertedAt, a.escalated_at AS escalatedAt, a.acknowledged_at AS acknowledgedAt, a.passed_at AS passedAt
               FROM alerts a JOIN signals s ON s.id = a.signal_id
              WHERE a.signal_id IN (${ids.map(() => '?').join(',')})
              ORDER BY a.alerted_at DESC LIMIT 10`,
          )
          .all(...ids)
      : [];
    res.json({ primarySignalIds: mine.primary, backupSignalIds: mine.backup, signals, current: trips.officerAlerts(user), recent });
  });

  // ── simulator (demo only) ──
  api.get('/simulator', demoOnly, requireAuth('admin'), (_req, res) => res.json(simulator.list()));
  api.post('/simulator/start', demoOnly, requireAuth('admin'), (req, res) => {
    res.status(201).json(simulator.start(SimStartBody.parse(req.body)));
  });
  api.post('/simulator/:id/control', demoOnly, requireAuth('admin'), (req, res) => {
    res.json(simulator.control(idParam(req), SimControlBody.parse(req.body)));
  });
  api.post('/simulator/:id/stop', demoOnly, requireAuth('admin'), (req, res) => {
    simulator.stop(idParam(req));
    res.status(204).end();
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'not_found')));
  app.use('/api', api);

  // Serve the built React app from the same origin in production.
  if (clientDist && existsSync(clientDist)) {
    app.use(
      express.static(clientDist, {
        maxAge: '1h',
        index: false,
        // The service worker must always be revalidated so new deploys roll out.
        setHeaders: (res, path) => {
          if (path.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get(/^\/(?!api|socket\.io|health).*/, (_req, res) => res.sendFile('index.html', { root: clientDist }));
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof ZodError) return res.status(400).json({ error: 'invalid_input', issues: err.issues });
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'invalid_json' });
    req.log.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
