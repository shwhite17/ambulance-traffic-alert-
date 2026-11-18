export const fmtDistance = (m: number | null | undefined) =>
  m === null || m === undefined ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

export const fmtDuration = (s: number | null | undefined) => {
  if (s === null || s === undefined) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `${m}m ${r}s` : `${m} min`;
};

export const fmtTime = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

/** Colour + label per junction state. Shapes (icons) back up colour for colour-blind users. */
export const STATE_STYLE: Record<string, { label: string; color: string; badge: string; live: boolean }> = {
  PENDING: { label: 'Pending', color: '#64748b', badge: 'bg-slate-500/15 text-slate-300 ring-slate-500/30', live: false },
  ALERTED: { label: 'Alerted', color: '#f5a524', badge: 'bg-amber-500/15 text-amber-300 ring-amber-500/40', live: true },
  ESCALATED: { label: 'Escalated', color: '#e5383b', badge: 'bg-red-500/15 text-red-300 ring-red-500/40', live: true },
  ACKNOWLEDGED: { label: 'Clearing', color: '#17c964', badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40', live: false },
  PASSED: { label: 'Passed', color: '#3b82f6', badge: 'bg-blue-500/15 text-blue-300 ring-blue-500/40', live: false },
  CLOSED: { label: 'Closed', color: '#475569', badge: 'bg-slate-600/20 text-slate-400 ring-slate-600/30', live: false },
};
