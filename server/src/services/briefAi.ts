import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { HttpError } from '../auth.js';

/**
 * AI Paramedic Copilot: turns a spoken handover (any of en/hi/kn/mr, or mixed)
 * into a structured pre-arrival brief for the hospital.
 *
 * Deliberately OFF the alert path: junction alerts never wait on or depend on
 * this. It is decision support for the receiving team, labelled as such.
 */

export const PatientBrief = z.object({
  severity: z.enum(['critical', 'serious', 'stable']),
  category: z.enum(['cardiac', 'stroke', 'trauma', 'respiratory', 'obstetric', 'burns', 'poisoning', 'other']),
  suspectedCondition: z.string().describe('Short, hedged working impression, e.g. "Possible heart attack (STEMI)"'),
  patient: z.object({
    ageYears: z.number().nullable(),
    sex: z.enum(['male', 'female', 'unknown']),
  }),
  chiefComplaint: z.string(),
  onset: z.string().nullable().describe('When symptoms started, as stated, e.g. "40 minutes ago"'),
  vitals: z.object({
    bloodPressure: z.string().nullable().describe('As stated, e.g. "90/60"'),
    heartRate: z.number().nullable(),
    spo2: z.number().nullable(),
    respiratoryRate: z.number().nullable(),
    gcs: z.number().nullable(),
    bloodGlucose: z.number().nullable(),
  }),
  redFlags: z.array(z.string()),
  prepChecklist: z.array(z.string()).describe('Concrete things the emergency department should prepare before arrival'),
  missingInfo: z.array(z.string()).describe('Important facts the paramedic has not reported yet'),
  handoverSummary: z.string().describe('One or two sentence English handover for the receiving doctor'),
  detectedLanguage: z.string(),
});
export type PatientBrief = z.infer<typeof PatientBrief>;

export interface BriefGenerator {
  readonly configured: boolean;
  generate(transcript: string): Promise<PatientBrief>;
}

const SYSTEM = `You help ambulance paramedics in India hand over a patient to the receiving hospital before arrival.

The input is a paramedic's spoken note, transcribed by a phone. It may be in English, Hindi, Kannada or Marathi, mixed, informal, or contain speech-recognition errors. Produce a structured pre-arrival brief in English for the emergency department.

Rules:
- Use only facts stated in the note. If a vital sign or detail is not stated, return null for it. Never invent or estimate numbers.
- The suspected condition is a working impression for preparation, not a diagnosis: phrase it with "Possible" or "Suspected".
- Severity: critical = immediate threat to life or airway/breathing/circulation compromise; serious = needs urgent care but currently stable; stable = otherwise.
- The prep checklist should be short (3 to 6 items), practical for an Indian emergency department, and specific to the presentation (e.g. ECG on arrival, cath lab standby, CT ready, blood type and crossmatch, trauma bay).
- Missing info: list the most useful facts the paramedic has not given (e.g. blood pressure, blood glucose, time of onset, allergies).
- Leave out personal identifiers (names, phone numbers, addresses, ID numbers) even if they are spoken.
- Keep every string brief; this is read at a glance.`;

/**
 * TEST ONLY: deterministic stand-in so end-to-end tests can exercise the brief
 * flow without an API key. Never enabled in production (see index.ts).
 */
export class FakeBriefGenerator implements BriefGenerator {
  readonly configured = true;
  async generate(transcript: string): Promise<PatientBrief> {
    return {
      severity: 'critical',
      category: 'cardiac',
      suspectedCondition: 'Possible heart attack (STEMI) [TEST FAKE]',
      patient: { ageYears: 58, sex: 'male' },
      chiefComplaint: 'Chest pain radiating to left arm',
      onset: '40 minutes ago',
      vitals: { bloodPressure: '90/60', heartRate: 112, spo2: null, respiratoryRate: null, gcs: 15, bloodGlucose: null },
      redFlags: ['Hypotension', 'Diaphoresis'],
      prepChecklist: ['12-lead ECG on arrival', 'Cath lab standby', 'Cardiologist alert'],
      missingInfo: ['SpO2', 'Allergies'],
      handoverSummary: `58M, chest pain 40 min, BP 90/60, HR 112. (${transcript.length} chars received)`,
      detectedLanguage: 'test',
    };
  }
}

/** Upper bound on what we send: a spoken handover is short. */
export const MAX_TRANSCRIPT_CHARS = 2_000;

export class ClaudeBriefGenerator implements BriefGenerator {
  private readonly client: Anthropic | null;

  constructor(apiKey: string | undefined) {
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 }) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async generate(transcript: string): Promise<PatientBrief> {
    if (!this.client) throw new HttpError(503, 'ai_not_configured', 'AI briefs are not configured on this server');
    try {
      const response = await this.client.beta.messages.parse({
        model: 'claude-opus-5-5',
        max_tokens: 4_000,
        // Short extraction; the hospital wants it in seconds.
        output_config: { effort: 'low', format: betaZodOutputFormat(PatientBrief) },
        // If the model declines (e.g. a classifier false positive on medical content), retry on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: `Paramedic's note:\n"""${transcript}"""` }],
      });
      if (response.stop_reason === 'refusal') throw new HttpError(422, 'ai_declined', 'The AI declined to process this note');
      if (!response.parsed_output) throw new HttpError(502, 'ai_bad_output', 'The AI response could not be read');
      return response.parsed_output;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'ai_busy', 'AI is busy, try again in a moment');
      if (err instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'ai_not_configured', 'AI key is invalid');
      if (err instanceof Anthropic.APIError) throw new HttpError(502, 'ai_unavailable', `AI service error (${err.status ?? 'network'})`);
      throw err;
    }
  }
}
