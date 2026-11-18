import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CityMap, EventFeed, SimPanel } from '../components/ControlParts';
import { RoleGate } from '../components/RoleGate';
import { ConnectionDot, ErrorBanner, SimBadge, TopBar } from '../components/ui';
import { api, errorText } from '../lib/api';
import { fmtTime } from '../lib/format';
import { useTripsFeed } from '../lib/useTripsFeed';
import type { RouteInfo, Session } from '../lib/types';

export function ControlPage() {
  return <RoleGate role="admin">{(s, logout) => <Control session={s} logout={logout} />}</RoleGate>;
}

interface TripRow {
  id: number;
  status: string;
  simulated: number;
  emergencyType: string;
  startedAt: number;
  endReason: string | null;
  hospital: string;
  ambulance: string;
}

export function useRoutes(session: Session) {
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<RouteInfo[]>('/routes', { token: session.token })
      .then(setRoutes)
      .catch((e) => setError(errorText(e)));
  }, [session.token]);
  return { routes, error };
}

function Control({ session, logout }: { session: Session; logout: () => void }) {
  const { routes, error } = useRoutes(session);
  const [cityIdx, setCityIdx] = useState(0);
  const [recent, setRecent] = useState<TripRow[]>([]);
  const feed = useTripsFeed(session);
  const route = routes[cityIdx];
  const trip = route && [...feed.trips.values()].find((t) => t.route.id === route.id);

  const endedCount = feed.ended.size;
  useEffect(() => {
    api<TripRow[]>('/trips', { token: session.token }).then(setRecent).catch(() => {});
  }, [session.token, endedCount, feed.trips.size]);

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        title="Control room"
        right={
          <>
            <Link to="/demo" className="text-sm underline">
              Split-screen demo
            </Link>
            <ConnectionDot connected={feed.connected} />
            <button className="text-sm underline opacity-80" onClick={logout}>
              Sign out
            </button>
          </>
        }
      />
      <div className="flex gap-2 bg-white px-4 py-2 shadow-sm" role="tablist">
        {routes.map((r, i) => {
          const active = [...feed.trips.values()].some((t) => t.route.id === r.id);
          return (
            <button
              key={r.id}
              role="tab"
              aria-selected={i === cityIdx}
              onClick={() => setCityIdx(i)}
              className={`min-h-12 rounded-xl px-4 font-semibold ${i === cityIdx ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}
            >
              {r.city} {active && <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full bg-red-500" />}
            </button>
          );
        })}
      </div>
      <ErrorBanner error={error} />
      {route && (
        <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[1fr_420px]">
          <div className="min-h-[50vh] overflow-hidden rounded-2xl shadow-sm">
            <CityMap route={route} trip={trip} />
          </div>
          <aside className="space-y-4">
            <SimPanel session={session} route={route} trip={trip} sim={trip && feed.simState.get(trip.id)} />
            <EventFeed events={feed.events} />
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="mb-2 font-bold">Recent trips</h3>
              <ul className="space-y-1">
                {recent.slice(0, 8).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span>
                      #{t.id} {t.ambulance} → {t.hospital}{' '}
                      <span className="text-sm text-slate-500">{fmtTime(t.startedAt)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {t.simulated ? <SimBadge /> : null}
                      {t.status === 'ended' ? (
                        <Link className="text-sm font-semibold underline" to={`/trips/${t.id}`}>
                          Summary
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-red-700">LIVE</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
