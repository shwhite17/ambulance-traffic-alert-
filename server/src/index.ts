import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { config } from './config.js';
import { openDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import { RouteCatalog, loadRouteSeeds } from './services/catalog.js';
import { TripService } from './services/tripService.js';
import { Simulator } from './services/simulator.js';
import { ClaudeBriefGenerator, FakeBriefGenerator, type BriefGenerator } from './services/briefAi.js';
import { CitizenService } from './services/citizens.js';
import { createApp } from './http/app.js';
import { createRealtime } from './realtime.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(config.isProd ? {} : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});

const db = openDb(config.dbPath);
const seeds = loadRouteSeeds(new URL('../data/routes.json', import.meta.url));
if (seedIfEmpty(db, seeds)) log.info('seeded demo data (password for all accounts: demo1234)');
const catalog = new RouteCatalog(seeds, db);

const httpServer = createServer();
const realtime = createRealtime(httpServer, log);
const trips = new TripService(db, catalog, realtime.notifier, log);
const simulator = new Simulator(db, catalog, trips, realtime.notifier, log);
const citizens = new CitizenService(catalog, realtime.notifier, log);
trips.observe(citizens);
realtime.attach(trips, citizens);
// AI briefs are optional: without a key the rest of the app runs normally.
// BRIEF_AI_FAKE is for end-to-end tests only and is refused in production.
if (process.env.BRIEF_AI_FAKE === '1' && config.isProd) throw new Error('BRIEF_AI_FAKE must never be enabled in production');
const briefAi: BriefGenerator =
  process.env.BRIEF_AI_FAKE === '1' ? new FakeBriefGenerator() : new ClaudeBriefGenerator(process.env.ANTHROPIC_API_KEY);
if (!briefAi.configured) log.warn('ANTHROPIC_API_KEY not set: AI paramedic briefs disabled');
if (process.env.BRIEF_AI_FAKE === '1') log.warn('TEST MODE: fake AI briefs');

const app = createApp({
  db,
  catalog,
  trips,
  simulator,
  briefAi,
  citizens,
  log,
  clientDist: fileURLToPath(new URL('../../client/dist', import.meta.url)),
});
httpServer.on('request', app);

httpServer.listen(config.port, () => {
  log.info({ port: config.port, demoMode: config.demoMode }, 'ambulance-alert server listening');
});

function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  simulator.dispose();
  trips.dispose();
  realtime.io.close();
  httpServer.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
