import { getRedis } from '../db/client';

type DailyUsageBucket = {
  count: number;
  expiresAt: number;
};

type DailyUsageAmountBucket = {
  amountMicros: number;
  expiresAt: number;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const memoryBuckets = new Map<string, DailyUsageBucket>();
const memoryAmountBuckets = new Map<string, DailyUsageAmountBucket>();

function utcDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function redisKey(scope: string, walletAddress: string, now: Date): string {
  return `usage:daily:${scope}:${walletAddress.toLowerCase()}:${utcDayKey(now)}`;
}

function amountRedisKey(scope: string, walletAddress: string, now: Date): string {
  return `usage:daily_amount:${scope}:${walletAddress.toLowerCase()}:${utcDayKey(now)}`;
}

export type DailyUsageCapResult = {
  allowed: boolean;
  used: number;
  limit: number;
};

export type DailyUsageReadResult = {
  used: number;
  limit: number;
};

export type DailyUsageAmountResult = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  delta: number;
};

export type DailyUsageAmountReadResult = {
  used: number;
  limit: number;
  remaining: number;
};

async function incrementWithRedis(
  key: string,
  limit: number,
): Promise<DailyUsageCapResult> {
  const redis = getRedis();
  const nextValue = Number(await redis.incr(key));
  await redis.expire(key, Math.ceil(ONE_DAY_MS / 1000));
  return {
    allowed: nextValue <= limit,
    used: nextValue,
    limit,
  };
}

async function readWithRedis(key: string, limit: number): Promise<DailyUsageReadResult> {
  const redis = getRedis();
  const current = Number((await redis.get(key)) || 0);
  return {
    used: current,
    limit,
  };
}

async function incrementAmountWithRedis(
  key: string,
  limitMicros: number,
  deltaMicros: number,
): Promise<DailyUsageAmountResult> {
  const redis = getRedis();
  const nextValue = Number(await redis.incrby(key, deltaMicros));
  await redis.expire(key, Math.ceil(ONE_DAY_MS / 1000));
  const used = nextValue / 1_000_000;
  const limit = limitMicros / 1_000_000;
  const delta = deltaMicros / 1_000_000;
  return {
    allowed: nextValue <= limitMicros,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    delta,
  };
}

async function readAmountWithRedis(
  key: string,
  limitMicros: number,
): Promise<DailyUsageAmountReadResult> {
  const redis = getRedis();
  const current = Number((await redis.get(key)) || 0);
  const used = current / 1_000_000;
  const limit = limitMicros / 1_000_000;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

function incrementWithMemory(
  key: string,
  limit: number,
  now: Date,
): DailyUsageCapResult {
  const current = memoryBuckets.get(key);
  if (current && current.expiresAt <= now.getTime()) {
    memoryBuckets.delete(key);
  }

  const active = memoryBuckets.get(key) ?? {
    count: 0,
    expiresAt: now.getTime() + ONE_DAY_MS,
  };
  active.count += 1;
  memoryBuckets.set(key, active);

  return {
    allowed: active.count <= limit,
    used: active.count,
    limit,
  };
}

function readWithMemory(
  key: string,
  limit: number,
  now: Date,
): DailyUsageReadResult {
  const current = memoryBuckets.get(key);
  if (current && current.expiresAt <= now.getTime()) {
    memoryBuckets.delete(key);
  }

  return {
    used: memoryBuckets.get(key)?.count ?? 0,
    limit,
  };
}

function incrementAmountWithMemory(
  key: string,
  limitMicros: number,
  deltaMicros: number,
  now: Date,
): DailyUsageAmountResult {
  const current = memoryAmountBuckets.get(key);
  if (current && current.expiresAt <= now.getTime()) {
    memoryAmountBuckets.delete(key);
  }

  const active = memoryAmountBuckets.get(key) ?? {
    amountMicros: 0,
    expiresAt: now.getTime() + ONE_DAY_MS,
  };
  active.amountMicros += deltaMicros;
  memoryAmountBuckets.set(key, active);

  const used = active.amountMicros / 1_000_000;
  const limit = limitMicros / 1_000_000;
  const delta = deltaMicros / 1_000_000;
  return {
    allowed: active.amountMicros <= limitMicros,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    delta,
  };
}

function readAmountWithMemory(
  key: string,
  limitMicros: number,
  now: Date,
): DailyUsageAmountReadResult {
  const current = memoryAmountBuckets.get(key);
  if (current && current.expiresAt <= now.getTime()) {
    memoryAmountBuckets.delete(key);
  }

  const used = (memoryAmountBuckets.get(key)?.amountMicros ?? 0) / 1_000_000;
  const limit = limitMicros / 1_000_000;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export async function incrementDailyUsageCap(input: {
  scope: string;
  walletAddress: string;
  limit: number;
  now?: Date;
}): Promise<DailyUsageCapResult> {
  const now = input.now ?? new Date();
  const key = redisKey(input.scope, input.walletAddress, now);

  try {
    return await incrementWithRedis(key, input.limit);
  } catch {
    return incrementWithMemory(key, input.limit, now);
  }
}

export async function readDailyUsageCap(input: {
  scope: string;
  walletAddress: string;
  limit: number;
  now?: Date;
}): Promise<DailyUsageReadResult> {
  const now = input.now ?? new Date();
  const key = redisKey(input.scope, input.walletAddress, now);

  try {
    return await readWithRedis(key, input.limit);
  } catch {
    return readWithMemory(key, input.limit, now);
  }
}

export async function incrementDailyUsageAmount(input: {
  scope: string;
  walletAddress: string;
  amount: number;
  limit: number;
  now?: Date;
}): Promise<DailyUsageAmountResult> {
  const now = input.now ?? new Date();
  const key = amountRedisKey(input.scope, input.walletAddress, now);
  const limitMicros = Math.max(0, Math.round(input.limit * 1_000_000));
  const deltaMicros = Math.max(0, Math.round(input.amount * 1_000_000));

  try {
    return await incrementAmountWithRedis(key, limitMicros, deltaMicros);
  } catch {
    return incrementAmountWithMemory(key, limitMicros, deltaMicros, now);
  }
}

export async function readDailyUsageAmount(input: {
  scope: string;
  walletAddress: string;
  limit: number;
  now?: Date;
}): Promise<DailyUsageAmountReadResult> {
  const now = input.now ?? new Date();
  const key = amountRedisKey(input.scope, input.walletAddress, now);
  const limitMicros = Math.max(0, Math.round(input.limit * 1_000_000));

  try {
    return await readAmountWithRedis(key, limitMicros);
  } catch {
    return readAmountWithMemory(key, limitMicros, now);
  }
}
