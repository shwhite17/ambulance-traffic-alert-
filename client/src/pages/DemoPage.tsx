import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CityMap, EventFeed, SimPanel } from '../components/ControlParts';
import { OfficerDashboard } from '../components/OfficerDashboard';
import { RoleGate } from '../components/RoleGate';
import { TripSummaryView } from '../components/TripSummaryView';
import { Button, ConnectionDot, ErrorBanner, TopBar } from '../components/ui';
import { demoLogin, errorText } from '../lib/api';
import { unlockAudio } from '../lib/alarm';
import { useTripsFeed } from '../lib/useTripsFeed';
import type { Session, TripSummary } from '../lib/types';
import { useRoutes } from './ControlPage';

/**
 * Split screen for the pitch: map + simulator on the left, every officer on the
 * route on the right (each card is a real officer session with its own socket).
 */
export function DemoPage() {
  return <RoleGate role="admin">{(s) => <Demo session={s} />}</RoleGate>;
}

function Demo({ session }: { session: Session }) {
  const { routes, error } = useRoutes(session);
  const [cityIdx, setCityIdx] = useState(0);
  const [officers, setOfficers] = useState<Session[]>([]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const feed = useTripsFeed(session, { onEnded: (_id, s) => setSummary(s) });
  const route = routes[cityIdx];
  const trip = route && [...feed.trips.values()].find((t) => t.route.id === route.id);

  // Sign in every officer on this route, plus the backup patrol.
  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    const cityKey = route.city === 'Bengaluru' ? 'blr' : route.city.toLowerCase();
    const emails = [...route.signals.map((s) => `officer.${s.code.toLowerCase()}@demo.in`), `backup.${cityKey}@demo.in`];
    Promise.all(emails.map((e) => demoLogin(e)))
      .then((res) => !cancelled && setOfficers(res.map((r) => ({ token: r.token, user: r.user }))))
      .catch((e) => !cancelled && setLoginError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [route?.id]);

  return (
    <div className="flex h-full flex-col">
      <TopBar
        title="Live demo"
        right={
          <>
            {routes.map((r, i) => (
              <button
                key={r.id}
                onClick={() => {
                  setOfficers([]);
                  setSummary(null);
                  setCityIdx(i);
                }}
                className={`rounded-lg px-3 py-1 text-sm font-semibold ${i === cityIdx ? 'bg-white text-slate-900' : 'bg-white/10'}`}
              >
                {r.city}
              </button>
            ))}
            <Button
              variant={soundOn ? 'ok' : 'ghost'}
              className="min-h-9 text-sm"
              onClick={() => {
                unlockAudio();
                setSoundOn((v) => !v);
              }}
            >
              {soundOn ? '🔊 Sound on' : '🔇 Enable sound'}
            </Button>
            <ConnectionDot connected={feed.connected} />
            <Link to="/control" className="text-sm underline">
              Control room
            </Link>
          </>
        }
      />
      <ErrorBanner error={error ?? loginError} />
      {route && (
        <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="min-h-72 flex-1 overflow-hidden rounded-2xl shadow-sm">
              <CityMap route={route} trip={trip} />
            </div>
            <SimPanel session={session} route={route} trip={trip} sim={trip && feed.simState.get(trip.id)} />
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {summary && !trip ? (
              <div className="space-y-3 rounded-2xl bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold">Trip summary</h2>
                  <Button variant="ghost" onClick={() => setSummary(null)}>
                    Back to officers
                  </Button>
                </div>
                <TripSummaryView summary={summary} />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {officers.map((o) => (
                  <div key={o.user.id} className="h-64">
                    <OfficerDashboard session={o} compact autoStart soundEnabled={soundOn} />
                  </div>
                ))}
              </div>
            )}
            <EventFeed events={feed.events} />
          </div>
        </div>
      )}
    </div>
  );
}
