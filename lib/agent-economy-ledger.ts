import { adminDb } from '../db/client';
import { ARC } from './arc-config';
import {
  pickX402SettlementReference,
  type X402SettlementTransaction,
} from './x402ServerClient';

export type AgentEconomyLedgerInput = {
  requestId?: string | null;
  buyerWallet: string;
  sellerWallet: string;
  buyerAgent: string;
  sellerAgent: string;
  amount: number;
  paymentRail?: string;
  settlement?: X402SettlementTransaction;
  metadata?: Record<string, unknown>;
  status?: string;
};

export type AgentEconomyLedgerResult =
  | { ok: true }
  | { ok: false; error: string };

function isMissingLedgerTableError(message: string): boolean {
  return /relation\s+"?agent_economy_ledger"?\s+does not exist/i.test(message);
}

export async function insertAgentEconomyLedger(
  input: AgentEconomyLedgerInput,
): Promise<AgentEconomyLedgerResult> {
  const settlementRef = pickX402SettlementReference(input.settlement);
  const row = {
    request_id: input.requestId || settlementRef || null,
    buyer_wallet: input.buyerWallet,
    seller_wallet: input.sellerWallet,
    buyer_agent: input.buyerAgent,
    seller_agent: input.sellerAgent,
    amount: input.amount,
    currency: 'USDC',
    payment_rail: input.paymentRail ?? 'x402/gateway',
    x402_transaction_ref: settlementRef ?? null,
    settlement_tx_hash: input.settlement?.txHash ?? null,
    arc_tx_id: input.settlement?.txHash ?? null,
    chain_id: ARC.chainId,
    status: input.status ?? 'complete',
    metadata: input.metadata ?? {},
  };

  const { error } = await adminDb.from('agent_economy_ledger').upsert(row, {
    onConflict: 'request_id',
    ignoreDuplicates: true,
  });

  if (error) {
    if (isMissingLedgerTableError(error.message)) {
      console.warn('[agent-economy-ledger] table missing; apply latest migrations');
      return { ok: false, error: error.message };
    }
    console.warn('[agent-economy-ledger] insert failed:', error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function listAgentEconomyLedger(input: {
  limit: number;
  agent?: string;
}) {
  const limit = Math.min(Math.max(input.limit, 1), 100);
  let query = adminDb
    .from('agent_economy_ledger')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (input.agent) {
    query = query.or(`buyer_agent.eq.${input.agent},seller_agent.eq.${input.agent}`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getAgentEconomyLedgerSummary() {
  const { data, error } = await adminDb
    .from('agent_economy_ledger')
    .select('amount,buyer_agent,seller_agent,status');

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];
  const complete = rows.filter((row) => row.status === 'complete');
  const totalUsdc = complete.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const agentCounts = new Map<string, number>();

  for (const row of complete) {
    for (const agent of [row.buyer_agent, row.seller_agent]) {
      if (!agent) continue;
      agentCounts.set(agent, (agentCounts.get(agent) ?? 0) + 1);
    }
  }

  return {
    totalRows: rows.length,
    completeRows: complete.length,
    totalUsdc,
    agentCounts: Object.fromEntries(agentCounts),
  };
}
