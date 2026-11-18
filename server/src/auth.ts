import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import type { Role } from './domain/types.js';

export interface AuthUser {
  id: number;
  role: Role;
  name: string;
  city: string | null;
  hospitalId: string | null;
}

// Distinct audiences keep token kinds from being swapped: a QR join token can
// never be used as a session token, and vice versa.
const SESSION_AUD = 'session';
const JOIN_AUD = 'officer-join';
const CITIZEN_AUD = 'citizen';

export function signToken(u: AuthUser): string {
  return jwt.sign({ role: u.role, name: u.name, city: u.city, hospitalId: u.hospitalId }, config.jwtSecret, {
    subject: String(u.id),
    audience: SESSION_AUD,
    expiresIn: config.jwtTtl,
  });
}

export function verifyToken(token: string): AuthUser {
  const p = jwt.verify(token, config.jwtSecret, { audience: SESSION_AUD }) as jwt.JwtPayload;
  return { id: Number(p.sub), role: p.role, name: p.name, city: p.city ?? null, hospitalId: p.hospitalId ?? null };
}

/** Short-lived link token that can only sign in as one junction's officer (demo QR). */
export function signJoinToken(signalId: number, ttl: jwt.SignOptions['expiresIn'] = '2h'): string {
  return jwt.sign({ sig: signalId }, config.jwtSecret, { audience: JOIN_AUD, expiresIn: ttl });
}

/** Anonymous Citizen Corridor participant: only lets a socket receive its own car's alerts. */
export function signCitizenToken(citizenId: string): string {
  return jwt.sign({ cid: citizenId }, config.jwtSecret, { audience: CITIZEN_AUD, expiresIn: '6h' });
}

export function verifyCitizenToken(token: string): { citizenId: string } {
  const p = jwt.verify(token, config.jwtSecret, { audience: CITIZEN_AUD }) as jwt.JwtPayload;
  if (typeof p.cid !== 'string') throw new Error('invalid_citizen_token');
  return { citizenId: p.cid };
}

export function verifyJoinToken(token: string): { signalId: number } {
  const p = jwt.verify(token, config.jwtSecret, { audience: JOIN_AUD }) as jwt.JwtPayload;
  if (typeof p.sig !== 'number') throw new Error('invalid_join_token');
  return { signalId: p.sig };
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** Require a valid bearer token, optionally restricted to some roles. */
export function requireAuth(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(new HttpError(401, 'unauthenticated'));
    try {
      req.user = verifyToken(token);
    } catch {
      return next(new HttpError(401, 'invalid_token'));
    }
    if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'forbidden'));
    next();
  };
}

/** Narrow req.user after requireAuth ran. */
export function userOf(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'unauthenticated');
  return req.user;
}
