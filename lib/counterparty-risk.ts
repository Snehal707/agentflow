import { getAddress, isAddress } from 'viem';
import { adminDb } from '../db/client';
import { resolvePayee } from './agentpay-payee';

export type CounterpartyRiskLevel = 'low' | 'medium' | 'high';

export type CounterpartyRiskFactor = {
  label: string;
  impact: number;
  evidence: string;
};

export type CounterpartyRiskAssessment = {
  counterparty: string;
  ownerWallet?: string;
  amountUsdc?: number;
  purpose?: string;
  resolvedAddress: string | null;
  ownerAddress: string | null;
  resolutionStatus: 'resolved' | 'unresolved';
  score: number;
  level: CounterpartyRiskLevel;
  recommendation: string;
  factors: CounterpartyRiskFactor[];
  evidence: {
    contacts: Array<Record<string, unknown>>;
    invoices: Array<Record<string, unknown>>;
    paymentRequests: Array<Record<string, unknown>>;
    transactions: Array<Record<string, unknown>>;
    reputation: Record<string, unknown> | null;
  };
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function riskLevel(score: number): CounterpartyRiskLevel {
  if (score >= 80) return 'low';
  if (score >= 50) return 'medium';
  return 'high';
}

function compactRows(rows: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
  return rows.slice(0, limit).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value !== null && value !== undefined) out[key] = value;
    }
    return out;
  });
}

function amountOf(row: Record<string, unknown>): number {
  const value = Number(row.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function statusOf(row: Record<string, unknown>): string {
  return String(row.status ?? '').toLowerCase();
}

async function resolveCounterparty(counterparty: string, ownerWallet?: string): Promise<string | null> {
  try {
    if (isAddress(counterparty)) return getAddress(counterparty);
    return getAddress(await resolvePayee(counterparty, ownerWallet));
  } catch {
    return null;
  }
}

async function ownerFromDcw(address: string | null): Promise<string | null> {
  if (!address) return null;
  const { data } = await adminDb
    .from('wallets')
    .select('user_wallet')
    .eq('address', address)
    .eq('purpose', 'user_agent')
    .maybeSingle();
  const owner = String(data?.user_wallet ?? '').trim();
  return owner && isAddress(owner) ? getAddress(owner) : null;
}

async function loadContactMatches(ownerWallet: string | undefined, counterparty: string, resolved: string | null) {
  if (!ownerWallet) return [];
  const { data, error } = await adminDb
    .from('contacts')
    .select('id,name,address,label,notes,created_at,updated_at')
    .eq('wallet_address', ownerWallet)
    .limit(100);
  if (error || !data) return [];
  const cleanName = counterparty.replace(/\.arc$/i, '').toLowerCase();
  const resolvedLower = resolved?.toLowerCase();
  return compactRows(
    (data as Array<Record<string, unknown>>).filter((row) => {
      const name = String(row.name ?? '').toLowerCase();
      const address = String(row.address ?? '').toLowerCase();
      return name === cleanName || name === counterparty.toLowerCase() || Boolean(resolvedLower && address === resolvedLower);
    }),
    10,
  );
}

async function loadInvoices(ownerWallet: string | undefined, counterparty: string, resolved: string | null) {
  if (!ownerWallet) return [];
  const vendorBase = counterparty.replace(/\.arc$/i, '');
  const filters = [
    `vendor_handle.ilike.${counterparty}`,
    `vendor_handle.ilike.${vendorBase}`,
    `vendor_name.ilike.${counterparty}`,
    `vendor_name.ilike.${vendorBase}`,
  ];
  if (resolved) filters.push(`vendor_handle.ilike.${resolved}`);

  const { data, error } = await adminDb
    .from('invoices')
    .select('invoice_number,vendor_name,vendor_handle,amount,currency,status,business_wallet,payment_request_id,created_at,settled_at')
    .eq('business_wallet', ownerWallet)
    .or(filters.join(','))
    .order('created_at', { ascending: false })
    .limit(30);
  if (error || !data) return [];
  return compactRows(data as Array<Record<string, unknown>>, 30);
}

async function loadPaymentRequests(addresses: string[]) {
  const rows: Array<Record<string, unknown>> = [];
  for (const address of addresses) {
    const { data } = await adminDb
      .from('payment_requests')
      .select('amount,status,from_wallet,to_wallet,invoice_id,initiated_by,created_at,updated_at')
      .or(`from_wallet.eq.${address},to_wallet.eq.${address}`)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) rows.push(...(data as Array<Record<string, unknown>>));
  }
  return compactRows(rows, 30);
}

async function loadTransactions(addresses: string[]) {
  const rows: Array<Record<string, unknown>> = [];
  for (const address of addresses) {
    const { data } = await adminDb
      .from('transactions')
      .select('from_wallet,to_wallet,amount,status,remark,action_type,agent_slug,buyer_agent,seller_agent,payment_rail,created_at,arc_tx_id')
      .or(`from_wallet.eq.${address},to_wallet.eq.${address}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) rows.push(...(data as Array<Record<string, unknown>>));
  }
  return compactRows(rows, 50);
}

async function loadReputation(address: string | null) {
  if (!address) return null;
  const { data } = await adminDb
    .from('reputation_cache')
    .select('agent_address,score,total_calls,last_updated')
    .eq('agent_address', address)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

function pushFactor(
  factors: CounterpartyRiskFactor[],
  label: string,
  impact: number,
  evidence: string,
): void {
  factors.push({ label, impact, evidence });
}

function calculateAssessment(input: {
  counterparty: string;
  ownerWallet?: string;
  amountUsdc?: number;
  purpose?: string;
  resolvedAddress: string | null;
  ownerAddress: string | null;
  contacts: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  paymentRequests: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  reputation: Record<string, unknown> | null;
}): CounterpartyRiskAssessment {
  const factors: CounterpartyRiskFactor[] = [];
  let score = 50;

  if (input.resolvedAddress) {
    pushFactor(factors, 'Resolved identity', 10, `Resolved to ${input.resolvedAddress}.`);
    score += 10;
  } else {
    pushFactor(factors, 'Unresolved identity', -25, 'Could not resolve to a contact, .arc name, or wallet.');
    score -= 25;
  }

  if (input.contacts.length > 0) {
    pushFactor(factors, 'Saved contact', 15, 'Counterparty is in the owner contact book.');
    score += 15;
  } else {
    pushFactor(factors, 'Not saved as contact', -5, 'No matching saved contact for this owner.');
    score -= 5;
  }

  const settledInvoices = input.invoices.filter((row) => /paid|settled|complete/i.test(statusOf(row)));
  const riskyInvoices = input.invoices.filter((row) => /reject|failed|overdue|cancel/i.test(statusOf(row)));
  const pendingInvoices = input.invoices.filter((row) => /pending|open|review|approved/i.test(statusOf(row)));
  if (settledInvoices.length > 0) {
    pushFactor(factors, 'Settled invoice history', 10, `${settledInvoices.length} prior paid/settled invoice(s).`);
    score += 10;
  }
  if (riskyInvoices.length > 0) {
    pushFactor(factors, 'Problem invoice history', -20, `${riskyInvoices.length} rejected/failed/overdue/cancelled invoice(s).`);
    score -= 20;
  }
  if (pendingInvoices.length > 2) {
    pushFactor(factors, 'Many open invoices', -10, `${pendingInvoices.length} pending/open invoice(s).`);
    score -= 10;
  }

  const successfulTxs = input.transactions.filter((row) => /complete|success|settled/i.test(statusOf(row)));
  const failedTxs = input.transactions.filter((row) => /fail|reject|cancel/i.test(statusOf(row)));
  if (successfulTxs.length > 0) {
    pushFactor(factors, 'Successful transaction history', 20, `${successfulTxs.length} successful transaction(s) involving this counterparty wallet.`);
    score += 20;
  } else if (input.resolvedAddress) {
    pushFactor(factors, 'No transaction history', -10, 'Resolved wallet has no prior AgentFlow transaction history.');
    score -= 10;
  }
  if (failedTxs.length > 0) {
    pushFactor(factors, 'Failed transaction history', -20, `${failedTxs.length} failed/cancelled transaction(s).`);
    score -= 20;
  }

  const completedRequests = input.paymentRequests.filter((row) => /paid|complete|settled/i.test(statusOf(row)));
  const staleRequests = input.paymentRequests.filter((row) => /pending|open/i.test(statusOf(row)));
  if (completedRequests.length > 0) {
    pushFactor(factors, 'Completed payment requests', 8, `${completedRequests.length} completed payment request(s).`);
    score += 8;
  }
  if (staleRequests.length > 3) {
    pushFactor(factors, 'Many pending payment requests', -8, `${staleRequests.length} pending/open payment request(s).`);
    score -= 8;
  }

  const repScore = Number(input.reputation?.score ?? NaN);
  if (Number.isFinite(repScore) && repScore > 0) {
    const impact = repScore >= 80 ? 8 : repScore < 50 ? -15 : 0;
    pushFactor(factors, 'Reputation cache', impact, `Cached reputation score is ${repScore}.`);
    score += impact;
  }

  if (input.amountUsdc && input.amountUsdc > 0) {
    const historicAmounts = [...input.transactions, ...input.invoices].map(amountOf).filter((n) => n > 0);
    if (historicAmounts.length > 0) {
      const average = historicAmounts.reduce((sum, n) => sum + n, 0) / historicAmounts.length;
      if (input.amountUsdc > average * 3 && input.amountUsdc >= 10) {
        pushFactor(factors, 'Amount spike', -15, `Invoice amount ${input.amountUsdc} USDC is more than 3x historical average ${average.toFixed(2)} USDC.`);
        score -= 15;
      }
    } else if (input.amountUsdc >= 25) {
      pushFactor(factors, 'New counterparty amount', -8, `No history and requested amount is ${input.amountUsdc} USDC.`);
      score -= 8;
    }
  }

  const finalScore = clampScore(score);
  const level = riskLevel(finalScore);
  const recommendation =
    level === 'low'
      ? 'Proceed normally; internal AgentFlow history is favorable.'
      : level === 'medium'
        ? 'Proceed with normal confirmation and review the evidence before paying.'
        : 'Use caution; verify the counterparty or start with a smaller/manual payment.';

  return {
    counterparty: input.counterparty,
    ownerWallet: input.ownerWallet,
    amountUsdc: input.amountUsdc,
    purpose: input.purpose,
    resolvedAddress: input.resolvedAddress,
    ownerAddress: input.ownerAddress,
    resolutionStatus: input.resolvedAddress ? 'resolved' : 'unresolved',
    score: finalScore,
    level,
    recommendation,
    factors,
    evidence: {
      contacts: input.contacts,
      invoices: input.invoices,
      paymentRequests: input.paymentRequests,
      transactions: input.transactions,
      reputation: input.reputation,
    },
  };
}

export async function assessCounterpartyRisk(input: {
  counterparty: string;
  ownerWalletAddress?: string;
  amountUsdc?: number;
  purpose?: string;
}): Promise<CounterpartyRiskAssessment> {
  const ownerWallet = input.ownerWalletAddress?.trim() && isAddress(input.ownerWalletAddress)
    ? getAddress(input.ownerWalletAddress)
    : undefined;
  const resolvedAddress = await resolveCounterparty(input.counterparty, ownerWallet);
  const ownerAddress = await ownerFromDcw(resolvedAddress);
  const addressCandidates = [...new Set([resolvedAddress, ownerAddress].filter((v): v is string => Boolean(v)))];

  const [contacts, invoices, paymentRequests, transactions, reputation] = await Promise.all([
    loadContactMatches(ownerWallet, input.counterparty, resolvedAddress),
    loadInvoices(ownerWallet, input.counterparty, resolvedAddress),
    loadPaymentRequests(addressCandidates),
    loadTransactions(addressCandidates),
    loadReputation(resolvedAddress),
  ]);

  return calculateAssessment({
    counterparty: input.counterparty,
    ownerWallet,
    amountUsdc: input.amountUsdc,
    purpose: input.purpose,
    resolvedAddress,
    ownerAddress,
    contacts,
    invoices,
    paymentRequests,
    transactions,
    reputation,
  });
}

export function formatCounterpartyRiskReport(assessment: CounterpartyRiskAssessment): string {
  const lines = [
    `Counterparty Risk: ${assessment.counterparty}`,
    '',
    `Risk: ${assessment.level.toUpperCase()} (${assessment.score}/100)`,
    `Recommendation: ${assessment.recommendation}`,
    '',
    `Resolution: ${assessment.resolutionStatus}`,
  ];
  if (assessment.resolvedAddress) lines.push(`Resolved wallet: ${assessment.resolvedAddress}`);
  if (assessment.ownerAddress) lines.push(`Owner wallet: ${assessment.ownerAddress}`);
  if (assessment.amountUsdc !== undefined) lines.push(`Amount: ${assessment.amountUsdc} USDC`);
  if (assessment.purpose) lines.push(`Purpose: ${assessment.purpose}`);

  lines.push('', 'Factors:');
  for (const factor of assessment.factors) {
    const sign = factor.impact > 0 ? '+' : '';
    lines.push(`- ${factor.label} (${sign}${factor.impact}): ${factor.evidence}`);
  }

  lines.push('', 'Internal Evidence:');
  lines.push(`- Contact matches: ${assessment.evidence.contacts.length}`);
  lines.push(`- Invoice rows: ${assessment.evidence.invoices.length}`);
  lines.push(`- Payment requests: ${assessment.evidence.paymentRequests.length}`);
  lines.push(`- Transactions: ${assessment.evidence.transactions.length}`);
  lines.push(`- Reputation cache: ${assessment.evidence.reputation ? 'present' : 'none'}`);
  lines.push('', 'No public web search was used for this risk score.');

  return lines.join('\n');
}
