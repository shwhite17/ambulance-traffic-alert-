import { useEffect, useState, type ReactNode } from 'react';
import { api, demoLogin, errorText, login } from '../lib/api';
import { saveSession, useSession } from '../lib/session';
import type { DemoAccount, Role, Session } from '../lib/types';
import { Ambulance, ChevronRight, Hospital, MonitorDot, Siren, type LucideIcon } from 'lucide-react';
import { Button, ErrorBanner, TopBar } from './ui';

const ROLE_TITLE: Record<Role, string> = {
  driver: 'Ambulance driver',
  officer: 'Traffic officer',
  hospital: 'Hospital desk',
  admin: 'Control room',
};
const ROLE_ICON: Record<Role, LucideIcon> = { driver: Ambulance, officer: Siren, hospital: Hospital, admin: MonitorDot };

/** Renders children with a session for `role`, or a login screen. */
export function RoleGate({ role, children }: { role: Role; children: (s: Session, logout: () => void) => ReactNode }) {
  const { session, setSession, logout } = useSession(role);
  if (session) return <>{children(session, logout)}</>;
  return (
    <LoginScreen
      role={role}
      onLogin={(s) => {
        saveSession(s);
        setSession(s);
      }}
    />
  );
}

function LoginScreen({ role, onLogin }: { role: Role; onLogin: (s: Session) => void }) {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<DemoAccount[]>('/demo/accounts')
      .then((all) => setAccounts(all.filter((a) => a.role === role)))
      .catch(() => setAccounts([])); // demo mode off: manual login only
  }, [role]);

  const run = async (fn: () => Promise<Session & { role: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      if (s.user.role !== role) throw new Error(`That account is a ${s.user.role}, not a ${role}.`);
      onLogin({ token: s.token, user: s.user });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const Icon = ROLE_ICON[role];
  return (
    <div className="grid-bg min-h-full">
      <TopBar title={`${ROLE_TITLE[role]} · sign in`} />
      <main className="mx-auto max-w-md space-y-6 px-4 py-10">
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10">
            <Icon size={26} className="text-white" />
          </span>
          <h1 className="mt-4 text-2xl font-bold">{ROLE_TITLE[role]}</h1>
          <p className="text-sm text-slate-400">Sign in to continue</p>
        </div>
        <ErrorBanner error={error} />
        {accounts.length > 0 && (
          <section className="panel p-2">
            <h2 className="px-3 pt-2 pb-1 eyebrow text-slate-400 uppercase">Demo accounts · one tap</h2>
            <div className="max-h-72 overflow-y-auto">
              {accounts.map((a) => (
                <button
                  key={a.email}
                  disabled={busy}
                  onClick={() => run(() => demoLogin(a.email))}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-white">{a.name}</span>
                    <span className="block truncate text-xs text-slate-500">{a.email}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-slate-500" />
                </button>
              ))}
            </div>
          </section>
        )}
        <form
          className="panel space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => login(email, password));
          }}
        >
          <h2 className="eyebrow text-slate-400 uppercase">Sign in with email</h2>
          <label className="block">
            <span className="text-sm text-slate-400">Email</span>
            <input className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-blue-500" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-slate-400">Password</span>
            <input className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-white outline-none focus:border-blue-500" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <Button type="submit" disabled={busy} className="w-full">
            Sign in
          </Button>
        </form>
      </main>
    </div>
  );
}
