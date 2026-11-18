import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS hospitals (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  lat  REAL NOT NULL,
  lng  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('driver','officer','hospital','admin')),
  city          TEXT,
  hospital_id   TEXT REFERENCES hospitals(id)
);

CREATE TABLE IF NOT EXISTS ambulances (
  id        INTEGER PRIMARY KEY,
  reg_no    TEXT NOT NULL UNIQUE,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  city      TEXT NOT NULL
);

-- Officer assignment lives on the signal: one primary and one backup officer.
CREATE TABLE IF NOT EXISTS signals (
  id                INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  city              TEXT NOT NULL,
  route_id          TEXT NOT NULL,
  lat               REAL NOT NULL,
  lng               REAL NOT NULL,
  officer_id        INTEGER REFERENCES users(id),
  backup_officer_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS trips (
  id                    INTEGER PRIMARY KEY,
  ambulance_id          INTEGER NOT NULL REFERENCES ambulances(id),
  driver_id             INTEGER NOT NULL REFERENCES users(id),
  hospital_id           TEXT NOT NULL REFERENCES hospitals(id),
  route_id              TEXT NOT NULL,
  emergency_type        TEXT NOT NULL,
  simulated             INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL CHECK (status IN ('active','ended')),
  end_reason            TEXT,
  started_at            INTEGER NOT NULL,
  ended_at              INTEGER,
  hospital_confirmed_at INTEGER,
  hospital_ready_at     INTEGER,
  patient_note          TEXT,
  summary_json          TEXT
);
CREATE INDEX IF NOT EXISTS trips_status ON trips(status);

CREATE TABLE IF NOT EXISTS trip_signals (
  trip_id   INTEGER NOT NULL REFERENCES trips(id),
  signal_id INTEGER NOT NULL REFERENCES signals(id),
  ord       INTEGER NOT NULL,
  along_m   REAL NOT NULL,
  state     TEXT NOT NULL,
  PRIMARY KEY (trip_id, signal_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id              INTEGER PRIMARY KEY,
  trip_id         INTEGER NOT NULL REFERENCES trips(id),
  signal_id       INTEGER NOT NULL REFERENCES signals(id),
  trigger         TEXT NOT NULL,
  distance_m      INTEGER NOT NULL,
  eta_s           INTEGER NOT NULL,
  approach_from   TEXT,
  alerted_at      INTEGER NOT NULL,
  escalated_at    INTEGER,
  acknowledged_at INTEGER,
  acknowledged_by INTEGER REFERENCES users(id),
  passed_at       INTEGER,
  closed_at       INTEGER,
  UNIQUE (trip_id, signal_id)
);

-- Pings stay in memory; one sample per ~10 s is persisted for the trip trace.
CREATE TABLE IF NOT EXISTS location_samples (
  trip_id    INTEGER NOT NULL REFERENCES trips(id),
  ts         INTEGER NOT NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  progress_m REAL NOT NULL,
  speed_mps  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER NOT NULL,
  user_id   INTEGER,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  details   TEXT
);
`;

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function audit(
  db: Db,
  entry: { userId?: number | null; action: string; entity?: string; entityId?: string | number; details?: unknown },
): void {
  db.prepare('INSERT INTO audit_log (ts, user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)').run(
    Date.now(),
    entry.userId ?? null,
    entry.action,
    entry.entity ?? null,
    entry.entityId === undefined ? null : String(entry.entityId),
    entry.details === undefined ? null : JSON.stringify(entry.details),
  );
}

/** Run fn inside a transaction. node:sqlite has no helper for this. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
