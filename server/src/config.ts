// All tunables in one place. Thresholds come from the blueprint (section 7).
const env = process.env;

function num(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

const isProd = env.NODE_ENV === 'production';
const jwtSecret = env.JWT_SECRET ?? (isProd ? '' : 'dev-only-secret-change-me');
if (!jwtSecret) throw new Error('JWT_SECRET must be set in production');

export const config = {
  port: num('PORT', 4000),
  isProd,
  jwtSecret,
  jwtTtl: '12h',
  dbPath: env.DB_PATH ?? 'data/app.db',
  /** Demo mode enables the simulator and one-click demo logins. */
  demoMode: (env.DEMO_MODE ?? 'true') === 'true',
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',

  alert: {
    /** Trigger when along-route distance to the signal is at most this. */
    distanceM: num('ALERT_DISTANCE_M', 500),
    /** ...or when the ETA to the signal is at most this. */
    etaS: num('ALERT_ETA_S', 60),
    /** No acknowledgment within this window escalates to backup + control room. */
    escalateAfterMs: num('ESCALATE_AFTER_MS', 10_000),
    /** Ambulance is considered past a signal once this far beyond it. */
    passMarginM: 15,
  },

  pipeline: {
    /** Rolling window for speed estimation. */
    speedWindowMs: 10_000,
    /** Floor so ETA stays finite while stopped (~5.4 km/h). */
    minSpeedMps: 1.5,
    /** Reject pings implying a jump faster than this (~216 km/h). */
    maxPlausibleSpeedMps: 60,
    /** Accuracy worse than this is flagged as low confidence. */
    lowAccuracyM: 50,
    /** Perpendicular distance from the route considered off-route. */
    offRouteM: 75,
    /** No ping for this long marks the driver offline. */
    offlineAfterMs: 10_000,
    /** Persist one location sample per this interval (pings stay in memory). */
    sampleEveryMs: 10_000,
  },

  /**
   * ASSUMPTION used only for the clearly labeled "simulated time saved" figure:
   * average wait at a signalized junction without advance clearance.
   */
  assumedWaitPerJunctionS: num('ASSUMED_WAIT_PER_JUNCTION_S', 45),
} as const;
