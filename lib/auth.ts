import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

export interface JWTPayload {
  walletAddress: string;
  accessModel?: 'pay_per_task';
  exp: number;
}

function getSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) {
    throw new Error('[auth] JWT_SECRET is required');
  }
  return s;
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
