import { haversineM, type RouteGeometry } from './geo.js';
import type { LngLat, LocationPing } from './types.js';

export interface PipelineConfig {
  speedWindowMs: number;
  minSpeedMps: number;
  maxPlausibleSpeedMps: number;
  lowAccuracyM: number;
  offRouteM: number;
}

export type RejectReason = 'out_of_order' | 'implausible_jump';

export type PipelineResult =
  | { accepted: false; reason: RejectReason }
  | {
      accepted: true;
      ts: number;
      raw: LngLat;
      snapped: LngLat;
      /** Monotonic along-route progress in metres. */
      progressM: number;
      offsetM: number;
      offRoute: boolean;
      lowConfidence: boolean;
      /** Rolling-average speed along the route. */
      speedMps: number;
    };

/** How far behind the last progress a new fix may snap (GPS jitter). */
const BACKWARD_WINDOW_M = 100;
/** How far ahead a new fix may snap before we suspect a wrong match. */
const FORWARD_WINDOW_M = 2_000;
/** Ignore tiny jumps when checking plausibility (GPS noise at low dt). */
const JUMP_NOISE_FLOOR_M = 30;
/**
 * Speed is "unknown" (0, so ETA falls back to the floor and only the distance
 * rule can fire) until samples span this long. Over 1 s, 5 m of GPS jitter is
 * ±5 m/s of speed error, enough to fire an ETA alert far too early.
 */
const MIN_SPEED_SPAN_MS = 3_000;

/**
 * Turns raw GPS pings into stable along-route progress and speed.
 * Steps: reject out-of-order or physically impossible fixes → snap to route
 * (windowed around current progress) → keep progress monotonic → rolling speed.
 */
export class LocationPipeline {
  private last: { ts: number; raw: LngLat } | null = null;
  private progress: number | null = null;
  private samples: { ts: number; progressM: number }[] = [];
  private speed = 0;

  constructor(
    private readonly route: RouteGeometry,
    private readonly cfg: PipelineConfig,
  ) {}

  get progressM(): number | null {
    return this.progress;
  }

  get speedMps(): number {
    return this.speed;
  }

  /** Speed used for ETA maths, floored so ETA stays finite while stopped. */
  get etaSpeedMps(): number {
    return Math.max(this.speed, this.cfg.minSpeedMps);
  }

  /**
   * Demo-only: move to a new fix without the plausibility check and restart the
   * speed window. Progress stays monotonic. Used by the simulator's "skip ahead".
   */
  relocate(ping: LocationPing): PipelineResult {
    this.last = null;
    this.samples = [];
    this.speed = 0;
    return this.ingest(ping);
  }

  ingest(ping: LocationPing): PipelineResult {
    const raw = { lng: ping.lng, lat: ping.lat };

    if (this.last) {
      if (ping.ts <= this.last.ts) return { accepted: false, reason: 'out_of_order' };
      const jumpM = haversineM(this.last.raw, raw);
      const dtS = (ping.ts - this.last.ts) / 1000;
      if (jumpM > JUMP_NOISE_FLOOR_M && jumpM / dtS > this.cfg.maxPlausibleSpeedMps) {
        return { accepted: false, reason: 'implausible_jump' };
      }
    }

    const proj =
      this.progress === null
        ? this.route.project(raw)
        : this.route.project(raw, {
            minAlongM: this.progress - BACKWARD_WINDOW_M,
            maxAlongM: this.progress + FORWARD_WINDOW_M,
            maxOffsetM: this.cfg.offRouteM,
          });

    // An ambulance doesn't reverse along its own route; backward snaps are jitter.
    this.progress = this.progress === null ? proj.alongM : Math.max(this.progress, proj.alongM);
    this.last = { ts: ping.ts, raw };

    this.samples.push({ ts: ping.ts, progressM: this.progress });
    const cutoff = ping.ts - this.cfg.speedWindowMs;
    while (this.samples.length > 2 && this.samples[0]!.ts < cutoff) this.samples.shift();
    const first = this.samples[0]!;
    const spanMs = ping.ts - first.ts;
    if (spanMs >= MIN_SPEED_SPAN_MS) this.speed = (this.progress - first.progressM) / (spanMs / 1000);

    return {
      accepted: true,
      ts: ping.ts,
      raw,
      snapped: this.route.pointAt(this.progress),
      progressM: this.progress,
      offsetM: proj.offsetM,
      offRoute: proj.offsetM > this.cfg.offRouteM,
      lowConfidence: (ping.accuracy ?? 0) > this.cfg.lowAccuracyM,
      speedMps: this.speed,
    };
  }
}
