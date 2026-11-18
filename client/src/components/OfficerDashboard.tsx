import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText } from '../lib/api';
import { chirp, keepAwake, setSirenWanted, unlockAudio } from '../lib/alarm';
import { fmtDistance, fmtDuration } from '../lib/format';
import { useSocket } from '../lib/socket';
import type { AlertView, Session } from '../lib/types';
import { ConnectionDot, SimBadge } from './ui';

interface OfficerInfo {
  primarySignalIds: number[];
  backupSignalIds: number[];
  signals: { id: number; code: string; name: string }[];
}

/** How long the "Passed" confirmation stays before returning to waiting. */
const PASSED_LINGER_MS = 6_000;
const UNACKED = new Set(['ALERTED', 'ESCALATED']);

export function OfficerDashboard({
  session,
  compact = false,
  soundEnabled = true,
  autoStart = false,
  onLogout,
}: {
  session: Session;
  compact?: boolean;
  soundEnabled?: boolean;
  /** Skip the "Start duty" tap (demo grid; sound is unlocked by the page). */
  autoStart?: boolean;
  onLogout?: () => void;
}) {
  const [onDuty, setOnDuty] = useState(autoStart);
  const [info, setInfo] = useState<OfficerInfo | null>(null);
  const [alerts, setAlerts] = useState<Map<number, AlertView>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);
  const removeTimers = useRef(new Map<number, number>());
  const me = session.user.id;

  useEffect(() => {
    api<OfficerInfo>('/officer/alerts', { token: session.token })
      .then(setInfo)
      .catch((e) => setError(errorText(e)));
  }, [session.token]);

  const upsert = useCallback((a: AlertView) => {
    setAlerts((prev) => new Map(prev).set(a.signal.signalId, a));
  }, []);
  const removeLater = useCallback((signalId: number) => {
    window.clearTimeout(removeTimers.current.get(signalId));
    removeTimers.current.set(
      signalId,
      window.setTimeout(() => {
        setAlerts((prev) => {
          const next = new Map(prev);
          next.delete(signalId);
          return next;
        });
      }, PASSED_LINGER_MS),
    );
  }, []);

  const { connected } = useSocket(session.token, {
    snapshot: (s: { alerts: AlertView[] }) => setAlerts(new Map(s.alerts.map((a) => [a.signal.signalId, a]))),
    'alert:new': upsert,
    'alert:update': upsert,
    'alert:escalated': upsert,
    'alert:ack': upsert,
    'alert:passed': (a: AlertView) => {
      if (!a.alertId) return; // passed without ever being alerted: nothing to show
      upsert(a);
      removeLater(a.signal.signalId);
    },
    'alert:closed': (a: AlertView) => {
      setAlerts((prev) => {
        const next = new Map(prev);
        next.delete(a.signal.signalId);
        return next;
      });
    },
  });

  useEffect(() => () => removeTimers.current.forEach((t) => window.clearTimeout(t)), []);

  const backupIds = useMemo(() => new Set(info?.backupSignalIds ?? []), [info]);
  // A backup officer only sees alerts once they escalate (or ones they handled).
  const visible = useMemo(
    () =>
      [...alerts.values()].filter((a) => {
        if (!backupIds.has(a.signal.signalId)) return true;
        return a.signal.escalatedAt !== null || a.signal.acknowledgedBy === me;
      }),
    [alerts, backupIds, me],
  );
  const current = useMemo(() => {
    const rank = (a: AlertView) => (UNACKED.has(a.signal.state) ? 0 : a.signal.state === 'ACKNOWLEDGED' ? 1 : 2);
    return [...visible].sort((a, b) => rank(a) - rank(b) || (a.signal.etaS ?? 1e9) - (b.signal.etaS ?? 1e9))[0] ?? null;
  }, [visible]);

  const needsAck = !!current && UNACKED.has(current.signal.state);
  const owner = `officer-${me}`;
  useEffect(() => {
    setSirenWanted(owner, onDuty && soundEnabled && needsAck, compact ? 0.08 : 0.25);
  }, [owner, onDuty, soundEnabled, needsAck, compact]);
  useEffect(() => () => setSirenWanted(owner, false), [owner]);

  useEffect(() => {
    if (!onDuty || compact) return;
    let release: (() => void) | null = null;
    void keepAwake().then((r) => (release = r));
    return () => release?.();
  }, [onDuty, compact]);

  const acknowledge = async () => {
    if (!current?.alertId) return;
    setAcking(true);
    setError(null);
    try {
      await api(`/alerts/${current.alertId}/ack`, { method: 'POST', token: session.token });
      chirp();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAcking(false);
    }
  };

  const junctionLabel = info?.signals.length
    ? info.primarySignalIds.length
      ? info.signals.filter((s) => info.primarySignalIds.includes(s.id)).map((s) => s.name).join(', ')
      : `Backup for ${info.signals.length} junctions`
    : '…';

  const pad = compact ? 'p-3' : 'p-6';
  const big = compact ? 'text-3xl' : 'text-6xl';
  const shell = `relative flex flex-col text-white ${compact ? 'h-full min-h-56 rounded-xl overflow-hidden' : 'min-h-full'}`;

  // ── Start duty (unlocks audio + vibration via a user gesture) ──
  if (!onDuty) {
    return (
      <div className={`${shell} items-center justify-center gap-6 bg-ink ${pad} text-center`}>
        <p className="text-slate-300">{junctionLabel}</p>
        <button
          className="min-h-20 w-full max-w-sm rounded-2xl bg-ok px-6 text-2xl font-bold shadow-lg focus-visible:ring-4 focus-visible:ring-white"
          onClick={() => {
            unlockAudio();
            setOnDuty(true);
          }}
        >
          Start duty
        </button>
        <p className="max-w-sm text-sm text-slate-400">This enables the alarm sound and vibration and keeps your screen on.</p>
        {onLogout && (
          <button className="text-sm text-slate-400 underline" onClick={onLogout}>
            Sign out
          </button>
        )}
      </div>
    );
  }

  const header = (
    <div className={`flex items-center justify-between gap-2 ${compact ? 'text-sm' : ''}`}>
      <span className="truncate font-semibold opacity-90">{compact ? session.user.name.replace('Officer @ ', '') : junctionLabel}</span>
      <span className="flex items-center gap-3">
        <ConnectionDot connected={connected} label={compact ? '' : undefined} />
        {onLogout && !compact && (
          <button className="text-sm underline opacity-80" onClick={onLogout}>
            Sign out
          </button>
        )}
      </span>
    </div>
  );

  // ── Waiting: the normal state ──
  if (!current) {
    return (
      <div className={`${shell} bg-ink ${pad}`}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className={`${compact ? 'h-6 w-6' : 'h-10 w-10'} rounded-full bg-ok shadow-[0_0_24px] shadow-green-500/60`} />
          <p className={compact ? 'text-lg' : 'text-2xl'}>No ambulance approaching</p>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  const s = current.signal;
  const isBackup = backupIds.has(s.signalId);

  // ── Acknowledged: clear the lane ──
  if (s.state === 'ACKNOWLEDGED') {
    return (
      <div className={`${shell} bg-green-700 ${pad}`}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className={`${big} font-black tracking-tight`}>CLEAR THE LANE</p>
          <p className={compact ? 'text-xl' : 'text-3xl'}>
            {fmtDistance(s.distanceM)} · ~{fmtDuration(s.etaS)}
          </p>
          <p className="opacity-90">from the {s.approachFrom} · {s.name}</p>
        </div>
      </div>
    );
  }

  // ── Passed ──
  if (s.state === 'PASSED') {
    return (
      <div className={`${shell} bg-blue-700 ${pad}`}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className={`${big} font-black`}>PASSED ✓</p>
          <p>{s.acknowledgedAt ? 'Thank you. Junction cleared.' : 'Ambulance passed without acknowledgment.'}</p>
        </div>
      </div>
    );
  }

  // ── ALERT / ESCALATED: full-screen takeover ──
  const frac = s.alertEtaS ? Math.max(0, Math.min(1, (s.etaS ?? 0) / Math.max(s.alertEtaS, 1))) : 1;
  if (compact) {
    return (
      <div className={`${shell} alert-flash gap-2 ${pad}`} role="alert" aria-live="assertive">
        {header}
        {s.state === 'ESCALATED' && (
          <p className="rounded bg-black/40 px-2 py-1 text-xs font-semibold">
            {isBackup ? `BACKUP: ${s.name} did not respond` : 'ESCALATED — backup + control room notified'}
          </p>
        )}
        <div className="flex flex-1 flex-col justify-center text-center">
          <p className="text-2xl font-black">🚑 {fmtDistance(s.distanceM)} · {s.etaS ?? '—'} s</p>
          <p className="text-sm opacity-90">from the {s.approachFrom}</p>
        </div>
        {error && <p className="truncate rounded bg-black/40 px-2 text-xs">{error}</p>}
        <button
          onClick={acknowledge}
          disabled={acking || !current.alertId}
          className="min-h-12 w-full shrink-0 rounded-xl bg-white text-lg font-black text-emergency shadow focus-visible:ring-4 focus-visible:ring-yellow-300 disabled:opacity-60"
        >
          {acking ? '…' : 'ACKNOWLEDGE'}
        </button>
      </div>
    );
  }
  const R = 70;
  const C = 2 * Math.PI * R;
  return (
    <div className={`${shell} alert-flash p-6`} role="alert" aria-live="assertive">
      {header}
      {s.state === 'ESCALATED' && (
        <p className="mt-2 rounded-lg bg-black/40 px-3 py-2 text-lg font-semibold">
          {isBackup ? `BACKUP: ${s.name} did not respond` : 'ESCALATED — backup and control room notified'}
        </p>
      )}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <svg width={R * 2 + 16} height={R * 2 + 16} className="shrink-0" aria-hidden>
          <circle cx={R + 8} cy={R + 8} r={R} stroke="rgb(255 255 255 / 0.25)" strokeWidth={12} fill="none" />
          <circle
            cx={R + 8}
            cy={R + 8}
            r={R}
            stroke="white"
            strokeWidth={12}
            fill="none"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            strokeLinecap="round"
            transform={`rotate(-90 ${R + 8} ${R + 8})`}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
          <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="white" fontSize={40} fontWeight={800}>
            {s.etaS ?? '—'}s
          </text>
        </svg>
        <div>
          <p className="text-6xl font-black tracking-tight">🚑 AMBULANCE</p>
          <p className="text-4xl font-bold">
            {fmtDistance(s.distanceM)} · ~{fmtDuration(s.etaS)}
          </p>
          <p className="text-xl">
            from the <b>{s.approachFrom}</b> · {current.emergencyType} · {current.ambulanceRegNo}
          </p>
          {current.simulated && (
            <p className="mt-1">
              <SimBadge />
            </p>
          )}
        </div>
      </div>
      {error && <p className="mb-2 rounded bg-black/40 px-2 py-1 text-sm">{error}</p>}
      <button
        onClick={acknowledge}
        disabled={acking || !current.alertId}
        className={`w-full rounded-2xl bg-white font-black text-emergency shadow-xl focus-visible:ring-4 focus-visible:ring-yellow-300 disabled:opacity-60 min-h-24 text-3xl`}
      >
        {acking ? '…' : 'ACKNOWLEDGE'}
      </button>
    </div>
  );
}
