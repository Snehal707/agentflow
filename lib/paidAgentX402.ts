import { getAddress } from 'viem';
import { ARC } from './arc-config';
import { generateJWT } from './auth';
import { adminDb } from '../db/client';
import { getOrCreateUserAgentWallet } from './dcw';
import { insertAgentToAgentLedger } from './a2a-ledger';
import { loadAgentOwnerWallet } from './agent-owner-wallet';
import { loadTreasuryWallet } from './agent-treasury';
import { resolveAgentRunUrl } from './a2a-followups';
import {
  payProtectedResourceServer,
  type PayProtectedResourceServerResult,
} from './x402ServerClient';
import type { SupportedSourceChain } from '../agents/bridge/bridgeKit';

export const BRIDGE_AGENT_PRICE_LABEL = process.env.BRIDGE_AGENT_PRICE
  ? `$${process.env.BRIDGE_AGENT_PRICE}`
  : '$0.009';
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
export const BRIDGE_RUN_URL = resolveAgentRunUrl(
  process.env.BRIDGE_AGENT_URL?.trim(),
  'http://127.0.0.1:3013/run',
);

export const SPONSORED_BRIDGE_DAILY_LIMIT_USDC = (() => {
  const raw = Number(process.env.SPONSORED_BRIDGE_DAILY_LIMIT_USDC ?? '10');
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
})();

export const SPONSORED_BRIDGE_USAGE_SCOPE = 'bridge_sponsored_usdc';

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executeSponsoredBridgeViaX402(input: {
  userWalletAddress: `0x${string}`;
  sourceChain: SupportedSourceChain;
  amount: string;
}): Promise<PayProtectedResourceServerResult<Record<string, unknown>>> {
  const treasury = await loadTreasuryWallet();
  if (!treasury) {
    throw new Error('AgentFlow treasury wallet is not configured for sponsored bridge payments.');
  }
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const headers: Record<string, string> = internalKey
    ? { 'x-agentflow-paid-internal': internalKey }
    : { Authorization: `Bearer ${generateJWT(input.userWalletAddress)}` };

  return payProtectedResourceServer<Record<string, unknown>, Record<string, unknown>>({
    url: BRIDGE_RUN_URL,
    method: 'POST',
    body: {
      sourceChain: input.sourceChain,
      targetChain: 'arc-testnet',
      amount: Number(input.amount),
      walletAddress: input.userWalletAddress,
    },
    circleWalletId: treasury.walletId,
    payer: treasury.address,
    chainId: ARC.chainId,
    headers,
    requestId: `sponsored_bridge_${input.sourceChain}_${Date.now()}`,
  });
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
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const headers: Record<string, string> = internalKey
    ? { 'x-agentflow-paid-internal': internalKey }
    : { Authorization: `Bearer ${generateJWT(input.userWalletAddress)}` };

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
        amount: Number(String(input.price).replace(/^\$/, '')) || 0,
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

export async function ensureSponsoredBridgeLedger(input: {
  settlement?: {
    id?: string;
    txHash?: string;
    payer?: string;
    network?: string;
    rawTransaction?: string;
  };
  transactionRef?: string;
  recipientAddress: `0x${string}`;
}): Promise<void> {
  const requestRef =
    input.transactionRef ||
    input.settlement?.txHash ||
    input.settlement?.id ||
    input.settlement?.rawTransaction;
  if (!requestRef) {
    return;
  }

  const { data: existing, error: existingError } = await adminDb
    .from('transactions')
    .select('id')
    .eq('buyer_agent', 'agentflow_sponsor')
    .eq('seller_agent', 'bridge')
    .eq('request_id', requestRef)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.warn('[paidAgentX402] sponsored bridge ledger lookup failed:', existingError.message);
  }
  if (existing?.id) {
    return;
  }

  const bridgeOwner = await loadAgentOwnerWallet('bridge');
  const treasury = await loadTreasuryWallet();
  if (!treasury) {
    console.warn('[paidAgentX402] treasury wallet unavailable for sponsored bridge ledger');
    return;
  }

  const ledger = await insertAgentToAgentLedger({
    fromWallet: treasury.address,
    toWallet: bridgeOwner.address,
    amount: Number(String(BRIDGE_AGENT_PRICE_LABEL).replace(/^\$/, '')) || 0.009,
    settlement: input.settlement,
    remark: `AgentFlow Sponsor -> Bridge Agent (bridge to ${input.recipientAddress})`,
    agentSlug: 'bridge',
    buyerAgent: 'agentflow_sponsor',
    sellerAgent: 'bridge',
    requestId: requestRef,
    context: 'agentflow_sponsor->bridge',
  });
  if (!ledger.ok) {
    console.warn('[paidAgentX402] sponsored bridge ledger insert failed:', ledger.error);
  }
}
