import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, Ambulance, Bell, CheckCheck, Clock, FastForward, Gauge, History, Hospital, ListOrdered, OctagonAlert,
  Pause, Play, QrCode, Radar, RotateCcw, ShieldCheck, Siren, Smartphone, Square, Timer, Volume2, VolumeX, WifiOff, X,
} from 'lucide-react';
import { JudgeMode } from './JudgeMode';
import { api, demoLogin, errorText } from '../lib/api';
import { unlockAudio } from '../lib/alarm';
import { fmtDistance, fmtDuration, fmtTime, STATE_STYLE } from '../lib/format';
import { useTripsFeed, type FeedEvent } from '../lib/useTripsFeed';
import type { RouteInfo, Session, SignalView, TripSummary, TripView } from '../lib/types';
import { MapView, alertRadiusM } from './MapView';
import { OfficerDashboard } from './OfficerDashboard';
import { TripSummaryView } from './TripSummaryView';
import { Button, ConnectionDot, ErrorBanner, Kpi, SectionTitle, SimBadge, StateBadge, STATE_ICON, TopBar } from './ui';

interface SignalInfo {
  id: number;
  code: string;
  officer: string | null;
  backupOfficer: string | null;
}

const cityKey = (city: string) => (city === 'Bengaluru' ? 'blr' : city.toLowerCase());
const LIVE = new Set(['ALERTED', 'ESCALATED']);

/**
 * The control-room screen. In demo mode it also signs in every officer on the
 * route (so acknowledgments come from real officer accounts) and shows the
 * officer app live inside a phone frame.
 */
export function CommandCenter({ session, mode, onLogout }: { session: Session; mode: 'demo' | 'control'; onLogout?: () => void }) {
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [signalInfo, setSignalInfo] = useState<Map<number, SignalInfo>>(new Map());
  const [cityIdx, setCityIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [officers, setOfficers] = useState<Map<number, Session>>(new Map());
  const [backup, setBackup] = useState<Session | null>(null);
  const [judgeOpen, setJudgeOpen] = useState(false);
  const feed = useTripsFeed(session, { onEnded: (_id, s) => setSummary(s), onReset: () => setSummary(null) });

  useEffect(() => {
    api<RouteInfo[]>('/routes', { token: session.token }).then(setRoutes).catch((e) => setError(errorText(e)));
    api<SignalInfo[]>('/signals', { token: session.token })
      .then((rows) => setSignalInfo(new Map(rows.map((r) => [r.id, r]))))
      .catch(() => {});
  }, [session.token]);

  const route = routes[cityIdx];
  const trip = route && [...feed.trips.values()].find((t) => t.route.id === route.id);

  // Demo: sign in the route's officers + backup so acks are attributable to them.
  useEffect(() => {
    if (mode !== 'demo' || !route) return;
    let cancelled = false;
    const ck = cityKey(route.city);
    Promise.all([
      ...route.signals.map((s) => demoLogin(`officer.${s.code.toLowerCase()}@demo.in`).then((r) => [s.id, r] as const)),
    ])
      .then(async (pairs) => {
        const b = await demoLogin(`backup.${ck}@demo.in`);
        if (cancelled) return;
        setOfficers(new Map(pairs.map(([id, r]) => [id, { token: r.token, user: r.user }])));
        setBackup({ token: b.token, user: b.user });
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [mode, route?.id]);

  const statuses = useMemo(() => new Map(trip?.signals.map((s) => [s.signalId, s])), [trip]);

  // The phone shows whichever junction matters most right now.
  const focusSignalId = useMemo(() => {
    if (!route) return null;
    const live = trip?.signals.filter((s) => LIVE.has(s.state)).sort((a, b) => (a.etaS ?? 1e9) - (b.etaS ?? 1e9))[0];
    const acked = trip?.signals.find((s) => s.state === 'ACKNOWLEDGED');
    const next = trip?.nextSignal;
    return (live ?? acked ?? next)?.signalId ?? route.signals[0]?.id ?? null;
  }, [trip, route]);
  const phoneSession = focusSignalId !== null ? officers.get(focusSignalId) : undefined;

  const ack = async (s: SignalView) => {
    if (!s.alertId) return;
    // Escalated → the backup patrol responds; otherwise the junction's own officer.
    const token = mode === 'demo' ? (s.state === 'ESCALATED' ? backup?.token : officers.get(s.signalId)?.token) : session.token;
    try {
      await api(`/alerts/${s.alertId}/ack`, { method: 'POST', token });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="grid-bg flex min-h-full flex-col">
      <TopBar
        title={mode === 'demo' ? 'Live demo · Command centre' : 'Command centre'}
        right={
          <>
            <div className="flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10" role="tablist" aria-label="City">
              {routes.map((r, i) => {
                const active = [...feed.trips.values()].some((t) => t.route.id === r.id);
                return (
                  <button
                    key={r.id}
                    role="tab"
                    aria-selected={i === cityIdx}
                    onClick={() => {
                      setCityIdx(i);
                      setSummary(null);
                      setOfficers(new Map());
                    }}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${i === cityIdx ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
                  >
                    {r.city}
                    {active && <span className="pulse-ring h-2 w-2 rounded-full bg-emergency text-emergency" />}
                  </button>
                );
              })}
            </div>
            <Button
              variant={soundOn ? 'ok' : 'ghost'}
              className="min-h-9 px-3 text-sm"
              onClick={() => {
                unlockAudio();
                setSoundOn((v) => !v);
              }}
              aria-pressed={soundOn}
            >
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              <span className="hidden md:inline">{soundOn ? 'Sound on' : 'Sound off'}</span>
            </Button>
            <Button variant="ghost" className="min-h-9 px-3 text-sm" onClick={() => setJudgeOpen(true)} disabled={!route}>
              <QrCode size={15} />
              <span className="hidden md:inline">Judge mode</span>
            </Button>
            <ResetDemoButton session={session} onError={setError} />
            <ConnectionDot connected={feed.connected} />
            <Link to={mode === 'demo' ? '/control' : '/demo'} className="hidden text-sm text-slate-400 hover:text-white lg:block">
              {mode === 'demo' ? 'Control room' : 'Demo view'}
            </Link>
            {onLogout && (
              <button onClick={onLogout} className="text-sm text-slate-400 hover:text-white">
                Sign out
              </button>
            )}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        <ErrorBanner error={error} />
        {route && <KpiStrip trip={trip} summary={summary} activeTrips={feed.trips.size} />}

        {route && (
          <div className={`grid min-h-0 flex-1 gap-3 ${mode === 'demo' ? 'xl:grid-cols-[minmax(0,1fr)_340px_320px]' : 'lg:grid-cols-[minmax(0,1fr)_380px]'}`}>
            {/* Map column */}
            <div className="flex min-h-[520px] flex-col gap-3">
              <div className="panel relative min-h-[420px] flex-1 overflow-hidden">
                <MapView
                  routeCoords={route.coordinates}
                  fitKey={route.id}
                  signals={route.signals.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, label: s.name, order: s.order, state: statuses.get(s.id)?.state ?? 'PENDING' }))}
                  hospital={trip ? { lat: trip.hospital.lat, lng: trip.hospital.lng, label: trip.hospital.name } : undefined}
                  progressM={trip?.position?.progressM ?? null}
                  speedKmh={trip?.position?.speedKmh ?? 0}
                  ambulanceLabel={trip?.ambulance.regNo}
                />
                <MapHud trip={trip} route={route} />
                <Legend />
              </div>
              <SimToolbar session={session} route={route} trip={trip} sim={trip && feed.simState.get(trip.id)} onError={setError} />
            </div>

            {/* Corridor + events */}
            <div className="flex min-h-0 flex-col gap-3">
              <Corridor route={route} statuses={statuses} signalInfo={signalInfo} presence={feed.presence} onAck={ack} canAck={mode === 'control' || officers.size > 0} />
              <EventTimeline events={feed.events} />
              {mode === 'control' && <RecentTrips session={session} refreshKey={feed.ended.size + feed.trips.size} />}
            </div>

            {/* Phone preview (demo) */}
            {mode === 'demo' && (
              <div className="hidden flex-col items-center gap-2 xl:flex">
                <SectionTitle icon={Smartphone}>Officer app · live</SectionTitle>
                <PhoneFrame>
                  {phoneSession ? (
                    <OfficerDashboard key={phoneSession.user.id} session={phoneSession} autoStart soundEnabled={soundOn} />
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-slate-500">Signing in officers…</div>
                  )}
                </PhoneFrame>
                <p className="max-w-[300px] text-center text-xs text-slate-500">
                  Follows the junction that needs attention. This is the same screen an officer opens at <span className="text-slate-300">/officer</span>.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {judgeOpen && route && <JudgeMode session={session} route={route} presence={feed.presence} onClose={() => setJudgeOpen(false)} />}

      {summary && !trip && (
        <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Trip summary">
          <div className="panel max-h-[90vh] w-full max-w-4xl overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">Trip summary</h2>
              <Button variant="ghost" onClick={() => setSummary(null)} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            <TripSummaryView summary={summary} />
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── pieces ─────────────────────────

/** Two-step so it can't be hit by accident mid-pitch. Every screen resets via the server. */
function ResetDemoButton({ session, onError }: { session: Session; onError: (e: string | null) => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4_000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const click = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
    onError(null);
    try {
      await api('/demo/reset', { method: 'POST', token: session.token });
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <Button variant={armed ? 'danger' : 'ghost'} className="min-h-9 px-3 text-sm" onClick={click} disabled={busy} title="Stop simulations, close trips and clear history on every screen">
      <RotateCcw size={15} className={busy ? 'animate-spin' : ''} />
      <span className="hidden md:inline">{armed ? 'Click to confirm' : 'Reset demo'}</span>
    </Button>
  );
}

function KpiStrip({ trip, summary, activeTrips }: { trip?: TripView; summary: TripSummary | null; activeTrips: number }) {
  const sigs = trip?.signals ?? [];
  const acked = sigs.filter((s) => s.acknowledgedAt && s.alertedAt);
  const avgResp = trip
    ? acked.length
      ? acked.reduce((a, s) => a + (s.acknowledgedAt! - s.alertedAt!), 0) / acked.length / 1000
      : null
    : (summary?.totals.avgResponseS ?? null);
  const cleared = trip ? sigs.filter((s) => s.acknowledgedAt && (s.state === 'PASSED' || s.state === 'ACKNOWLEDGED')).length : (summary?.totals.acknowledged ?? 0);
  const total = trip ? sigs.length : (summary?.totals.signals ?? 0);
  const escalations = trip ? sigs.filter((s) => s.escalatedAt).length : (summary?.totals.escalated ?? 0);
  const alerted = sigs.filter((s) => s.alertEtaS !== null);
  const lead = alerted.length ? Math.round(alerted.reduce((a, s) => a + (s.alertEtaS ?? 0), 0) / alerted.length) : null;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Kpi icon={Ambulance} label="Active emergencies" value={activeTrips} tone={activeTrips ? 'danger' : 'default'} />
      <Kpi icon={ShieldCheck} label="Junctions cleared" value={`${cleared}/${total || '—'}`} tone="ok" />
      <Kpi icon={Timer} label="Avg officer response" value={avgResp === null ? '—' : `${avgResp.toFixed(1)} s`} />
      <Kpi icon={Radar} label="Avg warning given" value={lead === null ? '—' : `${lead} s`} hint="before arrival" tone="warn" />
      <Kpi icon={Siren} label="Escalations" value={escalations} tone={escalations ? 'danger' : 'default'} />
    </div>
  );
}

function MapHud({ trip, route }: { trip?: TripView; route: RouteInfo }) {
  if (!trip) {
    return (
      <div className="panel pointer-events-none absolute top-3 left-3 z-[500] max-w-xs px-4 py-3">
        <p className="text-xs font-semibold tracking-wider text-slate-400 uppercase">{route.city} corridor</p>
        <p className="mt-0.5 font-semibold text-white">{route.name}</p>
        <p className="mt-1 text-sm text-slate-400">
          {fmtDistance(route.lengthM)} · {route.signals.length} junctions · standing by
        </p>
      </div>
    );
  }
  const speed = trip.position?.speedKmh ?? 0;
  const { radius, rule } = alertRadiusM(speed);
  return (
    <div className="panel pointer-events-none absolute top-3 left-3 z-[500] w-72 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="pulse-ring h-2 w-2 rounded-full bg-emergency text-emergency" />
          {trip.ambulance.regNo}
        </span>
        <span className="flex items-center gap-2">
          {trip.simulated && <SimBadge />}
          {trip.offline && (
            <span className="flex items-center gap-1 text-xs text-red-300">
              <WifiOff size={12} /> offline
            </span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/5 px-1 py-3 text-center">
        <HudStat icon={Gauge} value={`${speed}`} unit="km/h" />
        <HudStat icon={Clock} value={fmtDuration(trip.etaToHospitalS)} unit="to hospital" />
        <HudStat icon={Activity} value={fmtDistance(trip.remainingM)} unit="remaining" />
      </div>
      <div className="border-t border-line bg-warn/5 px-4 py-2.5">
        <p className="flex items-center justify-between text-xs">
          <span className="font-semibold text-warn">Alert zone ahead</span>
          <span className="tabular font-bold text-white">{fmtDistance(radius)}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {rule === 'eta' ? `ETA rule: anything within ${60} s at ${speed} km/h` : `Distance rule: within 500 m (slow traffic)`}
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-xs text-slate-400">
        <Hospital size={14} className="text-info" />
        <span className="truncate">{trip.hospital.name}</span>
        {trip.hospitalReadyAt && <span className="ml-auto font-semibold text-ok">Team ready</span>}
      </div>
    </div>
  );
}

function HudStat({ icon: Icon, value, unit }: { icon: typeof Gauge; value: string; unit: string }) {
  return (
    <div className="px-2">
      <Icon size={14} className="mx-auto mb-1 text-slate-500" />
      <div className="tabular text-lg leading-none font-bold text-white">{value}</div>
      <div className="mt-1 text-[10px] tracking-wide text-slate-500 uppercase">{unit}</div>
    </div>
  );
}

function Legend() {
  const items = ['PENDING', 'ALERTED', 'ESCALATED', 'ACKNOWLEDGED', 'PASSED'];
  return (
    <div className="panel pointer-events-none absolute bottom-3 left-3 z-[500] hidden gap-3 px-3 py-2 text-[11px] text-slate-300 md:flex">
      {items.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATE_STYLE[s]!.color }} />
          {STATE_STYLE[s]!.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-1 w-4 rounded bg-warn" />
        Alert zone
      </span>
    </div>
  );
}

function Corridor({
  route,
  statuses,
  signalInfo,
  presence,
  onAck,
  canAck,
}: {
  route: RouteInfo;
  statuses: Map<number, SignalView>;
  signalInfo: Map<number, SignalInfo>;
  presence: Record<number, number>;
  onAck: (s: SignalView) => void;
  canAck: boolean;
}) {
  return (
    <div className="panel p-4">
      <SectionTitle icon={ListOrdered} right={<span className="text-xs text-slate-500">{route.signals.length} junctions</span>}>
        Corridor
      </SectionTitle>
      <ol className="relative">
        {route.signals.map((def, i) => {
          const s = statuses.get(def.id);
          const state = s?.state ?? 'PENDING';
          const st = STATE_STYLE[state]!;
          const Icon = STATE_ICON[state]!;
          const live = LIVE.has(state);
          const info = signalInfo.get(def.id);
          const frac = s?.alertEtaS ? Math.max(0, Math.min(1, (s.etaS ?? 0) / Math.max(1, s.alertEtaS))) : 0;
          return (
            <li key={def.id} className="relative flex gap-3 pb-3 last:pb-0">
              {i < route.signals.length - 1 && (
                <span className="absolute top-8 bottom-0 left-[15px] w-0.5" style={{ background: state === 'PASSED' ? STATE_STYLE.PASSED!.color : 'rgb(255 255 255 / 0.08)' }} />
              )}
              <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ${live ? 'pulse-ring' : ''}`} style={{ background: st.color, color: st.color }}>
                <Icon size={15} className="text-slate-950" strokeWidth={2.75} />
              </span>
              <div className={`min-w-0 flex-1 rounded-xl px-3 py-2 transition ${live ? 'bg-white/[0.06] ring-1' : ''}`} style={live ? { boxShadow: `inset 0 0 0 1px ${st.color}55` } : undefined}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{def.name}</p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                      {def.code}
                      {(presence[def.id] ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ok/15 px-1.5 font-semibold text-emerald-300" title="Officer phones connected">
                          <Smartphone size={11} />
                          {presence[def.id]} on duty
                        </span>
                      ) : (
                        <span>· {info?.officer ? 'officer assigned' : 'no officer'}</span>
                      )}
                    </p>
                  </div>
                  <StateBadge state={state} />
                </div>
                {s && s.distanceM !== null && state !== 'PENDING' && (
                  <p className="tabular mt-1 text-xs text-slate-300">
                    {fmtDistance(s.distanceM)} · {s.etaS} s · from the {s.approachFrom}
                  </p>
                )}
                {state === 'PASSED' && s?.acknowledgedAt && s.alertedAt && (
                  <p className="mt-1 text-xs text-slate-400">Acknowledged in {((s.acknowledgedAt - s.alertedAt) / 1000).toFixed(1)} s</p>
                )}
                {live && s && (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${frac * 100}%`, background: st.color }} />
                    </div>
                    {state === 'ESCALATED' && <p className="mt-1.5 text-xs text-red-300">No response in 10 s · {info?.backupOfficer ?? 'backup'} notified</p>}
                    {canAck && (
                      <Button variant={state === 'ESCALATED' ? 'danger' : 'primary'} className="mt-2 min-h-9 w-full text-sm" onClick={() => onAck(s)}>
                        <Bell size={14} />
                        {state === 'ESCALATED' ? 'Acknowledge as backup' : 'Acknowledge'}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const EVENT_STYLE: Record<FeedEvent['kind'], { icon: typeof Bell; color: string }> = {
  alert: { icon: Bell, color: '#f5a524' },
  escalated: { icon: OctagonAlert, color: '#e5383b' },
  ack: { icon: ShieldCheck, color: '#17c964' },
  passed: { icon: CheckCheck, color: '#3b82f6' },
  trip: { icon: Ambulance, color: '#94a3b8' },
  offline: { icon: WifiOff, color: '#e5383b' },
  online: { icon: Activity, color: '#17c964' },
  hospital: { icon: Hospital, color: '#a78bfa' },
};

function EventTimeline({ events }: { events: FeedEvent[] }) {
  return (
    <div className="panel flex min-h-48 flex-1 flex-col p-4">
      <SectionTitle icon={Activity}>Live events</SectionTitle>
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">Waiting for activity…</p>
      ) : (
        <ol className="-mr-2 max-h-72 flex-1 space-y-2 overflow-y-auto pr-2" aria-live="polite">
          {events.map((e) => {
            const st = EVENT_STYLE[e.kind];
            const Icon = st.icon;
            return (
              <li key={e.id} className="flex gap-2.5 text-sm">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg" style={{ background: `${st.color}22`, color: st.color }}>
                  <Icon size={13} />
                </span>
                <span className="min-w-0 flex-1 text-slate-200">{e.text}</span>
                <span className="tabular shrink-0 text-xs text-slate-500">{fmtTime(e.ts)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const SPEEDS = [20, 40, 60, 90];

function SimToolbar({ session, route, trip, sim, onError }: { session: Session; route: RouteInfo; trip?: TripView; sim?: { speedKmh: number; paused: boolean }; onError: (e: string | null) => void }) {
  const [speed, setSpeed] = useState(40);
  const [nearFirst, setNearFirst] = useState(true);
  const call = async (path: string, body: unknown) => {
    onError(null);
    try {
      await api(path, { body, token: session.token });
    } catch (e) {
      onError(errorText(e));
    }
  };
  const current = trip ? (sim?.speedKmh ?? speed) : speed;

  const speedPicker = (onPick: (v: number) => void) => (
    <div className="flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10" role="group" aria-label="Simulator speed">
      {SPEEDS.map((s) => (
        <button
          key={s}
          aria-pressed={current === s}
          onClick={() => onPick(s)}
          className={`tabular rounded-lg px-3 py-1.5 text-sm font-semibold transition ${current === s ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
        >
          {s}
          <span className="ml-0.5 text-[10px] opacity-70">km/h</span>
        </button>
      ))}
    </div>
  );

  if (trip && !trip.simulated) {
    return (
      <div className="panel flex items-center gap-3 px-4 py-3 text-sm text-slate-300">
        <Smartphone size={16} /> Live GPS trip from the driver's phone
      </div>
    );
  }

  return (
    <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
        <Play size={14} /> Simulator
      </span>
      {trip ? (
        <>
          {speedPicker((v) => call(`/simulator/${trip.id}/control`, { speedKmh: v }))}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" className="min-h-9 text-sm" onClick={() => call(`/simulator/${trip.id}/control`, { paused: !sim?.paused })}>
              {sim?.paused ? <Play size={15} /> : <Pause size={15} />} {sim?.paused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="ghost" className="min-h-9 text-sm" onClick={() => call(`/simulator/${trip.id}/control`, { skipToNextSignal: true })}>
              <FastForward size={15} /> Next junction
            </Button>
            <Button variant="ghost" className="min-h-9 text-sm" onClick={() => call(`/simulator/${trip.id}/stop`, {})}>
              <Square size={14} /> Stop
            </Button>
          </div>
        </>
      ) : (
        <>
          {speedPicker(setSpeed)}
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="h-4 w-4 accent-emergency" checked={nearFirst} onChange={(e) => setNearFirst(e.target.checked)} />
            Start near first junction
          </label>
          <Button
            variant="danger"
            className="ml-auto min-h-10"
            onClick={() => call('/simulator/start', { routeId: route.id, speedKmh: speed, startAtM: nearFirst ? Math.max(0, (route.signals[0]?.alongM ?? 0) - 900) : 0, noiseM: 4 })}
          >
            <Siren size={16} /> Dispatch simulated ambulance
          </Button>
        </>
      )}
    </div>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-[620px] w-[300px] shrink-0 rounded-[44px] bg-gradient-to-b from-slate-700 to-slate-900 p-[10px] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8),inset_0_0_0_1px_rgb(255_255_255/0.08)]">
      <div className="relative h-full w-full overflow-hidden rounded-[34px] bg-ink">
        <div className="absolute top-2 left-1/2 z-20 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
        <div className="h-full overflow-hidden pt-8">{children}</div>
      </div>
    </div>
  );
}

interface TripRow {
  id: number;
  status: string;
  simulated: number;
  startedAt: number;
  hospital: string;
  ambulance: string;
}

function RecentTrips({ session, refreshKey }: { session: Session; refreshKey: number }) {
  const [rows, setRows] = useState<TripRow[]>([]);
  useEffect(() => {
    api<TripRow[]>('/trips', { token: session.token }).then(setRows).catch(() => {});
  }, [session.token, refreshKey]);
  return (
    <div className="panel p-4">
      <SectionTitle icon={History}>Recent trips</SectionTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No trips yet.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.slice(0, 6).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-300">
                #{t.id} {t.ambulance} <span className="text-slate-500">· {fmtTime(t.startedAt)}</span>
              </span>
              {t.status === 'ended' ? (
                <Link className="shrink-0 text-xs font-semibold text-info hover:underline" to={`/trips/${t.id}`}>
                  Summary
                </Link>
              ) : (
                <span className="shrink-0 text-xs font-bold text-emergency">LIVE</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
