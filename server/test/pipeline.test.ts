import { describe, expect, it } from 'vitest';
import { RouteGeometry } from '../src/domain/geo.js';
import { LocationPipeline } from '../src/domain/pipeline.js';
import { config } from '../src/config.js';
import { coords, m } from './helpers.js';

const route = new RouteGeometry(coords([0, 0], [5000, 0]));
const mk = () => new LocationPipeline(route, config.pipeline);
const ping = (x: number, ts: number, extra: { y?: number; accuracy?: number } = {}) => ({
  ...m(x, extra.y ?? 0),
  ts,
  accuracy: extra.accuracy,
});

describe('LocationPipeline', () => {
  it('estimates rolling speed along the route', () => {
    const p = mk();
    for (let i = 0; i <= 10; i++) p.ingest(ping(i * 20, i * 2000)); // 10 m/s
    expect(p.speedMps).toBeCloseTo(10, 0);
    expect(p.progressM).toBeCloseTo(200, -1);
  });

  it('does not trust speed from a too-short window (GPS jitter would inflate it)', () => {
    const p = mk();
    p.ingest(ping(0, 0));
    p.ingest(ping(19, 1000)); // true 11 m/s + 8 m jitter → would read 19 m/s
    expect(p.speedMps).toBe(0);
    p.ingest(ping(22, 2000));
    expect(p.speedMps).toBe(0);
    p.ingest(ping(33, 3000));
    expect(p.speedMps).toBeCloseTo(11, 0);
  });

  it('rejects out-of-order and duplicate timestamps', () => {
    const p = mk();
    p.ingest(ping(0, 5000));
    expect(p.ingest(ping(10, 5000))).toEqual({ accepted: false, reason: 'out_of_order' });
    expect(p.ingest(ping(10, 4000))).toEqual({ accepted: false, reason: 'out_of_order' });
  });

  it('rejects physically impossible jumps but tolerates small noise', () => {
    const p = mk();
    p.ingest(ping(0, 0));
    expect(p.ingest(ping(3000, 2000))).toEqual({ accepted: false, reason: 'implausible_jump' });
    expect(p.ingest(ping(25, 200)).accepted).toBe(true); // 25 m in 0.2 s: under noise floor
  });

  it('keeps progress monotonic under backward GPS jitter', () => {
    const p = mk();
    p.ingest(ping(1000, 0));
    const r = p.ingest(ping(970, 2000));
    expect(r.accepted && r.progressM).toBeCloseTo(1000, -1);
  });

  it('flags low accuracy and off-route fixes', () => {
    const p = mk();
    const r = p.ingest(ping(100, 0, { y: 120, accuracy: 80 }));
    expect(r.accepted && r.lowConfidence).toBe(true);
    expect(r.accepted && r.offRoute).toBe(true);
  });

  it('floors ETA speed when stopped', () => {
    const p = mk();
    for (let i = 0; i <= 6; i++) p.ingest(ping(500, i * 2000));
    expect(p.speedMps).toBe(0);
    expect(p.etaSpeedMps).toBe(config.pipeline.minSpeedMps);
  });
});
