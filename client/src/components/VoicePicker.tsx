import { Volume2, VolumeX } from 'lucide-react';
import { LANGS, setLang, setVoiceOn, speak, useVoicePrefs, type Lang } from '../lib/voice';

/**
 * Voice language + on/off. Tapping a language also plays a short sample, which
 * doubles as the user gesture browsers require before speech is allowed.
 */
export function VoicePicker({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const { lang, on, supported, available } = useVoicePrefs();
  if (!supported) return compact ? null : <p className="text-xs text-slate-500">Voice alerts aren't supported in this browser.</p>;

  const choose = (l: Lang) => {
    setLang(l);
    if (!on) setVoiceOn(true);
    speak((p) => p.voiceOn, { interrupt: true, force: true });
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setVoiceOn(!on)}
          aria-pressed={on}
          aria-label={on ? 'Turn voice alerts off' : 'Turn voice alerts on'}
          className={`grid shrink-0 place-items-center rounded-lg ring-1 ring-white/10 ${compact ? 'h-8 w-8' : 'h-10 w-10'} ${on ? 'bg-white/10 text-white' : 'bg-transparent text-slate-500'}`}
        >
          {on ? <Volume2 size={compact ? 15 : 18} /> : <VolumeX size={compact ? 15 : 18} />}
        </button>
        <div className="flex rounded-lg bg-white/5 p-0.5 ring-1 ring-white/10" role="group" aria-label="Voice language">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => choose(l.code)}
              aria-pressed={lang === l.code}
              title={l.label}
              className={`rounded-md font-semibold transition ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${lang === l.code && on ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
            >
              {compact ? l.short : l.label}
            </button>
          ))}
        </div>
      </div>
      {!compact && on && !available && lang !== 'en' && (
        <p className="text-xs text-amber-200">
          No {LANGS.find((l) => l.code === lang)!.label} voice on this device. Using English; install it in your phone's text-to-speech settings.
        </p>
      )}
    </div>
  );
}
