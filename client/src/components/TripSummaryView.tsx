import { Ambulance, Clock, OctagonAlert, ShieldCheck, Timer, TrafficCone } from 'lucide-react';
import { fmtDistance, fmtDuration } from '../lib/format';
import type { TripSummary } from '../lib/types';
import { Kpi, SimBadge, StateBadge } from './ui';

export function TripSummaryView({ summary }: { summary: TripSummary }) {
  const t = summary.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <Ambulance size={16} />
        <span>
          Trip #{summary.tripId} · {fmtDistance(summary.distanceM)} in {fmtDuration(summary.durationS)} · {summary.endReason.replace(/_/g, ' ')}
        </span>
        {summary.simulated && <SimBadge />}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi icon={ShieldCheck} label="Acknowledged" value={`${t.acknowledged}/${t.signals}`} tone="ok" />
        <Kpi icon={Timer} label="Avg response" value={t.avgResponseS === null ? '—' : `${t.avgResponseS} s`} />
        <Kpi icon={OctagonAlert} label="Escalated" value={t.escalated} tone={t.escalated ? 'danger' : 'default'} />
        <Kpi icon={TrafficCone} label="Stops on route" value={summary.stops} tone={summary.stops ? 'warn' : 'ok'} />
        <Kpi icon={Clock} label="Junctions alerted" value={`${t.alerted}/${t.signals}`} tone="warn" />
        <Kpi icon={Ambulance} label="Trip time" value={fmtDuration(summary.durationS)} />
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs tracking-wider text-slate-500 uppercase">
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
          <tbody className="text-slate-200">
            {summary.signals.map((s) => (
              <tr key={s.code} className="border-t border-line">
                <td className="p-3 text-slate-500">{s.order}</td>
                <td className="p-3 font-medium text-white">{s.name}</td>
                <td className="p-3">{s.trigger ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs uppercase">{s.trigger}</span> : '—'}</td>
                <td className="tabular p-3 whitespace-nowrap">{s.alertDistanceM === null ? '—' : `${fmtDistance(s.alertDistanceM)} / ${s.alertEtaS} s`}</td>
                <td className="tabular p-3 whitespace-nowrap">
                  {s.responseS === null ? '—' : `${s.responseS} s`}
                  {s.escalated && <span className="ml-2 text-red-300">escalated</span>}
                </td>
                <td className="tabular p-3 whitespace-nowrap">
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
      <div className="rounded-2xl border border-dashed border-violet-400/40 bg-violet-500/10 p-4">
        <p className="text-lg font-bold text-violet-200">Simulated time saved: ~{fmtDuration(summary.timeSaved.valueS)}</p>
        <p className="mt-1 text-sm text-violet-300/80">{summary.timeSaved.assumption}</p>
      </div>
    </div>
  );
}
