import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Car, Check, Copy, Plus, Siren, Smartphone, TriangleAlert, Volume2, X } from 'lucide-react';
import { api, errorText } from '../lib/api';
import type { CitizenView, RouteInfo, Session } from '../lib/types';
import { Button } from './ui';

interface JoinLink {
  token: string;
  signal: { id: number; name: string };
  expiresAt: number;
}

type Tab = 'officer' | 'cars';

const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
// Low error correction = fewer, bigger modules: easier to scan off a projector from the audience.
const toQr = (url: string) => QRCode.toDataURL(url, { width: 520, margin: 1, errorCorrectionLevel: 'L', color: { dark: '#0b1120', light: '#ffffff' } });

/**
 * Big QR for the audience. "Officer": the phone becomes a junction's traffic
 * officer. "Cars": the phone becomes a car on the corridor (Citizen Corridor).
 */
export function JudgeMode({
  session,
  route,
  presence,
  cars,
  onClose,
}: {
  session: Session;
  route: RouteInfo;
  presence: Record<number, number>;
  cars: CitizenView[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('officer');
  // J3 by default: mid-route, so it rings during a normal demo run.
  const [signalId, setSignalId] = useState(route.signals[2]?.id ?? route.signals[0]?.id);
  const [link, setLink] = useState<JoinLink | null>(null);
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setQr(null);
    setError(null);
    const make = async () => {
      if (tab === 'cars') {
        const u = `${window.location.origin}/car/${route.id}`;
        return { u, l: null };
      }
      if (!signalId) throw new Error('No junction selected');
      const l = await api<JoinLink>('/demo/join-link', { body: { signalId }, token: session.token });
      return { u: `${window.location.origin}/join/${l.token}`, l };
    };
    make()
      .then(async ({ u, l }) => {
        const img = await toQr(u);
        if (cancelled) return;
        setLink(l);
        setUrl(u);
        setQr(img);
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [tab, signalId, route.id, session.token]);

  const onDuty = signalId ? (presence[signalId] ?? 0) : 0;
  const realCars = cars.filter((c) => !c.simulated).length;
  const simCars = cars.length - realCars;

  const addSimulated = async () => {
    setAdding(true);
    setError(null);
    try {
      await api('/demo/citizens', { body: { routeId: route.id, count: 20 }, token: session.token });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Judge mode">
      <div className="panel grid w-full max-w-4xl gap-6 p-6 md:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-3">
          <div className="grid h-[300px] w-[300px] place-items-center rounded-2xl bg-white p-3 shadow-[0_0_60px_-10px_rgb(255_255_255/0.35)]">
            {qr ? <img src={qr} alt={tab === 'cars' ? 'QR code to join as a car' : 'QR code to join as traffic officer'} className="h-full w-full" /> : <span className="text-sm text-slate-500">{error ? '—' : 'Generating…'}</span>}
          </div>
          {tab === 'officer' ? (
            <span className="flex items-center gap-2 rounded-full bg-ok/10 px-3 py-1 text-sm font-semibold text-emerald-200 ring-1 ring-ok/30">
              <Smartphone size={15} />
              <span className="tabular">{onDuty}</span> phone{onDuty === 1 ? '' : 's'} on duty here
            </span>
          ) : (
            <span className="flex items-center gap-2 rounded-full bg-ok/10 px-3 py-1 text-sm font-semibold text-emerald-200 ring-1 ring-ok/30">
              <Car size={15} />
              <span className="tabular">{realCars}</span> audience car{realCars === 1 ? '' : 's'}
              {simCars > 0 && <span className="text-emerald-300/70">+ {simCars} simulated</span>}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10" role="tablist" aria-label="Who joins">
              {(
                [
                  ['officer', 'Traffic officer', Siren],
                  ['cars', 'Cars (audience)', Car],
                ] as const
              ).map(([t, label, Icon]) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'}`}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={onClose} aria-label="Close">
              <X size={18} />
            </Button>
          </div>

          {tab === 'officer' ? (
            <>
              <div>
                <h2 className="text-3xl leading-tight font-bold">Scan to become the traffic officer</h2>
                <p className="mt-1 text-slate-400">Your phone will flash and ring when the ambulance approaches this junction.</p>
              </div>
              <div>
                <p className="mb-2 eyebrow text-slate-400 uppercase">Junction</p>
                <div className="flex flex-wrap gap-2">
                  {route.signals.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSignalId(s.id)}
                      aria-pressed={s.id === signalId}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${s.id === signalId ? 'bg-white text-slate-900' : 'bg-white/5 ring-1 ring-white/10 hover:bg-white/10'}`}
                    >
                      J{s.order}
                      {(presence[s.id] ?? 0) > 0 && <span className="rounded-full bg-ok px-1.5 text-xs text-slate-950">{presence[s.id]}</span>}
                    </button>
                  ))}
                </div>
                {link && <p className="mt-2 text-sm text-slate-300">{link.signal.name}</p>}
              </div>
              <ol className="space-y-1.5 text-sm text-slate-300">
                <li><b className="text-white">1.</b> Scan with your phone camera</li>
                <li><b className="text-white">2.</b> Tap <b className="text-white">Start duty</b> (this enables the alarm sound)</li>
                <li className="flex items-center gap-1.5"><b className="text-white">3.</b> Keep the page open, volume up <Volume2 size={14} /></li>
              </ol>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-3xl leading-tight font-bold">Everyone: you're now a car on {route.city}'s road</h2>
                <p className="mt-1 text-slate-400">
                  Most junctions have no officer. When the ambulance comes up behind you, your phone tells you to move left, about 30 seconds ahead.
                </p>
              </div>
              <ol className="space-y-1.5 text-sm text-slate-300">
                <li><b className="text-white">1.</b> Scan with your phone camera</li>
                <li><b className="text-white">2.</b> Tap <b className="text-white">Turn on ambulance alerts</b></li>
                <li><b className="text-white">3.</b> Watch the map: each car lights up as the ambulance reaches it</li>
              </ol>
              <Button variant="ghost" className="self-start" onClick={addSimulated} disabled={adding}>
                <Plus size={16} /> Add 20 simulated cars
              </Button>
            </>
          )}

          {isLocal() && (
            <p className="flex gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-100 ring-1 ring-amber-500/30">
              <TriangleAlert size={18} className="shrink-0" />
              <span>
                This QR points to <b>localhost</b>, which phones can't open. Use the deployed link for the live demo.
              </span>
            </p>
          )}
          {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">{error}</p>}

          {url && (
            <div className="mt-auto flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-400">{url}</code>
              <Button
                variant="ghost"
                className="min-h-9 text-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(url).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}
          {tab === 'officer' && link && <p className="text-xs text-slate-500">Link valid until {new Date(link.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>}
        </div>
      </div>
    </div>
  );
}
