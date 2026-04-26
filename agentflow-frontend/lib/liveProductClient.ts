export type StoreAgent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  priceUsdc: number | null;
  reputationScore: number;
  status: string;
  available: boolean;
  source: "system" | "marketplace";
  arcHandle: string | null;
  devWallet: string | null;
  tokenId: string | null;
  agentCardUrl: string | null;
};

export type BusinessRecord = {
  wallet_address: string;
  business_name: string;
  invoice_email: string | null;
  telegram_id: string | null;
  auto_settle_below: number | null;
  require_approval_above: number | null;
  daily_settlement_cap: number | null;
  trusted_vendors: string[] | null;
  blocked_vendors: string[] | null;
  require_dual_approval: boolean | null;
};

export type BusinessInvoice = {
  id: string;
  business_wallet: string;
  vendor_name: string | null;
  vendor_email: string | null;
  vendor_handle: string | null;
  amount: number;
  currency: string;
  invoice_number: string | null;
  line_items: unknown;
  status: string;
  arc_tx_id: string | null;
  created_at: string;
  settled_at: string | null;
};

export type BusinessPublicPayment = {
  id: string;
  payer_wallet: string | null;
  amount: number;
  purpose: string | null;
  tx_hash: string | null;
  created_at: string;
  source?: "recorded" | "onchain";
};

/** Row from `transactions` (invoice_pay, swaps, etc.) */
export type BusinessLedgerTransaction = {
  id: string;
  from_wallet: string;
  to_wallet: string;
  amount: number;
  arc_tx_id: string | null;
  agent_slug: string | null;
  invoice_id: string | null;
  action_type: string | null;
  status: string | null;
  created_at: string;
};

export type BusinessDashboardResponse = {
  business: BusinessRecord | null;
  invoices: BusinessInvoice[];
  public_payments: BusinessPublicPayment[];
  message?: string;
  inbox_email?: string;
  arc_handle?: string;
  linked_telegram_id?: string | null;
  linked_telegram_username?: string | null;
  linked_telegram_display_name?: string | null;
};

export type BusinessRulesPatch = Partial<
  Pick<
    BusinessRecord,
    | "auto_settle_below"
    | "require_approval_above"
    | "daily_settlement_cap"
    | "telegram_id"
    | "trusted_vendors"
    | "blocked_vendors"
  >
>;

export type BusinessOnboardInput = {
  business_name: string;
  arc_handle: string;
  telegram_id?: string | null;
};

export class ClientApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ClientApiError(
      response.status,
      (json as { error?: string }).error || fallback,
    );
  }
  return json;
}

/** Avoid infinite “Loading…” when backend/RPC/Circle is slow or unreachable. */
const AGENTPAY_FETCH_TIMEOUT_MS = 28_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number = AGENTPAY_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStoreAgents(): Promise<StoreAgent[]> {
  const response = await fetch("/api/agent-store/agents", {
    cache: "no-store",
  });
  const json = await readJson<{ agents: StoreAgent[] }>(response, "Store fetch failed");
  return Array.isArray(json.agents) ? json.agents : [];
}

export async function fetchBusinessDashboard(
  authHeaders: Record<string, string>,
): Promise<BusinessDashboardResponse> {
  const response = await fetch("/api/business/me", {
    headers: authHeaders,
    cache: "no-store",
  });
  return readJson<BusinessDashboardResponse>(response, "Business dashboard failed");
}

export async function fetchBusinessTransactions(
  authHeaders: Record<string, string>,
  options?: { limit?: number },
): Promise<BusinessLedgerTransaction[]> {
  const limit = options?.limit ?? 50;
  const response = await fetch(
    `/api/business/transactions?limit=${encodeURIComponent(String(limit))}`,
    {
      headers: authHeaders,
      cache: "no-store",
    },
  );
  const json = await readJson<{ transactions: BusinessLedgerTransaction[] }>(
    response,
    "Business transactions failed",
  );
  return Array.isArray(json.transactions) ? json.transactions : [];
}

export async function updateBusinessRules(
  authHeaders: Record<string, string>,
  patch: BusinessRulesPatch,
): Promise<BusinessRecord> {
  const response = await fetch("/api/business/rules", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(patch),
  });
  const json = await readJson<{ business: BusinessRecord }>(
    response,
    "Business rules update failed",
  );
  return json.business;
}

export async function onboardBusiness(
  authHeaders: Record<string, string>,
  payload: BusinessOnboardInput,
): Promise<BusinessDashboardResponse> {
  const response = await fetch("/api/business/onboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  });
  return readJson<BusinessDashboardResponse>(response, "Business onboarding failed");
}

export async function approveBusinessInvoice(
  authHeaders: Record<string, string>,
  invoiceId: string,
): Promise<{ success: boolean; invoice: BusinessInvoice; txHash?: string }> {
  const response = await fetch(`/api/business/invoices/${invoiceId}/approve`, {
    method: "POST",
    headers: authHeaders,
  });
  return readJson<{ success: boolean; invoice: BusinessInvoice; txHash?: string }>(
    response,
    "Invoice approval failed",
  );
}

export async function rejectBusinessInvoice(
  authHeaders: Record<string, string>,
  invoiceId: string,
): Promise<{ success: boolean; invoice: BusinessInvoice }> {
  const response = await fetch(`/api/business/invoices/${invoiceId}/reject`, {
    method: "POST",
    headers: authHeaders,
  });
  return readJson<{ success: boolean; invoice: BusinessInvoice }>(
    response,
    "Invoice rejection failed",
  );
}

/** AgentPay */
export type PayContextResponse = {
  walletAddress: string;
  /** Circle DCW execution address on Arc (USDC send/receive). */
  userAgentWalletAddress: string;
  arc_handle: string | null;
  /** On-chain AgentPayRegistry `.arc` name for the user's execution wallet. */
  chain_arc_name?: string | null;
  chain_arc_expires_at?: string | null;
};

export type PaySendResponse = {
  txHash: string;
  explorerLink: string;
};

export type PaymentRequestRow = {
  id: string;
  from_wallet: string;
  to_wallet: string;
  amount: number;
  remark: string | null;
  status: string;
  initiated_by: string | null;
  created_at: string;
  expires_at?: string | null;
  paid_at?: string | null;
  arc_tx_id?: string | null;
  invoice_id?: string | null;
  invoices?: {
    id: string;
    invoice_number: string | null;
    vendor_name: string | null;
    line_items: unknown | null;
    created_at: string | null;
  } | null;
};

export type PayRequestsResponse = {
  incoming: PaymentRequestRow[];
  outgoing: PaymentRequestRow[];
};

export type PayHistoryRow = {
  id: string;
  from_wallet: string;
  to_wallet: string;
  amount: number;
  arc_tx_id: string | null;
  agent_slug: string | null;
  invoice_id: string | null;
  action_type: string | null;
  status: string | null;
  remark: string | null;
  created_at: string;
  direction: "in" | "out";
  explorerLink: string | null;
};

export type ScheduledPaymentRow = {
  id: string;
  wallet_address: string;
  to_address: string;
  to_name: string | null;
  amount: number;
  remark: string | null;
  schedule_type: "daily" | "weekly_day" | "monthly_day" | string;
  schedule_value: string;
  next_run: string;
  created_at: string;
  execution_count: number | null;
  status: string | null;
  last_run?: string | null;
};

export async function fetchPayContext(
  authHeaders: Record<string, string>,
): Promise<PayContextResponse> {
  const response = await fetchWithTimeout("/api/pay/context", {
    headers: authHeaders,
    cache: "no-store",
  });
  return readJson<PayContextResponse>(response, "AgentPay context failed");
}

export async function postPaySend(
  authHeaders: Record<string, string>,
  body: { toAddress: string; amount: number; remark?: string | null },
): Promise<PaySendResponse> {
  const response = await fetch("/api/pay/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(body),
  });
  return readJson<PaySendResponse>(response, "AgentPay send failed");
}

export async function postPayRequest(
  authHeaders: Record<string, string>,
  body: { fromWallet: string; amount: number; remark?: string | null },
): Promise<{ requestId: string }> {
  const response = await fetch("/api/pay/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(body),
  });
  return readJson<{ requestId: string }>(response, "AgentPay request failed");
}

export async function fetchPayRequests(
  authHeaders: Record<string, string>,
): Promise<PayRequestsResponse> {
  const response = await fetch("/api/pay/requests", {
    headers: authHeaders,
    cache: "no-store",
  });
  const json = await readJson<PayRequestsResponse>(response, "AgentPay requests failed");
  return {
    incoming: Array.isArray(json.incoming) ? json.incoming : [],
    outgoing: Array.isArray(json.outgoing) ? json.outgoing : [],
  };
}

export async function postPayApprove(
  authHeaders: Record<string, string>,
  requestId: string,
): Promise<{ txHash: string; explorerLink: string }> {
  const response = await fetch(`/api/pay/approve/${encodeURIComponent(requestId)}`, {
    method: "POST",
    headers: authHeaders,
  });
  return readJson<{ txHash: string; explorerLink: string }>(
    response,
    "AgentPay approve failed",
  );
}

export async function postPayDecline(
  authHeaders: Record<string, string>,
  requestId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/pay/decline/${encodeURIComponent(requestId)}`, {
    method: "POST",
    headers: authHeaders,
  });
  return readJson<{ success: boolean }>(response, "AgentPay decline failed");
}

export async function fetchPayHistory(
  authHeaders: Record<string, string>,
  options?: { limit?: number; type?: "in" | "out" | "" },
): Promise<PayHistoryRow[]> {
  const limit = options?.limit ?? 80;
  const type = options?.type ?? "";
  const qs = new URLSearchParams({
    limit: String(limit),
    ...(type ? { type } : {}),
  });
  const response = await fetch(`/api/pay/history?${qs.toString()}`, {
    headers: authHeaders,
    cache: "no-store",
  });
  const json = await readJson<{ transactions: PayHistoryRow[] }>(
    response,
    "AgentPay history failed",
  );
  return Array.isArray(json.transactions) ? json.transactions : [];
}

export async function fetchScheduledPayments(
  authHeaders: Record<string, string>,
): Promise<ScheduledPaymentRow[]> {
  const response = await fetch("/api/pay/schedule", {
    headers: authHeaders,
    cache: "no-store",
  });
  const json = await readJson<{ schedules: ScheduledPaymentRow[] }>(
    response,
    "Scheduled payments fetch failed",
  );
  return Array.isArray(json.schedules) ? json.schedules : [];
}

export async function deleteScheduledPayment(
  authHeaders: Record<string, string>,
  scheduleId: string,
): Promise<{ ok: boolean }> {
  const response = await fetch(`/api/pay/schedule/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  return readJson<{ ok: boolean }>(response, "Scheduled payment cancel failed");
}

export async function exportAgentPayWorkbook(
  authHeaders: Record<string, string>,
): Promise<Blob> {
  const response = await fetch("/api/pay/export", {
    method: "POST",
    headers: authHeaders,
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ClientApiError(
      response.status,
      err.error || "AgentPay export failed",
    );
  }
  return response.blob();
}

/** Arc Testnet native USDC (from backend `api/wallet.ts`). */
const ARC_USDC_CONTRACT = "0x3600000000000000000000000000000000000000";

export type WalletBalanceHolding = {
  contractAddress?: string | null;
  symbol?: string | null;
  balance?: number;
  balanceFormatted?: string | number | null;
};

export type WalletBalanceResponse = {
  walletAddress: string;
  userAgentWalletAddress: string;
  holdings: WalletBalanceHolding[];
};

export async function fetchWalletBalance(
  authHeaders: Record<string, string>,
): Promise<WalletBalanceResponse> {
  const response = await fetchWithTimeout("/api/wallet/balance", {
    headers: authHeaders,
    cache: "no-store",
  });
  return readJson<WalletBalanceResponse>(response, "Wallet balance failed");
}

/** Prefer USDC by symbol; fallback to known Arc USDC contract (case-insensitive). */
export function pickUsdcBalance(holdings: WalletBalanceHolding[]): number | null {
  if (!Array.isArray(holdings)) return null;
  let fromSymbol: number | null = null;
  let fromContract: number | null = null;
  for (const h of holdings) {
    const rawBalance = h.balance ?? h.balanceFormatted;
    const bal = typeof rawBalance === "number" ? rawBalance : Number(rawBalance);
    if (typeof bal !== "number" || !Number.isFinite(bal)) continue;
    const sym = (h.symbol || "").toUpperCase();
    if (sym === "USDC") {
      fromSymbol = bal;
      break;
    }
    const ca = (h.contractAddress || "").toLowerCase();
    if (ca === ARC_USDC_CONTRACT.toLowerCase()) {
      fromContract = bal;
    }
  }
  if (fromSymbol !== null) return fromSymbol;
  if (fromContract !== null) return fromContract;
  return null;
}

/** On-chain AgentPayRegistry (.arc) — public checks */
export async function fetchArcNameAvailability(
  bareName: string,
): Promise<{ available: boolean; name: string; registrationFeeUsdc?: number }> {
  const q = encodeURIComponent(bareName.replace(/\.arc$/i, "").trim());
  const response = await fetch(`/api/pay/name/check/${q}`, { cache: "no-store" });
  return readJson<{ available: boolean; name: string; registrationFeeUsdc?: number }>(
    response,
    "Name check failed",
  );
}

export type MyArcNameResponse = {
  name: string | null;
  expiresAt: string | null;
};

export async function fetchMyArcName(
  authHeaders: Record<string, string>,
): Promise<MyArcNameResponse> {
  const response = await fetchWithTimeout("/api/pay/name/my", {
    headers: authHeaders,
    cache: "no-store",
  });
  return readJson<MyArcNameResponse>(response, "My arc name failed");
}

export async function postArcNameRegister(
  authHeaders: Record<string, string>,
  body: { name: string; dcwWallet?: string },
): Promise<{ txHash: string; name: string }> {
  const response = await fetch("/api/pay/name/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  return readJson<{ txHash: string; name: string }>(response, "Register failed");
}

export async function postArcNameRenew(
  authHeaders: Record<string, string>,
): Promise<{ txHash: string; newExpiry?: string }> {
  const response = await fetch("/api/pay/name/renew", {
    method: "POST",
    headers: authHeaders,
  });
  return readJson<{ txHash: string; newExpiry?: string }>(response, "Renew failed");
}

export async function putArcNameDcw(
  authHeaders: Record<string, string>,
  body: { newDcwWallet: string },
): Promise<{ txHash: string }> {
  const response = await fetch("/api/pay/name/dcw", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
  return readJson<{ txHash: string }>(response, "Update DCW failed");
}

export type EconomyAgentSpec = {
  slug: string;
  name: string;
  category: string;
  priceUsdc: number;
};

export type EconomyAgentRollup = {
  earned: number;
  spent: number;
  tasks: number;
};

export type EconomyTransaction = {
  id: string;
  from_wallet: string;
  to_wallet: string;
  amount: number;
  arc_tx_id: string | null;
  agent_slug: string | null;
  invoice_id: string | null;
  action_type: string | null;
  status: string | null;
  created_at: string;
  remark: string | null;
  payment_rail?: string | null;
  buyer_agent?: string | null;
  seller_agent?: string | null;
  request_id?: string | null;
  gateway_transfer_id?: string | null;
};

export type EconomyStats = {
  today: {
    settlements: number;
    tasks: number;
    usdc: string;
    a2a_payments: number;
    arc_gas_paid: string;
    arc_gas_attribution?: "batcher_onchain" | "direct_onchain" | "placeholder" | "none";
    arc_gas_buyer_onchain_usd?: string;
    arc_gas_batcher_attributed_usd?: string;
    arc_gas_attributed_tx_count?: number;
    arc_gas_attributed_transfer_count?: number;
    net_margin: string;
  };
  all_time: {
    settlements: number;
    tasks: number;
    usdc: string;
    a2a_payments: number;
  };
  agent_specs: EconomyAgentSpec[];
  agent_earnings: Record<string, EconomyAgentRollup>;
  a2a_chains: Record<string, number>;
  hourly_activity: Record<string, number[]>;
  gateway_balances: Record<string, number>;
  treasury: {
    total_dcw: string;
    total_gateway: string;
    agents_needing_topup: number;
    agents: Array<{
      slug: string;
      dcw: string;
      gateway: string;
      status: "low" | "ok";
    }>;
  } | null;
  latest_transactions: EconomyTransaction[];
  /** Latest ledger rows for `agent_to_agent_payment` (x402 / Gateway). */
  recent_a2a_payments?: EconomyTransaction[];
  arc_vs_ethereum: {
    arc_gas_per_tx: string;
    ethereum_gas_per_tx: string;
    savings_multiplier: string;
    min_viable_payment_arc: string;
    min_viable_payment_eth: string;
  };
};

export type EconomyBenchmarkResult = {
  total_txs: number;
  total_usdc: string;
  gas_paid: string;
  margin: string;
  results: Array<{
    tx: number;
    amount: string;
    agent: string;
    txHash?: string;
    status: "success" | "failed";
    error?: string;
  }>;
  agents_covered: string[];
  flows_completed: string[];
  arc_tx_ids: string[];
  breakdown: {
    x402_payments: number;
    a2a_payments: number;
  };
  arc_vs_eth: {
    arc_cost: string;
    eth_cost: string;
    savings: string;
  };
  execution_wallet?: string;
};

export type EconomyBenchmarkJobStatus = {
  jobId: string;
  status: "queued" | "running" | "complete" | "failed";
  walletAddress: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  progress: {
    completed: number;
    total: number;
    successful: number;
    failed: number;
    currentAgent: string | null;
  };
  result: EconomyBenchmarkResult | null;
  error: string | null;
};

export async function fetchEconomyStats(): Promise<EconomyStats> {
  const response = await fetch("/api/economy", {
    cache: "no-store",
  });
  return readJson<EconomyStats>(response, "Economy stats failed");
}

export async function startEconomyBenchmark(
  authHeaders: Record<string, string>,
): Promise<EconomyBenchmarkJobStatus> {
  const response = await fetch("/api/economy", {
    method: "POST",
    headers: authHeaders,
  });
  return readJson<EconomyBenchmarkJobStatus>(response, "Economy benchmark failed");
}

export async function fetchEconomyBenchmarkStatus(
  authHeaders: Record<string, string>,
  jobId: string,
): Promise<EconomyBenchmarkJobStatus> {
  const response = await fetch(`/api/economy/benchmark/${encodeURIComponent(jobId)}`, {
    headers: authHeaders,
    cache: "no-store",
  });
  return readJson<EconomyBenchmarkJobStatus>(
    response,
    "Economy benchmark status failed",
  );
}
