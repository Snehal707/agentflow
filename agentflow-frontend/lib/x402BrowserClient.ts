import { x402Client, x402HTTPClient } from '@x402/core/client';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { getAddress, type Address, type Hex, type WalletClient } from 'viem';

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

type JsonRequestBody = Record<string, unknown> | undefined;

type GatewayBatchingRequirement = PaymentRequirements & {
  extra: Record<string, unknown> & {
    name?: string;
    version?: string;
    verifyingContract?: string;
  };
};

export interface PayProtectedResourceResult<T> {
  data: T;
  status: number;
  requestId: string;
  transaction?: string;
}

export interface PayProtectedResourceInput<TBody extends JsonRequestBody> {
  url: string;
  method?: 'GET' | 'POST';
  body?: TBody;
  walletClient: WalletClient;
  payer: Address;
  chainId: number;
  headers?: Record<string, string>;
  onAwaitSignature?: () => void;
  signal?: AbortSignal;
}

type X402PreflightResponse = {
  ok?: boolean;
  facilitator?: {
    ok?: boolean;
    url?: string;
    status?: number | null;
    error?: string | null;
  };
  target?: {
    ok?: boolean;
    url?: string;
    status?: number | null;
    error?: string | null;
  };
  error?: string;
};

type X402AttemptStage =
  | 'started'
  | 'preflight_ok'
  | 'preflight_failed'
  | 'payment_required'
  | 'payload_created'
  | 'paid_request_sent'
  | 'succeeded'
  | 'failed';

type X402AttemptMutationResponse = {
  ok?: boolean;
  error?: string;
  requestId?: string;
  existingRequestId?: string | null;
};

type BrowserX402AttemptContext = {
  requestId: string;
  idempotencyKey: string;
  route: string;
  method: 'GET' | 'POST';
  payer: string;
  chainId: number;
  slug?: string;
  mode?: 'eoa' | 'dcw';
};

function createNonce(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

function isGatewayBatchingOption(
  requirements: PaymentRequirements,
  chainId: number,
): requirements is GatewayBatchingRequirement {
  if (!requirements) return false;
  if (requirements.scheme !== CIRCLE_BATCHING_SCHEME) return false;
  if (requirements.network !== `eip155:${chainId}`) return false;
  const extra = (requirements as PaymentRequirements).extra;
  if (!extra || typeof extra !== "object") return false;
  const typedExtra = extra as GatewayBatchingRequirement["extra"];
  return (
    typedExtra.name === CIRCLE_BATCHING_NAME &&
    typedExtra.version === CIRCLE_BATCHING_VERSION &&
    typeof typedExtra.verifyingContract === "string"
  );
}

class BrowserGatewayBatchScheme {
  readonly scheme = CIRCLE_BATCHING_SCHEME;

  constructor(
    private readonly walletClient: WalletClient,
    private readonly payer: Address,
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
        nonce: Hex;
      };
      signature: Hex;
    };
  }> {
    const requirements = paymentRequirements as GatewayBatchingRequirement;
    const verifyingContract = requirements.extra?.verifyingContract;
    if (!verifyingContract) {
      throw new Error(
        'Gateway batching option missing extra.verifyingContract.',
      );
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
    const authorization = {
      from: getAddress(this.payer),
      to: getAddress(requirements.payTo as Address),
      value: requirements.amount,
      validAfter: String(now - 600),
      validBefore: String(now + requirements.maxTimeoutSeconds),
      nonce: createNonce(),
    };

    const signature = await this.walletClient.signTypedData({
      account: this.payer,
      domain: {
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        chainId,
        verifyingContract: getAddress(verifyingContract as Address),
      },
      types: transferWithAuthorizationTypes,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });

    return {
      x402Version,
      payload: {
        authorization,
        signature: signature as Hex,
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

function tryParseJsonString(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function describeStructuredError(
  value: unknown,
  fallbackLabel: string,
): string {
  if (typeof value === 'string') {
    const parsed = tryParseJsonString(value);
    if (parsed && parsed !== value) {
      return describeStructuredError(parsed, fallbackLabel);
    }

    const trimmed = value.trim();
    return trimmed || fallbackLabel;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const primary =
      (typeof record.error === 'string' && record.error.trim()) ||
      (typeof record.reason === 'string' && record.reason.trim()) ||
      (typeof record.message === 'string' && record.message.trim()) ||
      '';

    const executionWallet =
      typeof record.executionWalletAddress === 'string'
        ? record.executionWalletAddress
        : null;

    const requestId =
      typeof record.requestId === 'string'
        ? record.requestId
        : null;

    const parts = [primary || fallbackLabel];
    if (executionWallet) {
      parts.push(`Execution wallet: ${executionWallet}`);
    }
    if (requestId) {
      parts.push(`Request ID: ${requestId}`);
    }
    return parts.join('\n');
  }

  return fallbackLabel;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `x402_${crypto.randomUUID()}`;
  }
  return `x402_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

function fallbackHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16)}`;
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return fallbackHash(value);
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function resolveBrowserRoute(url: string): string {
  try {
    const base =
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const resolved = new URL(url, base);
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return url;
  }
}

function inferPreflightTarget(url: string): { slug: string; mode: "eoa" | "dcw" } | null {
  try {
    const resolved =
      typeof window !== "undefined"
        ? new URL(url, window.location.origin)
        : new URL(url);
    const path = resolved.pathname;
    const dcwMatch = path.match(/^\/api\/dcw\/agents\/([^/]+)/i);
    if (dcwMatch?.[1]) {
      return { slug: dcwMatch[1].toLowerCase(), mode: "dcw" };
    }
    const agentMatch = path.match(/^\/api\/agents\/([^/]+)/i);
    if (agentMatch?.[1]) {
      return { slug: agentMatch[1].toLowerCase(), mode: "eoa" };
    }
    return null;
  } catch {
    return null;
  }
}

async function buildX402AttemptContext<TBody extends JsonRequestBody>(
  input: PayProtectedResourceInput<TBody>,
  requestId: string,
  method: 'GET' | 'POST',
): Promise<BrowserX402AttemptContext> {
  const target = inferPreflightTarget(input.url);
  const route = resolveBrowserRoute(input.url);
  const idempotencyKey = await sha256Hex(
    canonicalizeJson({
      route,
      method,
      payer: getAddress(input.payer),
      chainId: input.chainId,
      body: input.body ?? null,
    }),
  );

  return {
    requestId,
    idempotencyKey,
    route,
    method,
    payer: getAddress(input.payer),
    chainId: input.chainId,
    slug: target?.slug,
    mode: target?.mode,
  };
}

async function startX402Attempt(attempt: BrowserX402AttemptContext): Promise<void> {
  const response = await fetch('/api/x402/attempts/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(attempt),
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as X402AttemptMutationResponse;

  if (response.ok) {
    return;
  }

  const fallbackLabel =
    response.status === 409
      ? `Another x402 request is already in flight. Request ID: ${payload.existingRequestId || attempt.requestId}`
      : `Unable to start x402 attempt. Request ID: ${attempt.requestId}`;

  throw new Error(describeStructuredError(payload, fallbackLabel));
}

async function recordX402AttemptStage(
  attempt: BrowserX402AttemptContext,
  stage: X402AttemptStage,
  patch: Partial<Pick<BrowserX402AttemptContext, 'slug' | 'mode'>> & {
    error?: string;
    httpStatus?: number;
    transaction?: string;
  } = {},
): Promise<void> {
  const response = await fetch('/api/x402/attempts/stage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      ...attempt,
      ...patch,
      stage,
    }),
  });

  if (response.ok) {
    return;
  }

  const payload = (await response
    .json()
    .catch(() => ({}))) as X402AttemptMutationResponse;
  throw new Error(
    describeStructuredError(
      payload,
      `Unable to record x402 stage "${stage}". Request ID: ${attempt.requestId}`,
    ),
  );
}

async function safeRecordX402AttemptStage(
  attempt: BrowserX402AttemptContext,
  stage: X402AttemptStage,
  patch: Partial<Pick<BrowserX402AttemptContext, 'slug' | 'mode'>> & {
    error?: string;
    httpStatus?: number;
    transaction?: string;
  } = {},
): Promise<void> {
  try {
    await recordX402AttemptStage(attempt, stage, patch);
  } catch (error) {
    console.warn(
      `[x402] failed to record ${stage} for ${attempt.requestId}`,
      error,
    );
  }
}

async function describeFailedResponse(response: Response, fallbackLabel: string): Promise<string> {
  const details = await parseResponseBody<unknown>(response.clone());
  if (typeof details === 'string') {
    return details || fallbackLabel;
  }
  try {
    return JSON.stringify(details);
  } catch {
    return fallbackLabel;
  }
}

async function preflightX402Request(
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  const target = inferPreflightTarget(url);
  if (!target) {
    return;
  }

  const query = new URLSearchParams({
    slug: target.slug,
    mode: target.mode,
  });
  const response = await fetch(`/api/x402/preflight?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as X402PreflightResponse;
  if (response.ok && payload.ok) {
    return;
  }

  const details = [
    "x402 preflight failed.",
    payload.facilitator
      ? `Facilitator: ${payload.facilitator.ok ? "ok" : "down"} (${payload.facilitator.url || "unknown"}${payload.facilitator.error ? ` — ${payload.facilitator.error}` : ""})`
      : null,
    payload.target
      ? `Target: ${payload.target.ok ? "ok" : "down"} (${payload.target.url || "unknown"}${payload.target.error ? ` — ${payload.target.error}` : ""})`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  throw new Error(describeStructuredError(payload, details));
}

async function buildX402HttpClient(
  walletClient: WalletClient,
  payer: Address,
  chainId: number,
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
    new BrowserGatewayBatchScheme(walletClient, payer),
  );
  return new x402HTTPClient(client);
}

async function executeProtectedFetch<TBody extends JsonRequestBody>(
  input: PayProtectedResourceInput<TBody>,
): Promise<{ response: Response; attemptedPayment: boolean; requestId: string }> {
  const method = input.method ?? 'POST';
  const requestId = createRequestId();
  const attempt = await buildX402AttemptContext(input, requestId, method);
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-agentflow-request-id': requestId,
    ...(input.headers || {}),
  };
  let ledgerStarted = false;
  let terminalStageWritten = false;
  let attemptedPayment = false;

  const execute = async (headers: Record<string, string>): Promise<Response> =>
    fetch(input.url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined,
      signal: input.signal,
    });

  try {
    await startX402Attempt(attempt);
    ledgerStarted = true;

    try {
      await preflightX402Request(input.url, input.signal);
      await safeRecordX402AttemptStage(attempt, 'preflight_ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await safeRecordX402AttemptStage(attempt, 'preflight_failed', {
        error: message,
      });
      terminalStageWritten = true;
      throw error;
    }

    const initialResponse = await execute(baseHeaders);
    if (initialResponse.status !== 402) {
      if (initialResponse.ok) {
        const settleHeader = initialResponse.headers.get('PAYMENT-RESPONSE');
        const settle = settleHeader
          ? decodePaymentResponseHeader(settleHeader)
          : undefined;
        await safeRecordX402AttemptStage(attempt, 'succeeded', {
          httpStatus: initialResponse.status,
          transaction: settle?.transaction,
        });
      } else {
        const details = await describeFailedResponse(
          initialResponse,
          `Agent call failed with status ${initialResponse.status}`,
        );
        await safeRecordX402AttemptStage(attempt, 'failed', {
          httpStatus: initialResponse.status,
          error: `Agent call failed with status ${initialResponse.status}: ${details}`,
        });
      }
      return { response: initialResponse, attemptedPayment: false, requestId };
    }

    await safeRecordX402AttemptStage(attempt, 'payment_required', {
      httpStatus: initialResponse.status,
    });

    const paymentRequiredHeader = initialResponse.headers.get('PAYMENT-REQUIRED');
    if (!paymentRequiredHeader) {
      await safeRecordX402AttemptStage(attempt, 'failed', {
        httpStatus: initialResponse.status,
        error: 'Missing PAYMENT-REQUIRED header in 402 response.',
      });
      terminalStageWritten = true;
      throw new Error(`Missing PAYMENT-REQUIRED header in 402 response. Request ID: ${requestId}`);
    }

    const paymentRequired = decodePaymentRequiredHeader(
      paymentRequiredHeader,
    ) as PaymentRequired;
    const httpClient = await buildX402HttpClient(
      input.walletClient,
      input.payer,
      input.chainId,
    );

    input.onAwaitSignature?.();
    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    await safeRecordX402AttemptStage(attempt, 'payload_created');
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    await safeRecordX402AttemptStage(attempt, 'paid_request_sent');
    attemptedPayment = true;
    const paidResponse = await execute({
      ...baseHeaders,
      ...paymentHeaders,
    });

    if (paidResponse.ok) {
      const paymentResponseHeader = paidResponse.headers.get('PAYMENT-RESPONSE');
      const settle = paymentResponseHeader
        ? decodePaymentResponseHeader(paymentResponseHeader)
        : undefined;
      await safeRecordX402AttemptStage(attempt, 'succeeded', {
        httpStatus: paidResponse.status,
        transaction: settle?.transaction,
      });
    } else {
      const details = await describeFailedResponse(
        paidResponse,
        `Payment retry failed with status ${paidResponse.status}`,
      );
      await safeRecordX402AttemptStage(attempt, 'failed', {
        httpStatus: paidResponse.status,
        error: `Payment retry failed with status ${paidResponse.status}: ${details}`,
      });
    }

    return { response: paidResponse, attemptedPayment, requestId };
  } catch (error) {
    if (ledgerStarted && !terminalStageWritten) {
      const message = error instanceof Error ? error.message : String(error);
      await safeRecordX402AttemptStage(attempt, 'failed', {
        error: message,
      });
    }
    throw error;
  }
}

export async function payProtectedResource<TResponse, TBody extends JsonRequestBody>(
  input: PayProtectedResourceInput<TBody>,
): Promise<PayProtectedResourceResult<TResponse>> {
  const { response: paidResponse, attemptedPayment, requestId } =
    await executeProtectedFetch(input);

  const paidData = await parseResponseBody<TResponse>(paidResponse);
  if (!paidResponse.ok) {
    const fallbackLabel = `${
      attemptedPayment ? 'Payment retry failed' : 'Protected request failed'
    } with status ${paidResponse.status}\nRequest ID: ${requestId}`;
    throw new Error(describeStructuredError(paidData, fallbackLabel));
  }

  const paymentResponseHeader = paidResponse.headers.get('PAYMENT-RESPONSE');
  const settle = paymentResponseHeader
    ? decodePaymentResponseHeader(paymentResponseHeader)
    : undefined;

  return {
    data: paidData,
    status: paidResponse.status,
    requestId,
    transaction: settle?.transaction,
  };
}

export async function payProtectedFetchWithMeta<TBody extends JsonRequestBody>(
  input: PayProtectedResourceInput<TBody>,
): Promise<{ response: Response; requestId: string }> {
  const { response, attemptedPayment, requestId } = await executeProtectedFetch(input);
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const fallbackLabel = `${
      attemptedPayment ? 'Payment retry failed' : 'Protected fetch failed'
    } with status ${response.status}: ${details || response.statusText}\nRequest ID: ${requestId}`;
    throw new Error(describeStructuredError(details, fallbackLabel));
  }
  return { response, requestId };
}

export async function payProtectedFetch<TBody extends JsonRequestBody>(
  input: PayProtectedResourceInput<TBody>,
): Promise<Response> {
  const { response } = await payProtectedFetchWithMeta(input);
  return response;
}
