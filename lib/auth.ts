import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

export interface JWTPayload {
  walletAddress: string;
  accessModel?: 'pay_per_task';
  exp: number;
}

let warnedWeakJwtSecret = false;

function getSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) {
    throw new Error('[auth] JWT_SECRET is required');
  }
  // A weak JWT_SECRET lets an attacker forge tokens for any wallet and drain
  // funds via the authenticated withdraw path. Warn loudly (once) rather than
  // hard-fail, to avoid an unexpected boot outage on deploy — but rotate to a
  // long random value (>= 32 chars) in production.
  if (s.length < 32 && !warnedWeakJwtSecret) {
    warnedWeakJwtSecret = true;
    console.warn(
      `[auth] JWT_SECRET is only ${s.length} chars — use >= 32 random chars to prevent token forgery`,
    );
  }
  return s;
}

/**
 * Logs the JWT_SECRET's length and a strength verdict WITHOUT ever printing the
 * value. Call once at boot so you can confirm the secret is strong enough.
 */
export function logJwtSecretStatus(): void {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) {
    console.error('[auth] JWT_SECRET is NOT set — auth will fail until it is configured');
    return;
  }
  const strong = s.length >= 32;
  console.log(
    `[Boot] JWT_SECRET length=${s.length} — ${strong ? 'OK (>= 32 chars)' : 'WEAK: use >= 32 random chars'}`,
  );
}

export function generateJWT(walletAddress: string, _legacyAccessHint?: string): string {
  return jwt.sign({ walletAddress, accessModel: 'pay_per_task' }, getSecret(), {
    expiresIn: '7d',
  });
}

export function verifyJWT(token: string): JWTPayload {
  const decoded = jwt.verify(token, getSecret());
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('[auth] Invalid token payload');
  }
  const obj = decoded as Partial<JWTPayload> & { exp?: number; [key: string]: unknown };
  if (!obj.walletAddress || typeof obj.exp !== 'number') {
    throw new Error('[auth] Token missing walletAddress/exp');
  }
  return {
    walletAddress: obj.walletAddress,
    accessModel: 'pay_per_task',
    exp: obj.exp,
  };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }
    const payload = verifyJWT(token);
    (req as any).auth = payload;
    next();
  } catch (e: any) {
    res.status(401).json({ error: e?.message ?? 'Unauthorized' });
  }
}
