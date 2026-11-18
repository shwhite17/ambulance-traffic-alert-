import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Car, Heart, Power } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { setSirenWanted, unlockAudio } from '../lib/alarm';
import { useSocket } from '../lib/socket';
import { speak } from '../lib/voice';
import type { CitizenView } from '../lib/types';
import { LogoMark } from '../components/Logo';
import { ConnectionDot, SimBadge } from '../components/ui';
import { VoicePicker } from '../components/VoicePicker';

const key = (routeId: string) => `ata.citizen.${routeId}`;

/**
 * Citizen Corridor: an ordinary driver's phone. Opt-in, anonymous, no install.
 * Warns "ambulance behind you, move left" about 30 s before it reaches you.
 */
export function CitizenPage() {
  const { routeId = '' } = useParams();
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(key(routeId)));
  const [car, setCar] = useState<CitizenView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const spoken = useRef<{ warnedFor: string | null; thanked: boolean }>({ warnedFor: null, thanked: false });

  const join = async () => {
    setError(null);
    try {
      const r = await api<{ token: string; citizen: CitizenView }>('/citizen/join', { body: { routeId } });
      sessionStorage.setItem(key(routeId), r.token);
      setToken(r.token);
      setCar(r.citizen);
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    if (!token) void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const { connected } = useSocket(token ?? undefined, {
    'citizen:snapshot': (c: CitizenView | null) => {
      if (c) setCar(c);
      else {
        // Our car was removed (e.g. server restart): join again.
        sessionStorage.removeItem(key(routeId));
        setToken(null);
        void join();
      }
    },
    'citizen:update': (c: CitizenView) => setCar(c),
  });

  // Sound, vibration and voice follow the car's state.
  const warned = car?.state === 'warned';
  useEffect(() => {
    setSirenWanted('citizen', armed && warned, 0.12);
    return () => setSirenWanted('citizen', false);
  }, [armed, warned]);
  useEffect(() => {
    if (!armed || !car) return;
    const s = spoken.current;
    if (car.state === 'warned' && s.warnedFor !== car.regNo) {
      s.warnedFor = car.regNo;
      s.thanked = false;
      speak((p) => p.citizenWarn(car.etaS ?? 30), { interrupt: true });
    } else if (car.state === 'cleared' && !s.thanked) {
      s.thanked = true;
      speak((p) => p.citizenPassed, { interrupt: true });
    } else if (car.state === 'idle') {
      s.warnedFor = null;
    }
  }, [armed, car]);

  const shell = 'flex h-full min-h-full flex-col text-white';
  const header = (
    <div className="flex items-center justify-between px-5 pt-4 text-sm">
      <span className="flex items-center gap-2 font-semibold opacity-90">
        <Car size={16} /> {car?.label ?? 'Joining…'}
      </span>
      <ConnectionDot connected={connected} label="" />
    </div>
  );

  if (error && !car) {
    return (
      <div className={`${shell} grid-bg items-center justify-center gap-3 bg-ink p-6 text-center`}>
        <LogoMark size={48} />
        <p className="text-lg font-bold">Couldn't join the corridor</p>
        <p className="text-slate-400">{error}</p>
      </div>
    );
  }

  // One tap: browsers need it before sound, vibration and voice are allowed.
  if (!armed) {
    return (
      <div className={`${shell} grid-bg items-center justify-center gap-6 bg-ink p-6 text-center`}>
        <LogoMark size={56} />
        <div>
          <p className="eyebrow text-slate-400 uppercase">Citizen Corridor</p>
          <p className="mt-1 text-2xl font-bold">You're a car on the road</p>
          <p className="mt-1 text-slate-400">{car ? `${car.label}` : 'Finding your spot on the route…'}</p>
        </div>
        <button
          disabled={!car}
          onClick={() => {
            unlockAudio();
            speak((p) => p.voiceOn, { interrupt: true });
            setArmed(true);
          }}
          className="flex min-h-16 w-full max-w-sm items-center justify-center gap-3 rounded-2xl bg-ok px-6 text-xl font-bold text-slate-950 disabled:opacity-50"
        >
          <Power size={22} /> Turn on ambulance alerts
        </button>
        <VoicePicker className="items-center" />
        <p className="max-w-sm text-xs text-slate-500">
          Anonymous demo: you're placed at a point on the corridor. In real use this would come from a maps app or fleet integration.
        </p>
      </div>
    );
  }

  if (warned && car) {
    return (
      <div className={`${shell} alert-flash`} role="alert" aria-live="assertive">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <p className="text-sm font-bold tracking-[0.2em] uppercase opacity-90">🚑 Ambulance behind you</p>
          <ArrowLeft size={150} strokeWidth={3} className="animate-pulse" />
          <p className="text-6xl leading-none font-extrabold">MOVE LEFT</p>
          <p className="tabular text-3xl font-semibold">
            {car.etaS ?? '—'} s · {car.distanceM ?? '—'} m
          </p>
          <p className="opacity-90">{car.regNo} is on an emergency run. Please give way safely.</p>
        </div>
      </div>
    );
  }

  if (car?.state === 'cleared') {
    return (
      <div className={`${shell} bg-gradient-to-b from-emerald-600 to-emerald-800`}>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <Heart size={72} strokeWidth={1.5} className="fill-white/20" />
          <p className="text-4xl font-bold">Thank you!</p>
          <p className="text-lg opacity-90">You helped clear the lane. The ambulance got through.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${shell} bg-ink`}>
      {header}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="relative grid h-40 w-24 place-items-center rounded-3xl bg-slate-800 ring-1 ring-white/10">
          <div className="absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2 border-l-2 border-dashed border-slate-600" />
          <Car size={40} className="relative text-slate-200" />
        </div>
        <div>
          <p className="text-2xl font-bold">Drive safely</p>
          <p className="mt-1 text-slate-400">We'll warn you about 30 seconds before an ambulance comes up behind you.</p>
        </div>
        {car?.simulated && <SimBadge />}
      </div>
    </div>
  );
}
