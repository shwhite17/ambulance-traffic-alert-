import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { fmtDistance, fmtDuration, fmtTime } from '../lib/format';
import type { FeedEvent } from '../lib/useTripsFeed';
import type { RouteInfo, Session, TripView } from '../lib/types';
import { MapView } from './MapView';
import { Button, ErrorBanner, SimBadge } from './ui';

/** Map of one city's route: signal colours come from the active trip, if any. */
export function CityMap({ route, trip, className }: { route: RouteInfo; trip?: TripView; className?: string }) {
  const states = new Map(trip?.signals.map((s) => [s.signalId, s.state]));
  return (
    <MapView
      className={className}
      fitKey={route.id}
      routes={[{ key: route.id, coordinates: route.coordinates }]}
      signals={route.signals.map((s) => ({ key: s.id, lat: s.lat, lng: s.lng, label: s.name, state: states.get(s.id) ?? 'PENDING' }))}
      ambulances={trip?.position ? [{ key: trip.id, lat: trip.position.snapped.lat, lng: trip.position.snapped.lng, label: `${trip.ambulance.regNo} · ${trip.position.speedKmh} km/h` }] : []}
    />
  );
}

const SPEEDS = [20, 40, 60, 90];

export function SimPanel({
  session,
  route,
  trip,
  sim,
}: {
  session: Session;
  route: RouteInfo;
  trip?: TripView;
  sim?: { speedKmh: number; paused: boolean };
}) {
  const [speed, setSpeed] = useState(40);
  const [nearFirst, setNearFirst] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const call = async (path: string, body: unknown) => {
    setError(null);
    try {
      await api(path, { body, token: session.token });
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!trip) {
    const firstAlong = route.signals[0]?.alongM ?? 0;
    return (
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="font-bold">Route simulator</h3>
        <p className="text-sm text-slate-600">
          Replays {route.name} ({fmtDistance(route.lengthM)}, {route.signals.length} junctions) through the same pipeline as a real phone.
        </p>
        <ErrorBanner error={error} />
        <SpeedPicker value={speed} onChange={setSpeed} />
        <label className="flex items-center gap-2 text-base">
          <input type="checkbox" className="h-5 w-5" checked={nearFirst} onChange={(e) => setNearFirst(e.target.checked)} />
          Start just before the first junction
        </label>
        <Button
          variant="danger"
          className="w-full"
          onClick={() => call('/simulator/start', { routeId: route.id, speedKmh: speed, startAtM: nearFirst ? Math.max(0, firstAlong - 900) : 0, noiseM: 4 })}
        >
          ▶ Start simulated trip
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Trip #{trip.id}</h3>
        {trip.simulated && <SimBadge />}
      </div>
      <TripStats trip={trip} />
      <ErrorBanner error={error} />
      {trip.simulated ? (
        <>
          <SpeedPicker value={sim?.speedKmh ?? trip.position?.speedKmh ?? 40} onChange={(v) => call(`/simulator/${trip.id}/control`, { speedKmh: v })} />
          <div className="grid grid-cols-3 gap-2">
            <Button variant="ghost" onClick={() => call(`/simulator/${trip.id}/control`, { paused: !sim?.paused })}>
              {sim?.paused ? '▶ Resume' : '⏸ Pause'}
            </Button>
            <Button variant="ghost" onClick={() => call(`/simulator/${trip.id}/control`, { skipToNextSignal: true })}>
              ⏭ Next junction
            </Button>
            <Button variant="ghost" onClick={() => call(`/simulator/${trip.id}/stop`, {})}>
              ⏹ Stop
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-600">Live GPS trip from the driver's phone.</p>
      )}
    </div>
  );
}

function SpeedPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="mb-1 text-sm text-slate-600">Speed (faster = alerts fire farther out, because the ETA rule kicks in)</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            aria-pressed={value === s}
            onClick={() => onChange(s)}
            className={`min-h-12 rounded-xl font-semibold ring-1 ${value === s ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-300'}`}
          >
            {s} km/h
          </button>
        ))}
      </div>
    </div>
  );
}

export function TripStats({ trip }: { trip: TripView }) {
  return (
    <div className="space-y-1 text-base">
      <p>
        🚑 {trip.ambulance.regNo} · {trip.emergencyType} → {trip.hospital.name}
      </p>
      <p className="text-slate-600">
        {trip.position ? `${trip.position.speedKmh} km/h` : 'waiting for GPS'} · {fmtDistance(trip.remainingM)} to go · ETA {fmtDuration(trip.etaToHospitalS)}
      </p>
      {trip.nextSignal && (
        <p className="text-slate-600">
          Next: {trip.nextSignal.name} in {fmtDistance(trip.nextSignal.distanceM)} (~{fmtDuration(trip.nextSignal.etaS)})
        </p>
      )}
      {trip.offline && <p className="font-semibold text-red-700">Driver offline — showing last known position</p>}
    </div>
  );
}

const KIND_STYLE: Record<FeedEvent['kind'], string> = {
  alert: 'border-amber-500',
  escalated: 'border-emergency bg-red-50',
  ack: 'border-ok',
  passed: 'border-blue-500',
  trip: 'border-slate-400',
  offline: 'border-emergency bg-red-50',
  online: 'border-ok',
  hospital: 'border-violet-500',
};

export function EventFeed({ events }: { events: FeedEvent[] }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="mb-2 font-bold">Event feed</h3>
      {events.length === 0 ? (
        <p className="text-slate-500">No events yet.</p>
      ) : (
        <ol className="max-h-80 space-y-1 overflow-y-auto text-base" aria-live="polite">
          {events.map((e) => (
            <li key={e.id} className={`border-l-4 py-1 pl-3 ${KIND_STYLE[e.kind]}`}>
              <span className="mr-2 font-mono text-sm text-slate-500">{fmtTime(e.ts)}</span>
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
