import { fmtDistance, fmtDuration } from '../lib/format';
import type { TripSummary } from '../lib/types';
import { SimBadge, StateBadge } from './ui';

export function TripSummaryView({ summary }: { summary: TripSummary }) {
  const t = summary.totals;
  const stats: [string, string][] = [
    ['Junctions', String(t.signals)],
    ['Alerted', String(t.alerted)],
    ['Acknowledged', String(t.acknowledged)],
    ['Escalated', String(t.escalated)],
    ['Avg response', t.avgResponseS === null ? '—' : `${t.avgResponseS} s`],
    ['Stops', String(summary.stops)],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-slate-600">
        <span>
          Trip #{summary.tripId} · {fmtDistance(summary.distanceM)} in {fmtDuration(summary.durationS)} · {summary.endReason.replace(/_/g, ' ')}
        </span>
        {summary.simulated && <SimBadge />}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white p-3 text-center shadow-sm">
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-sm text-slate-500">{k}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-base">
          <thead className="bg-slate-50 text-sm text-slate-500">
            <tr>
              <th className="p-3">#</th>
              <th className="p-3">Junction</th>
              <th className="p-3">Rule</th>
              <th className="p-3">Alerted at</th>
              <th className="p-3">Response</th>
              <th className="p-3">Warning before crossing</th>
              <th className="p-3">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {summary.signals.map((s) => (
              <tr key={s.code} className="border-t border-slate-100">
                <td className="p-3">{s.order}</td>
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3">{s.trigger ?? '—'}</td>
                <td className="p-3 whitespace-nowrap">
                  {s.alertDistanceM === null ? '—' : `${fmtDistance(s.alertDistanceM)} / ${s.alertEtaS} s`}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {s.responseS === null ? '—' : `${s.responseS} s`}
                  {s.escalated && <span className="ml-2 text-red-700">escalated</span>}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {s.skipped ? <span className="text-slate-500">skipped (demo)</span> : s.leadTimeS === null ? '—' : `${s.leadTimeS} s`}
                </td>
                <td className="p-3">
                  <StateBadge state={s.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 p-4">
        <p className="text-lg font-bold text-violet-900">
          Simulated time saved: ~{fmtDuration(summary.timeSaved.valueS)}
        </p>
        <p className="text-sm text-violet-800">{summary.timeSaved.assumption}</p>
      </div>
    </div>
  );
}
