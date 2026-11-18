// Officer-side alarm: siren via Web Audio (no asset to load or fail), vibration,
// and a screen wake lock. Browsers only allow audio/vibration after a user tap,
// which is why the officer taps "Start duty" first.

let ctx: AudioContext | null = null;
let siren: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null = null;
let vibrateTimer: number | null = null;

/** Must be called from a user gesture (the "Start duty" tap). */
export function unlockAudio(): boolean {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

// Several dashboards can share one page (demo grid). The siren plays while any
// of them wants it, so one card going quiet can't silence another that's alerting.
const wanting = new Set<string>();
export function setSirenWanted(owner: string, wanted: boolean, volume = 0.25) {
  if (wanted) wanting.add(owner);
  else wanting.delete(owner);
  if (wanting.size > 0) startSiren(volume);
  else stopSiren();
}

function startSiren(volume: number) {
  if (!ctx || siren) return;
  // Two-tone wail: a square LFO swings the carrier between ~650 and ~950 Hz.
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 800;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 1.6;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 150;
  lfo.connect(lfoGain).connect(osc.frequency);
  const gain = ctx.createGain();
  gain.gain.value = volume;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  lfo.start();
  siren = { osc, gain, lfo };

  if ('vibrate' in navigator) {
    navigator.vibrate([400, 200, 400]);
    vibrateTimer = window.setInterval(() => navigator.vibrate([400, 200, 400]), 1500);
  }
}

function stopSiren() {
  if (siren) {
    siren.osc.stop();
    siren.lfo.stop();
    siren = null;
  }
  if (vibrateTimer !== null) {
    clearInterval(vibrateTimer);
    vibrateTimer = null;
    navigator.vibrate?.(0);
  }
}

/** Short confirmation chirp after acknowledging. */
export function chirp() {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = 1200;
  g.gain.setValueAtTime(0.2, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.25);
}

/** Keep the officer's screen on while on duty, where supported. */
export async function keepAwake(): Promise<(() => void) | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock) return null;
    let lock = await nav.wakeLock.request('screen');
    // Locks are dropped when the tab is hidden; re-acquire on return.
    const onVis = async () => {
      if (document.visibilityState === 'visible') lock = await nav.wakeLock!.request('screen');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock.release();
    };
  } catch {
    return null;
  }
}
