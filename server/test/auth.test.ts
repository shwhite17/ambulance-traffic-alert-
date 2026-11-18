import { describe, expect, it } from 'vitest';
import { signJoinToken, signToken, verifyJoinToken, verifyToken } from '../src/auth.js';

const officer = { id: 7, role: 'officer' as const, name: 'Officer', city: 'Bengaluru', hospitalId: null };

describe('token kinds cannot be swapped', () => {
  it('a session token round-trips', () => {
    expect(verifyToken(signToken(officer))).toMatchObject({ id: 7, role: 'officer' });
  });

  it('a QR join token is not accepted as a session token', () => {
    expect(() => verifyToken(signJoinToken(3))).toThrow(/audience/);
  });

  it('a session token is not accepted as a join token', () => {
    expect(() => verifyJoinToken(signToken(officer))).toThrow(/audience/);
  });

  it('a join token carries only its junction, and expires', async () => {
    expect(verifyJoinToken(signJoinToken(3))).toEqual({ signalId: 3 });
    const short = signJoinToken(3, 1); // 1 second
    await new Promise((r) => setTimeout(r, 1_100));
    expect(() => verifyJoinToken(short)).toThrow(/expired/);
  });
});
