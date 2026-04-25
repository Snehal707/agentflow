import { createHash } from 'node:crypto';
import { getAddress } from 'viem';
import { getRedis } from '../db/client';
import type { X402HealthCheckResult } from './x402Health';

export type JsonRequestBody = Record<string, unknown> | undefined;

export type X402AttemptStage =
  | 'started'
  | 'preflight_ok'
  | 'preflight_failed'
  | 'payment_required'
  | 'payload_created'
  | 'paid_request_sent'
  | 'succeeded'
  | 'failed';

export type X402AttemptMode = 'eoa' | 'dcw';

export type X402AttemptRecord = {
  requestId: string;
  idempotencyKey: string;
  route: string;
  method: string;
  payer: string;
  chainId: number;
  stage: X402AttemptStage;
  createdAt: string;
  updatedAt: string;
  transaction?: string;
  error?: string;
  httpStatus?: number;
  slug?: string;
  mode?: X402AttemptMode;
  facilitator?: X402HealthCheckResult;
  target?: X402HealthCheckResult;
};

export type X402AttemptRecordPatch = Partial<X402AttemptRecord> &
  Pick<
    X402AttemptRecord,
    'requestId' | 'idempotencyKey' | 'route' | 'method' | 'payer' | 'chainId' | 'stage'
  >;

const X402_ATTEMPT_TTL_SEC = Number(process.env.X402_ATTEMPT_TTL_SEC || 86_400);
const X402_INFLIGHT_TTL_SEC = Number(process.env.X402_INFLIGHT_TTL_SEC || 120);

export class X402InflightConflictError extends Error {
  existingRequestId?: string;

  constructor(existingRequestId?: string) {
    super(
      existingRequestId
        ? `Another x402 request is already in flight. Request ID: ${existingRequestId}`
        : 'Another x402 request is already in flight.',
    );
    this.name = 'X402InflightConflictError';
    this.existingRequestId = existingRequestId;
  }
}

function buildAttemptRecordKey(requestId: string): string {
  return `x402:attempt:${requestId}`;
}

function buildInflightKey(idempotencyKey: string): string {
  return `x402:inflight:${idempotencyKey}`;
}

function canonicalizeJson(value: unknown): string {
  if (value == null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildDefaultIdempotencyKey(
  input: Pick<
    {
      url: string;
      method?: 'GET' | 'POST';
      payer: string;
      chainId: number;
      body?: JsonRequestBody;
    },
    'url' | 'method' | 'payer' | 'chainId' | 'body'
  >,
): string {
  return createHash('sha256')
    .update(
      canonicalizeJson({
        url: input.url,
        method: input.method ?? 'POST',
        payer: getAddress(input.payer as `0x${string}`),
        chainId: input.chainId,
        body: input.body ?? null,
      }),
    )
    .digest('hex');
}

export async function readX402AttemptRecord(
  requestId: string,
): Promise<X402AttemptRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(buildAttemptRecordKey(requestId));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as X402AttemptRecord;
}

export async function writeX402AttemptRecord(
  patch: X402AttemptRecordPatch,
): Promise<X402AttemptRecord> {
  const redis = getRedis();
  const recordKey = buildAttemptRecordKey(patch.requestId);
  const existingRaw = await redis.get(recordKey);
  const existing = existingRaw ? (JSON.parse(existingRaw) as X402AttemptRecord) : null;
  const now = new Date().toISOString();
  const next: X402AttemptRecord = {
    requestId: patch.requestId,
    idempotencyKey: patch.idempotencyKey,
    route: patch.route,
    method: patch.method,
    payer: patch.payer,
    chainId: patch.chainId,
    stage: patch.stage,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    transaction: patch.transaction ?? existing?.transaction,
    error: patch.error ?? existing?.error,
    httpStatus: patch.httpStatus ?? existing?.httpStatus,
    slug: patch.slug ?? existing?.slug,
    mode: patch.mode ?? existing?.mode,
    facilitator: patch.facilitator ?? existing?.facilitator,
    target: patch.target ?? existing?.target,
  };
  await redis.set(recordKey, JSON.stringify(next), 'EX', X402_ATTEMPT_TTL_SEC);
  return next;
}

export async function acquireX402InflightLock(
  requestId: string,
  idempotencyKey: string,
): Promise<void> {
  const redis = getRedis();
  const inflightKey = buildInflightKey(idempotencyKey);
  const locked = await redis.set(
    inflightKey,
    requestId,
    'EX',
    X402_INFLIGHT_TTL_SEC,
    'NX',
  );
  if (locked !== 'OK') {
    const existingRequestId = await redis.get(inflightKey);
    if (existingRequestId === requestId) {
      return;
    }
    throw new X402InflightConflictError(existingRequestId || undefined);
  }
}

export async function releaseX402InflightLock(
  requestId: string,
  idempotencyKey: string,
): Promise<void> {
  const redis = getRedis();
  const inflightKey = buildInflightKey(idempotencyKey);
  const current = await redis.get(inflightKey);
  if (current === requestId) {
    await redis.del(inflightKey);
  }
}
