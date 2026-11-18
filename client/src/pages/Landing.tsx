import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { demoLogin, errorText } from '../lib/api';
import { saveSession } from '../lib/session';
import { ErrorBanner } from '../components/ui';

const ROLES = [
  { to: '/driver', icon: '🚑', title: 'Ambulance driver', text: 'Start an emergency trip. Your GPS warns the junctions ahead.' },
  { to: '/officer', icon: '👮', title: 'Traffic officer', text: 'Get a loud, glanceable alert about a minute before the ambulance arrives.' },
  { to: '/hospital', icon: '🏥', title: 'Hospital desk', text: 'See incoming ambulances and live ETA. Get the team ready.' },
  { to: '/control', icon: '🗺️', title: 'Control room', text: 'Every trip and junction on one map, with escalations.' },
];

export function Landing() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

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
    <div className="min-h-full bg-ink text-white">
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-12">
        <header className="space-y-4">
          <p className="text-5xl">🚑</p>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Ambulance Traffic Alert</h1>
          <p className="max-w-2xl text-xl text-slate-300">
            Every traffic officer on the route is warned about <b className="text-white">60 seconds or 500 m</b> before the ambulance reaches their junction,
            so the lane is clear before it arrives. Phones and browsers only, no signal hardware.
          </p>
          <ErrorBanner error={error} />
          <button
            onClick={runDemo}
            className="min-h-16 rounded-2xl bg-emergency px-8 text-xl font-bold shadow-lg hover:bg-emergency-dark focus-visible:ring-4 focus-visible:ring-red-300"
          >
            ▶ Run live demo
          </button>
        </header>
        <nav className="grid gap-4 sm:grid-cols-2">
          {ROLES.map((r) => (
            <Link key={r.to} to={r.to} className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10 transition hover:bg-white/10 focus-visible:ring-4 focus-visible:ring-blue-400">
              <p className="text-4xl">{r.icon}</p>
              <p className="mt-2 text-2xl font-bold">{r.title}</p>
              <p className="mt-1 text-slate-300">{r.text}</p>
            </Link>
          ))}
        </nav>
        <footer className="text-sm text-slate-400">
          Alerts humans; does not control traffic signals. Demo routes in Bengaluru and Pune use real roads; junction assignments and accounts are seeded.
        </footer>
      </main>
    </div>
  );
}
