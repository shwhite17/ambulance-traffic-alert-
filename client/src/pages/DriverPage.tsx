import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapView } from '../components/MapView';
import { RoleGate } from '../components/RoleGate';
import { TripSummaryView } from '../components/TripSummaryView';
import { Button, ConnectionDot, ErrorBanner, SimBadge, StateBadge, TopBar } from '../components/ui';
import { api, errorText } from '../lib/api';
import { fmtDistance, fmtDuration } from '../lib/format';
import { checkGps, useGpsSender } from '../lib/useGpsSender';
import { useTripsFeed } from '../lib/useTripsFeed';
import type { Session, TripSummary, TripView } from '../lib/types';

const EMERGENCY_TYPES = ['Cardiac', 'Trauma / accident', 'Stroke', 'Maternity', 'Respiratory', 'Other'];

export function DriverPage() {
  return <RoleGate role="driver">{(s, logout) => <Driver session={s} logout={logout} />}</RoleGate>;
}

function Driver({ session, logout }: { session: Session; logout: () => void }) {
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const feed = useTripsFeed(session, { onEnded: (_id, s) => setSummary(s) });
  const trip = [...feed.trips.values()][0] ?? null;

  // Join the trip room for a trip created after the socket connected.
  useEffect(() => {
    if (trip && feed.socket) feed.socket.emit('trip:join', trip.id);
  }, [trip?.id, feed.socket]);

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        title="Ambulance"
        right={
          <>
            <ConnectionDot connected={feed.connected} />
            <button className="text-sm underline opacity-80" onClick={logout}>
              Sign out
            </button>
          </>
        }
      />
      {summary ? (
        <main className="mx-auto w-full max-w-4xl space-y-4 p-4">
          <h2 className="text-2xl font-bold">Trip complete</h2>
          <TripSummaryView summary={summary} />
          <Button onClick={() => setSummary(null)}>New trip</Button>
        </main>
      ) : trip ? (
        <LiveTrip session={session} trip={trip} connected={feed.connected} onEnded={setSummary} />
      ) : (
        <StartTrip session={session} onStarted={feed.mergeTrip} />
      )}
    </div>
  );
}

function StartTrip({ session, onStarted }: { session: Session; onStarted: (t: TripView) => void }) {
  const [hospitals, setHospitals] = useState<{ id: string; name: string; city: string }[]>([]);
  const [hospitalId, setHospitalId] = useState('');
  const [emergencyType, setEmergencyType] = useState(EMERGENCY_TYPES[0]!);
  const [error, setError] = useState<string | null>(null);
  const [gpsProblem, setGpsProblem] = useState<'denied' | 'unavailable' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ id: string; name: string; city: string }[]>('/hospitals', { token: session.token })
      .then((hs) => {
        const mine = hs.filter((h) => h.city === session.user.city);
        const list = mine.length ? mine : hs;
        setHospitals(list);
        setHospitalId(list[0]?.id ?? '');
      })
      .catch((e) => setError(errorText(e)));
  }, [session]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setGpsProblem(null);
    const gps = await checkGps();
    if (gps !== 'ok') {
      setGpsProblem(gps);
      setBusy(false);
      return;
    }
    try {
      onStarted(await api<TripView>('/trips', { body: { hospitalId, emergencyType }, token: session.token }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-4">
      <h2 className="text-2xl font-bold">Start emergency trip</h2>
      <ErrorBanner error={error} />
      {gpsProblem && (
        <div role="alert" className="space-y-2 rounded-lg bg-amber-100 p-4 text-amber-950">
          <p className="font-semibold">Cannot get your location.</p>
          <p>
            {gpsProblem === 'denied'
              ? 'Location permission is blocked. Allow location for this site in your browser settings, then try again.'
              : 'GPS is unavailable. Turn on location services (and use HTTPS), then try again.'}
          </p>
          <p>
            Or <Link to="/control" className="font-semibold underline">run a simulated trip from the control room</Link>.
          </p>
        </div>
      )}
      <label className="block">
        <span className="font-semibold">Hospital</span>
        <select className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} ({h.city})
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="font-semibold">Emergency type</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {EMERGENCY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setEmergencyType(t)}
              aria-pressed={emergencyType === t}
              className={`min-h-12 rounded-xl px-3 font-medium ring-1 ${emergencyType === t ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-300'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </fieldset>
      <button
        onClick={start}
        disabled={busy || !hospitalId}
        className="min-h-20 w-full rounded-2xl bg-emergency text-2xl font-black text-white shadow-lg focus-visible:ring-4 focus-visible:ring-red-300 disabled:opacity-60"
      >
        {busy ? 'Starting…' : 'START EMERGENCY TRIP'}
      </button>
      <p className="text-sm text-slate-500">Starting a trip is logged and attributed to you. Officers on the route will be warned as you approach.</p>
    </main>
  );
}

function LiveTrip({ session, trip, connected, onEnded }: { session: Session; trip: TripView; connected: boolean; onEnded: (s: TripSummary) => void }) {
  const gps = useGpsSender(trip.id, session.token, !trip.simulated);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const next = trip.nextSignal;
  const pos = trip.position;

  const end = async () => {
    try {
      onEnded(await api<TripSummary>(`/trips/${trip.id}/end`, { method: 'POST', token: session.token }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <main className="flex flex-1 flex-col">
      <div className="relative h-[45vh] min-h-64">
        <MapView
          fitKey={`trip-${trip.id}`}
          follow
          routes={[{ key: trip.id, coordinates: trip.route.coordinates }]}
          signals={trip.signals.map((s) => ({ key: s.signalId, lat: s.lat, lng: s.lng, label: s.name, state: s.state }))}
          hospitals={[{ key: trip.hospital.id, lat: trip.hospital.lat, lng: trip.hospital.lng, label: trip.hospital.name }]}
          ambulances={pos ? [{ key: trip.id, lat: pos.snapped.lat, lng: pos.snapped.lng, label: trip.ambulance.regNo }] : []}
        />
      </div>
      <div className="space-y-3 p-4">
        <ErrorBanner error={error} />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {trip.simulated ? <SimBadge /> : <GpsLine {...gps} />}
          {pos?.offRoute && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">Off route</span>}
          {pos?.lowConfidence && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">Weak GPS</span>}
          {!connected && <span className="text-red-700">Live updates reconnecting…</span>}
        </div>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">Next junction</p>
          {next ? (
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-xl font-bold">{next.name}</p>
                <p className="text-3xl font-black">{fmtDistance(next.distanceM)}</p>
              </div>
              <div className="text-right">
                <StateBadge state={next.state} />
                <p className="mt-1 text-sm text-slate-600">
                  {next.state === 'ACKNOWLEDGED' ? 'Officer clearing lane ✓' : next.state === 'ESCALATED' ? 'Backup officer notified' : next.state === 'ALERTED' ? 'Officer alerted' : 'Not yet alerted'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xl font-bold">All junctions passed</p>
          )}
        </section>

        <section className="grid grid-cols-3 gap-2 text-center">
          <Stat label="To hospital" value={fmtDistance(trip.remainingM)} />
          <Stat label="ETA" value={fmtDuration(trip.etaToHospitalS)} />
          <Stat label="Speed" value={pos ? `${pos.speedKmh} km/h` : '—'} />
        </section>
        <p className="text-sm text-slate-600">
          → {trip.hospital.name}
          {trip.hospitalReadyAt ? ' · Team ready ✓' : trip.hospitalConfirmedAt ? ' · Hospital confirmed' : ''}
        </p>

        {confirmEnd ? (
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" onClick={end}>
              Yes, end trip
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setConfirmEnd(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant={trip.arrived ? 'ok' : 'ghost'} className="w-full" onClick={() => setConfirmEnd(true)}>
            {trip.arrived ? 'Arrived — end trip' : 'End trip'}
          </Button>
        )}
      </div>
    </main>
  );
}

function GpsLine({ status, queued, online, accuracy }: ReturnType<typeof useGpsSender>) {
  const text =
    status === 'ok' ? `GPS ±${accuracy ?? '?'} m` : status === 'waiting' ? 'Waiting for GPS…' : status === 'denied' ? 'Location blocked' : status === 'unavailable' ? 'GPS unavailable' : 'GPS off';
  return (
    <span className="flex items-center gap-3">
      <ConnectionDot connected={status === 'ok' && online} label={text} />
      {queued > 1 && <span className="text-amber-800">{queued} fixes queued</span>}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </div>
  );
}
