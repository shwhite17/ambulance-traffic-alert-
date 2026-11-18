import { useState } from 'react';
import { Ambulance, BedDouble, CheckCircle2, ClipboardCheck, LogOut, NotebookPen, WifiOff } from 'lucide-react';
import { RoleGate } from '../components/RoleGate';
import { Button, ConnectionDot, ErrorBanner, SectionTitle, SimBadge, TopBar } from '../components/ui';
import { api, errorText } from '../lib/api';
import { fmtDistance, fmtDuration, fmtTime, STATE_STYLE } from '../lib/format';
import { useTripsFeed } from '../lib/useTripsFeed';
import type { Session, TripView } from '../lib/types';

export function HospitalPage() {
  return <RoleGate role="hospital">{(s, logout) => <Hospital session={s} logout={logout} />}</RoleGate>;
}

function Hospital({ session, logout }: { session: Session; logout: () => void }) {
  const feed = useTripsFeed(session);
  const trips = [...feed.trips.values()].sort((a, b) => (a.etaToHospitalS ?? 1e9) - (b.etaToHospitalS ?? 1e9));
  const recent = [...feed.ended.values()].slice(-3).reverse();

  return (
    <div className="grid-bg min-h-full">
      <TopBar
        title={session.user.name}
        right={
          <>
            <ConnectionDot connected={feed.connected} />
            <button className="text-slate-400 hover:text-white" onClick={logout} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </>
        }
      />
      <main className="mx-auto max-w-6xl space-y-5 p-4">
        <div className="flex items-end justify-between gap-4 pt-2">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-400 uppercase">Emergency department</p>
            <h2 className="text-2xl font-bold">Incoming ambulances</h2>
          </div>
          <span className="rounded-full bg-white/5 px-3 py-1 text-sm ring-1 ring-white/10">
            <b className="text-white">{trips.length}</b> <span className="text-slate-400">en route</span>
          </span>
        </div>
        {trips.length === 0 && (
          <div className="panel grid place-items-center gap-3 p-12 text-center">
            <BedDouble size={36} className="text-slate-500" />
            <p className="text-slate-400">No ambulances on the way. Incoming trips appear here the moment they start.</p>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {trips.map((t) => (
            <IncomingCard key={t.id} trip={t} session={session} />
          ))}
        </div>
        {recent.length > 0 && (
          <section className="panel p-4">
            <SectionTitle icon={ClipboardCheck}>Recently arrived / ended</SectionTitle>
            <ul className="space-y-1 text-sm text-slate-300">
              {recent.map((s) => (
                <li key={s.tripId}>
                  Trip #{s.tripId} · {s.endReason.replace(/_/g, ' ')} after {fmtDuration(s.durationS)} · {s.totals.acknowledged}/{s.totals.signals} junctions cleared
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
  const progress = trip.route.lengthM ? 1 - trip.remainingM / trip.route.lengthM : 0;

  return (
    <article className="panel overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-emergency/15 text-emergency">
            <Ambulance size={22} />
          </span>
          <div>
            <p className="font-bold text-white">
              {trip.ambulance.regNo} · {trip.emergencyType}
            </p>
            <p className="text-xs text-slate-400">
              Trip #{trip.id} · started {fmtTime(trip.startedAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {trip.simulated && <SimBadge />}
          {trip.offline && (
            <span className="flex items-center gap-1 text-xs text-red-300">
              <WifiOff size={12} /> GPS offline
            </span>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-slate-400 uppercase">Arriving in</p>
            <p className="tabular text-5xl leading-none font-black text-white">{trip.arrived ? 'Arrived' : fmtDuration(trip.etaToHospitalS)}</p>
          </div>
          <p className="tabular text-right text-sm text-slate-400">{fmtDistance(trip.remainingM)} away</p>
        </div>
        {/* Route progress with junction states */}
        <div className="relative mt-5 mb-2 h-2 rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-info to-ok transition-[width] duration-1000" style={{ width: `${progress * 100}%` }} />
          {trip.signals.map((s) => (
            <span
              key={s.signalId}
              title={`${s.name}: ${STATE_STYLE[s.state]?.label}`}
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel"
              style={{ left: `${(s.alongM / trip.route.lengthM) * 100}%`, background: STATE_STYLE[s.state]?.color }}
            />
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {trip.signals.filter((s) => s.state === 'PASSED').length}/{trip.signals.length} junctions passed
          {trip.nextSignal && ` · next: ${trip.nextSignal.name}`}
        </p>

        <ErrorBanner error={error} />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant={trip.hospitalConfirmedAt ? 'ghost' : 'primary'} disabled={!!trip.hospitalConfirmedAt} onClick={() => act('confirm')}>
            <CheckCircle2 size={16} />
            {trip.hospitalConfirmedAt ? `Confirmed ${fmtTime(trip.hospitalConfirmedAt)}` : 'Confirm incoming'}
          </Button>
          <Button variant={trip.hospitalReadyAt ? 'ghost' : 'ok'} disabled={!!trip.hospitalReadyAt} onClick={() => act('ready')}>
            <ClipboardCheck size={16} />
            {trip.hospitalReadyAt ? 'Team ready ✓' : 'Team ready'}
          </Button>
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act('note');
          }}
        >
          <input
            className="min-h-11 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
            placeholder="Patient note (no personal identifiers)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button variant="ghost" type="submit" aria-label="Save note">
            <NotebookPen size={16} />
          </Button>
        </form>
      </div>
    </article>
  );
}
