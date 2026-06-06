import { createHash, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getAddress, isAddress } from 'viem';
import { adminDb, getRedis } from '../db/client';

const MAINNET_KILL_SWITCH_AT_BOOT = /^(1|true|yes|on)$/i.test(
  process.env.MAINNET_KILL_SWITCH || '',
);
const EXECUTION_INFLIGHT_TTL_SEC = Number(process.env.EXECUTION_INFLIGHT_TTL_SEC || 120);

export type GuardInput = {
  walletAddress: string;
  amount: number;
  recipients?: string[];
  idempotencyKey?: string;
  route?: string;
  requireConfirmation?: boolean;
  logReason?: string;
  logContext?: Record<string, unknown>;
};

export type GuardLock = {
  idempotencyKey: string;
  requestId: string;
  release: () => Promise<void>;
};

export type ExecutionGuardDenyReason =
  | 'kill_switch'
  | 'invalid_amount'
  | 'max_per_transaction'
  | 'max_per_day'
  | 'blocked_recipient'
  | 'recipient_not_allowed'
  | 'confirmation_required'
  | 'inflight_conflict';

export type ExecutionGuardCheckResult =
  | (GuardLock & { allowed: true; reason?: undefined; status: 200 })
  | {
      allowed: false;
      reason: ExecutionGuardDenyReason;
      message: string;
      status: 403 | 409 | 503;
      idempotencyKey?: string;
      requestId?: string;
      release?: undefined;
    };

function killSwitchOn(): boolean {
  return (
    MAINNET_KILL_SWITCH_AT_BOOT ||
    /^(1|true|yes|on)$/i.test(process.env.MAINNET_KILL_SWITCH || '')
  );
}

function logBlocked(reason: string, details: Record<string, unknown>): void {
  console.warn('[EXECUTION_GUARD_BLOCKED]', JSON.stringify({ reason, ...details }));
}

function canonical(value: unknown): string {
  if (value == null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildIdempotencyKey(input: GuardInput): string {
  if (input.idempotencyKey?.trim()) return input.idempotencyKey.trim();
  return createHash('sha256')
    .update(
      canonical({
        route: input.route || 'money',
        walletAddress: getAddress(input.walletAddress),
        amount: input.amount,
        recipients: (input.recipients || []).map((r) => getAddress(r)).sort(),
      }),
    )
    .digest('hex');
}

function guardLogReason(input: GuardInput, reason: ExecutionGuardDenyReason): string {
  return input.logReason?.trim() || reason;
}

function denyGuard(
  input: GuardInput,
  reason: ExecutionGuardDenyReason,
  message: string,
  status: 403 | 409 | 503,
  details: Record<string, unknown>,
): ExecutionGuardCheckResult {
  logBlocked(guardLogReason(input, reason), {
    guardReason: reason,
    ...details,
    ...(input.logContext ?? {}),
  });
  return {
    allowed: false,
    reason,
    message,
    status,
    idempotencyKey:
      typeof details.idempotencyKey === 'string' ? details.idempotencyKey : undefined,
  };
}

function readAmount(req: Request): number {
  const raw =
    req.body?.amountUsdc ??
    req.body?.amount ??
    req.body?.usdcAmount ??
    req.body?.payment?.amount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function readWallet(req: Request): string {
  const raw =
    (req as any).auth?.walletAddress ||
    req.body?.walletAddress ||
    req.body?.userWalletAddress ||
    req.body?.payerEoa ||
    req.body?.from_wallet;
  if (!raw || !isAddress(String(raw))) return '';
  return getAddress(String(raw));
}

function readRecipients(req: Request): string[] {
  const values = [
    req.body?.toAddress,
    req.body?.to,
    req.body?.recipient,
    req.body?.recipientAddress,
    req.body?.destinationAddress,
    req.body?.receiverAddress,
    ...(Array.isArray(req.body?.payments) ? req.body.payments.map((p: any) => p.to || p.toAddress) : []),
    ...(Array.isArray(req.body?.recipients) ? req.body.recipients.map((p: any) => p.address || p.to) : []),
  ];
  return values.filter((v) => typeof v === 'string' && isAddress(v)).map((v) => getAddress(v));
}

function headerIdempotencyKey(req: Request): string {
  return (
    String(req.headers['idempotency-key'] || '').trim() ||
    String(req.body?.idempotencyKey || '').trim()
  );
}

function includesAddress(list: unknown, address: string): boolean {
  if (!Array.isArray(list)) return false;
  const lower = address.toLowerCase();
  return list.some((v) => typeof v === 'string' && v.toLowerCase() === lower);
}

async function dailySpent(wallet: string): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data } = await adminDb
    .from('transactions')
    .select('amount')
    .eq('from_wallet', wallet)
    .gte('created_at', since.toISOString())
    .in('status', ['pending', 'complete']);
  return (data ?? []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0);
}

export async function executeGuardCheck(input: GuardInput): Promise<ExecutionGuardCheckResult> {
  const wallet = getAddress(input.walletAddress);
  const amount = Number(input.amount);
  const recipients = (input.recipients || [])
    .filter((recipient) => isAddress(recipient))
    .map((recipient) => getAddress(recipient));
  const route = input.route || 'money';

  if (killSwitchOn()) {
    return denyGuard(input, 'kill_switch', 'Execution disabled by MAINNET_KILL_SWITCH', 503, {
      wallet,
      amount,
      route,
    });
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return denyGuard(input, 'invalid_amount', 'Invalid execution amount', 403, {
      wallet,
      amount,
      route,
    });
  }

  const policyQuery = await adminDb
    .from('users')
    .select('max_per_transaction,max_per_day,allowed_recipients,blocked_recipients,require_confirmation_above')
    .eq('wallet_address', wallet)
    .maybeSingle();
  let user = policyQuery.data as
    | {
        max_per_transaction?: number | string | null;
        max_per_day?: number | string | null;
        allowed_recipients?: unknown;
        blocked_recipients?: unknown;
        require_confirmation_above?: number | string | null;
      }
    | null;
  if (policyQuery.error && /allowed_recipients|blocked_recipients|require_confirmation_above/i.test(policyQuery.error.message || '')) {
    const fallback = await adminDb
      .from('users')
      .select('max_per_transaction,max_per_day')
      .eq('wallet_address', wallet)
      .maybeSingle();
    user = fallback.data;
  }

  if (user?.max_per_transaction != null && amount > Number(user.max_per_transaction)) {
    return denyGuard(input, 'max_per_transaction', 'Amount exceeds max_per_transaction', 403, {
      wallet,
      amount,
      limit: user.max_per_transaction,
      route,
    });
  }

  if (user?.max_per_day != null && amount + (await dailySpent(wallet)) > Number(user.max_per_day)) {
    return denyGuard(input, 'max_per_day', 'Amount exceeds max_per_day', 403, {
      wallet,
      amount,
      limit: user.max_per_day,
      route,
    });
  }

  for (const recipient of recipients) {
    if (includesAddress(user?.blocked_recipients, recipient)) {
      return denyGuard(input, 'blocked_recipient', 'Recipient is blocked by user policy', 403, {
        wallet,
        recipient,
        route,
      });
    }
    if (Array.isArray(user?.allowed_recipients) && user.allowed_recipients.length > 0) {
      if (!includesAddress(user.allowed_recipients, recipient)) {
        return denyGuard(input, 'recipient_not_allowed', 'Recipient is not in allowed_recipients', 403, {
          wallet,
          recipient,
          route,
        });
      }
    }
  }

  if (
    user?.require_confirmation_above != null &&
    amount > Number(user.require_confirmation_above) &&
    input.requireConfirmation !== true
  ) {
    return denyGuard(input, 'confirmation_required', 'Confirmation required before execution', 409, {
      wallet,
      amount,
      threshold: user.require_confirmation_above,
      route,
    });
  }

  const idempotencyKey = buildIdempotencyKey({ ...input, walletAddress: wallet, recipients });
  const requestId = randomUUID();
  const lockKey = `money:inflight:${idempotencyKey}`;
  const redis = getRedis();
  const locked = await redis.set(lockKey, requestId, 'EX', EXECUTION_INFLIGHT_TTL_SEC, 'NX');
  if (locked !== 'OK') {
    return denyGuard(input, 'inflight_conflict', 'Execution already in flight', 409, {
      wallet,
      amount,
      route,
      idempotencyKey,
    });
  }

  return {
    allowed: true,
    idempotencyKey,
    requestId,
    status: 200,
    release: async () => {
      const current = await redis.get(lockKey).catch(() => null);
      if (current === requestId) await redis.del(lockKey).catch(() => undefined);
    },
  };
}

export async function acquireExecutionGuard(input: GuardInput): Promise<GuardLock> {
  const result = await executeGuardCheck(input);
  if (result.allowed) {
    return result;
  }
  throw new Error(result.message);
}

export function executionGuardMiddleware(req: Request, res: Response, next: NextFunction): void {
  const walletAddress = readWallet(req);
  if (!walletAddress) {
    res.status(400).json({ error: 'Execution wallet is required' });
    return;
  }
  acquireExecutionGuard({
    walletAddress,
    amount: readAmount(req),
    recipients: readRecipients(req),
    idempotencyKey: headerIdempotencyKey(req),
    route: `${req.method} ${req.originalUrl || req.path}`,
    requireConfirmation:
      req.body?.confirmed === true || String(req.headers['x-agentflow-confirmed'] || '') === 'true',
  })
    .then((lock) => {
      res.setHeader('Idempotency-Key', lock.idempotencyKey);
      (req as any).executionGuard = lock;
      res.once('finish', () => void lock.release());
      next();
    })
    .catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('MAINNET_KILL_SWITCH')) res.status(503).json({ error: msg });
      else if (msg.includes('already in flight') || msg.includes('Confirmation required')) {
        res.status(409).json({ error: msg });
      } else {
        res.status(403).json({ error: msg });
      }
    });
}
