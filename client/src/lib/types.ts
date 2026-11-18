// Mirrors server/src/services/tripService.ts response shapes.
export type Role = 'driver' | 'officer' | 'hospital' | 'admin';
export type SignalState = 'PENDING' | 'ALERTED' | 'ESCALATED' | 'ACKNOWLEDGED' | 'PASSED' | 'CLOSED';

export interface User {
  id: number;
  role: Role;
  name: string;
  city: string | null;
  hospitalId: string | null;
}

export interface Session {
  token: string;
  user: User;
}

export interface SignalView {
  signalId: number;
  code: string;
  name: string;
  order: number;
  alongM: number;
  state: SignalState;
  alertId: number | null;
  distanceM: number | null;
  etaS: number | null;
  alertedAt: number | null;
  escalatedAt: number | null;
  acknowledgedAt: number | null;
  acknowledgedBy: number | null;
  passedAt: number | null;
  trigger: 'distance' | 'eta' | 'both' | null;
  alertDistanceM: number | null;
  alertEtaS: number | null;
  approachFrom: string | null;
  lat: number;
  lng: number;
}

export interface TripView {
  id: number;
  status: 'active';
  simulated: boolean;
  emergencyType: string;
  startedAt: number;
  ambulance: { regNo: string };
  hospital: { id: string; name: string; lat: number; lng: number };
  route: { id: string; name: string; city: string; lengthM: number; coordinates: [number, number][] };
  position: {
    lat: number;
    lng: number;
    snapped: { lat: number; lng: number };
    progressM: number;
    speedKmh: number;
    offRoute: boolean;
    lowConfidence: boolean;
    ts: number;
  } | null;
  remainingM: number;
  etaToHospitalS: number | null;
  offline: boolean;
  arrived: boolean;
  nextSignal: SignalView | null;
  signals: SignalView[];
  hospitalConfirmedAt: number | null;
  hospitalReadyAt: number | null;
  patientNote: string | null;
}

export interface AlertView {
  alertId: number | null;
  tripId: number;
  ambulanceRegNo: string;
  emergencyType: string;
  hospitalName: string;
  simulated: boolean;
  signal: SignalView;
}

export interface TripSummary {
  tripId: number;
  simulated: boolean;
  endReason: string;
  durationS: number;
  distanceM: number;
  stops: number;
  signals: {
    code: string;
    name: string;
    order: number;
    state: string;
    trigger: string | null;
    alertDistanceM: number | null;
    alertEtaS: number | null;
    responseS: number | null;
    escalated: boolean;
    leadTimeS: number | null;
    skipped: boolean;
  }[];
  totals: { signals: number; alerted: number; acknowledged: number; escalated: number; unacknowledged: number; avgResponseS: number | null };
  timeSaved: { valueS: number; simulated: true; assumption: string };
}

export interface RouteInfo {
  id: string;
  city: string;
  name: string;
  hospitalId: string;
  lengthM: number;
  coordinates: [number, number][];
  signals: { id: number; code: string; name: string; lat: number; lng: number; alongM: number; order: number }[];
}

export interface DemoAccount {
  email: string;
  name: string;
  role: Role;
  city: string | null;
  hospitalId: string | null;
}
