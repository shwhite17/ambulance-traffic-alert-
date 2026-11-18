// Spoken alerts using the device's built-in text-to-speech (Web Speech API):
// free, no network, works with the screen on. Not every phone has every
// Indian language installed, so we detect that and fall back to English.
//
// TRANSLATIONS: written carefully but NOT yet reviewed by native speakers.
// Please have Hindi, Kannada and Marathi lines checked before the final demo.

import { useEffect, useState } from 'react';
import { duckSiren } from './alarm';

export type Lang = 'en' | 'hi' | 'kn' | 'mr';

export const LANGS: { code: Lang; label: string; short: string; bcp47: string }[] = [
  { code: 'en', label: 'English', short: 'EN', bcp47: 'en-IN' },
  { code: 'hi', label: 'हिन्दी', short: 'हि', bcp47: 'hi-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ', short: 'ಕ', bcp47: 'kn-IN' },
  { code: 'mr', label: 'मराठी', short: 'म', bcp47: 'mr-IN' },
];

const DIRS: Record<Lang, Record<string, string>> = {
  en: { north: 'north', 'north-east': 'north-east', east: 'east', 'south-east': 'south-east', south: 'south', 'south-west': 'south-west', west: 'west', 'north-west': 'north-west' },
  hi: { north: 'उत्तर', 'north-east': 'उत्तर-पूर्व', east: 'पूर्व', 'south-east': 'दक्षिण-पूर्व', south: 'दक्षिण', 'south-west': 'दक्षिण-पश्चिम', west: 'पश्चिम', 'north-west': 'उत्तर-पश्चिम' },
  kn: { north: 'ಉತ್ತರ', 'north-east': 'ಈಶಾನ್ಯ', east: 'ಪೂರ್ವ', 'south-east': 'ಆಗ್ನೇಯ', south: 'ದಕ್ಷಿಣ', 'south-west': 'ನೈಋತ್ಯ', west: 'ಪಶ್ಚಿಮ', 'north-west': 'ವಾಯವ್ಯ' },
  mr: { north: 'उत्तर', 'north-east': 'उत्तर-पूर्व', east: 'पूर्व', 'south-east': 'दक्षिण-पूर्व', south: 'दक्षिण', 'south-west': 'दक्षिण-पश्चिम', west: 'पश्चिम', 'north-west': 'उत्तर-पश्चिम' },
};

interface Phrases {
  voiceOn: string;
  alert: (dir: string, secs: number) => string;
  backupAlert: (dir: string, secs: number) => string;
  countdown: (secs: number) => string;
  escalated: string;
  acknowledged: string;
  passed: string;
  driverAlerted: (n: number) => string;
  driverClearing: (n: number) => string;
  driverEscalated: (n: number) => string;
  driverAllPassed: string;
  driverArriving: string;
  citizenWarn: (secs: number) => string;
  citizenPassed: string;
}

export const PHRASES: Record<Lang, Phrases> = {
  en: {
    voiceOn: 'Voice alerts are on.',
    alert: (d, s) => `Ambulance approaching from the ${d}. ${s} seconds away. Please clear the lane.`,
    backupAlert: (d, s) => `Backup alert. Ambulance approaching from the ${d}. ${s} seconds away. Please respond.`,
    countdown: (s) => `${s} seconds.`,
    escalated: 'No response. Backup officer has been alerted. Please acknowledge now.',
    acknowledged: 'Acknowledged. Clear the lane.',
    passed: 'Ambulance has passed. Thank you.',
    driverAlerted: (n) => `Junction ${n}: officer alerted.`,
    driverClearing: (n) => `Junction ${n}: lane is being cleared.`,
    driverEscalated: (n) => `Junction ${n}: no response. Backup notified.`,
    driverAllPassed: 'All junctions passed.',
    driverArriving: 'Arriving at the hospital.',
    citizenWarn: (s) => `Ambulance behind you, ${s} seconds away. Please move to the left.`,
    citizenPassed: 'Thank you for clearing the way.',
  },
  hi: {
    voiceOn: 'आवाज़ अलर्ट चालू हैं।',
    alert: (d, s) => `एम्बुलेंस ${d} दिशा से आ रही है। ${s} सेकंड में पहुँचेगी। कृपया रास्ता खाली कराएँ।`,
    backupAlert: (d, s) => `बैकअप अलर्ट। एम्बुलेंस ${d} दिशा से आ रही है। ${s} सेकंड में पहुँचेगी। कृपया जवाब दें।`,
    countdown: (s) => `${s} सेकंड।`,
    escalated: 'कोई जवाब नहीं मिला। बैकअप अधिकारी को सूचित किया गया है। कृपया अभी पुष्टि करें।',
    acknowledged: 'पुष्टि हो गई। रास्ता खाली कराएँ।',
    passed: 'एम्बुलेंस निकल गई। धन्यवाद।',
    driverAlerted: (n) => `जंक्शन ${n}: अधिकारी को सूचित किया गया।`,
    driverClearing: (n) => `जंक्शन ${n}: रास्ता खाली कराया जा रहा है।`,
    driverEscalated: (n) => `जंक्शन ${n}: कोई जवाब नहीं। बैकअप को सूचित किया गया।`,
    driverAllPassed: 'सभी जंक्शन पार हो गए।',
    driverArriving: 'अस्पताल पहुँच रहे हैं।',
    citizenWarn: (s) => `आपके पीछे एम्बुलेंस है, ${s} सेकंड में पहुँचेगी। कृपया बाईं ओर हो जाएँ।`,
    citizenPassed: 'रास्ता देने के लिए धन्यवाद।',
  },
  kn: {
    voiceOn: 'ಧ್ವನಿ ಎಚ್ಚರಿಕೆಗಳು ಆನ್ ಆಗಿವೆ.',
    alert: (d, s) => `ಆಂಬ್ಯುಲೆನ್ಸ್ ${d} ದಿಕ್ಕಿನಿಂದ ಬರುತ್ತಿದೆ. ${s} ಸೆಕೆಂಡುಗಳಲ್ಲಿ ತಲುಪುತ್ತದೆ. ದಯವಿಟ್ಟು ದಾರಿ ತೆರವುಗೊಳಿಸಿ.`,
    backupAlert: (d, s) => `ಬ್ಯಾಕಪ್ ಎಚ್ಚರಿಕೆ. ಆಂಬ್ಯುಲೆನ್ಸ್ ${d} ದಿಕ್ಕಿನಿಂದ ಬರುತ್ತಿದೆ. ${s} ಸೆಕೆಂಡುಗಳಲ್ಲಿ ತಲುಪುತ್ತದೆ. ದಯವಿಟ್ಟು ಪ್ರತಿಕ್ರಿಯಿಸಿ.`,
    countdown: (s) => `${s} ಸೆಕೆಂಡುಗಳು.`,
    escalated: 'ಪ್ರತಿಕ್ರಿಯೆ ಸಿಗಲಿಲ್ಲ. ಬ್ಯಾಕಪ್ ಅಧಿಕಾರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಈಗ ದೃಢೀಕರಿಸಿ.',
    acknowledged: 'ದೃಢೀಕರಿಸಲಾಗಿದೆ. ದಾರಿ ತೆರವುಗೊಳಿಸಿ.',
    passed: 'ಆಂಬ್ಯುಲೆನ್ಸ್ ಹಾದುಹೋಯಿತು. ಧನ್ಯವಾದಗಳು.',
    driverAlerted: (n) => `ಜಂಕ್ಷನ್ ${n}: ಅಧಿಕಾರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
    driverClearing: (n) => `ಜಂಕ್ಷನ್ ${n}: ದಾರಿ ತೆರವುಗೊಳಿಸಲಾಗುತ್ತಿದೆ.`,
    driverEscalated: (n) => `ಜಂಕ್ಷನ್ ${n}: ಪ್ರತಿಕ್ರಿಯೆ ಇಲ್ಲ. ಬ್ಯಾಕಪ್‌ಗೆ ತಿಳಿಸಲಾಗಿದೆ.`,
    driverAllPassed: 'ಎಲ್ಲಾ ಜಂಕ್ಷನ್‌ಗಳನ್ನು ದಾಟಲಾಗಿದೆ.',
    driverArriving: 'ಆಸ್ಪತ್ರೆಗೆ ತಲುಪುತ್ತಿದ್ದೇವೆ.',
    citizenWarn: (s) => `ನಿಮ್ಮ ಹಿಂದೆ ಆಂಬ್ಯುಲೆನ್ಸ್ ಇದೆ, ${s} ಸೆಕೆಂಡುಗಳಲ್ಲಿ ತಲುಪುತ್ತದೆ. ದಯವಿಟ್ಟು ಎಡಕ್ಕೆ ಸರಿಯಿರಿ.`,
    citizenPassed: 'ದಾರಿ ಬಿಟ್ಟುಕೊಟ್ಟಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.',
  },
  mr: {
    voiceOn: 'आवाज सूचना सुरू आहेत.',
    alert: (d, s) => `रुग्णवाहिका ${d} दिशेने येत आहे. ${s} सेकंदात पोहोचेल. कृपया रस्ता मोकळा करा.`,
    backupAlert: (d, s) => `बॅकअप सूचना. रुग्णवाहिका ${d} दिशेने येत आहे. ${s} सेकंदात पोहोचेल. कृपया प्रतिसाद द्या.`,
    countdown: (s) => `${s} सेकंद.`,
    escalated: 'प्रतिसाद मिळाला नाही. बॅकअप अधिकाऱ्याला कळवले आहे. कृपया आता पुष्टी करा.',
    acknowledged: 'पुष्टी झाली. रस्ता मोकळा करा.',
    passed: 'रुग्णवाहिका पुढे गेली. धन्यवाद.',
    driverAlerted: (n) => `जंक्शन ${n}: अधिकाऱ्याला कळवले.`,
    driverClearing: (n) => `जंक्शन ${n}: रस्ता मोकळा केला जात आहे.`,
    driverEscalated: (n) => `जंक्शन ${n}: प्रतिसाद नाही. बॅकअपला कळवले.`,
    driverAllPassed: 'सर्व जंक्शन पार झाले.',
    driverArriving: 'रुग्णालयात पोहोचत आहोत.',
    citizenWarn: (s) => `तुमच्या मागे रुग्णवाहिका आहे, ${s} सेकंदात पोहोचेल. कृपया डावीकडे व्हा.`,
    citizenPassed: 'रस्ता दिल्याबद्दल धन्यवाद.',
  },
};

export const dirName = (lang: Lang, approachFrom: string | null) => DIRS[lang][approachFrom ?? ''] ?? DIRS.en[approachFrom ?? ''] ?? '';

// ── preferences (per device) ──
const LANG_KEY = 'ata.voice.lang';
const ON_KEY = 'ata.voice.on';
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

export const getLang = (): Lang => (localStorage.getItem(LANG_KEY) as Lang | null) ?? 'en';
export const getVoiceOn = (): boolean => localStorage.getItem(ON_KEY) !== 'false';
export function setLang(l: Lang) {
  localStorage.setItem(LANG_KEY, l);
  notify();
}
export function setVoiceOn(on: boolean) {
  localStorage.setItem(ON_KEY, String(on));
  if (!on) window.speechSynthesis?.cancel();
  notify();
}

// ── voices ──
const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

function findVoice(lang: Lang): SpeechSynthesisVoice | null {
  if (!supported()) return null;
  const want = LANGS.find((l) => l.code === lang)!.bcp47.toLowerCase();
  const voices = window.speechSynthesis.getVoices();
  const matches = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === want || v.lang.toLowerCase().startsWith(`${lang}-`) || v.lang.toLowerCase() === lang);
  // Prefer high-quality voices where the platform offers them.
  return matches.find((v) => /natural|neural|google/i.test(v.name)) ?? matches[0] ?? null;
}

export function hasVoice(lang: Lang): boolean {
  return findVoice(lang) !== null;
}

/** Re-renders when the voice list loads or preferences change. */
export function useVoicePrefs() {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    window.speechSynthesis?.addEventListener?.('voiceschanged', l);
    return () => {
      listeners.delete(l);
      window.speechSynthesis?.removeEventListener?.('voiceschanged', l);
    };
  }, []);
  const lang = getLang();
  return { lang, on: getVoiceOn(), supported: supported(), available: hasVoice(lang) };
}

/**
 * Speak a line. Falls back to an English voice/phrase when the chosen
 * language has no voice on this device. The siren is ducked while speaking.
 */
export function speak(build: (p: Phrases, lang: Lang) => string, opts: { interrupt?: boolean; force?: boolean } = {}) {
  if (!supported() || (!getVoiceOn() && !opts.force)) return;
  let lang = getLang();
  let voice = findVoice(lang);
  if (!voice && lang !== 'en') {
    lang = 'en';
    voice = findVoice('en');
  }
  const u = new SpeechSynthesisUtterance(build(PHRASES[lang], lang));
  u.lang = LANGS.find((l) => l.code === lang)!.bcp47;
  if (voice) u.voice = voice;
  u.rate = 0.95;
  u.onstart = () => duckSiren(true);
  u.onend = u.onerror = () => duckSiren(false);
  if (opts.interrupt) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
