import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from '@x402/core/http';
import type {
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from '@x402/core/types';
import { Agent } from 'undici';
import { getAddress, type Address } from 'viem';
import { getRedis } from '../db/client';
import { signTypedDataWithCircleWallet } from './circleWallet';
import { ensureGatewayBuyerBalance } from './gatewayLiquidity';
import {
  checkHttpHealth,
  deriveHealthUrlFromRunUrl,
  resolveFacilitatorHealthUrl,
  type X402HealthCheckResult,
} from './x402Health';
import {
  acquireX402InflightLock,
  buildDefaultIdempotencyKey,
  releaseX402InflightLock,
  type JsonRequestBody,
  type X402AttemptRecordPatch,
  writeX402AttemptRecord,
} from './x402AttemptLedger';

const CIRCLE_BATCHING_NAME = 'GatewayWalletBatched';
const CIRCLE_BATCHING_VERSION = '1';
const CIRCLE_BATCHING_SCHEME = 'exact';

const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

type GatewayBatchingRequirement = PaymentRequirements & {
  extra: Record<string, unknown> & {
    name?: string;
    version?: string;
    verifyingContract?: string;
    minValiditySeconds?: unknown;
  };
};

type CircleGatewaySupportedKind = {
  x402Version?: number;
  scheme?: string;
  network?: string;
  extra?: Record<string, unknown>;
};

let supportedKindsCache:
  | { fetchedAt: number; kinds: CircleGatewaySupportedKind[] }
  | null = null;

const SUPPORTED_KINDS_CACHE_MS = 60_000;
const PAYMENT_RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.X402_PAYMENT_RETRY_ATTEMPTS || '3', 10) || 3,
);
const PAYMENT_RETRY_BASE_DELAY_MS = Math.max(
  250,
  Number.parseInt(process.env.X402_PAYMENT_RETRY_BASE_DELAY_MS || '1200', 10) || 1200,
);
const X402_AGENT_RESPONSE_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.X402_AGENT_RESPONSE_TIMEOUT_MS || '600000', 10) || 600_000,
);
const x402AgentDispatcher = new Agent({
  headersTimeout: X402_AGENT_RESPONSE_TIMEOUT_MS,
  bodyTimeout: X402_AGENT_RESPONSE_TIMEOUT_MS,
});
const X402_THROTTLE_AFTER_ACTIVE_REPORTS = Math.max(
  0,
  Number.parseInt(process.env.X402_THROTTLE_AFTER_ACTIVE_REPORTS || '6', 10) || 6,
);
const X402_MAX_INFLIGHT_PER_PAYER = Math.max(
  1,
  Number.parseInt(process.env.X402_MAX_INFLIGHT_PER_PAYER || '6', 10) || 6,
);
const X402_PAYER_SLOT_WAIT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.X402_PAYER_SLOT_WAIT_MS || '900000', 10) || 900_000,
);
const X402_PAYER_SLOT_TTL_SECONDS = Math.max(
  30,
  Number.parseInt(process.env.X402_PAYER_SLOT_TTL_SECONDS || '900', 10) || 900,
);
const ACTIVE_PIPELINE_COUNT_KEY = 'research:active:pipeline_count';
const PAYER_SLOT_PREFIX = 'x402:payer:slots:';
const PAYER_SLOT_HEARTBEAT_PREFIX = 'x402:payer:slot:heartbeat:';

type X402PayDiagContext = {
  requestId: string;
  url: string;
};

function isAgentflowX402Debug(): boolean {
  return process.env.AGENTFLOW_X402_DEBUG?.trim().toLowerCase() === 'true';
}

const RESEARCH_TIMING_TRACE = /^(1|true|yes|on)$/i.test(
  String(process.env.RESEARCH_TIMING_TRACE || '').trim(),
);

type X402TimingTracePoint = {
  label: string;
  at_ms: number;
  delta_ms: number;
  meta?: Record<string, unknown>;
};

function pushX402TimingTrace(
  trace: X402TimingTracePoint[],
  traceStart: number,
  label: string,
  meta?: Record<string, unknown>,
): void {
  if (!RESEARCH_TIMING_TRACE) return;
  const atMs = Date.now() - traceStart;
  const prev = trace[trace.length - 1];
  trace.push({
    label,
    at_ms: atMs,
    delta_ms: prev ? atMs - prev.at_ms : atMs,
    ...(meta ? { meta } : {}),
  });
}

async function writeX402TimingTrace(
  timingTraceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!RESEARCH_TIMING_TRACE || !timingTraceId) return;
  try {
    const outDir = path.join(process.cwd(), 'tmp', 'latency-fast-research-diagnostic');
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, `${timingTraceId}.x402-client.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    console.warn('[timing-trace] failed to write x402 client trace:', error);
  }
}

function queueAttemptRecordWrite(
  args: {
    patch: X402AttemptRecordPatch;
    stageLogId: string;
    trace?: X402TimingTracePoint[];
    traceStart?: number;
    timingTraceId?: string;
    requestId: string;
    url: string;
  },
): void {
  const { patch, stageLogId, trace, traceStart, timingTraceId, requestId, url } = args;
  if (trace && typeof traceStart === 'number') {
    pushX402TimingTrace(trace, traceStart, `${stageLogId}_write_scheduled`);
  }
  void writeX402AttemptRecord(patch)
    .then(async () => {
      if (trace && typeof traceStart === 'number') {
        pushX402TimingTrace(trace, traceStart, `${stageLogId}_write_complete`);
      }
      if (timingTraceId) {
        await writeX402TimingTrace(timingTraceId, {
          requestId,
          timingTraceId,
          url,
          trace,
        });
      }
    })
    .catch((err) => {
      if (trace && typeof traceStart === 'number') {
        pushX402TimingTrace(trace, traceStart, `${stageLogId}_write_failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      console.error(`[x402-attempt] write failed for ${stageLogId}`, err);
    });
}

function truncateForDebugLog(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…(${text.length} chars total)`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number): number {
  const jitter = Math.floor(Math.random() * 350);
  return PAYMENT_RETRY_BASE_DELAY_MS * Math.max(1, attempt) + jitter;
}

function payerSlotKey(payer: Address): string {
  return `${PAYER_SLOT_PREFIX}${getAddress(payer).toLowerCase()}`;
}

function payerSlotHeartbeatKey(token: string): string {
  return `${PAYER_SLOT_HEARTBEAT_PREFIX}${token}`;
}

async function getActiveResearchPipelineCount(): Promise<number> {
  try {
    const raw = await getRedis().get(ACTIVE_PIPELINE_COUNT_KEY);
    return Math.max(0, Number.parseInt(raw || '0', 10) || 0);
  } catch (error) {
    console.warn('[x402] active research count unavailable; payment throttle skipped:', error instanceof Error ? error.message : error);
    return 0;
  }
}

async function cleanupStalePayerSlots(key: string): Promise<void> {
  const redis = getRedis();
  const tokens = await redis.smembers(key);
  if (tokens.length === 0) return;
  for (const token of tokens) {
    const heartbeat = await redis.get(payerSlotHeartbeatKey(token));
    if (!heartbeat) {
      await redis.srem(key, token);
    }
  }
}

async function acquireAdaptivePayerPaymentSlot(
  payer: Address,
  requestId: string,
): Promise<{ key: string; token: string } | null> {
  if (X402_THROTTLE_AFTER_ACTIVE_REPORTS <= 0) return null;
  const active = await getActiveResearchPipelineCount();
  if (active <= X402_THROTTLE_AFTER_ACTIVE_REPORTS) return null;

  const redis = getRedis();
  const key = payerSlotKey(payer);
  const token = `${requestId}:${randomUUID()}`;
  const deadline = Date.now() + X402_PAYER_SLOT_WAIT_MS;
  let cleanedAt = 0;

  while (Date.now() < deadline) {
    if (Date.now() - cleanedAt > 5_000) {
      cleanedAt = Date.now();
      await cleanupStalePayerSlots(key);
    }

    const acquired = (await redis.eval(
      `
local c = redis.call('SCARD', KEYS[1])
if c >= tonumber(ARGV[1]) then return 0 end
redis.call('SADD', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`,
      2,
      key,
      payerSlotHeartbeatKey(token),
      String(X402_MAX_INFLIGHT_PER_PAYER),
      token,
      String(X402_PAYER_SLOT_TTL_SECONDS),
    )) as number;

    if (acquired === 1) {
      console.log(
        `[x402] adaptive payer throttle active: activeReports=${active} payer=${getAddress(payer)} maxInflight=${X402_MAX_INFLIGHT_PER_PAYER} requestId=${requestId}`,
      );
      return { key, token };
    }
    await sleep(350 + Math.floor(Math.random() * 250));
  }

  throw new Error(
    `x402 payer throttle timed out after ${Math.round(X402_PAYER_SLOT_WAIT_MS / 1000)}s. Request ID: ${requestId}`,
  );
}

async function releaseAdaptivePayerPaymentSlot(
  slot: { key: string; token: string } | null,
): Promise<void> {
  if (!slot) return;
  try {
    await Promise.all([
      getRedis().srem(slot.key, slot.token),
      getRedis().del(payerSlotHeartbeatKey(slot.token)),
    ]);
  } catch (error) {
    console.warn('[x402] payer throttle release skipped:', error instanceof Error ? error.message : error);
  }
}

function errorLooksRetriable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /\b429\b|rate limit|too many requests|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(
    message,
  );
}

function paidResponseLooksRetriable(status: number, body: string): boolean {
  if (status === 429 || status === 408) return true;
  if (status >= 500 && status <= 599) return true;
  return /Circle Gateway settle failed|Internal error during settle|Unexpected token '<'|Gateway settle failed|rate limit|too many requests/i.test(
    body,
  );
}

function sanitizeGatewayRequirementForDiag(
  req: GatewayBatchingRequirement,
): Record<string, unknown> {
  const extra = req.extra ?? {};
  const raw = req as Record<string, unknown>;
  const resource = raw.resource;
  return {
    scheme: req.scheme,
    network: req.network,
    amount: req.amount,
    payTo: req.payTo,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    resource: typeof resource === 'string' ? resource : undefined,
    mimeType: (req as { mimeType?: string }).mimeType,
    extra: {
      name: extra.name,
      version: extra.version,
      verifyingContract: extra.verifyingContract,
      minValiditySeconds: extra.minValiditySeconds,
    },
  };
}

export interface X402SettlementTransaction {
  id?: string;
  txHash?: string;
  payer?: string;
  network?: string;
  rawTransaction?: string;
}

export interface PayProtectedResourceServerResult<T> {
  data: T;
  status: number;
  requestId: string;
  transaction?: X402SettlementTransaction;
  transactionRef?: string;
  settlement?: SettleResponse;
}

export interface PayProtectedResourceServerInput<TBody extends JsonRequestBody> {
  url: string;
  method?: 'GET' | 'POST';
  body?: TBody;
  circleWalletId: string;
  payer: Address;
  chainId: number;
  headers?: Record<string, string>;
  requestId?: string;
  idempotencyKey?: string;
  skipPreflight?: boolean;
}

function createNonce(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
}


function formatHealthForMessage(label: string, health: X402HealthCheckResult): string {
  return `${label}: ${health.ok ? 'ok' : 'down'} (${health.url}${health.error ? ` — ${health.error}` : ''})`;
}


async function assertX402RailHealthy(runUrl: string): Promise<{
  facilitator: X402HealthCheckResult;
  target: X402HealthCheckResult;
}> {
  const facilitatorUrl = resolveFacilitatorHealthUrl();
  const targetHealthUrl = deriveHealthUrlFromRunUrl(runUrl);
  const [facilitator, target] = await Promise.all([
    checkHttpHealth(facilitatorUrl),
    checkHttpHealth(targetHealthUrl),
  ]);

  return { facilitator, target };
}

function isGatewayBatchingOption(
  requirements: PaymentRequirements,
  chainId: number,
): requirements is GatewayBatchingRequirement {
  if (!requirements) return false;
  if (requirements.scheme !== CIRCLE_BATCHING_SCHEME) return false;
  if (requirements.network !== `eip155:${chainId}`) return false;
  const extra = (requirements as PaymentRequirements).extra;
  if (!extra || typeof extra !== 'object') return false;
  const typedExtra = extra as GatewayBatchingRequirement['extra'];
  return (
    typedExtra.name === CIRCLE_BATCHING_NAME &&
    typedExtra.version === CIRCLE_BATCHING_VERSION &&
    typeof typedExtra.verifyingContract === 'string'
  );
}

function findGatewayBatchingRequirement(
  paymentRequired: PaymentRequired,
  chainId: number,
): GatewayBatchingRequirement | null {
  const matching = paymentRequired.accepts.find((requirements) =>
    isGatewayBatchingOption(requirements, chainId),
  );
  return matching ?? null;
}

function gatewayAtomicAmountToUsdc(amount: string): number {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed / 1_000_000;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function circleGatewayApiBaseUrl(): string {
  return (
    process.env.GATEWAY_API_BASE_URL?.trim() || 'https://gateway-api-testnet.circle.com/v1'
  ).replace(/\/+$/, '');
}

async function fetchCircleGatewaySupportedKinds(): Promise<CircleGatewaySupportedKind[]> {
  const now = Date.now();
  if (
    supportedKindsCache &&
    now - supportedKindsCache.fetchedAt < SUPPORTED_KINDS_CACHE_MS
  ) {
    return supportedKindsCache.kinds;
  }

  const response = await fetch(`${circleGatewayApiBaseUrl()}/x402/supported`);
  if (!response.ok) {
    throw new Error(
      `Circle Gateway supported request failed with status ${response.status}`,
    );
  }
  const body = (await response.json()) as { kinds?: unknown };
  const kinds = Array.isArray(body.kinds)
    ? (body.kinds as CircleGatewaySupportedKind[])
    : [];
  supportedKindsCache = { fetchedAt: now, kinds };
  return kinds;
}

async function resolveRequiredValiditySeconds(
  requirements: GatewayBatchingRequirement,
  diagCtx?: X402PayDiagContext,
): Promise<number> {
  const maxTimeoutRaw = requirements.maxTimeoutSeconds;
  const maxTimeoutParsed = Number(maxTimeoutRaw ?? 0);
  let requiredValiditySeconds = Math.max(maxTimeoutParsed, 604800);
  const requirementExtraMinValiditySeconds = parsePositiveInteger(
    requirements.extra?.minValiditySeconds,
  );
  if (requirementExtraMinValiditySeconds) {
    requiredValiditySeconds = Math.max(
      requiredValiditySeconds,
      requirementExtraMinValiditySeconds,
    );
  }

  const supportedKindsLikelyCached =
    Boolean(supportedKindsCache) &&
    Date.now() - (supportedKindsCache?.fetchedAt ?? 0) < SUPPORTED_KINDS_CACHE_MS;
  let supportedExtraMinValiditySeconds: number | null = null;
  let supportedKindsFetchError: string | null = null;

  try {
    const supportedKinds = await fetchCircleGatewaySupportedKinds();
    const supported = supportedKinds.find((kind) => {
      const extra = kind.extra ?? {};
      return (
        kind.scheme === requirements.scheme &&
        kind.network === requirements.network &&
        extra.name === CIRCLE_BATCHING_NAME &&
        extra.version === CIRCLE_BATCHING_VERSION
      );
    });
    const matchedMin = parsePositiveInteger(supported?.extra?.minValiditySeconds);
    if (matchedMin !== null) {
      supportedExtraMinValiditySeconds = matchedMin;
      requiredValiditySeconds = Math.max(requiredValiditySeconds, matchedMin);
    }
  } catch (error) {
    supportedKindsFetchError =
      error instanceof Error ? error.message : String(error);
    console.warn(
      '[x402Server] Circle Gateway supported metadata unavailable:',
      supportedKindsFetchError,
    );
  }

  if (diagCtx && isAgentflowX402Debug()) {
    console.log(
      '[x402Server diag]',
      JSON.stringify({
        stage: 'resolve_required_validity_seconds',
        requestId: diagCtx.requestId,
        url: diagCtx.url,
        network: requirements.network,
        requirementsMaxTimeoutSeconds: maxTimeoutRaw,
        maxTimeoutSecondsNumeric: maxTimeoutParsed,
        maxTimeoutSecondsNumericIsFinite: Number.isFinite(maxTimeoutParsed),
        requirementExtraMinValiditySeconds:
          requirementExtraMinValiditySeconds ?? null,
        supportedExtraMinValiditySeconds,
        supportedKindsLikelyCachedBeforeFetch: supportedKindsLikelyCached,
        supportedKindsFetchError,
        requiredValiditySeconds,
      }),
    );
  }

  return requiredValiditySeconds;
}

function isTxHash(value: string | undefined): boolean {
  return Boolean(value && /^0x[a-fA-F0-9]{64}$/.test(value));
}

function normalizeSettlement(
  settle: SettleResponse | undefined,
): X402SettlementTransaction | undefined {
  if (!settle) {
    return undefined;
  }

  const rawTransaction =
    typeof settle.transaction === 'string' && settle.transaction.trim()
      ? settle.transaction.trim()
      : undefined;

  return {
    id: rawTransaction && !isTxHash(rawTransaction) ? rawTransaction : undefined,
    txHash: rawTransaction && isTxHash(rawTransaction) ? rawTransaction : undefined,
    payer: typeof settle.payer === 'string' ? settle.payer : undefined,
    network: typeof settle.network === 'string' ? settle.network : undefined,
    rawTransaction,
  };
}

export function pickX402SettlementReference(
  transaction: X402SettlementTransaction | undefined,
): string | undefined {
  return transaction?.txHash ?? transaction?.id ?? transaction?.rawTransaction;
}

export function pickX402GatewayTransferId(
  transaction: X402SettlementTransaction | undefined,
): string | undefined {
  return transaction?.id;
}

class ServerGatewayBatchScheme {
  readonly scheme = CIRCLE_BATCHING_SCHEME;

  constructor(
    private readonly circleWalletId: string,
    private readonly payer: Address,
    private readonly payDiagCtx?: X402PayDiagContext,
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<{
    x402Version: number;
    payload: {
      authorization: {
        from: Address;
        to: Address;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: `0x${string}`;
      };
      signature: `0x${string}`;
    };
  }> {
    const requirements = paymentRequirements as GatewayBatchingRequirement;
    const verifyingContract = requirements.extra?.verifyingContract;
    if (!verifyingContract) {
      throw new Error('Gateway batching option missing extra.verifyingContract.');
    }

    if (!requirements.network.startsWith('eip155:')) {
      throw new Error(
        `Unsupported network format "${requirements.network}". Expected eip155:<chainId>.`,
      );
    }

    const chainId = Number(requirements.network.split(':')[1]);
    if (!Number.isFinite(chainId) || chainId <= 0) {
      throw new Error(`Invalid chain id in network "${requirements.network}".`);
    }

    const now = Math.floor(Date.now() / 1000);
    const requiredValiditySeconds = await resolveRequiredValiditySeconds(
      requirements,
      this.payDiagCtx,
    );
    const skewSeconds = 30;
    const settlementBufferSeconds = 600;
    const validAfter = now - skewSeconds;
    const validBefore = now + requiredValiditySeconds + settlementBufferSeconds;
    const validityDelta = validBefore - validAfter;

    const authorization = {
      from: getAddress(this.payer),
      to: getAddress(requirements.payTo as Address),
      value: requirements.amount,
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce: createNonce(),
    };

    const typedData = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        TransferWithAuthorization: transferWithAuthorizationTypes.TransferWithAuthorization,
      },
      domain: {
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        chainId,
        verifyingContract: getAddress(verifyingContract as Address),
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: authorization.from,
        to: authorization.to,
        value: String(authorization.value),
        validAfter: String(authorization.validAfter),
        validBefore: String(authorization.validBefore),
        nonce: authorization.nonce,
      },
    };

    if (this.payDiagCtx && isAgentflowX402Debug()) {
      console.log(
        '[x402Server diag]',
        JSON.stringify({
          stage: 'create_payment_payload',
          requestId: this.payDiagCtx.requestId,
          url: this.payDiagCtx.url,
          network: requirements.network,
          requirementsMaxTimeoutSeconds: requirements.maxTimeoutSeconds,
          requiredValiditySeconds,
          unixNowSeconds: now,
          validAfter,
          validBefore,
          validityDelta,
          paymentRequirementsSafe: sanitizeGatewayRequirementForDiag(requirements),
        }),
      );
    }

    if (isAgentflowX402Debug()) {
      console.log(
        '[x402Server] signing typed data',
        JSON.stringify({
          payer: authorization.from,
          payTo: authorization.to,
          value: authorization.value,
          validBefore: authorization.validBefore,
          requiredValiditySeconds,
          network: requirements.network,
        }),
      );
    }

    const signature = (await signTypedDataWithCircleWallet(
      this.circleWalletId,
      typedData,
    )) as `0x${string}`;

    return {
      x402Version,
      payload: {
        authorization,
        signature,
      },
    };
  }
}

async function parseResponseBody<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw) return {} as T;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }
  return raw as T;
}

async function buildX402HttpClient(
  circleWalletId: string,
  payer: Address,
  chainId: number,
  payDiagCtx?: X402PayDiagContext,
): Promise<x402HTTPClient> {
  const client = new x402Client((_version, requirements) => {
    const matching = requirements.find((requirement) =>
      isGatewayBatchingOption(requirement, chainId),
    );
    if (!matching) {
      throw new Error(
        `No GatewayWalletBatched payment option found for eip155:${chainId}.`,
      );
    }
    return matching;
  });

  client.register(
    `eip155:${chainId}`,
    new ServerGatewayBatchScheme(circleWalletId, payer, payDiagCtx),
  );
  return new x402HTTPClient(client);
}

export async function payProtectedResourceServer<
  TResponse,
  TBody extends JsonRequestBody,
>(input: PayProtectedResourceServerInput<TBody>): Promise<
  PayProtectedResourceServerResult<TResponse>
> {
  const method = input.method ?? 'POST';
  const requestId = input.requestId?.trim() || `x402_${randomUUID()}`;
  const idempotencyKey =
    input.idempotencyKey?.trim() || buildDefaultIdempotencyKey(input);
  const timingTraceId =
    input.body &&
    typeof input.body === 'object' &&
    'timingTraceId' in input.body &&
    typeof (input.body as { timingTraceId?: unknown }).timingTraceId === 'string'
      ? String((input.body as { timingTraceId?: unknown }).timingTraceId || '').trim()
      : '';
  const traceStart = Date.now();
  const timingTrace: X402TimingTracePoint[] = [];
  const facilitatorUrl = resolveFacilitatorHealthUrl();
  pushX402TimingTrace(timingTrace, traceStart, 'client_call_start', {
    requestId,
    method,
    url: input.url,
  });
  if (isAgentflowX402Debug()) {
    console.log('[x402] attempting payment:', {
      requestId,
      url: input.url,
      circleWalletId: input.circleWalletId,
      payer: input.payer,
      chainId: input.chainId,
    });
    console.log('[x402] chain config:', {
      chainId: input.chainId,
      facilitatorUrl,
    });
  }
  await acquireX402InflightLock(requestId, idempotencyKey);
  pushX402TimingTrace(timingTrace, traceStart, 'after_inflight_lock');
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(input.headers || {}),
  };
  let adaptivePayerSlot: { key: string; token: string } | null = null;

  const execute = async (headers: Record<string, string>): Promise<Response> =>
    fetch(input.url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined,
      dispatcher: x402AgentDispatcher,
    } as RequestInit & { dispatcher: Agent });

  queueAttemptRecordWrite({
    patch: {
      requestId,
      idempotencyKey,
      route: input.url,
      method,
      payer: getAddress(input.payer),
      chainId: input.chainId,
      stage: 'started',
    },
    stageLogId: 'stage_started',
    trace: timingTrace,
    traceStart,
    timingTraceId,
    requestId,
    url: input.url,
  });

  try {
    if (!input.skipPreflight) {
      pushX402TimingTrace(timingTrace, traceStart, 'before_preflight');
      const health = await assertX402RailHealthy(input.url);
      pushX402TimingTrace(timingTrace, traceStart, 'after_preflight', {
        facilitatorOk: health.facilitator.ok,
        targetOk: health.target.ok,
      });
      if (!health.facilitator.ok || !health.target.ok) {
        await writeX402AttemptRecord({
          requestId,
          idempotencyKey,
          route: input.url,
          method,
          payer: getAddress(input.payer),
          chainId: input.chainId,
          stage: 'preflight_failed',
          error: [
            'x402 preflight failed.',
            `Request ID: ${requestId}`,
            formatHealthForMessage('Facilitator', health.facilitator),
            formatHealthForMessage('Target', health.target),
          ].join('\n'),
          facilitator: health.facilitator,
          target: health.target,
        });
        throw new Error(
          [
            'x402 preflight failed.',
            `Request ID: ${requestId}`,
            formatHealthForMessage('Facilitator', health.facilitator),
            formatHealthForMessage('Target', health.target),
          ].join('\n'),
        );
      }

      queueAttemptRecordWrite({
        patch: {
          requestId,
          idempotencyKey,
          route: input.url,
          method,
          payer: getAddress(input.payer),
          chainId: input.chainId,
          stage: 'preflight_ok',
          facilitator: health.facilitator,
          target: health.target,
        },
        stageLogId: 'stage_preflight_ok',
        trace: timingTrace,
        traceStart,
        timingTraceId,
        requestId,
        url: input.url,
      });
    }

    pushX402TimingTrace(timingTrace, traceStart, 'before_initial_request');
    const initialResponse = await execute(baseHeaders);
    pushX402TimingTrace(timingTrace, traceStart, 'after_initial_request', {
      status: initialResponse.status,
    });

    if (initialResponse.status !== 402) {
      const data = await parseResponseBody<TResponse>(initialResponse);
      if (!initialResponse.ok) {
        const details = typeof data === 'string' ? data : JSON.stringify(data);
        await writeX402AttemptRecord({
          requestId,
          idempotencyKey,
          route: input.url,
          method,
          payer: getAddress(input.payer),
          chainId: input.chainId,
          stage: 'failed',
          httpStatus: initialResponse.status,
          error: `Agent call failed with status ${initialResponse.status}: ${details}`,
        });
        throw new Error(
          `Agent call failed with status ${initialResponse.status}: ${details}`,
        );
      }
      const settleHeader = initialResponse.headers.get('PAYMENT-RESPONSE');
      const settle = settleHeader
        ? decodePaymentResponseHeader(settleHeader)
        : undefined;
      const transaction = normalizeSettlement(settle);
      if (transaction && isAgentflowX402Debug()) {
        console.log('[x402] settlement:', JSON.stringify(transaction));
      }
      queueAttemptRecordWrite({
        patch: {
          requestId,
          idempotencyKey,
          route: input.url,
          method,
          payer: getAddress(input.payer),
          chainId: input.chainId,
          stage: 'succeeded',
          httpStatus: initialResponse.status,
          transaction: pickX402SettlementReference(transaction),
        },
        stageLogId: 'stage_succeeded_no_payment',
        trace: timingTrace,
        traceStart,
        timingTraceId,
        requestId,
        url: input.url,
      });
      pushX402TimingTrace(timingTrace, traceStart, 'client_call_complete_no_payment', {
        status: initialResponse.status,
      });
      await writeX402TimingTrace(timingTraceId, {
        requestId,
        timingTraceId,
        url: input.url,
        trace: timingTrace,
      });
      return {
        data,
        status: initialResponse.status,
        requestId,
        transaction,
        transactionRef: pickX402SettlementReference(transaction),
        settlement: settle,
      };
    }

    queueAttemptRecordWrite({
      patch: {
        requestId,
        idempotencyKey,
        route: input.url,
        method,
        payer: getAddress(input.payer),
        chainId: input.chainId,
        stage: 'payment_required',
        httpStatus: initialResponse.status,
      },
      stageLogId: 'stage_payment_required',
      trace: timingTrace,
      traceStart,
      timingTraceId,
      requestId,
      url: input.url,
    });
    if (isAgentflowX402Debug()) {
      console.log('[x402] 402 received, payment required');
    }

    const paymentRequiredHeader = initialResponse.headers.get('PAYMENT-REQUIRED');
    if (!paymentRequiredHeader) {
      await writeX402AttemptRecord({
        requestId,
        idempotencyKey,
        route: input.url,
        method,
        payer: getAddress(input.payer),
        chainId: input.chainId,
        stage: 'failed',
        httpStatus: initialResponse.status,
        error: 'Missing PAYMENT-REQUIRED header in 402 response.',
      });
      throw new Error(`Missing PAYMENT-REQUIRED header in 402 response. Request ID: ${requestId}`);
    }

    pushX402TimingTrace(timingTrace, traceStart, 'before_decode_payment_required');
    const paymentRequired = decodePaymentRequiredHeader(
      paymentRequiredHeader,
    ) as PaymentRequired;
    pushX402TimingTrace(timingTrace, traceStart, 'after_decode_payment_required', {
      acceptsCount: Array.isArray(paymentRequired.accepts) ? paymentRequired.accepts.length : 0,
    });
    if (isAgentflowX402Debug()) {
      console.log('[x402] payment requirements:', JSON.stringify(paymentRequired, null, 2));
    }
    const gatewayRequirement = findGatewayBatchingRequirement(paymentRequired, input.chainId);
    if (!gatewayRequirement) {
      await writeX402AttemptRecord({
        requestId,
        idempotencyKey,
        route: input.url,
        method,
        payer: getAddress(input.payer),
        chainId: input.chainId,
        stage: 'failed',
        httpStatus: initialResponse.status,
        error: `No GatewayWalletBatched payment option found for eip155:${input.chainId}.`,
      });
      throw new Error(
        `No GatewayWalletBatched payment option found for eip155:${input.chainId}. Request ID: ${requestId}`,
      );
    }
    const requiredAmountUsdc = gatewayAtomicAmountToUsdc(gatewayRequirement.amount);
    pushX402TimingTrace(timingTrace, traceStart, 'before_ensure_gateway_balance');
    const buyerGatewayBalance = await ensureGatewayBuyerBalance({
      walletId: input.circleWalletId,
      walletAddress: input.payer,
      requiredAmountUsdc,
      label: input.url,
      requestId,
    });
    pushX402TimingTrace(timingTrace, traceStart, 'after_ensure_gateway_balance', {
      requiredAmountUsdc,
      availableUsdc: buyerGatewayBalance,
    });
    if (isAgentflowX402Debug()) {
      console.log('[x402] buyer gateway balance ready:', buyerGatewayBalance);
    }
    pushX402TimingTrace(timingTrace, traceStart, 'before_build_http_client');
    const httpClient = await buildX402HttpClient(input.circleWalletId, input.payer, input.chainId, {
      requestId,
      url: input.url,
    });
    pushX402TimingTrace(timingTrace, traceStart, 'after_build_http_client');
    pushX402TimingTrace(timingTrace, traceStart, 'before_adaptive_payer_slot');
    adaptivePayerSlot = await acquireAdaptivePayerPaymentSlot(input.payer, requestId);
    pushX402TimingTrace(timingTrace, traceStart, 'after_adaptive_payer_slot', {
      active: !!adaptivePayerSlot,
    });

    let paidResponse: Response | null = null;
    let paidResponseBody = '';
    let paidData: TResponse | undefined;
    for (let attempt = 1; attempt <= PAYMENT_RETRY_ATTEMPTS; attempt += 1) {
      let paymentPayload: any;
      try {
        pushX402TimingTrace(timingTrace, traceStart, 'before_create_payment_payload', {
          attempt,
        });
        paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
        pushX402TimingTrace(timingTrace, traceStart, 'after_create_payment_payload', {
          attempt,
        });
      } catch (payloadError) {
        const shouldRetry = attempt < PAYMENT_RETRY_ATTEMPTS && errorLooksRetriable(payloadError);
        console.warn(
          `[x402] create payment payload failed attempt=${attempt}/${PAYMENT_RETRY_ATTEMPTS} requestId=${requestId}:`,
          payloadError instanceof Error ? payloadError.message : payloadError,
        );
        if (!shouldRetry) {
          throw payloadError;
        }
        await sleep(retryDelayMs(attempt));
        continue;
      }

      const typedPayload = paymentPayload as {
        x402Version?: number;
        payload?: {
          authorization?: {
            from?: string;
            to?: string;
            value?: string;
            validAfter?: string;
            validBefore?: string;
          };
          signature?: `0x${string}`;
        };
      };
      const authHdr = typedPayload.payload?.authorization;
      if (isAgentflowX402Debug()) {
        console.log(
          '[x402] payment built (sanitized diag):',
          JSON.stringify({
            x402Version: typedPayload?.x402Version,
            payer: authHdr?.from ?? null,
            payTo: authHdr?.to ?? null,
            value: authHdr?.value ?? null,
            validAfter: authHdr?.validAfter ?? null,
            validBefore: authHdr?.validBefore ?? null,
            hasSignature: Boolean(typedPayload.payload?.signature),
            attempt,
          }),
        );
      }
      queueAttemptRecordWrite({
        patch: {
          requestId,
          idempotencyKey,
          route: input.url,
          method,
          payer: getAddress(input.payer),
          chainId: input.chainId,
          stage: 'payload_created',
        },
        stageLogId: 'stage_payload_created',
        trace: timingTrace,
        traceStart,
        timingTraceId,
        requestId,
        url: input.url,
      });
      const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

      queueAttemptRecordWrite({
        patch: {
          requestId,
          idempotencyKey,
          route: input.url,
          method,
          payer: getAddress(input.payer),
          chainId: input.chainId,
          stage: 'paid_request_sent',
        },
        stageLogId: 'stage_paid_request_sent',
        trace: timingTrace,
        traceStart,
        timingTraceId,
        requestId,
        url: input.url,
      });
      pushX402TimingTrace(timingTrace, traceStart, 'before_paid_request', {
        attempt,
      });
      paidResponse = await execute({
        ...baseHeaders,
        ...paymentHeaders,
      });
      pushX402TimingTrace(timingTrace, traceStart, 'after_paid_request', {
        attempt,
        status: paidResponse.status,
      });
      pushX402TimingTrace(timingTrace, traceStart, 'before_paid_response_text', {
        attempt,
      });
      paidResponseBody = await paidResponse.clone().text();
      pushX402TimingTrace(timingTrace, traceStart, 'after_paid_response_text', {
        attempt,
        responseChars: paidResponseBody.length,
      });
      if (isAgentflowX402Debug()) {
        console.log('[x402] payment response status:', paidResponse.status);
        console.log(
          '[x402] payment response body:',
          truncateForDebugLog(paidResponseBody, 520),
        );
      }

      pushX402TimingTrace(timingTrace, traceStart, 'before_paid_response_parse', {
        attempt,
      });
      paidData = await parseResponseBody<TResponse>(paidResponse);
      pushX402TimingTrace(timingTrace, traceStart, 'after_paid_response_parse', {
        attempt,
      });
      if (paidResponse.ok) {
        break;
      }
      const shouldRetry =
        attempt < PAYMENT_RETRY_ATTEMPTS &&
        paidResponseLooksRetriable(paidResponse.status, paidResponseBody);
      if (!shouldRetry) {
        break;
      }
      console.warn(
        `[x402] paid request transient failure status=${paidResponse.status} attempt=${attempt}/${PAYMENT_RETRY_ATTEMPTS} requestId=${requestId}; retrying`,
      );
      await sleep(retryDelayMs(attempt));
    }

    if (!paidResponse || paidData === undefined) {
      throw new Error(`Payment retry failed before response. Request ID: ${requestId}`);
    }
    if (!paidResponse.ok) {
      const details =
        typeof paidData === 'string' ? paidData : JSON.stringify(paidData);
      let failureReasonStructured: Record<string, unknown> | string | null = null;
      if (typeof paidData === 'object' && paidData !== null && !Array.isArray(paidData)) {
        failureReasonStructured = paidData as Record<string, unknown>;
      }
      console.warn(
        `[x402] payment retry failed status=${paidResponse.status} requestId=${requestId} url=${input.url}`,
      );
      if (isAgentflowX402Debug()) {
        console.log(
          '[x402Server diag]',
          JSON.stringify({
            stage: 'payment_retry_failed',
            requestId,
            url: input.url,
            network: gatewayRequirement.network,
            facilitatorUrlHealth: facilitatorUrl,
            httpStatus: paidResponse.status,
            failureReason: truncateForDebugLog(details, 800),
            failureReasonStructured:
              typeof failureReasonStructured === 'object' && failureReasonStructured !== null
                ? failureReasonStructured
                : undefined,
            paymentRequirementsSafe:
              sanitizeGatewayRequirementForDiag(gatewayRequirement),
          }),
        );
      }
      await writeX402AttemptRecord({
        requestId,
        idempotencyKey,
        route: input.url,
        method,
        payer: getAddress(input.payer),
        chainId: input.chainId,
        stage: 'failed',
        httpStatus: paidResponse.status,
        error: `Payment retry failed with status ${paidResponse.status}: ${details}`,
      });
      throw new Error(
        `Payment retry failed with status ${paidResponse.status}: ${details}`,
      );
    }

    const paymentResponseHeader = paidResponse.headers.get('PAYMENT-RESPONSE');
    const settle = paymentResponseHeader
      ? decodePaymentResponseHeader(paymentResponseHeader)
      : undefined;
    const transaction = normalizeSettlement(settle);
    if (transaction && isAgentflowX402Debug()) {
      console.log('[x402] settlement:', JSON.stringify(transaction));
    }

    queueAttemptRecordWrite({
      patch: {
        requestId,
        idempotencyKey,
        route: input.url,
        method,
        payer: getAddress(input.payer),
        chainId: input.chainId,
        stage: 'succeeded',
        httpStatus: paidResponse.status,
        transaction: pickX402SettlementReference(transaction),
      },
      stageLogId: 'stage_succeeded',
      trace: timingTrace,
      traceStart,
      timingTraceId,
      requestId,
      url: input.url,
    });
    pushX402TimingTrace(timingTrace, traceStart, 'client_call_complete', {
      status: paidResponse.status,
      hasSettlement: Boolean(transaction),
    });
    await writeX402TimingTrace(timingTraceId, {
      requestId,
      timingTraceId,
      url: input.url,
      trace: timingTrace,
    });

    return {
      data: paidData,
      status: paidResponse.status,
      requestId,
      transaction,
      transactionRef: pickX402SettlementReference(transaction),
      settlement: settle,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeX402AttemptRecord({
      requestId,
      idempotencyKey,
      route: input.url,
      method,
      payer: getAddress(input.payer),
      chainId: input.chainId,
      stage: 'failed',
      error: message,
    });
    throw error;
  } finally {
    pushX402TimingTrace(timingTrace, traceStart, 'before_release_locks');
    await releaseAdaptivePayerPaymentSlot(adaptivePayerSlot);
    await releaseX402InflightLock(requestId, idempotencyKey);
    pushX402TimingTrace(timingTrace, traceStart, 'after_release_locks');
    if (timingTraceId) {
      await writeX402TimingTrace(timingTraceId, {
        requestId,
        timingTraceId,
        url: input.url,
        trace: timingTrace,
      });
    }
  }
}
