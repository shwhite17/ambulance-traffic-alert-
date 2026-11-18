import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ambulance, ArrowRight, BellRing, Download, Hospital, MonitorDot, Radar, ShieldCheck, Siren, Smartphone, Timer, Users } from 'lucide-react';
import { demoLogin, errorText } from '../lib/api';
import { saveSession } from '../lib/session';
import { APP_NAME, TAGLINE } from '../lib/brand';
import { ErrorBanner } from '../components/ui';
import { Logo } from '../components/Logo';

const ROLES = [
  { to: '/driver', icon: Ambulance, title: 'Ambulance driver', text: 'One tap starts an emergency trip. GPS warns every junction ahead.' },
  { to: '/officer', icon: Siren, title: 'Traffic officer', text: 'Full-screen alarm about a minute before the ambulance arrives.' },
  { to: '/hospital', icon: Hospital, title: 'Hospital desk', text: 'Live ETA for every incoming ambulance. Get the team ready.' },
  { to: '/control', icon: MonitorDot, title: 'Control room', text: 'Every trip and junction on one map, with escalations.' },
];

const STEPS = [
  { icon: Radar, title: 'Track', text: 'The ambulance phone streams GPS. We snap it to the road and measure distance along the route, not as the crow flies.' },
  { icon: BellRing, title: 'Warn', text: 'Each junction is alerted at 500 m or 60 s, whichever comes first, so faster ambulances warn earlier.' },
  { icon: ShieldCheck, title: 'Escalate', text: 'No acknowledgment in 10 s? A backup officer and the control room are alerted instantly.' },
];

type InstallPrompt = Event & { prompt: () => Promise<void> };

export function Landing() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const runDemo = async () => {
    try {
      const s = await demoLogin('control@demo.in');
      saveSession({ token: s.token, user: s.user });
      navigate('/demo');
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="grid-bg min-h-full text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          {install && (
            <button onClick={() => install.prompt().then(() => setInstall(null))} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10">
              <Download size={16} /> Install app
            </button>
          )}
          <Link to="/control" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white">
            Control room
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        {/* Hero */}
        <section className="grid items-center gap-10 pt-8 pb-16 lg:grid-cols-[1.05fr_1fr]">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-emergency/10 px-3 py-1 text-xs font-semibold tracking-wide text-red-200 ring-1 ring-emergency/30">
              <span className="pulse-ring h-2 w-2 rounded-full bg-emergency text-emergency" /> Green corridors without smart signals
            </span>
            <h1 className="text-5xl leading-[1.05] font-black tracking-tight sm:text-6xl">
              {TAGLINE.split(' before ')[0]}
              <span className="block bg-gradient-to-r from-red-400 via-amber-300 to-emerald-300 bg-clip-text text-transparent">before the siren is heard.</span>
            </h1>
            <p className="max-w-xl text-lg text-slate-300">
              {APP_NAME} warns every traffic officer on an ambulance's route about <b className="text-white">60 seconds ahead</b>, and escalates if nobody responds.
              It runs on the phones officers already carry, with no signal hardware, so any city can afford it.
            </p>
            <ErrorBanner error={error} />
            <div className="flex flex-wrap gap-3">
              <button
                onClick={runDemo}
                className="flex min-h-14 items-center gap-2 rounded-2xl bg-emergency px-7 text-lg font-bold shadow-[0_16px_50px_-12px_rgb(229_56_59/0.8)] transition hover:bg-red-500 focus-visible:ring-4 focus-visible:ring-red-300"
              >
                <Siren size={20} /> Launch live demo
              </button>
              <Link to="/officer" className="flex min-h-14 items-center gap-2 rounded-2xl bg-white/5 px-6 font-semibold ring-1 ring-white/15 hover:bg-white/10">
                <Smartphone size={18} /> Open officer app
              </Link>
            </div>
            <div className="flex flex-wrap gap-6 pt-2 text-sm text-slate-400">
              <span className="flex items-center gap-2"><Timer size={16} className="text-warn" /> ~60 s warning</span>
              <span className="flex items-center gap-2"><ShieldCheck size={16} className="text-ok" /> 10 s escalation</span>
              <span className="flex items-center gap-2"><Users size={16} className="text-info" /> 4 roles, one system</span>
            </div>
          </div>
          <HeroCorridor />
        </section>

        {/* How it works */}
        <section className="grid gap-4 pb-16 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="panel p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10">
                  <s.icon size={20} />
                </span>
                <span className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 text-xl font-bold">{s.title}</h3>
              <p className="mt-1 text-slate-400">{s.text}</p>
            </div>
          ))}
        </section>

        {/* Roles */}
        <section className="pb-16">
          <h2 className="mb-4 text-xs font-semibold tracking-[0.18em] text-slate-400 uppercase">Open an app</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <Link key={r.to} to={r.to} className="panel group p-5 transition hover:-translate-y-0.5 hover:border-white/20 focus-visible:ring-4 focus-visible:ring-blue-500/50">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10 transition group-hover:bg-white group-hover:text-slate-900">
                  <r.icon size={20} />
                </span>
                <p className="mt-4 font-bold">{r.title}</p>
                <p className="mt-1 text-sm text-slate-400">{r.text}</p>
                <span className="mt-3 flex items-center gap-1 text-sm font-semibold text-slate-300 group-hover:text-white">
                  Open <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <footer className="border-t border-line py-8 text-sm text-slate-500">
          Alerts humans; does not control traffic signals. Demo routes in Bengaluru and Pune follow real roads; junction assignments and accounts are seeded.
          Map data © OpenStreetMap contributors.
        </footer>
      </main>
    </div>
  );
}

/** Looping illustration: ambulance drives, alert zone runs ahead, lights go amber → green → blue. */
function HeroCorridor() {
  const DUR = 9;
  const X0 = 40;
  const X1 = 560;
  // First junction must be > 2.2 s of driving in, so its keyframes stay positive.
  const junctions = [190, 300, 410, 520];
  const at = (x: number) => ((x - X0) / (X1 - X0)) * DUR; // seconds when the ambulance reaches x
  const f = (t: number) => Math.max(0, Math.min(1, t / DUR)).toFixed(3);

  return (
    <div className="panel relative overflow-hidden p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-2 font-semibold tracking-[0.14em] uppercase">
          <span className="pulse-ring h-2 w-2 rounded-full bg-emergency text-emergency" /> Live corridor
        </span>
        <span>Ambulance · 40 km/h</span>
      </div>
      <svg viewBox="0 0 600 220" className="w-full" role="img" aria-label="Animation of an ambulance clearing four junctions in turn">
        <defs>
          <linearGradient id="zone" x1="0" x2="1">
            <stop offset="0" stopColor="#f5a524" stopOpacity="0.9" />
            <stop offset="1" stopColor="#f5a524" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* cross streets */}
        {junctions.map((x) => (
          <rect key={x} x={x - 9} y="20" width="18" height="180" rx="4" fill="#111a2e" />
        ))}
        {/* main road */}
        <rect x="20" y="96" width="560" height="28" rx="14" fill="#16213a" />
        <line x1="30" y1="110" x2="570" y2="110" stroke="#2b3a5c" strokeWidth="2" strokeDasharray="10 10" />
        {/* junction lights */}
        {junctions.map((x, i) => {
          const t = at(x);
          return (
            <g key={x}>
              <circle cx={x} cy="60" r="16" fill="#0b1120" stroke="#1f2b47" />
              <circle cx={x} cy="60" r="9" fill="#334155">
                <animate
                  attributeName="fill"
                  dur={`${DUR}s`}
                  repeatCount="indefinite"
                  calcMode="discrete"
                  keyTimes={`0;${f(t - 2.2)};${f(t - 1.4)};${f(t + 0.15)};1`}
                  values="#334155;#f5a524;#17c964;#3b82f6;#3b82f6"
                />
              </circle>
              <text x={x} y="170" textAnchor="middle" fill="#64748b" fontSize="11" fontFamily="Inter Variable, sans-serif">
                J{i + 1}
              </text>
            </g>
          );
        })}
        {/* ambulance + alert zone moving together */}
        <g>
          <animateTransform attributeName="transform" type="translate" from={`${X0} 0`} to={`${X1} 0`} dur={`${DUR}s`} repeatCount="indefinite" />
          <rect x="0" y="103" width="130" height="14" rx="7" fill="url(#zone)" />
          <circle cx="0" cy="110" r="20" fill="#e5383b" opacity="0.25">
            <animate attributeName="r" values="14;24;14" dur="1.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="0" cy="110" r="12" fill="#fff" />
          <path d="M-5 110h10M0 105v10" stroke="#e5383b" strokeWidth="3" strokeLinecap="round" />
        </g>
      </svg>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <span className="rounded-lg bg-warn/10 py-1.5 text-amber-200">● Alerted</span>
        <span className="rounded-lg bg-ok/10 py-1.5 text-emerald-200">● Lane clearing</span>
        <span className="rounded-lg bg-info/10 py-1.5 text-blue-200">● Passed</span>
      </div>
    </div>
  );
}
