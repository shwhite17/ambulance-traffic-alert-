import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Send, Sparkles, Square } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { LANGS, getLang } from '../lib/voice';
import type { Session, TripView } from '../lib/types';
import { BriefCard } from './BriefCard';
import { Button, ErrorBanner } from './ui';

// Browser speech-to-text (Chrome/Edge). Not in TS's DOM lib, so typed minimally.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
const SpeechRecognitionCtor = (): (new () => SpeechRecognitionLike) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Realistic sample notes, so the demo works even in a noisy hall. */
const SAMPLES = [
  {
    label: 'Hindi · chest pain',
    text: 'मरीज़ लगभग 58 साल का पुरुष है। 40 मिनट से सीने में तेज़ दर्द है जो बाएँ हाथ तक जा रहा है। बहुत पसीना आ रहा है। बीपी 90 बाय 60, पल्स 112। होश में है।',
  },
  {
    label: 'English · road accident',
    text: 'Female around 30, two-wheeler accident, no helmet. Head injury with bleeding, drowsy, GCS 12. BP 100 over 70, pulse 120. Suspected left thigh fracture.',
  },
  {
    label: 'Kannada · stroke',
    text: 'ಸುಮಾರು 65 ವರ್ಷದ ಮಹಿಳೆ. ಒಂದು ಗಂಟೆ ಹಿಂದೆ ಬಲಗೈ ಮತ್ತು ಬಲಗಾಲು ದುರ್ಬಲವಾಗಿದೆ, ಮಾತು ತೊದಲುತ್ತಿದೆ. ಬಿಪಿ 180 ಬೈ 100, ಶುಗರ್ 140.',
  },
];

/**
 * AI Paramedic Copilot input: speak (in the selected voice language) or type
 * the patient handover; Claude turns it into a structured brief for the hospital.
 */
export function BriefComposer({ session, trip, onSent }: { session: Session; trip: TripView; onSent?: (t: TripView) => void }) {
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const Ctor = SpeechRecognitionCtor();
  const langInfo = LANGS.find((l) => l.code === getLang())!;

  useEffect(() => () => recRef.current?.stop(), []);

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = langInfo.bcp47;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = '';
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else partial += r[0].transcript;
      }
      if (finalText) setText((t) => (t ? `${t} ${finalText.trim()}` : finalText.trim()));
      setInterim(partial);
    };
    rec.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone permission was blocked.' : `Speech recognition: ${e.error}`);
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    setError(null);
    rec.start();
    setListening(true);
  };

  const send = async () => {
    recRef.current?.stop();
    setBusy(true);
    setError(null);
    try {
      onSent?.(await api<TripView>(`/trips/${trip.id}/brief`, { body: { transcript: text.trim() }, token: session.token }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
          <Sparkles size={20} />
        </span>
        <div>
          <p className="font-bold">Paramedic Copilot</p>
          <p className="text-sm text-slate-400">
            Describe the patient in any language. AI turns it into a pre-arrival brief so {trip.hospital.name} is ready before you arrive.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggleMic}
          disabled={!Ctor || busy}
          aria-pressed={listening}
          className={`grid h-16 w-16 shrink-0 place-items-center rounded-full transition disabled:opacity-40 ${listening ? 'pulse-ring bg-emergency text-white' : 'bg-white text-slate-900'}`}
          style={listening ? { color: '#e5383b' } : undefined}
          aria-label={listening ? 'Stop recording' : 'Start recording'}
        >
          {listening ? <Square size={22} className="text-white" /> : <Mic size={26} />}
        </button>
        <p className="text-sm text-slate-400">
          {!Ctor
            ? 'Voice input isn’t supported in this browser. Type the note, or use Chrome or Edge.'
            : listening
              ? `Listening in ${langInfo.label}… tap to stop`
              : `Tap and speak in ${langInfo.label} (change the language with the voice picker).`}
        </p>
      </div>

      <div>
        <textarea
          value={text + (interim ? (text ? ' ' : '') + interim : '')}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="e.g. Male around 58, chest pain for 40 minutes, BP 90/60, sweating…"
          className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400"
        />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button key={s.label} onClick={() => setText(s.text)} className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-white/10">
              Sample: {s.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Don't say names, phone numbers or addresses. The AI also strips them.</p>
      </div>

      <ErrorBanner error={error} />
      <Button variant="primary" className="w-full" disabled={busy || text.trim().length < 10} onClick={send}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        {busy ? 'AI is preparing the brief…' : 'Send brief to hospital'}
      </Button>

      {trip.brief && (
        <div>
          <p className="mb-2 eyebrow text-slate-400 uppercase">Sent to hospital</p>
          <BriefCard brief={trip.brief} />
        </div>
      )}
    </div>
  );
}
