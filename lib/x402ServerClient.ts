import { randomBytes, randomUUID } from 'node:crypto';
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
import { getAddress, type Address } from 'viem';
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
  };
};

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
    const authorization = {
      from: getAddress(this.payer),
      to: getAddress(requirements.payTo as Address),
      value: requirements.amount,
      validAfter: String(now - 600),
      validBefore: String(now + requirements.maxTimeoutSeconds),
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

    console.log(
      '[x402Server] signing typed data',
      JSON.stringify({
        payer: authorization.from,
        payTo: authorization.to,
        value: authorization.value,
        validBefore: authorization.validBefore,
        network: requirements.network,
      }),
    );

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
    new ServerGatewayBatchScheme(circleWalletId, payer),
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
  const facilitatorUrl = resolveFacilitatorHealthUrl();
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
  await acquireX402InflightLock(requestId, idempotencyKey);
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(input.headers || {}),
  };

  const execute = async (headers: Record<string, string>): Promise<Response> =>
    fetch(input.url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined,
    });

  await writeX402AttemptRecord({
    requestId,
    idempotencyKey,
    route: input.url,
    method,
    payer: getAddress(input.payer),
    chainId: input.chainId,
    stage: 'started',
  });

  try {
    if (!input.skipPreflight) {
      const health = await assertX402RailHealthy(input.url);
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

      await writeX402AttemptRecord({
        requestId,
        idempotencyKey,
        route: input.url,
        method,
        payer: getAddress(input.payer),
        chainId: input.chainId,
        stage: 'preflight_ok',
        facilitator: health.facilitator,
        target: health.target,
      });
    }

    const initialResponse = await execute(baseHeaders);

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
      if (transaction) {
        console.log('[x402] settlement:', JSON.stringify(transaction));
      }
      await writeX402AttemptRecord({
        requestId,
        idempotencyKey,
        route: input.url,
        method,
        payer: getAddress(input.payer),
        chainId: input.chainId,
        stage: 'succeeded',
        httpStatus: initialResponse.status,
        transaction: pickX402SettlementReference(transaction),
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

    await writeX402AttemptRecord({
      requestId,
      idempotencyKey,
      route: input.url,
      method,
      payer: getAddress(input.payer),
      chainId: input.chainId,
      stage: 'payment_required',
      httpStatus: initialResponse.status,
    });
    console.log('[x402] 402 received, payment required');

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

    const paymentRequired = decodePaymentRequiredHeader(
      paymentRequiredHeader,
    ) as PaymentRequired;
    console.log('[x402] payment requirements:', JSON.stringify(paymentRequired, null, 2));
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
    const buyerGatewayBalance = await ensureGatewayBuyerBalance({
      walletId: input.circleWalletId,
      walletAddress: input.payer,
      requiredAmountUsdc,
      label: input.url,
      requestId,
    });
    console.log('[x402] buyer gateway balance ready:', buyerGatewayBalance);
    const httpClient = await buildX402HttpClient(
      input.circleWalletId,
      input.payer,
      input.chainId,
    );

    const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    console.log('[x402] payment built:', JSON.stringify(paymentPayload, null, 2));
    await writeX402AttemptRecord({
      requestId,
      idempotencyKey,
      route: input.url,
      method,
      payer: getAddress(input.payer),
      chainId: input.chainId,
      stage: 'payload_created',
    });
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    await writeX402AttemptRecord({
      requestId,
      idempotencyKey,
      route: input.url,
      method,
      payer: getAddress(input.payer),
      chainId: input.chainId,
      stage: 'paid_request_sent',
    });
    const paidResponse = await execute({
      ...baseHeaders,
      ...paymentHeaders,
    });
    const paidResponseBody = await paidResponse.clone().text();
    console.log('[x402] payment response status:', paidResponse.status);
    console.log('[x402] payment response body:', paidResponseBody);

    const paidData = await parseResponseBody<TResponse>(paidResponse);
    if (!paidResponse.ok) {
      const details =
        typeof paidData === 'string' ? paidData : JSON.stringify(paidData);
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
    if (transaction) {
      console.log('[x402] settlement:', JSON.stringify(transaction));
    }

    await writeX402AttemptRecord({
      requestId,
      idempotencyKey,
      route: input.url,
      method,
      payer: getAddress(input.payer),
      chainId: input.chainId,
      stage: 'succeeded',
      httpStatus: paidResponse.status,
      transaction: pickX402SettlementReference(transaction),
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
    await releaseX402InflightLock(requestId, idempotencyKey);
  }
}
