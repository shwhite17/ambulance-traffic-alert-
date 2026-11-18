import { useEffect, useState, type ReactNode } from 'react';
import { api, demoLogin, errorText, login } from '../lib/api';
import { saveSession, useSession } from '../lib/session';
import type { DemoAccount, Role, Session } from '../lib/types';
import { Button, ErrorBanner, TopBar } from './ui';

const ROLE_TITLE: Record<Role, string> = {
  driver: 'Ambulance driver',
  officer: 'Traffic officer',
  hospital: 'Hospital desk',
  admin: 'Control room',
};

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

  return (
    <div className="min-h-full">
      <TopBar title={`${ROLE_TITLE[role]} — sign in`} />
      <main className="mx-auto max-w-lg space-y-6 p-4">
        <ErrorBanner error={error} />
        {accounts.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">Demo accounts</h2>
            <div className="grid gap-2">
              {accounts.map((a) => (
                <Button key={a.email} variant="ghost" disabled={busy} className="text-left" onClick={() => run(() => demoLogin(a.email))}>
                  <span className="block">{a.name}</span>
                  <span className="block text-sm font-normal text-slate-500">{a.email}</span>
                </Button>
              ))}
            </div>
          </section>
        )}
        <form
          className="space-y-3 rounded-xl bg-white p-4 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => login(email, password));
          }}
        >
          <h2 className="font-semibold">Sign in with email</h2>
          <label className="block">
            <span className="text-sm text-slate-600">Email</span>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-sm text-slate-600">Password</span>
            <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <Button type="submit" disabled={busy} className="w-full">
            Sign in
          </Button>
        </form>
      </main>
    </div>
  );
}
