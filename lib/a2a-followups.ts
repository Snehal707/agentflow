import { getAddress } from 'viem';
import { ARC } from './arc-config';
import { generateJWT } from './auth';
import { loadAgentOwnerWallet } from './agent-owner-wallet';
import { insertAgentToAgentLedger } from './a2a-ledger';
import { isAgentHealthy } from './a2a-health';
import { extractResearchQuery, shouldTriggerResearch } from './a2a-trigger';
import { assessCounterpartyRisk } from './counterparty-risk';
import {
  payProtectedResourceServer,
  type PayProtectedResourceServerResult,
} from './x402ServerClient';

export function usdFromPriceLabel(price: string): number {
  return Number(price.replace(/^\$/, '').trim()) || 0;
}

export function resolveAgentRunUrl(configured: string | undefined, fallback: string): string {
  const value = (configured || fallback).trim();
  try {
    const url = new URL(value);
    url.pathname = url.pathname.endsWith('/run')
      ? url.pathname
      : `${url.pathname.replace(/\/+$/, '') || ''}/run`;
    return url.toString();
  } catch {
    return value.endsWith('/run') ? value : `${value.replace(/\/+$/, '')}/run`;
  }
}

async function payWithA2aX402Log<TResponse>(
  label: string,
  run: () => Promise<PayProtectedResourceServerResult<TResponse>>,
): Promise<PayProtectedResourceServerResult<TResponse>> {
  console.log(`[a2a] x402 start (${label})`);
  try {
    const out = await run();
    console.log(`[a2a] x402 success (${label}) httpStatus=${out.status}`);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[a2a] x402 failed (${label}):`, msg);
    throw e;
  }
}

export async function runPortfolioFollowupAfterTool(input: {
  buyerAgentSlug: 'swap' | 'vault' | 'bridge' | 'batch' | 'split';
  userWalletAddress: string;
  portfolioRunUrl: string;
  portfolioPriceLabel: string;
  trigger: string;
  details?: unknown;
}): Promise<Record<string, unknown> | null> {
  const result = await runPortfolioFollowupAfterToolWithPayment(input);
  return result.data;
}

export type A2aFollowupPaymentEntry = {
  requestId: string;
  agent: string;
  price: string;
  payer: string;
  mode: 'a2a';
  buyerAgent: string;
  sellerAgent: string;
  transactionRef?: string | null;
  settlementTxHash?: string | null;
};

export async function runPortfolioFollowupAfterToolWithPayment(input: {
  buyerAgentSlug: 'swap' | 'vault' | 'bridge' | 'batch' | 'split';
  userWalletAddress: string;
  portfolioRunUrl: string;
  portfolioPriceLabel: string;
  trigger: string;
  details?: unknown;
}): Promise<{
  data: Record<string, unknown> | null;
  paymentEntry?: A2aFollowupPaymentEntry;
}> {
  const ua = getAddress(input.userWalletAddress as `0x${string}`);
  console.log(`[a2a] ${input.buyerAgentSlug}→portfolio hook start`, {
    trigger: input.trigger,
    portfolioRunUrl: input.portfolioRunUrl,
    userWallet: ua,
  });

  if (!(await isAgentHealthy('portfolio'))) {
    console.warn(
      `[a2a] portfolio agent unreachable, skipping ${input.buyerAgentSlug}→portfolio (${input.trigger})`,
    );
    return { data: null };
  }

  const buyer = await loadAgentOwnerWallet(input.buyerAgentSlug);
  const portfolioOwner = await loadAgentOwnerWallet('portfolio');
  console.log(`[a2a] ${input.buyerAgentSlug}→portfolio payer`, {
    payer: buyer.address,
    circleWalletId: buyer.walletId,
    portfolioOwner: portfolioOwner.address,
  });
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';

  const x402Label = `${input.buyerAgentSlug}→portfolio:${input.trigger}`;
  const result = await payWithA2aX402Log(x402Label, () =>
    payProtectedResourceServer<Record<string, unknown>, Record<string, unknown>>({
      url: input.portfolioRunUrl,
      method: 'POST',
      body: {
        walletAddress: ua,
        executionTarget: 'DCW',
        trigger: input.trigger,
        followupContext: input.details,
        responseStyle: 'concise_post_action',
      },
      circleWalletId: buyer.walletId,
      payer: buyer.address,
      chainId: ARC.chainId,
      headers: {
        Authorization: `Bearer ${generateJWT(ua, 'free')}`,
        ...(internalKey ? { 'X-Agentflow-A2A': internalKey } : {}),
      },
      requestId: `a2a_${input.buyerAgentSlug}_${input.trigger}_${Date.now()}`,
    }),
  );

  console.log(`[a2a] ${input.buyerAgentSlug}→portfolio ledger insert starting (${input.trigger})`);
  const ledger = await insertAgentToAgentLedger({
    fromWallet: buyer.address,
    toWallet: portfolioOwner.address,
    amount: usdFromPriceLabel(input.portfolioPriceLabel),
    settlement: result.transaction,
    remark: `${input.buyerAgentSlug} Agent → Portfolio Agent (${input.trigger})`,
    agentSlug: input.buyerAgentSlug,
    buyerAgent: input.buyerAgentSlug,
    sellerAgent: 'portfolio',
    requestId: result.transactionRef,
    context: `${input.buyerAgentSlug}->portfolio`,
  });
  const paymentEntry: A2aFollowupPaymentEntry = {
    requestId: result.requestId,
    agent: 'portfolio',
    price: input.portfolioPriceLabel,
    payer: buyer.address,
    mode: 'a2a',
    buyerAgent: input.buyerAgentSlug,
    sellerAgent: 'portfolio',
    transactionRef: result.transactionRef ?? null,
    settlementTxHash: result.transaction?.txHash ?? null,
  };
  if (!ledger.ok) {
    console.warn(
      `[a2a] ${input.buyerAgentSlug}→portfolio x402 paid but ledger failed (${input.trigger}):`,
      ledger.error,
    );
    return { data: result.data, paymentEntry };
  }
  console.log(`[a2a] ${input.buyerAgentSlug} → portfolio x402 complete (${input.trigger})`);
  return { data: result.data, paymentEntry };
}

export async function runResearchFollowupAfterRichContent(input: {
  buyerAgentSlug: 'vision' | 'transcribe' | 'invoice';
  text: string;
  researchRunUrl: string;
  researchPriceLabel: string;
}): Promise<Record<string, unknown> | null> {
  if (!(await isAgentHealthy('research'))) {
    console.warn(`[a2a] research agent unreachable, skipping ${input.buyerAgentSlug}→research`);
    return null;
  }
  if (!shouldTriggerResearch(input.text)) {
    console.log(`[a2a] ${input.buyerAgentSlug}: content not research-worthy, skipping`);
    return null;
  }
  const sourceType =
    input.buyerAgentSlug === 'invoice' ? 'invoice' : input.buyerAgentSlug === 'transcribe' ? 'transcribe' : 'vision';
  const buyer = await loadAgentOwnerWallet(input.buyerAgentSlug);
  const researchOwner = await loadAgentOwnerWallet('research');
  const task = extractResearchQuery(input.text, sourceType);
  const x402Label = `${input.buyerAgentSlug}→research:rich_content`;
  console.log(`[a2a] ${input.buyerAgentSlug}→research hook start`, {
    researchRunUrl: input.researchRunUrl,
    payer: buyer.address,
  });

  const result = await payWithA2aX402Log(x402Label, () =>
    payProtectedResourceServer<
      { task?: string; result?: string; liveData?: Record<string, unknown> | null },
      { task: string; reasoningMode: 'fast' | 'deep' }
    >({
      url: input.researchRunUrl,
      method: 'POST',
      body: { task, reasoningMode: 'fast' },
      circleWalletId: buyer.walletId,
      payer: buyer.address,
      chainId: ARC.chainId,
      requestId: `a2a_${input.buyerAgentSlug}_research_${Date.now()}`,
    }),
  );

  const ledger = await insertAgentToAgentLedger({
    fromWallet: buyer.address,
    toWallet: researchOwner.address,
    amount: usdFromPriceLabel(input.researchPriceLabel),
    settlement: result.transaction,
    remark: `${input.buyerAgentSlug} Agent → Research Agent`,
    agentSlug: input.buyerAgentSlug,
    buyerAgent: input.buyerAgentSlug,
    sellerAgent: 'research',
    requestId: result.transactionRef,
    context: `${input.buyerAgentSlug}->research`,
  });
  if (!ledger.ok) {
    console.warn(`[a2a] ${input.buyerAgentSlug}→research x402 paid but ledger failed:`, ledger.error);
    return result.data;
  }
  console.log(`[a2a] ${input.buyerAgentSlug} → research x402 complete`);
  return result.data;
}

/** Invoice pipeline: vendor due diligence (always runs when gated by caller). */
export async function runInvoiceVendorResearchFollowup(input: {
  vendor: string;
  amount: number;
  issuerWalletAddress?: string;
  researchRunUrl: string;
  researchPriceLabel: string;
}): Promise<Record<string, unknown> | null> {
  console.log(`[a2a] invoice→research hook start`, {
    vendor: input.vendor,
    amount: input.amount,
    researchRunUrl: input.researchRunUrl,
  });

  if (!(await isAgentHealthy('research'))) {
    console.warn('[a2a] research agent unreachable, skipping invoice→research');
    return null;
  }
  const buyer = await loadAgentOwnerWallet('invoice');
  const researchOwner = await loadAgentOwnerWallet('research');
  console.log(`[a2a] invoice→research payer`, {
    payer: buyer.address,
    circleWalletId: buyer.walletId,
  });

  const counterpartyRisk = await assessCounterpartyRisk({
    counterparty: input.vendor,
    amountUsdc: input.amount,
    ownerWalletAddress: input.issuerWalletAddress,
    purpose: 'invoice',
  });
  const vendorContext = JSON.stringify(counterpartyRisk, null, 2);
  const task = `Research vendor reputation and payment risk: ${input.vendor} (invoice amount ${input.amount} USDC).`;
  const x402Label = `invoice→research:vendor_${input.vendor.slice(0, 24)}`;
  const result = await payWithA2aX402Log(x402Label, () =>
    payProtectedResourceServer<
      { task?: string; result?: string; liveData?: Record<string, unknown> | null },
      {
        task: string;
        reasoningMode: 'fast' | 'deep';
        researchContext?: string;
        counterpartyRisk?: typeof counterpartyRisk;
        internalOnly?: boolean;
      }
    >({
      url: input.researchRunUrl,
      method: 'POST',
      body: {
        task,
        reasoningMode: 'fast',
        researchContext: vendorContext,
        counterpartyRisk,
        internalOnly: true,
      },
      circleWalletId: buyer.walletId,
      payer: buyer.address,
      chainId: ARC.chainId,
      requestId: `a2a_invoice_research_${Date.now()}`,
    }),
  );

  const ledger = await insertAgentToAgentLedger({
    fromWallet: buyer.address,
    toWallet: researchOwner.address,
    amount: usdFromPriceLabel(input.researchPriceLabel),
    settlement: result.transaction,
    remark: `Invoice Agent → Research Agent (vendor: ${input.vendor})`,
    agentSlug: 'invoice',
    buyerAgent: 'invoice',
    sellerAgent: 'research',
    requestId: result.transactionRef,
    context: 'invoice->research',
  });
  if (!ledger.ok) {
    console.warn('[a2a] invoice→research x402 paid but ledger failed:', ledger.error);
    return result.data;
  }
  console.log('[a2a] invoice → research x402 complete');
  return result.data;
}
