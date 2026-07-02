import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getRedis } from '../db/client';

/**
 * Lightweight per-IP fixed-window rate limiter backed by Redis.
 *
 * Intended for unauthenticated, abusable endpoints (login/nonce, webhooks).
 * Fails OPEN: if Redis is unavailable it lets the request through rather than
 * taking the API down.
 */
export interface IpRateLimitOptions {
  /** Window length in seconds. */
  windowSec: number;
  /** Max requests per IP per window. */
  max: number;
  /** Redis key namespace, e.g. 'auth'. */
  prefix: string;
}

/**
 * Client IP for the limit key. This app configures NO trusted proxy, so `req.ip`
 * is the real socket peer. We deliberately do NOT read X-Forwarded-For: it is a
 * client-controlled header a direct caller could rotate/forge to evade the
 * per-IP limit. If you later put the API behind a trusted reverse proxy, set
 * Express `trust proxy` so `req.ip` reflects the real client, rather than
 * trusting the raw header here.
 */
function clientIpForLimit(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function ipRateLimit(options: IpRateLimitOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = clientIpForLimit(req);
      const key = `ratelimit:ip:${options.prefix}:${ip}`;
      const redis = getRedis();
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, options.windowSec);
      }
      if (count > options.max) {
        const ttl = await redis.ttl(key);
        res.setHeader('Retry-After', String(Math.max(1, ttl)));
        res.status(429).json({ error: 'Too many requests. Please slow down and retry shortly.' });
        return;
      }
      next();
    } catch {
      // Redis hiccup — never block legitimate traffic on the limiter's account.
      next();
    }
  };
}
