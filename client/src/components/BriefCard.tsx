import { useState } from 'react';
import { Activity, AlertTriangle, Brain, Baby, Bone, CircleHelp, ClipboardList, Flame, HeartPulse, Sparkles, Stethoscope, Wind, FlaskConical } from 'lucide-react';
import { fmtTime } from '../lib/format';
import type { TripBrief } from '../lib/types';

const SEVERITY: Record<TripBrief['severity'], { label: string; cls: string }> = {
  critical: { label: 'CRITICAL', cls: 'bg-emergency text-white' },
  serious: { label: 'SERIOUS', cls: 'bg-warn text-slate-950' },
  stable: { label: 'STABLE', cls: 'bg-ok text-slate-950' },
};

const CATEGORY_ICON: Record<TripBrief['category'], typeof HeartPulse> = {
  cardiac: HeartPulse,
  stroke: Brain,
  trauma: Bone,
  respiratory: Wind,
  obstetric: Baby,
  burns: Flame,
  poisoning: FlaskConical,
  other: Stethoscope,
};

/** The AI pre-arrival brief as the receiving team sees it. Decision support, clearly labelled. */
export function BriefCard({ brief }: { brief: TripBrief }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const sev = SEVERITY[brief.severity];
  const Icon = CATEGORY_ICON[brief.category] ?? Stethoscope;
  const v = brief.vitals;
  const vitals: [string, string | number | null][] = [
    ['BP', v.bloodPressure],
    ['HR', v.heartRate],
    ['SpO₂', v.spo2 === null ? null : `${v.spo2}%`],
    ['RR', v.respiratoryRate],
    ['GCS', v.gcs],
    ['Glucose', v.bloodGlucose],
  ];
  const patient = [brief.patient.ageYears ? `${brief.patient.ageYears} y` : null, brief.patient.sex !== 'unknown' ? brief.patient.sex : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
      <div className={`flex items-center gap-3 px-4 py-3 ${sev.cls}`}>
        <Icon size={26} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow font-semibold">{sev.label} · {brief.category.toUpperCase()}</p>
          <p className="truncate text-lg leading-tight font-bold">{brief.suspectedCondition}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-[11px] font-semibold">
          <Sparkles size={12} /> AI brief
        </span>
      </div>

      <div className="space-y-3 bg-white/[0.03] p-4 text-sm">
        <p className="text-slate-200">
          <span className="font-semibold text-white">{brief.chiefComplaint}</span>
          {brief.onset && <span className="text-slate-400"> · since {brief.onset}</span>}
          {patient && <span className="text-slate-400"> · {patient}</span>}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {vitals.map(([k, val]) => (
            <span key={k} className={`tabular rounded-lg px-2 py-1 text-xs ring-1 ${val === null ? 'text-slate-500 ring-white/5' : 'bg-white/5 font-semibold text-white ring-white/10'}`}>
              {k} {val ?? '—'}
            </span>
          ))}
        </div>

        {brief.redFlags.length > 0 && (
          <div className="rounded-xl bg-red-500/10 p-3 ring-1 ring-red-500/25">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-red-200 uppercase">
              <AlertTriangle size={13} /> Red flags
            </p>
            <ul className="list-inside list-disc text-red-100">
              {brief.redFlags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            <ClipboardList size={13} /> Prepare before arrival
          </p>
          <ul className="space-y-1">
            {brief.prepChecklist.map((item, i) => (
              <li key={item}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-emerald-500"
                    checked={done.has(i)}
                    onChange={() =>
                      setDone((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                  />
                  <span className={done.has(i) ? 'text-slate-500 line-through' : 'text-slate-100'}>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        {brief.missingInfo.length > 0 && (
          <p className="flex gap-1.5 text-xs text-amber-200">
            <CircleHelp size={14} className="mt-0.5 shrink-0" />
            <span>
              <b>Ask the crew:</b> {brief.missingInfo.join(', ')}
            </span>
          </p>
        )}

        <p className="flex gap-1.5 rounded-xl bg-white/5 p-3 text-slate-200">
          <Activity size={15} className="mt-0.5 shrink-0 text-info" />
          {brief.handoverSummary}
        </p>

        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer">Paramedic's words ({brief.detectedLanguage})</summary>
          <p className="mt-1 rounded-lg bg-black/20 p-2 text-slate-300">“{brief.transcript}”</p>
        </details>

        <p className="text-[11px] text-slate-500">
          AI-generated from the paramedic's spoken note at {fmtTime(brief.at)}. Decision support only; confirm clinically.
        </p>
      </div>
    </div>
  );
}
