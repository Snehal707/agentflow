/**
 * Self-contained reproduction of the bridge-agent x402 nanopayment.
 *
 * Drives the real x402 handshake against the running bridge agent + facilitator
 * (Circle Gateway), signing the TransferWithAuthorization locally with
 * DEPLOYER_PRIVATE_KEY (== TEST_WALLET_ADDRESS == SELLER_ADDRESS). It bypasses
 * the DB/Redis attempt ledger so the ONLY thing exercised is sign -> verify.
 *
 * Run: npx tsx scripts/test-bridge-nanopay.ts
 */
import dotenv from 'dotenv';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import {
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';

import { generateJWT } from '../lib/auth';
import { ARC } from '../lib/arc-config';

dotenv.config();

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
  extra: Record<string, unknown> & { verifyingContract?: string };
};

function createNonce(): Hex {
  return `0x${randomBytes(32).toString('hex')}` as Hex;
}

function isGatewayBatchingOption(
  req: PaymentRequirements,
  chainId: number,
): req is GatewayBatchingRequirement {
  if (!req || req.scheme !== CIRCLE_BATCHING_SCHEME) return false;
  if (req.network !== `eip155:${chainId}`) return false;
  const extra = req.extra as GatewayBatchingRequirement['extra'] | undefined;
  return Boolean(
    extra &&
      extra.name === CIRCLE_BATCHING_NAME &&
      extra.version === CIRCLE_BATCHING_VERSION &&
      typeof extra.verifyingContract === 'string',
  );
}

/** Mirrors ServerGatewayBatchScheme exactly, but signs with a local viem account. */
class LocalKeyGatewayBatchScheme {
  readonly scheme = CIRCLE_BATCHING_SCHEME;
  constructor(
    private readonly account: ReturnType<typeof privateKeyToAccount>,
    private readonly payer: Address,
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ) {
    const req = paymentRequirements as GatewayBatchingRequirement;
    const verifyingContract = req.extra?.verifyingContract;
    if (!verifyingContract) throw new Error('missing extra.verifyingContract');
    const chainId = Number(req.network.split(':')[1]);

    const now = Math.floor(Date.now() / 1000);
    const requiredValiditySeconds = Math.max(Number(req.maxTimeoutSeconds ?? 0), 604800);
    const validAfter = now - 30;
    const validBefore = now + requiredValiditySeconds + 600;

    const authorization = {
      from: getAddress(this.payer),
      to: getAddress(req.payTo as Address),
      value: req.amount,
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce: createNonce(),
    };

    console.log('[repro] signing authorization', JSON.stringify(authorization, null, 2));
    console.log('[repro] domain', JSON.stringify({
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      chainId,
      verifyingContract: getAddress(verifyingContract as Address),
    }, null, 2));

    const signature = await this.account.signTypedData({
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

    return { x402Version, payload: { authorization, signature: signature as Hex } };
  }
}

function normalizeBaseUrl(v: string): string {
  return v.replace(/\/+$/, '');
}

function bridgeFinalizeUrl(): string {
  const base = normalizeBaseUrl(
    process.env.BRIDGE_AGENT_URL ||
      process.env.NEXT_PUBLIC_BRIDGE_AGENT_URL ||
      'http://127.0.0.1:3021',
  );
  return `${base}/bridge/finalize`;
}

async function main(): Promise<void> {
  const pk = (process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  if (!pk) throw new Error('Set DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) in .env');
  const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as Hex);
  const payer = getAddress(account.address);
  const chainId = ARC.chainId;
  const url = bridgeFinalizeUrl();

  console.log('[repro] payer            :', payer);
  console.log('[repro] TEST_WALLET_ADDR :', process.env.TEST_WALLET_ADDRESS);
  console.log('[repro] chainId          :', chainId);
  console.log('[repro] bridge url       :', url);
  console.log('[repro] facilitator      :', process.env.FACILITATOR_URL || `:${process.env.FACILITATOR_PORT}`);
  console.log('[repro] gateway api      :', process.env.GATEWAY_API_BASE_URL || 'https://gateway-api-testnet.circle.com/v1 (default)');

  const body = {
    sourceChain: 'ethereum-sepolia',
    amount: 0.1,
    walletAddress: payer,
    executionTarget: 'DCW',
  };
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    authorization: `Bearer ${generateJWT(payer)}`,
  };

  // 1) initial request -> expect 402
  const first = await fetch(url, { method: 'POST', headers: baseHeaders, body: JSON.stringify(body) });
  console.log('\n[repro] initial status:', first.status);
  if (first.status !== 402) {
    console.log('[repro] initial body:', await first.text());
    if (!first.ok) throw new Error(`Expected 402, got ${first.status}`);
    console.log('[repro] agent did not require payment (free path).');
    return;
  }

  const prHeader = first.headers.get('PAYMENT-REQUIRED');
  if (!prHeader) throw new Error('Missing PAYMENT-REQUIRED header');
  const paymentRequired = decodePaymentRequiredHeader(prHeader) as PaymentRequired;
  console.log('[repro] payment requirements:\n', JSON.stringify(paymentRequired, null, 2));

  const match = paymentRequired.accepts.find((r) => isGatewayBatchingOption(r, chainId));
  if (!match) {
    throw new Error(`No GatewayWalletBatched option for eip155:${chainId}. Networks offered: ${paymentRequired.accepts.map((r) => r.network).join(', ')}`);
  }

  // 2) build + sign payment via the official x402 client
  const client = new x402Client((_v, reqs) => {
    const m = reqs.find((r) => isGatewayBatchingOption(r, chainId));
    if (!m) throw new Error('no batching option');
    return m;
  });
  client.register(`eip155:${chainId}`, new LocalKeyGatewayBatchScheme(account, payer));
  const httpClient = new x402HTTPClient(client);
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  // 3) retry with payment
  const paid = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders, ...paymentHeaders },
    body: JSON.stringify(body),
  });
  const paidBody = await paid.text();
  console.log('\n[repro] ===== PAID RESPONSE =====');
  console.log('[repro] status:', paid.status);
  console.log('[repro] body  :', paidBody);
  const settle = paid.headers.get('PAYMENT-RESPONSE');
  if (settle) {
    try {
      console.log('[repro] settlement:', JSON.stringify(decodePaymentResponseHeader(settle), null, 2));
    } catch {
      console.log('[repro] settlement header (raw):', settle);
    }
  }
  if (paid.ok) {
    console.log('\n[repro] ✅ nanopayment SUCCEEDED');
  } else {
    console.log('\n[repro] ❌ nanopayment FAILED — see `reason` above (Circle Gateway invalidReason)');
  }
}

main().catch((e) => {
  console.error('[repro] fatal:', e);
  process.exit(1);
});
