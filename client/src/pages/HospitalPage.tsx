import { useState } from 'react';
import { RoleGate } from '../components/RoleGate';
import { Button, ConnectionDot, ErrorBanner, SimBadge, TopBar } from '../components/ui';
import { api, errorText } from '../lib/api';
import { fmtDistance, fmtDuration, fmtTime } from '../lib/format';
import { useTripsFeed } from '../lib/useTripsFeed';
import type { Session, TripView } from '../lib/types';

export function HospitalPage() {
  return <RoleGate role="hospital">{(s, logout) => <Hospital session={s} logout={logout} />}</RoleGate>;
}

function Hospital({ session, logout }: { session: Session; logout: () => void }) {
  const feed = useTripsFeed(session);
  const trips = [...feed.trips.values()].sort((a, b) => (a.etaToHospitalS ?? 1e9) - (b.etaToHospitalS ?? 1e9));
  const arrivedRecently = [...feed.ended.values()].slice(-3).reverse();

  return (
    <div className="min-h-full">
      <TopBar
        title={session.user.name}
        right={
          <>
            <ConnectionDot connected={feed.connected} />
            <button className="text-sm underline opacity-80" onClick={logout}>
              Sign out
            </button>
          </>
        }
      />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <h2 className="text-2xl font-bold">Incoming ambulances</h2>
        {trips.length === 0 && <p className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">No ambulances on the way.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {trips.map((t) => (
            <IncomingCard key={t.id} trip={t} session={session} />
          ))}
        </div>
        {arrivedRecently.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold text-slate-600">Recently ended</h3>
            <ul className="space-y-1 text-slate-600">
              {arrivedRecently.map((s) => (
                <li key={s.tripId}>
                  Trip #{s.tripId}: {s.endReason.replace(/_/g, ' ')} after {fmtDuration(s.durationS)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function IncomingCard({ trip, session }: { trip: TripView; session: Session }) {
  const [note, setNote] = useState(trip.patientNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'confirm' | 'ready' | 'note') => {
    setError(null);
    try {
      await api(`/trips/${trip.id}/hospital`, { body: { action, note: action === 'note' ? note : undefined }, token: session.token });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const passed = trip.signals.filter((s) => s.state === 'PASSED').length;

  return (
    <article className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">
            🚑 {trip.ambulance.regNo} · {trip.emergencyType}
          </p>
          <p className="text-sm text-slate-500">Started {fmtTime(trip.startedAt)} · Trip #{trip.id}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {trip.simulated && <SimBadge />}
          {trip.offline && <span className="rounded bg-red-100 px-2 py-0.5 text-sm text-red-800">GPS offline</span>}
        </div>
      </div>
      <div className="flex items-baseline gap-4">
        <p className="text-5xl font-black">{trip.arrived ? 'Arrived' : fmtDuration(trip.etaToHospitalS)}</p>
        <p className="text-slate-600">{fmtDistance(trip.remainingM)} away</p>
      </div>
      <p className="text-sm text-slate-600">
        Junctions cleared: {passed}/{trip.signals.length}
        {trip.nextSignal && ` · next: ${trip.nextSignal.name}`}
      </p>
      <ErrorBanner error={error} />
      <div className="flex flex-wrap gap-2">
        <Button variant={trip.hospitalConfirmedAt ? 'ghost' : 'primary'} disabled={!!trip.hospitalConfirmedAt} onClick={() => act('confirm')}>
          {trip.hospitalConfirmedAt ? `Confirmed ${fmtTime(trip.hospitalConfirmedAt)}` : 'Confirm incoming'}
        </Button>
        <Button variant={trip.hospitalReadyAt ? 'ghost' : 'ok'} disabled={!!trip.hospitalReadyAt} onClick={() => act('ready')}>
          {trip.hospitalReadyAt ? 'Team ready ✓' : 'Team ready'}
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act('note');
        }}
      >
        <input
          className="min-h-12 flex-1 rounded-xl border border-slate-300 px-3"
          placeholder="Patient note (no personal identifiers)"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button variant="ghost" type="submit">
          Save
        </Button>
      </form>
    </article>
  );
}
