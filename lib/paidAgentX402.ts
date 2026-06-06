import { getAddress } from 'viem';
import { ARC } from './arc-config';
import { generateJWT } from './auth';
import { adminDb } from '../db/client';
import { getOrCreateUserAgentWallet } from './dcw';
import { insertAgentToAgentLedger } from './a2a-ledger';
import { loadAgentOwnerWallet } from './agent-owner-wallet';
import { resolveAgentRunUrl } from './a2a-followups';
import {
  payProtectedResourceServer,
  type PayProtectedResourceServerResult,
} from './x402ServerClient';

export const PREDMARKET_AGENT_PRICE_LABEL = process.env.PREDMARKET_AGENT_PRICE
  ? `$${process.env.PREDMARKET_AGENT_PRICE}`
  : '$0.012';
export const SWAP_AGENT_PRICE_LABEL = process.env.SWAP_AGENT_PRICE
  ? `$${process.env.SWAP_AGENT_PRICE}`
  : '$0.010';
export const VAULT_AGENT_PRICE_LABEL = process.env.VAULT_AGENT_PRICE
  ? `$${process.env.VAULT_AGENT_PRICE}`
  : '$0.012';

export const SWAP_RUN_URL = resolveAgentRunUrl(
  process.env.SWAP_AGENT_URL?.trim(),
  'http://127.0.0.1:3011/run',
);
export const VAULT_RUN_URL = resolveAgentRunUrl(
  process.env.VAULT_AGENT_URL?.trim(),
  'http://127.0.0.1:3012/run',
);
export const PREDMARKET_RUN_URL = resolveAgentRunUrl(
  process.env.PREDMARKET_AGENT_URL?.trim(),
  'http://127.0.0.1:3013/run',
);

export type ExecutionPaymentEntry = {
  requestId: string;
  agent: string;
  price: string;
  payer: string;
  mode: 'dcw' | 'sponsored';
  sponsored?: boolean;
  transactionRef?: string | null;
  settlementTxHash?: string | null;
};

export type DcwPaidAgentX402Result<TResponse extends Record<string, unknown>> = {
  status: number;
  data: TResponse;
  requestId: string;
  transactionRef: string | null;
  settlement: Record<string, unknown> | null;
  payment: {
    mode: 'DCW';
    payer: string;
    agent: string;
    price: string;
    requestId: string;
    transaction: string | null;
    transactionRef: string | null;
    settlement: Record<string, unknown> | null;
    settlementTxHash: string | null;
  };
  paymentEntry: ExecutionPaymentEntry;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses amounts from `$0.015`, `$0.015 USDC`, or `0.015 USDC` for ledger rows. */
function amountFromPriceLabel(price: string): number {
  const trimmed = price.replace(/\$/g, '').trim();
  const match = trimmed.match(/^[\d.,]+/);
  if (!match?.[0]) {
    const n = Number.parseFloat(trimmed);
    return Number.isFinite(n) ? n : 0;
  }
  const normalized = match[0].replace(/,/g, '');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function settlementRecord(
  settlement: unknown,
): Record<string, unknown> | null {
  return settlement && typeof settlement === 'object'
    ? (settlement as Record<string, unknown>)
    : null;
}

/** Deduped DCW→agent `transactions` + `agent_economy_ledger` row (buyer_agent `user_dcw`). */
export async function ensureUserPaidAgentLedger(input: {
  payer: string;
  agent: string;
  price: string;
  requestId: string;
  settlement?: unknown;
  remark?: string;
  context?: string;
}): Promise<void> {
  const { data: existing, error: existingError } = await adminDb
    .from('transactions')
    .select('id')
    .eq('buyer_agent', 'user_dcw')
    .eq('seller_agent', input.agent)
    .eq('request_id', input.requestId)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.warn(
      `[paidAgentX402] ${input.agent} user-paid ledger lookup failed:`,
      existingError.message,
    );
  }

  if (existing?.id) {
    return;
  }

  const agentOwner = await loadAgentOwnerWallet(input.agent);
  const ledger = await insertAgentToAgentLedger({
    fromWallet: input.payer,
    toWallet: agentOwner.address,
    amount: amountFromPriceLabel(input.price),
    settlement: (input.settlement as any) || undefined,
    remark: input.remark ?? `User DCW -> ${input.agent} Agent`,
    agentSlug: input.agent,
    buyerAgent: 'user_dcw',
    sellerAgent: input.agent,
    requestId: input.requestId,
    context: input.context ?? `user_dcw->${input.agent}`,
  });
  if (!ledger.ok) {
    console.warn(
      `[paidAgentX402] ${input.agent} user-paid ledger insert failed:`,
      ledger.error,
    );
  }
}

export async function executeUserPaidAgentViaX402<TResponse extends Record<string, unknown>>(input: {
  userWalletAddress: `0x${string}`;
  url: string;
  agent: string;
  price: string;
  body: Record<string, unknown>;
  requestId: string;
}): Promise<
  PayProtectedResourceServerResult<TResponse> & {
    paymentEntry: ExecutionPaymentEntry;
  }
> {
  const executionWallet = await getOrCreateUserAgentWallet(input.userWalletAddress);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${generateJWT(input.userWalletAddress)}`,
  };

  const result = await payProtectedResourceServer<TResponse, Record<string, unknown>>({
    url: input.url,
    method: 'POST',
    body: {
      ...input.body,
      walletAddress: input.userWalletAddress,
      executionTarget: 'DCW',
    },
    circleWalletId: executionWallet.wallet_id,
    payer: getAddress(executionWallet.address) as `0x${string}`,
    chainId: ARC.chainId,
    headers,
    requestId: input.requestId,
    idempotencyKey: input.requestId,
  });

  try {
    const { data: existing, error: existingError } = await adminDb
      .from('transactions')
      .select('id')
      .eq('buyer_agent', 'user_dcw')
      .eq('seller_agent', input.agent)
      .eq('request_id', result.requestId)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.warn(
        `[paidAgentX402] ${input.agent} user-paid ledger lookup failed:`,
        existingError.message,
      );
    }

    if (!existing?.id) {
      const agentOwner = await loadAgentOwnerWallet(input.agent);
      const ledger = await insertAgentToAgentLedger({
        fromWallet: getAddress(executionWallet.address),
        toWallet: agentOwner.address,
        amount: amountFromPriceLabel(input.price),
        settlement: result.transaction,
        remark: `User DCW -> ${input.agent} Agent`,
        agentSlug: input.agent,
        buyerAgent: 'user_dcw',
        sellerAgent: input.agent,
        requestId: result.requestId,
        context: `user_dcw->${input.agent}`,
      });
      if (!ledger.ok) {
        console.warn(
          `[paidAgentX402] ${input.agent} user-paid ledger insert failed:`,
          ledger.error,
        );
      }
    }
  } catch (ledgerError) {
    console.warn(
      `[paidAgentX402] ${input.agent} user-paid ledger error:`,
      errorMessage(ledgerError),
    );
  }

  return {
    ...result,
    paymentEntry: {
      requestId: result.requestId,
      agent: input.agent,
      price: input.price,
      payer: getAddress(executionWallet.address),
      mode: 'dcw',
      transactionRef: result.transactionRef ?? null,
      settlementTxHash: result.transaction?.txHash ?? null,
    },
  };
}

export async function executeDcwPaidAgentViaX402<
  TResponse extends Record<string, unknown> = Record<string, unknown>,
>(input: {
  userWalletAddress: string;
  url: string;
  agent: string;
  price: string;
  body?: Record<string, unknown>;
  requestId: string;
  headers?: Record<string, string>;
  ledgerRemark?: string;
  ledgerContext?: string;
}): Promise<DcwPaidAgentX402Result<TResponse>> {
  const normalizedWallet = getAddress(input.userWalletAddress);
  const executionWallet = await getOrCreateUserAgentWallet(normalizedWallet);
  const headers: Record<string, string> = {
    authorization: `Bearer ${generateJWT(normalizedWallet)}`,
    ...(input.headers ?? {}),
  };
  const payer = getAddress(executionWallet.address);

  const result = await payProtectedResourceServer<TResponse, Record<string, unknown>>({
    url: input.url,
    method: 'POST',
    body: {
      ...(input.body ?? {}),
      walletAddress: normalizedWallet,
      executionTarget: 'DCW',
    },
    circleWalletId: executionWallet.wallet_id,
    payer,
    chainId: ARC.chainId,
    headers,
    requestId: input.requestId,
    idempotencyKey: input.requestId,
  });

  if (result.status >= 200 && result.status < 300 && !result.transactionRef) {
    throw new Error(
      `${input.agent} agent returned success without an x402 settlement reference. Refusing to record an unpaid user-agent call.`,
    );
  }

  if (result.status >= 200 && result.status < 300) {
    try {
      await ensureUserPaidAgentLedger({
        payer,
        agent: input.agent,
        price: input.price,
        requestId: result.requestId,
        settlement: result.transaction,
        remark: input.ledgerRemark,
        context: input.ledgerContext,
      });
    } catch (ledgerError) {
      console.warn(
        `[paidAgentX402] ${input.agent} user-paid ledger error:`,
        errorMessage(ledgerError),
      );
    }
  }

  const settlement = settlementRecord(result.transaction);
  const transactionRef = result.transactionRef ?? null;
  const settlementTxHash =
    result.transaction && typeof result.transaction === 'object' && 'txHash' in result.transaction
      ? String(result.transaction.txHash ?? '') || null
      : null;
  const paymentEntry: ExecutionPaymentEntry = {
    requestId: result.requestId,
    agent: input.agent,
    price: input.price,
    payer,
    mode: 'dcw',
    transactionRef,
    settlementTxHash,
  };

  return {
    status: result.status,
    data: result.data,
    requestId: result.requestId,
    transactionRef,
    settlement,
    payment: {
      mode: 'DCW',
      payer,
      agent: input.agent,
      price: input.price,
      requestId: result.requestId,
      transaction: transactionRef,
      transactionRef,
      settlement,
      settlementTxHash,
    },
    paymentEntry,
  };
}
