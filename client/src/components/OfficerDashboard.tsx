import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, CheckCheck, LogOut, OctagonAlert, Power, ShieldCheck } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { chirp, keepAwake, setSirenWanted, unlockAudio } from '../lib/alarm';
import { fmtDistance } from '../lib/format';
import { useSocket } from '../lib/socket';
import type { AlertView, Session } from '../lib/types';
import { speak } from '../lib/voice';
import { useOfficerVoice } from '../lib/useVoiceAlerts';
import { LogoMark } from './Logo';
import { VoicePicker } from './VoicePicker';
import { ConnectionDot, SimBadge } from './ui';

interface OfficerInfo {
  primarySignalIds: number[];
  backupSignalIds: number[];
  signals: { id: number; code: string; name: string }[];
}

/** How long the "Passed" confirmation stays before returning to waiting. */
const PASSED_LINGER_MS = 6_000;
const UNACKED = new Set(['ALERTED', 'ESCALATED']);
/**
 * Compass bearing of the side the ambulance comes FROM. Rotating a down-arrow
 * by this bearing points it along the ambulance's direction of travel
 * (e.g. from the east → arrow points west).
 */
const FROM_DEG: Record<string, number> = {
  north: 0, 'north-east': 45, east: 90, 'south-east': 135, south: 180, 'south-west': 225, west: 270, 'north-west': 315,
};

export function OfficerDashboard({
  session,
  soundEnabled = true,
  autoStart = false,
  onLogout,
}: {
  session: Session;
  soundEnabled?: boolean;
  /** Skip the "Start duty" tap (demo phone preview; sound is unlocked by the page). */
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

  const upsert = useCallback((a: AlertView) => setAlerts((prev) => new Map(prev).set(a.signal.signalId, a)), []);
  const drop = useCallback((signalId: number) => {
    setAlerts((prev) => {
      const next = new Map(prev);
      next.delete(signalId);
      return next;
    });
  }, []);
  const removeLater = useCallback(
    (signalId: number) => {
      window.clearTimeout(removeTimers.current.get(signalId));
      removeTimers.current.set(signalId, window.setTimeout(() => drop(signalId), PASSED_LINGER_MS));
    },
    [drop],
  );

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
    'alert:closed': (a: AlertView) => drop(a.signal.signalId),
    'demo:reset': () => setAlerts(new Map()),
    // autoStart is only used by the command centre's phone mockup: don't count it as on duty.
  }, { preview: autoStart });

  useEffect(() => () => removeTimers.current.forEach((t) => window.clearTimeout(t)), []);

  const backupIds = useMemo(() => new Set(info?.backupSignalIds ?? []), [info]);
  // A backup officer only sees alerts once they escalate (or ones they handled).
  const visible = useMemo(
    () => [...alerts.values()].filter((a) => !backupIds.has(a.signal.signalId) || a.signal.escalatedAt !== null || a.signal.acknowledgedBy === me),
    [alerts, backupIds, me],
  );
  const current = useMemo(() => {
    const rank = (a: AlertView) => (UNACKED.has(a.signal.state) ? 0 : a.signal.state === 'ACKNOWLEDGED' ? 1 : 2);
    return [...visible].sort((a, b) => rank(a) - rank(b) || (a.signal.etaS ?? 1e9) - (b.signal.etaS ?? 1e9))[0] ?? null;
  }, [visible]);

  const needsAck = !!current && UNACKED.has(current.signal.state);
  const owner = `officer-${me}`;
  useEffect(() => setSirenWanted(owner, onDuty && soundEnabled && needsAck), [owner, onDuty, soundEnabled, needsAck]);
  useEffect(() => () => setSirenWanted(owner, false), [owner]);
  useOfficerVoice(current, { active: onDuty && soundEnabled, isBackup: !!current && backupIds.has(current.signal.signalId) });

  useEffect(() => {
    if (!onDuty || autoStart) return;
    let release: (() => void) | null = null;
    void keepAwake().then((r) => (release = r));
    return () => release?.();
  }, [onDuty, autoStart]);

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

  const isBackupOnly = !!info && info.primarySignalIds.length === 0;
  const junctionLabel = info?.signals.length
    ? isBackupOnly
      ? `${info.signals.length} junctions`
      : info.signals.filter((s) => info.primarySignalIds.includes(s.id)).map((s) => s.name).join(', ')
    : '…';

  const shell = 'relative flex h-full min-h-full flex-col text-white';

  const header = (
    <div className="flex items-center justify-between gap-2 px-5 pt-4">
      <div className="min-w-0">
        <p className="eyebrow uppercase opacity-60">{isBackupOnly ? 'Backup patrol' : 'Your junction'}</p>
        <p className="truncate text-sm font-semibold">{junctionLabel}</p>
      </div>
      <span className="flex shrink-0 items-center gap-3">
        <ConnectionDot connected={connected} label="" />
        {onLogout && (
          <button className="opacity-70 hover:opacity-100" onClick={onLogout} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        )}
      </span>
    </div>
  );

  // ── Start duty (unlocks audio + vibration via a user gesture) ──
  if (!onDuty) {
    return (
      <div className={`${shell} grid-bg items-center justify-center gap-6 bg-ink p-6 text-center`}>
        <LogoMark size={56} />
        <div>
          <p className="eyebrow text-slate-400 uppercase">Traffic officer</p>
          <p className="mt-1 text-xl font-bold">{junctionLabel}</p>
        </div>
        <button
          className="flex min-h-20 w-full max-w-sm items-center justify-center gap-3 rounded-2xl bg-ok px-6 text-2xl font-bold text-slate-950 shadow-[0_12px_40px_-10px_rgb(23_201_100/0.7)] focus-visible:ring-4 focus-visible:ring-white"
          onClick={() => {
            unlockAudio();
            // Speaking inside the tap unlocks speech for later alerts, and confirms the volume is up.
            speak((p) => p.voiceOn, { interrupt: true });
            setOnDuty(true);
          }}
        >
          <Power size={26} /> Start duty
        </button>
        <div className="flex w-full max-w-sm flex-col items-center gap-2">
          <p className="eyebrow text-slate-400 uppercase">Voice alerts</p>
          <VoicePicker className="items-center" />
        </div>
        <p className="max-w-sm text-sm text-slate-400">Turns on the alarm sound, voice and vibration, and keeps your screen awake.</p>
        {onLogout && (
          <button className="text-sm text-slate-500 underline" onClick={onLogout}>
            Sign out
          </button>
        )}
      </div>
    );
  }

  // ── Waiting: the normal state ──
  if (!current) {
    return (
      <div className={`${shell} bg-ink`}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="relative h-44 w-44 rounded-full ring-1 ring-ok/30">
            <div className="absolute inset-6 rounded-full ring-1 ring-ok/20" />
            <div className="absolute inset-14 rounded-full ring-1 ring-ok/20" />
            <div className="radar-sweep absolute inset-0 rounded-full" />
            <ShieldCheck size={40} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-ok" />
          </div>
          <div>
            <p className="text-2xl font-bold">All clear</p>
            <p className="mt-1 text-slate-400">No ambulance approaching. You'll be alerted about a minute before one arrives.</p>
          </div>
        </div>
        {error && <p className="px-5 pb-4 text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  const s = current.signal;
  const isBackup = backupIds.has(s.signalId);

  // ── Acknowledged: clear the lane ──
  if (s.state === 'ACKNOWLEDGED') {
    return (
      <div className={`${shell} bg-gradient-to-b from-emerald-600 to-emerald-800`}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <ShieldCheck size={64} strokeWidth={1.5} />
          <p className="text-5xl leading-none font-extrabold tracking-tight">CLEAR THE LANE</p>
          <p className="tabular text-3xl font-semibold">
            {fmtDistance(s.distanceM)} · {s.etaS} s
          </p>
          <p className="opacity-90">Approaching from the {s.approachFrom}</p>
        </div>
      </div>
    );
  }

  // ── Passed ──
  if (s.state === 'PASSED') {
    return (
      <div className={`${shell} bg-gradient-to-b from-blue-600 to-blue-800`}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <CheckCheck size={64} strokeWidth={1.5} />
          <p className="text-5xl font-extrabold">PASSED</p>
          <p className="opacity-90">{s.acknowledgedAt ? 'Thank you. Junction cleared in time.' : 'Ambulance passed without acknowledgment.'}</p>
        </div>
      </div>
    );
  }

  // ── ALERT / ESCALATED: full-screen takeover ──
  const frac = s.alertEtaS ? Math.max(0, Math.min(1, (s.etaS ?? 0) / Math.max(s.alertEtaS, 1))) : 1;
  const R = 64;
  const C = 2 * Math.PI * R;
  return (
    <div className={`${shell} alert-flash`} role="alert" aria-live="assertive">
      {header}
      {s.state === 'ESCALATED' && (
        <p className="mx-5 mt-3 flex items-center gap-2 rounded-xl bg-black/35 px-3 py-2 text-sm font-semibold">
          <OctagonAlert size={18} className="shrink-0" />
          {isBackup ? `BACKUP: ${s.name} did not respond` : 'ESCALATED — backup and control room notified'}
        </p>
      )}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
        <div className="relative">
          <svg width={R * 2 + 20} height={R * 2 + 20} aria-hidden>
            <circle cx={R + 10} cy={R + 10} r={R} stroke="rgb(255 255 255 / 0.22)" strokeWidth={10} fill="none" />
            <circle
              cx={R + 10}
              cy={R + 10}
              r={R}
              stroke="white"
              strokeWidth={10}
              fill="none"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              strokeLinecap="round"
              transform={`rotate(-90 ${R + 10} ${R + 10})`}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div>
              <div className="tabular text-5xl leading-none font-semibold">{s.etaS ?? '—'}</div>
              <div className="text-xs font-semibold tracking-widest uppercase opacity-80">seconds</div>
            </div>
          </div>
        </div>
        <div>
          <p className="text-4xl font-extrabold tracking-tight">AMBULANCE</p>
          <p className="text-2xl font-semibold">
            <span className="tabular">{fmtDistance(s.distanceM)}</span> away
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-black/25 px-4 py-2">
          <ArrowDown size={28} style={{ transform: `rotate(${FROM_DEG[s.approachFrom ?? ''] ?? 0}deg)` }} />
          <div className="text-left text-sm">
            <p className="font-bold">From the {s.approachFrom}</p>
            <p className="opacity-85">
              {current.emergencyType} · {current.ambulanceRegNo}
            </p>
          </div>
        </div>
        {current.simulated && <SimBadge />}
      </div>
      {error && <p className="mx-5 mb-2 rounded bg-black/40 px-2 py-1 text-sm">{error}</p>}
      <div className="p-5 pt-0">
        <button
          onClick={acknowledge}
          disabled={acking || !current.alertId}
          className="min-h-20 w-full rounded-2xl bg-white text-2xl font-bold tracking-wide text-emergency shadow-xl focus-visible:ring-4 focus-visible:ring-yellow-300 disabled:opacity-60"
        >
          {acking ? '…' : 'ACKNOWLEDGE'}
        </button>
      </div>
    </div>
  );
}
