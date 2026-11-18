import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, CheckCheck, CircleDot, Clock, Gauge, Hospital, LocateFixed, LogOut, MapPin, OctagonAlert, Siren } from 'lucide-react';
import { MapView, alertRadiusM } from '../components/MapView';
import { RoleGate } from '../components/RoleGate';
import { TripSummaryView } from '../components/TripSummaryView';
import { Button, ConnectionDot, ErrorBanner, SimBadge, TopBar } from '../components/ui';
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
    <div className="flex h-full flex-col">
      <TopBar
        title="Ambulance"
        right={
          <>
            <ConnectionDot connected={feed.connected} />
            <button className="text-slate-400 hover:text-white" onClick={logout} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </>
        }
      />
      {summary ? (
        <main className="mx-auto w-full max-w-4xl space-y-4 overflow-y-auto p-4">
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
    <main className="grid-bg flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-md space-y-5 p-4 pb-10">
        <div className="pt-2">
          <p className="text-xs font-semibold tracking-[0.18em] text-slate-400 uppercase">New emergency</p>
          <h2 className="text-2xl font-bold">Where are you heading?</h2>
        </div>
        <ErrorBanner error={error} />
        {gpsProblem && (
          <div role="alert" className="space-y-2 rounded-2xl bg-amber-500/10 p-4 text-amber-100 ring-1 ring-amber-500/30">
            <p className="flex items-center gap-2 font-semibold">
              <LocateFixed size={18} /> Cannot get your location
            </p>
            <p className="text-sm">
              {gpsProblem === 'denied'
                ? 'Location permission is blocked. Allow location for this site in your browser settings, then try again.'
                : 'GPS is unavailable. Turn on location services (and use HTTPS), then try again.'}
            </p>
            <p className="text-sm">
              Or{' '}
              <Link to="/demo" className="font-semibold underline">
                run a simulated trip
              </Link>
              .
            </p>
          </div>
        )}
        <div className="panel p-2">
          {hospitals.map((h) => (
            <button
              key={h.id}
              onClick={() => setHospitalId(h.id)}
              aria-pressed={hospitalId === h.id}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${hospitalId === h.id ? 'bg-white/10 ring-1 ring-info/60' : 'hover:bg-white/5'}`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-info/15 text-info">
                <Hospital size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{h.name}</span>
                <span className="block text-xs text-slate-400">{h.city}</span>
              </span>
              {hospitalId === h.id && <Check size={18} className="text-info" />}
            </button>
          ))}
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Emergency type</legend>
          <div className="grid grid-cols-2 gap-2">
            {EMERGENCY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setEmergencyType(t)}
                aria-pressed={emergencyType === t}
                className={`min-h-12 rounded-xl px-3 text-sm font-semibold transition ${emergencyType === t ? 'bg-white text-slate-900' : 'bg-white/5 ring-1 ring-white/10 hover:bg-white/10'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          onClick={start}
          disabled={busy || !hospitalId}
          className="flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl bg-emergency text-xl font-black tracking-wide text-white shadow-[0_16px_50px_-12px_rgb(229_56_59/0.8)] focus-visible:ring-4 focus-visible:ring-red-300 disabled:opacity-60"
        >
          <Siren size={26} /> {busy ? 'Starting…' : 'START EMERGENCY TRIP'}
        </button>
        <p className="text-center text-xs text-slate-500">Every trip is logged and attributed to you. Officers on the route are warned as you approach.</p>
      </div>
    </main>
  );
}

const NEXT_STATUS: Record<string, { text: string; cls: string; icon: typeof Bell }> = {
  PENDING: { text: 'Not yet alerted', cls: 'text-slate-400', icon: CircleDot },
  ALERTED: { text: 'Officer alerted', cls: 'text-warn', icon: Bell },
  ESCALATED: { text: 'Backup officer notified', cls: 'text-red-300', icon: OctagonAlert },
  ACKNOWLEDGED: { text: 'Lane being cleared', cls: 'text-ok', icon: Check },
  PASSED: { text: 'Passed', cls: 'text-info', icon: CheckCheck },
};

function LiveTrip({ session, trip, connected, onEnded }: { session: Session; trip: TripView; connected: boolean; onEnded: (s: TripSummary) => void }) {
  const gps = useGpsSender(trip.id, session.token, !trip.simulated);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const next = trip.nextSignal;
  const pos = trip.position;
  const nextStatus = next ? NEXT_STATUS[next.state] : null;
  const cleared = trip.signals.filter((s) => s.state === 'PASSED' || s.state === 'ACKNOWLEDGED').length;

  const end = async () => {
    try {
      onEnded(await api<TripSummary>(`/trips/${trip.id}/end`, { method: 'POST', token: session.token }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <main className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <MapView
          routeCoords={trip.route.coordinates}
          fitKey={`trip-${trip.id}`}
          follow
          signals={trip.signals.map((s) => ({ id: s.signalId, lat: s.lat, lng: s.lng, label: s.name, order: s.order, state: s.state }))}
          hospital={{ lat: trip.hospital.lat, lng: trip.hospital.lng, label: trip.hospital.name }}
          progressM={pos?.progressM ?? null}
          speedKmh={pos?.speedKmh ?? 0}
        />
        {/* Next-junction card floats over the map, navigation style. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[500]">
          <div className="panel pointer-events-auto p-4">
            {next && nextStatus ? (
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400 uppercase">Next junction</p>
                  <p className="tabular text-3xl leading-tight font-black">{fmtDistance(next.distanceM)}</p>
                  <p className="truncate text-sm text-slate-300">{next.name}</p>
                </div>
                <div className={`flex flex-col items-center gap-1 text-center text-xs font-semibold ${nextStatus.cls}`}>
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-current/15">
                    <nextStatus.icon size={24} />
                  </span>
                  {nextStatus.text}
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-lg font-bold">
                <CheckCheck className="text-ok" /> All junctions passed
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t border-line bg-ink p-4">
        <ErrorBanner error={error} />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {trip.simulated ? <SimBadge /> : <GpsLine {...gps} />}
          {pos?.offRoute && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-200">Off route</span>}
          {pos?.lowConfidence && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-200">Weak GPS</span>}
          {!connected && <span className="text-red-300">Live updates reconnecting…</span>}
          <span className="ml-auto text-xs text-slate-400">
            {cleared}/{trip.signals.length} junctions clear · alert zone {fmtDistance(alertRadiusM(pos?.speedKmh ?? 0).radius)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat icon={MapPin} label="To hospital" value={fmtDistance(trip.remainingM)} />
          <Stat icon={Clock} label="ETA" value={fmtDuration(trip.etaToHospitalS)} />
          <Stat icon={Gauge} label="km/h" value={pos ? String(pos.speedKmh) : '—'} />
        </div>
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Hospital size={16} className="text-info" /> {trip.hospital.name}
          {trip.hospitalReadyAt ? <span className="font-semibold text-ok">· Team ready ✓</span> : trip.hospitalConfirmedAt ? <span>· Confirmed</span> : null}
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
      {queued > 1 && <span className="text-amber-200">{queued} fixes queued</span>}
    </span>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
      <Icon size={14} className="mx-auto mb-1 text-slate-500" />
      <div className="tabular text-lg leading-none font-bold">{value}</div>
      <div className="mt-1 text-[10px] tracking-wide text-slate-500 uppercase">{label}</div>
    </div>
  );
}
