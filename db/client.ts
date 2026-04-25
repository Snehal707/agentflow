import '../lib/loadEnv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Redis from 'ioredis';

const supabaseUrl = requireEnv('SUPABASE_URL');
const supabaseSecretKey = requireEnv('SUPABASE_SECRET_KEY');
const supabasePublishableKey = requireEnv('SUPABASE_PUBLISHABLE_KEY');

/** Service-role client — backend only, bypasses RLS. */
export const adminDb: SupabaseClient = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

/** Anon/publishable key client — respects RLS (e.g. server routes acting as user). */
export const clientDb: SupabaseClient = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `[db/client] Missing required environment variable: ${name}`,
    );
  }
  return v;
}

function resolveRedisUrl(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const internalUrl = process.env.REDIS_URL?.trim();
  const publicUrl = process.env.REDIS_PUBLIC_URL?.trim();
  const runningOnRailway = Boolean(
    process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_PRIVATE_DOMAIN,
  );
  const url =
    isProd && runningOnRailway
      ? internalUrl || publicUrl
      : publicUrl || internalUrl;
  if (!url) {
    const key =
      isProd && runningOnRailway
        ? 'REDIS_URL or REDIS_PUBLIC_URL'
        : 'REDIS_PUBLIC_URL or REDIS_URL';
    throw new Error(
      `[db/client] Missing Redis URL: set ${key} (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'})`,
    );
  }
  return url;
}

const DEFAULT_POOL_SIZE = 4;

function parsePoolSize(): number {
  const raw = process.env.REDIS_POOL_SIZE?.trim();
  if (!raw) {
    return DEFAULT_POOL_SIZE;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_POOL_SIZE;
  }
  return Math.min(n, 32);
}

const poolSize = parsePoolSize();

const redisPool: Redis[] = [];
let redisPoolInitialized = false;
let roundRobin = 0;

function initRedisPoolIfNeeded(): void {
  if (redisPoolInitialized) {
    return;
  }
  redisPoolInitialized = true;
  const redisUrl = resolveRedisUrl();

  for (let i = 0; i < poolSize; i++) {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    const label = `redis[${i}/${poolSize}]`;
    client.on('connect', () => {
      console.info(`[db/client] ${label} connect`);
    });
    client.on('ready', () => {
      console.info(`[db/client] ${label} ready`);
    });
    client.on('error', (err: Error) => {
      console.warn(`[redis] connection error: ${err.message}`);
      console.warn(`[db/client] ${label} error`, err.message);
    });
    client.on('close', () => {
      console.warn(`[db/client] ${label} close`);
    });

    redisPool.push(client);
  }
}

/**
 * Round-robin Redis connection from the pool.
 * Use one client per concurrent pipeline or transaction as needed.
 */
export function getRedis(): Redis {
  initRedisPoolIfNeeded();
  const client = redisPool[roundRobin % redisPool.length];
  roundRobin += 1;
  return client;
}

/** All pooled connections (for batch operations). */
export function getRedisPool(): readonly Redis[] {
  initRedisPoolIfNeeded();
  return redisPool;
}

/** Graceful shutdown — e.g. SIGTERM handler. */
export async function closeRedisPool(): Promise<void> {
  if (!redisPoolInitialized || redisPool.length === 0) {
    return;
  }
  await Promise.all(redisPool.map((c) => c.quit().catch(() => c.disconnect())));
}
