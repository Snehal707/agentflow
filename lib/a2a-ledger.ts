import { adminDb } from '../db/client';
import {
  pickX402GatewayTransferId,
  pickX402SettlementReference,
  type X402SettlementTransaction,
} from './x402ServerClient';
import { insertAgentEconomyLedger } from './agent-economy-ledger';

function isMissingTransactionsColumnError(message: string): boolean {
  return (
    /Could not find the '.*' column/i.test(message) ||
    /column\s+"[^"]+"\s+does not exist/i.test(message)
  );
}

export type AgentToAgentLedgerInput = {
  fromWallet: string;
  toWallet: string;
  amount: number;
  remark: string;
  settlement?: X402SettlementTransaction;
  agentSlug: string;
  buyerAgent: string;
  sellerAgent: string;
  requestId?: string;
  context: string;
};

export type AgentToAgentLedgerResult = { ok: true } | { ok: false; error: string };

export async function insertAgentToAgentLedger(
  input: AgentToAgentLedgerInput,
): Promise<AgentToAgentLedgerResult> {
  const baseInsert = {
    from_wallet: input.fromWallet,
    to_wallet: input.toWallet,
    amount: input.amount,
    arc_tx_id: pickX402SettlementReference(input.settlement) ?? null,
    remark: input.remark,
    status: 'complete',
    action_type: 'agent_to_agent_payment',
    agent_slug: input.agentSlug,
  };

  const extendedInsert = {
    ...baseInsert,
    gateway_transfer_id: pickX402GatewayTransferId(input.settlement) ?? null,
    payment_rail: 'x402/gateway',
    buyer_agent: input.buyerAgent,
    seller_agent: input.sellerAgent,
    request_id: input.requestId ?? null,
  };

  let { error } = await adminDb.from('transactions').insert(extendedInsert);
  if (error && isMissingTransactionsColumnError(error.message)) {
    console.warn(`[a2a] ${input.context} extended columns missing:`, error.message);
    ({ error } = await adminDb.from('transactions').insert(baseInsert));
  }

  if (error) {
    console.error(`[a2a] ledger insert FAILED (${input.context}):`, error.message);
    return { ok: false, error: error.message };
  }

  const economyLedger = await insertAgentEconomyLedger({
    requestId: input.requestId ?? pickX402SettlementReference(input.settlement) ?? null,
    buyerWallet: input.fromWallet,
    sellerWallet: input.toWallet,
    buyerAgent: input.buyerAgent,
    sellerAgent: input.sellerAgent,
    amount: input.amount,
    paymentRail: 'x402/gateway',
    settlement: input.settlement,
    metadata: {
      context: input.context,
      remark: input.remark,
      source: 'transactions_mirror',
    },
  });

  if (!economyLedger.ok) {
    console.warn(`[a2a] agent economy ledger insert failed (${input.context}):`, economyLedger.error);
  }

  console.log(
    `[a2a] ledger insert ok (${input.context}) ${input.buyerAgent}→${input.sellerAgent} amount=${input.amount}`,
  );
  return { ok: true };
}
