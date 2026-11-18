import { APP_NAME } from '../lib/brand';

/** Mark: a road corridor with a pulse line, inside a rounded shield. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5a5f" />
          <stop offset="1" stopColor="#b3141a" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lg)" />
      <path d="M10 36h12l5-12 8 22 6-14 3 4h10" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={compact ? 28 : 34} />
      <span className="leading-tight">
        <span className={`block font-bold tracking-tight text-white ${compact ? 'text-base' : 'text-lg'}`}>{APP_NAME}</span>
        {!compact && <span className="block text-[11px] font-medium tracking-[0.18em] text-slate-400 uppercase">Green corridor network</span>}
      </span>
    </span>
  );
}
