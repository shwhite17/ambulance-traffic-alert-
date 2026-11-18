export type Role = 'driver' | 'officer' | 'hospital' | 'admin';

/** Per-signal lifecycle for one trip. See alertEngine.ts for transitions. */
export type SignalState = 'PENDING' | 'ALERTED' | 'ESCALATED' | 'ACKNOWLEDGED' | 'PASSED' | 'CLOSED';

export interface LngLat {
  lng: number;
  lat: number;
}

export interface LocationPing extends LngLat {
  /** Reported GPS accuracy in metres (optional for simulator). */
  accuracy?: number;
  /** Client timestamp, epoch ms. */
  ts: number;
}

export interface SignalDef extends LngLat {
  id: number;
  code: string;
  name: string;
}

/** A signal placed on a specific route. */
export interface RouteSignal extends SignalDef {
  /** Distance from route start to the signal, measured along the route. */
  alongM: number;
  order: number;
}

export interface TripSignalStatus {
  signalId: number;
  code: string;
  name: string;
  order: number;
  alongM: number;
  state: SignalState;
  alertId: number | null;
  /** Distance remaining along the route (null once passed). */
  distanceM: number | null;
  etaS: number | null;
  alertedAt: number | null;
  escalatedAt: number | null;
  acknowledgedAt: number | null;
  acknowledgedBy: number | null;
  passedAt: number | null;
  /** Which rule fired: distance, ETA, or both. */
  trigger: 'distance' | 'eta' | 'both' | null;
  /** Distance and ETA at the moment the alert fired. */
  alertDistanceM: number | null;
  alertEtaS: number | null;
  /** Compass direction the ambulance approaches from, e.g. "east". */
  approachFrom: string | null;
}
