import type { Session } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Human-readable text for the error codes the server returns. */
const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong email or password.',
  trip_already_active: 'You already have an active trip.',
  not_your_junction: 'This alert is not for your junction.',
  already_passed: 'The ambulance has already passed this junction.',
  alert_not_active: 'This alert is no longer active.',
  trip_not_active: 'This trip has ended.',
  simulation_not_running: 'The simulation is no longer running.',
  join_link_expired: 'This join link has expired.',
  no_officer_for_signal: 'No officer is assigned to that junction.',
  not_found: 'This feature is only available in demo mode.',
  network: 'No connection to the server.',
};
export const errorText = (e: unknown) =>
  e instanceof ApiError ? (MESSAGES[e.code] ?? e.message) : e instanceof Error ? e.message : 'Something went wrong';

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message);
  return data as T;
}

export const demoLogin = (email: string) => api<Session & { role: string }>('/demo/login', { body: { email } });
export const login = (email: string, password: string) => api<Session & { role: string }>('/auth/login', { body: { email, password } });
