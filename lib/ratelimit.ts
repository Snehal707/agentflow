import { getRedis } from '../db/client';

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveNullableNumberEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getDailyLimit(): number {
  return readPositiveIntEnv('PAY_PER_TASK_DAILY_LIMIT', 50);
}

export function getMinuteLimit(): number {
  return readPositiveIntEnv('PAY_PER_TASK_MINUTE_LIMIT', 10);
}

export function getTransactionSizeLimitUsd(): number | null {
  return readPositiveNullableNumberEnv('PAY_PER_TASK_MAX_TX_USDC');
}

export const NEVER_LIMITED_ACTIONS = [
  'withdraw',
  'gateway_withdraw',
  'gateway_to_execution',
  'emergency_withdraw',
  'vault_withdraw',
  'cancel_dca',
  'emergency_stop',
] as const;

const NEVER_LIMITED: Set<string> = new Set(NEVER_LIMITED_ACTIONS);
export const DAILY_TTL_SECONDS = 24 * 60 * 60;
export const MINUTE_TTL_SECONDS = 60;

export interface RateLimitInput {
  walletAddress: string;
  agentSlug: string;
  actionType: string;
  amountUsd?: number;
  now?: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: 'DAILY_LIMIT' | 'MINUTE_LIMIT' | 'TX_SIZE_LIMIT';
  dailyUsed: number;
  dailyLimit: number;
  minuteUsed: number;
  minuteLimit: number;
}

function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMinuteKeyUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  const h = `${d.getUTCHours()}`.padStart(2, '0');
  const min = `${d.getUTCMinutes()}`.padStart(2, '0');
  return `${y}${m}${day}${h}${min}`;
}

export function getDailyRateKey(walletAddress: string, date: string, agentSlug: string): string {
  return `rate:daily:${walletAddress}:${date}:${agentSlug}`;
}

export function getMinuteRateKey(walletAddress: string, minuteStamp: string): string {
  return `rate:minute:${walletAddress}:${minuteStamp}`;
}

export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const now = input.now ?? new Date();
  const { walletAddress, agentSlug, actionType } = input;
  const amountUsd = input.amountUsd ?? 0;
  const dailyLimit = getDailyLimit();
  const minuteLimit = getMinuteLimit();

  if (!NEVER_LIMITED.has(actionType)) {
    const maxTx = getTransactionSizeLimitUsd();
    if (maxTx !== null && amountUsd > maxTx) {
      return {
        allowed: false,
        reason: 'TX_SIZE_LIMIT',
        dailyUsed: 0,
        dailyLimit,
        minuteUsed: 0,
        minuteLimit,
      };
    }
  }

  if (NEVER_LIMITED.has(actionType)) {
    return {
      allowed: true,
      dailyUsed: 0,
      dailyLimit,
      minuteUsed: 0,
      minuteLimit,
    };
  }

  const redis = getRedis();
  const date = formatDateUTC(now);
  const minuteStamp = formatMinuteKeyUTC(now);
  const dailyKey = getDailyRateKey(walletAddress, date, agentSlug);
  const minuteKey = getMinuteRateKey(walletAddress, minuteStamp);

  const [dailyUsedRaw, minuteUsedRaw] = await Promise.all([
    redis.get(dailyKey),
    redis.get(minuteKey),
  ]);

  const dailyUsed = Number(dailyUsedRaw ?? '0');
  const minuteUsed = Number(minuteUsedRaw ?? '0');

  if (dailyUsed >= dailyLimit) {
    return {
      allowed: false,
      reason: 'DAILY_LIMIT',
      dailyUsed,
      dailyLimit,
      minuteUsed,
      minuteLimit,
    };
  }

  if (minuteUsed >= minuteLimit) {
    return {
      allowed: false,
      reason: 'MINUTE_LIMIT',
      dailyUsed,
      dailyLimit,
      minuteUsed,
      minuteLimit,
    };
  }

  const tx = redis.multi();
  tx.incr(dailyKey);
  tx.expire(dailyKey, DAILY_TTL_SECONDS);
  tx.incr(minuteKey);
  tx.expire(minuteKey, MINUTE_TTL_SECONDS);
  const results = await tx.exec();

  const nextDaily = Number(results?.[0]?.[1] ?? dailyUsed + 1);
  const nextMinute = Number(results?.[2]?.[1] ?? minuteUsed + 1);

  return {
    allowed: true,
    dailyUsed: nextDaily,
    dailyLimit,
    minuteUsed: nextMinute,
    minuteLimit,
  };
}

export const RATE_LIMITS = {
  DAILY_LIMIT: getDailyLimit(),
  MINUTE_LIMIT: getMinuteLimit(),
  TX_SIZE_LIMIT_USD: getTransactionSizeLimitUsd(),
  NEVER_LIMITED: Array.from(NEVER_LIMITED),
} as const;
