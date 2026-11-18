export const fmtDistance = (m: number | null | undefined) =>
  m === null || m === undefined ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

export const fmtDuration = (s: number | null | undefined) => {
  if (s === null || s === undefined) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `${m} min ${r} s` : `${m} min`;
};

export const fmtTime = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export const STATE_STYLE: Record<string, { label: string; color: string; badge: string }> = {
  PENDING: { label: 'Pending', color: '#94a3b8', badge: 'bg-slate-200 text-slate-700' },
  ALERTED: { label: 'Alerted', color: '#f59e0b', badge: 'bg-amber-100 text-amber-800' },
  ESCALATED: { label: 'Escalated', color: '#c62828', badge: 'bg-red-100 text-red-800' },
  ACKNOWLEDGED: { label: 'Acknowledged', color: '#16a34a', badge: 'bg-green-100 text-green-800' },
  PASSED: { label: 'Passed', color: '#2563eb', badge: 'bg-blue-100 text-blue-800' },
  CLOSED: { label: 'Closed', color: '#64748b', badge: 'bg-slate-200 text-slate-600' },
};
