import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Check, CheckCheck, Circle, OctagonAlert, X, type LucideIcon } from 'lucide-react';
import { STATE_STYLE } from '../lib/format';
import { Logo } from './Logo';

export const STATE_ICON: Record<string, LucideIcon> = {
  PENDING: Circle,
  ALERTED: Bell,
  ESCALATED: OctagonAlert,
  ACKNOWLEDGED: Check,
  PASSED: CheckCheck,
  CLOSED: X,
};

export function ConnectionDot({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-300" role="status">
      <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'pulse-ring bg-ok text-ok' : 'animate-pulse bg-red-500'}`} />
      {label ?? (connected ? 'Live' : 'Reconnecting…')}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  const s = STATE_STYLE[state] ?? STATE_STYLE.PENDING!;
  const Icon = STATE_ICON[state] ?? Circle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${s.badge}`}>
      <Icon size={12} strokeWidth={2.5} />
      {s.label}
    </span>
  );
}

export function SimBadge() {
  return (
    <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold tracking-wider text-violet-300 uppercase ring-1 ring-violet-500/30">
      Simulated
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost' | 'ok' | 'subtle' };
export function Button({ variant = 'primary', className = '', ...rest }: BtnProps) {
  const v = {
    primary: 'bg-white text-slate-900 hover:bg-slate-200',
    danger: 'bg-emergency text-white hover:bg-red-500 shadow-[0_8px_30px_-8px_rgb(229_56_59/0.7)]',
    ok: 'bg-ok text-slate-950 hover:bg-emerald-400',
    ghost: 'bg-white/5 text-slate-100 ring-1 ring-white/10 hover:bg-white/10',
    subtle: 'bg-transparent text-slate-300 hover:bg-white/5',
  }[variant];
  return (
    <button
      {...rest}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition focus-visible:ring-4 focus-visible:ring-blue-500/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    />
  );
}

export function TopBar({ title, right }: { title?: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-[1000] flex items-center justify-between gap-4 border-b border-line bg-ink/80 px-4 py-2.5 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-4">
        <Link to="/" aria-label="Home" className="shrink-0">
          <Logo compact />
        </Link>
        {title && (
          <>
            <span className="hidden h-5 w-px bg-white/15 sm:block" />
            <h1 className="hidden truncate text-sm font-semibold text-slate-300 sm:block">{title}</h1>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-red-200 ring-1 ring-red-500/30">
      {error}
    </div>
  );
}

export function Kpi({ label, value, hint, icon: Icon, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; icon: LucideIcon; tone?: 'default' | 'ok' | 'warn' | 'danger' }) {
  const toneCls = { default: 'text-slate-300 bg-white/5', ok: 'text-ok bg-ok/10', warn: 'text-warn bg-warn/10', danger: 'text-emergency bg-emergency/10' }[tone];
  return (
    <div className="panel flex items-center gap-3 px-4 py-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneCls}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <div className="tabular text-xl leading-tight font-bold text-white">{value}</div>
        <div className="truncate text-xs text-slate-400">
          {label}
          {hint && <span className="text-slate-500"> · {hint}</span>}
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ icon: Icon, children, right }: { icon: LucideIcon; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
        <Icon size={14} />
        {children}
      </h3>
      {right}
    </div>
  );
}
