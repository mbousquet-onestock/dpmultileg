import type { NextFunction, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { config } from './config.js';

export interface SessionClaims {
  /** OneStock user id */
  sub: string;
  site_id: string;
  environment: string;
  /** OneStock API base URL resolved server side (never trusted from the client afterwards) */
  api_url: string;
  extension_id?: string;
  lang?: string;
  /** The session was opened with a valid OneStock extension signature (user authenticated by OneStock). */
  signed?: boolean;
}

const key = () => new TextEncoder().encode(config.jwtSecret);

export async function issueSession(claims: SessionClaims): Promise<{ token: string; expires_at: number }> {
  const exp = Math.floor(Date.now() / 1000) + config.jwtTtlSeconds;
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .setAudience('dpmultileg')
    .sign(key());
  return { token, expires_at: exp };
}

export async function readSession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, key(), { audience: 'dpmultileg', algorithms: ['HS256'] });
  return payload as unknown as SessionClaims;
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionClaims;
  }
}

export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'missing_session' });
    return;
  }
  try {
    req.session = await readSession(token);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_session' });
  }
}
