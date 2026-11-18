import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { STATE_STYLE } from '../lib/format';

export function ConnectionDot({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm" role="status">
      <span className={`h-3 w-3 rounded-full ${connected ? 'bg-green-500' : 'animate-pulse bg-red-500'}`} />
      {label ?? (connected ? 'Live' : 'Reconnecting…')}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  const s = STATE_STYLE[state] ?? STATE_STYLE.PENDING!;
  return <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${s.badge}`}>{s.label}</span>;
}

export function SimBadge() {
  return <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold tracking-wide text-violet-800 uppercase">Simulated</span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost' | 'ok' };
export function Button({ variant = 'primary', className = '', ...rest }: BtnProps) {
  const v = {
    primary: 'bg-slate-900 text-white hover:bg-slate-700',
    danger: 'bg-emergency text-white hover:bg-emergency-dark',
    ok: 'bg-ok text-white hover:bg-green-700',
    ghost: 'bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50',
  }[variant];
  return (
    <button
      {...rest}
      className={`min-h-12 rounded-xl px-5 font-semibold transition focus-visible:ring-4 focus-visible:ring-blue-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    />
  );
}

export function TopBar({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 bg-ink px-4 py-3 text-white">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-2xl" aria-label="Home">
          🚑
        </Link>
        <h1 className="text-lg font-bold">{title}</h1>
      </div>
      <div className="flex items-center gap-4">{right}</div>
    </header>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg bg-red-100 px-4 py-3 text-red-900">
      {error}
    </div>
  );
}
