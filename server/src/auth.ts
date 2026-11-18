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

export function signToken(u: AuthUser): string {
  return jwt.sign({ role: u.role, name: u.name, city: u.city, hospitalId: u.hospitalId }, config.jwtSecret, {
    subject: String(u.id),
    expiresIn: config.jwtTtl,
  });
}

export function verifyToken(token: string): AuthUser {
  const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  return { id: Number(p.sub), role: p.role, name: p.name, city: p.city ?? null, hospitalId: p.hospitalId ?? null };
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
