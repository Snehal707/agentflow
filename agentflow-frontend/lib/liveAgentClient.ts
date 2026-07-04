import { getAddress, type Address, type WalletClient } from "viem";
import { defaultPriceBySlug, getAgentRunUrl } from "@/lib/agentEndpoints";
import { ARC_CHAIN_ID } from "@/lib/arcChain";
import { fetchBrowserApi, getBrowserBackendUrl } from "@/lib/browserApi";
import { persistPortfolioSnapshot } from "@/lib/persistedWalletCache";
import {
  createBrowserX402RequestId,
  payProtectedFetchWithMeta,
  payProtectedResource,
  type PayProtectedResourceResult,
} from "@/lib/x402BrowserClient";
import { sanitizeAssistantStreamDelta } from "../../lib/sanitizeAssistantStreamDelta";

export type PipelineStepKey = "research" | "analyst" | "writer";

export type ResearchFactStatus = "confirmed" | "reported" | "analysis";

export type ResearchSource = {
  name?: string;
  url?: string;
  used_for?: string;
  usedFor?: string;
};

export type ResearchFact = {
  status?: ResearchFactStatus;
};

export type ResearchPayload = {
  sources?: ResearchSource[];
  facts?: ResearchFact[];
  recent_developments?: ResearchFact[];
};

export type LiveDataPayload = {
  dynamic_sources?: {
    articles?: Array<{
      title?: string;
      url?: string;
      publisher?: string;
      summary?: string;
    }>;
  };
  sources?: Array<{
    title?: string;
    domain?: string;
    url?: string;
    summary?: string;
  }>;
  coingecko?: {
    assets?: Array<{
      coinId?: string;
    }>;
  };
  current_events?: {
    freshness?: "fresh" | "stale_or_thin";
    has_recent_articles?: boolean;
    latest_seen_at?: string;
    recency_window_days?: number;
  };
  premise_check?: {
    note?: string;
  };
};

export type PipelineEvent =
  | { type: "step_start"; step: PipelineStepKey; price: string }
  | { type: "step_complete"; step: PipelineStepKey; tx?: string; amount?: string }
  | {
      type: "receipt";
      entries?: Array<{
        requestId: string;
        agent: string;
        price?: string;
        payer?: string;
        mode?: "dcw" | "eoa" | "sponsored" | "a2a";
        sponsored?: boolean;
        buyerAgent?: string;
        sellerAgent?: string;
        transactionRef?: string | null;
        settlementTxHash?: string | null;
      }>;
      researchTx?: string;
      analystTx?: string;
      writerTx?: string;
      total?: string;
    }
  | {
      type: "report";
      markdown: string;
      research?: ResearchPayload | null;
      analysis?: Record<string, unknown> | null;
      liveData?: LiveDataPayload | null;
      sources?: ResearchSource[] | null;
    }
  | { type: "error"; message: string; step?: PipelineStepKey };

export type PortfolioHolding = {
  id: string;
  kind: "native" | "erc20" | "vault_share";
  symbol: string;
  name: string;
  address: string | null;
  balanceRaw: string;
  balanceFormatted: string;
  usdPrice: number | null;
  usdValue: number | null;
  source: string;
  notes: string[];
};

export type PortfolioPosition = {
  id: string;
  kind: "swap_liquidity" | "gateway_position";
  name: string;
  protocol: string;
  amountFormatted: string;
  usdValue: number | null;
  costBasisUsd: number | null;
  pnlUsd: number | null;
  notes: string[];
};

export type PortfolioRecentTransaction = {
  hash: string;
  timestamp: string;
  status: string;
  method: string;
  from: string;
  to: string | null;
  summary: string;
  explorerUrl: string;
};

export type PortfolioTransfer = {
  hash: string;
  timestamp: string;
  token: string;
  tokenAddress: string;
  direction: "in" | "out";
  amount: string;
  counterparty: string;
  counterpartyName: string | null;
  type: string | null;
};

export type PortfolioPnlSummary = {
  costBasisUsd: number;
  currentValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
  methodology: string;
};

export type PortfolioDiagnostics = {
  alchemyRpcProvider: string;
  arcData?: {
    rpcAvailable: boolean;
    tokenApiUsed: boolean;
    note: string;
    error: string | null;
  };
  alchemyEnhanced: {
    available: boolean;
    error: string | null;
  };
  explorerBaseUrl: string;
  gatewayBalance: {
    source: "gateway_api" | "transfer_estimate";
    error: string | null;
  };
};

export type PortfolioSnapshotResponse = {
  walletAddress: string;
  holdings: PortfolioHolding[];
  positions: PortfolioPosition[];
  recentTransactions: PortfolioRecentTransaction[];
  tokenTransfers: PortfolioTransfer[];
  pnlSummary: PortfolioPnlSummary;
  diagnostics: PortfolioDiagnostics;
};

export type PortfolioAgentResponse = {
  success: boolean;
  holdings: PortfolioHolding[];
  positions: PortfolioPosition[];
  transfers: PortfolioTransfer[];
  recentTransactions: PortfolioRecentTransaction[];
  pnl: PortfolioPnlSummary;
  riskScore: number;
  recommendations: string[];
  notes: string[];
  report: string;
  diagnostics: PortfolioDiagnostics;
  analysisRaw?: string;
  payment?: {
    mode?: string;
    payer?: string;
    transaction?: string;
  };
};

export type ExecutionWalletSummary = {
  walletAddress: string;
  userAgentWalletAddress: string;
  userAgentWalletId: string;
  /** On-chain address that receives Gateway deposits; Circle indexes Gateway USDC by this depositor. */
  gatewayFundingAddress?: string;
  explorerUrl: string;
  balances: {
    nativeUsdcGas: {
      raw: string;
      formatted: string;
    };
    usdc: {
      raw: string;
      formatted: string;
    };
    eurc: {
      raw: string;
      formatted: string;
    };
    vaultShares: {
      raw: string;
      formatted: string;
    };
    gatewayUsdc: {
      raw: string;
      formatted: string;
      total: string;
    };
  };
  fundingStatus: {
    needsGasFunding: boolean;
    needsUsdcFunding: boolean;
    needsEurcFunding: boolean;
    needsVaultShares: boolean;
  };
  holdings: unknown[];
};

export type DcwVaultAction = "deposit" | "withdraw";

export type DcwVaultActionResponse = {
  success: boolean;
  action?: DcwVaultAction | string;
  txHash?: string;
  explorerLink?: string | null;
  error?: string;
};

type PortfolioSnapshotCacheEntry = {
  snapshot: PortfolioSnapshotResponse;
  expiresAt: number;
};

type ExecutionWalletSummaryCacheEntry = {
  summary: ExecutionWalletSummary;
  expiresAt: number;
};

const PORTFOLIO_SNAPSHOT_TTL_MS = 60_000;
const EXECUTION_WALLET_SUMMARY_TTL_MS = 30_000;
const portfolioSnapshotCache = new Map<string, PortfolioSnapshotCacheEntry>();
const portfolioSnapshotInflight = new Map<string, Promise<PortfolioSnapshotResponse>>();
const executionWalletSummaryCache = new Map<string, ExecutionWalletSummaryCacheEntry>();
const executionWalletSummaryInflight = new Map<string, Promise<ExecutionWalletSummary>>();

function normalizePortfolioSnapshotError(message: string | undefined): string {
  const text = (message ?? "").trim();
  if (/429|too many requests|rate limit/i.test(text)) {
    return "Arc portfolio reads are being rate-limited right now. Retry in a few seconds.";
  }
  if (/eth_call|viem@|request body|raw call arguments|contract call/i.test(text)) {
    return "Arc portfolio reads failed while querying live balances. Retry in a few seconds.";
  }
  return text || "Portfolio snapshot failed";
}

function normalizeExecutionWalletSummaryError(message: string | undefined): string {
  const text = (message ?? "").trim();
  if (/401|unauthorized|token|jwt|signature|expired|bearer/i.test(text)) {
    return "Session expired. Re-sign your AgentFlow session to reload balances.";
  }
  if (/429|too many requests|rate limit|compute units|capacity/i.test(text)) {
    return "Arc wallet balance reads are being rate-limited right now. Retry in a few seconds.";
  }
  if (/eth_call|eth_getbalance|viem@|request body|raw call arguments|contract call|alchemy/i.test(text)) {
    return "Arc wallet balance reads failed while querying live balances. Retry in a few seconds.";
  }
  return text || "Execution wallet fetch failed";
}

function normalizeExecutionWalletSummary(
  json: Partial<ExecutionWalletSummary> & { error?: string },
): ExecutionWalletSummary {
  const balances = (json.balances ?? {}) as Partial<ExecutionWalletSummary["balances"]>;
  const fundingStatus = (json.fundingStatus ??
    {}) as Partial<ExecutionWalletSummary["fundingStatus"]>;

  return {
    walletAddress: typeof json.walletAddress === "string" ? json.walletAddress : "",
    userAgentWalletAddress:
      typeof json.userAgentWalletAddress === "string" ? json.userAgentWalletAddress : "",
    userAgentWalletId:
      typeof json.userAgentWalletId === "string" ? json.userAgentWalletId : "",
    gatewayFundingAddress:
      typeof json.gatewayFundingAddress === "string" ? json.gatewayFundingAddress : undefined,
    explorerUrl: typeof json.explorerUrl === "string" ? json.explorerUrl : "",
    balances: {
      nativeUsdcGas: {
        raw:
          typeof balances.nativeUsdcGas?.raw === "string"
            ? balances.nativeUsdcGas.raw
            : "0",
        formatted:
          typeof balances.nativeUsdcGas?.formatted === "string"
            ? balances.nativeUsdcGas.formatted
            : "0",
      },
      usdc: {
        raw: typeof balances.usdc?.raw === "string" ? balances.usdc.raw : "0",
        formatted:
          typeof balances.usdc?.formatted === "string"
            ? balances.usdc.formatted
            : "0",
      },
      eurc: {
        raw: typeof balances.eurc?.raw === "string" ? balances.eurc.raw : "0",
        formatted:
          typeof balances.eurc?.formatted === "string"
            ? balances.eurc.formatted
            : "0",
      },
      vaultShares: {
        raw:
          typeof balances.vaultShares?.raw === "string"
            ? balances.vaultShares.raw
            : "0",
        formatted:
          typeof balances.vaultShares?.formatted === "string"
            ? balances.vaultShares.formatted
            : "0",
      },
      gatewayUsdc: {
        raw:
          typeof balances.gatewayUsdc?.raw === "string"
            ? balances.gatewayUsdc.raw
            : "0",
        formatted:
          typeof balances.gatewayUsdc?.formatted === "string"
            ? balances.gatewayUsdc.formatted
            : "0",
        total:
          typeof balances.gatewayUsdc?.total === "string"
            ? balances.gatewayUsdc.total
            : "0",
      },
    },
    fundingStatus: {
      needsGasFunding: Boolean(fundingStatus.needsGasFunding),
      needsUsdcFunding: Boolean(fundingStatus.needsUsdcFunding),
      needsEurcFunding: Boolean(fundingStatus.needsEurcFunding),
      needsVaultShares: Boolean(fundingStatus.needsVaultShares),
    },
    holdings: Array.isArray(json.holdings) ? json.holdings : [],
  };
}

function findHoldingBalance(
  holdings: PortfolioHolding[],
  matcher: (holding: PortfolioHolding) => boolean,
): { raw: string; formatted: string } {
  const holding = holdings.find(matcher);
  if (!holding) {
    return { raw: "0", formatted: "0" };
  }
  return {
    raw: holding.balanceRaw || "0",
    formatted: holding.balanceFormatted || "0",
  };
}

type PipelineInput = {
  task: string;
  walletAddress: string;
  signal?: AbortSignal;
  onEvent: (event: PipelineEvent) => void;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type ConversationInput = {
  message: string;
  /** Visible user text only (omit portfolio / injected context). Used server-side for capability FAQ routing only. */
  rawUserMessage?: string;
  quickActionContext?: {
    actionId?: string;
    prompt: string;
  };
  messages: ConversationMessage[];
  walletAddress?: string;
  executionTarget?: "EOA" | "DCW";
  browserTimeZone?: string;
  browserLocale?: string;
  sessionId?: string;
  signal?: AbortSignal;
  authHeaders?: Record<string, string>;
  onDelta: (delta: string) => void;
  onMeta?: (meta: {
    eventId?: string;
    title?: string;
    trace?: Array<string | { label: string; txHash?: string; explorerUrl?: string }>;
    reportMeta?: {
      kind: "research" | "portfolio" | "execution";
      diagnostics?: string[];
      highlights?: string[];
    };
    activityMeta?: {
      mode?: "brain";
      clusters?: string[];
      stageBars?: number[];
    };
    paymentMeta?: {
      entries: Array<{
        requestId: string;
        agent: string;
        price?: string;
        payer?: string;
        mode?: "dcw" | "eoa" | "sponsored" | "a2a";
        sponsored?: boolean;
        buyerAgent?: string;
        sellerAgent?: string;
        transactionRef?: string | null;
        settlementTxHash?: string | null;
      }>;
    };
    ratingMeta?: {
      taskId: string;
      requestId: string;
      agentSlug: string;
      settlementRef: string;
    };
    confirmation?: {
      required: boolean;
      action: "swap" | "vault" | "bridge" | "execute" | "schedule" | "split" | "invoice" | "batch";
    };
    quickActionGroups?: Array<{
      title?: string;
      actions: Array<{
        label: string;
        prompt: string;
        actionId?: string;
        tone?: "primary" | "secondary";
      }>;
    }>;
    paymentLink?: {
      handle: string;
      displayHandle: string;
      amount: string | null;
      remark: string | null;
      path: string;
    };
    researchQueued?: {
      jobId: string;
      position: number;
    };
  }) => void;
  /** Fired for raw pipeline report lines (`type: "report"`), e.g. if the server or proxy forwards POST /run SSE. */
  onReport?: (event: Extract<PipelineEvent, { type: "report" }>) => void;
  /** Pipeline-style error (`type: "error"`) with message; if unset, the stream still throws. */
  onPipelineError?: (message: string, step?: PipelineStepKey) => void;
};

type PortfolioRunInput = {
  walletClient: WalletClient;
  payer: Address;
  walletAddress: string;
  executionTarget?: "EOA" | "DCW";
  authHeaders: Record<string, string>;
  onAwaitSignature?: () => void;
};

type PaidAgentRunInput<TBody extends Record<string, unknown>> = {
  slug: "swap" | "vault" | "vision" | "transcribe";
  walletClient: WalletClient;
  payer: Address;
  authHeaders: Record<string, string>;
  body: TBody;
  onAwaitSignature?: () => void;
};

type AgentRunPayment = {
  requestId?: string;
  agent?: string;
  price?: string;
  payer?: string;
  mode?: string;
  transaction?: string | null;
  transactionRef?: string | null;
  settlement?: unknown;
  settlementTxHash?: string | null;
  sponsored?: boolean;
  buyerAgent?: string;
  sellerAgent?: string;
};

type PaymentBearingResponse = Record<string, unknown> & {
  payment?: AgentRunPayment;
};

function createClientRequestId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function paymentPriceLabel(slug: string): string {
  const price = defaultPriceBySlug[slug];
  return price ? `$${price} USDC` : "";
}

function attachBrowserPaymentMetadata<TResponse>(
  slug: string,
  payer: Address,
  result: PayProtectedResourceResult<TResponse>,
): TResponse {
  if (!result.data || typeof result.data !== "object") {
    return result.data;
  }
  const data = result.data as PaymentBearingResponse;
  data.payment = {
    ...(data.payment ?? {}),
    requestId: data.payment?.requestId ?? result.requestId,
    agent: data.payment?.agent ?? slug,
    price: data.payment?.price ?? paymentPriceLabel(slug),
    payer: data.payment?.payer ?? payer,
    mode: data.payment?.mode ?? "EOA",
    transaction: data.payment?.transaction ?? result.transaction ?? null,
    transactionRef: data.payment?.transactionRef ?? result.transaction ?? null,
    settlementTxHash: data.payment?.settlementTxHash ?? result.transaction ?? null,
  };
  return data as TResponse;
}

async function runAuthedAgent<TResponse>(
  slug: "transcribe",
  body: Record<string, unknown>,
  authHeaders: Record<string, string>,
): Promise<TResponse> {
  const response = await fetch(getAgentRunUrl(slug), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = (await response.json().catch(() => ({}))) as TResponse & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(json.error || `${slug} run failed`);
  }
  return json;
}

async function runDcwPaidAgent<TResponse>(
  slug: "swap" | "vault" | "portfolio" | "vision" | "transcribe",
  body: Record<string, unknown>,
  authHeaders: Record<string, string>,
): Promise<TResponse> {
  const requestId = createClientRequestId(`dcw_${slug}`);
  const response = await fetch(`/api/dcw/agents/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agentflow-request-id": requestId,
      ...authHeaders,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = (await response.json().catch(() => ({}))) as TResponse & {
    error?: string;
    payment?: AgentRunPayment;
  };
  if (!response.ok) {
    throw new Error(json.error || `${slug} DCW run failed`);
  }
  if (json && typeof json === "object") {
    json.payment = {
      ...(json.payment ?? {}),
      requestId: json.payment?.requestId ?? requestId,
      agent: json.payment?.agent ?? slug,
      price: json.payment?.price ?? paymentPriceLabel(slug),
      mode: json.payment?.mode ?? "DCW",
    };
  }
  return json;
}

export async function ensureCircleWallet(walletAddress: string): Promise<void> {
  const response = await fetch(getBrowserBackendUrl("/wallet/create"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAddress: walletAddress }),
  });

  if (response.ok || response.status === 200) {
    return;
  }

  const json = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(json.error || "Could not prepare Circle wallet");
}

export async function streamAgentFlow(input: PipelineInput): Promise<void> {
  await ensureCircleWallet(input.walletAddress);

  const response = await fetch(getBrowserBackendUrl("/run"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task: input.task,
      userAddress: input.walletAddress,
    }),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Pipeline failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }

    const raw = trimmed.slice(5).trim();
    if (!raw) {
      return;
    }

    input.onEvent(JSON.parse(raw) as PipelineEvent);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      processLine(line);
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      processLine(line);
    }
  }
}

export async function streamConversationReply(
  input: ConversationInput,
): Promise<void> {
  const response = await fetch(getBrowserBackendUrl("/api/chat/respond"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.sessionId ? { "x-session-id": input.sessionId } : {}),
      ...(input.authHeaders ?? {}),
    },
    body: JSON.stringify({
      message: input.message,
      ...(input.rawUserMessage !== undefined
        ? { rawUserMessage: input.rawUserMessage }
        : {}),
      ...(input.quickActionContext
        ? { quickActionContext: input.quickActionContext }
        : {}),
      messages: input.messages,
      walletAddress: input.walletAddress,
      executionTarget: input.executionTarget,
      browserTimeZone: input.browserTimeZone,
      browserLocale: input.browserLocale,
    }),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Conversation failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }

    const raw = trimmed.slice(5).trim();
    if (!raw || raw === "[DONE]") {
      return;
    }

    const rec = JSON.parse(raw) as {
      type?: string;
      markdown?: string;
      message?: string;
      step?: string;
      delta?: string;
      error?: string;
      research?: unknown;
      analysis?: unknown;
      liveData?: unknown;
      meta?: {
        eventId?: string;
        title?: string;
        trace?: Array<string | { label: string; txHash?: string; explorerUrl?: string }>;
        reportMeta?: {
          kind: "research" | "portfolio" | "execution";
          diagnostics?: string[];
          highlights?: string[];
        };
        activityMeta?: {
          mode?: "brain";
          clusters?: string[];
          stageBars?: number[];
        };
        paymentMeta?: {
          entries: Array<{
            requestId: string;
            agent: string;
            price?: string;
            payer?: string;
            mode?: "dcw" | "eoa" | "sponsored" | "a2a";
            sponsored?: boolean;
            buyerAgent?: string;
            sellerAgent?: string;
            transactionRef?: string | null;
            settlementTxHash?: string | null;
          }>;
        };
        ratingMeta?: {
          taskId: string;
          requestId: string;
          agentSlug: string;
          settlementRef: string;
        };
        confirmation?: {
          required: boolean;
          action: "swap" | "vault" | "bridge" | "execute" | "schedule" | "split" | "invoice" | "batch";
        };
        paymentLink?: {
          handle: string;
          displayHandle: string;
          amount: string | null;
          remark: string | null;
          path: string;
        };
        researchQueued?: {
          jobId: string;
          position: number;
        };
      };
    };

    if (rec.type === "report" && typeof rec.markdown === "string") {
      if (input.onReport) {
        const reportEvent: Extract<PipelineEvent, { type: "report" }> = {
          type: "report",
          markdown: rec.markdown,
          research:
            rec.research && typeof rec.research === "object" ? (rec.research as ResearchPayload) : null,
          analysis:
            rec.analysis && typeof rec.analysis === "object" ? (rec.analysis as Record<string, unknown>) : null,
          liveData:
            rec.liveData && typeof rec.liveData === "object" ? (rec.liveData as LiveDataPayload) : null,
        };
        input.onReport(reportEvent);
      }
      return;
    }

    if (rec.type === "error") {
      const errMsg =
        typeof rec.message === "string"
          ? rec.message
          : typeof rec.error === "string"
            ? rec.error
            : "Research pipeline error";
      if (input.onPipelineError) {
        const step =
          rec.step === "research" || rec.step === "analyst" || rec.step === "writer" ? rec.step : undefined;
        input.onPipelineError(errMsg, step);
      } else {
        throw new Error(errMsg);
      }
      return;
    }

    if (rec.error) {
      throw new Error(rec.error);
    }
    if (rec.meta && input.onMeta) {
      input.onMeta(rec.meta);
    }
    if (rec.delta) {
      const cleanDelta = sanitizeAssistantStreamDelta(rec.delta);
      if (cleanDelta) {
        input.onDelta(cleanDelta);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      processLine(line);
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      processLine(line);
    }
  }
}

export async function fetchPortfolioSnapshot(
  walletAddress: string,
  options?: { force?: boolean },
): Promise<PortfolioSnapshotResponse> {
  const normalizedWallet = walletAddress.trim().toLowerCase();
  const now = Date.now();
  const force = Boolean(options?.force);

  if (!force) {
    const cached = portfolioSnapshotCache.get(normalizedWallet);
    if (cached && cached.expiresAt > now) {
      return cached.snapshot;
    }

    const inflight = portfolioSnapshotInflight.get(normalizedWallet);
    if (inflight) {
      return inflight;
    }
  }

  const url = new URL(getBrowserBackendUrl("/api/portfolio/snapshot"));
  url.searchParams.set("walletAddress", walletAddress);

  const request = (async () => {
    const response = await fetch(url.toString(), {
      cache: "no-store",
    });
    const json = (await response.json()) as PortfolioSnapshotResponse & { error?: string };
    if (!response.ok) {
      throw new Error(normalizePortfolioSnapshotError(json.error));
    }
    persistPortfolioSnapshot(json);
    portfolioSnapshotCache.set(normalizedWallet, {
      snapshot: json,
      expiresAt: Date.now() + PORTFOLIO_SNAPSHOT_TTL_MS,
    });
    return json;
  })();

  portfolioSnapshotInflight.set(normalizedWallet, request);
  try {
    return await request;
  } finally {
    portfolioSnapshotInflight.delete(normalizedWallet);
  }
}

export async function fetchExecutionWalletSummary(
  authHeaders: Record<string, string>,
  options?: { force?: boolean; hydrateFromPortfolioSnapshot?: boolean },
): Promise<ExecutionWalletSummary> {
  const cacheKey = authHeaders.Authorization ?? JSON.stringify(authHeaders);
  const now = Date.now();
  if (!options?.force) {
    const cached = executionWalletSummaryCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.summary;
    }
    const inflight = executionWalletSummaryInflight.get(cacheKey);
    if (inflight) {
      return inflight;
    }
  }

  const request = (async () => {
    const response = await fetchBrowserApi(`/api/wallet/execution-summary`, {
      headers: {
        ...authHeaders,
      },
      cache: "no-store",
    });

    const json = (await response.json()) as (Partial<ExecutionWalletSummary> & {
      error?: string;
    });
    if (!response.ok) {
      throw new Error(normalizeExecutionWalletSummaryError(json.error));
    }
    const summary = normalizeExecutionWalletSummary(json);
    executionWalletSummaryCache.set(cacheKey, {
      summary,
      expiresAt: Date.now() + EXECUTION_WALLET_SUMMARY_TTL_MS,
    });
    return summary;
  })();

  executionWalletSummaryInflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    executionWalletSummaryInflight.delete(cacheKey);
  }
}

export async function runDcwVaultAction(input: {
  authHeaders: Record<string, string>;
  walletAddress: string;
  action: DcwVaultAction;
  amount: number;
}): Promise<DcwVaultActionResponse> {
  return runDcwPaidAgent<DcwVaultActionResponse>(
    "vault",
    {
      walletAddress: input.walletAddress,
      action: input.action,
      amount: input.amount,
      executionTarget: "DCW",
    },
    input.authHeaders,
  );
}

export async function runPortfolioAgent(
  input: PortfolioRunInput,
): Promise<PortfolioAgentResponse> {
  if (input.executionTarget === "DCW") {
    return runDcwPaidAgent<PortfolioAgentResponse>(
      "portfolio",
      {
        walletAddress: input.walletAddress,
        executionTarget: "DCW",
      },
      input.authHeaders,
    );
  }

  const result = await payProtectedResource<
    PortfolioAgentResponse,
    { walletAddress: string; executionTarget?: "EOA" | "DCW" }
  >({
    url: getAgentRunUrl("portfolio"),
    method: "POST",
    body: {
      walletAddress: input.walletAddress,
      executionTarget: input.executionTarget,
    },
    walletClient: input.walletClient,
    payer: input.payer,
    chainId: ARC_CHAIN_ID,
    headers: {
      "Content-Type": "application/json",
      ...input.authHeaders,
    },
    onAwaitSignature: input.onAwaitSignature,
  });

  return attachBrowserPaymentMetadata("portfolio", input.payer, result);
}

export async function runPaidAgent<TResponse, TBody extends Record<string, unknown>>(
  input: PaidAgentRunInput<TBody>,
): Promise<TResponse> {
  if (input.slug === "transcribe") {
    return runAuthedAgent<TResponse>(input.slug, input.body, input.authHeaders);
  }

  const requestedExecutionTarget = (() => {
    const raw = (input.body as { executionTarget?: unknown }).executionTarget;
    return typeof raw === "string" ? raw.toUpperCase() : "";
  })();

  if (requestedExecutionTarget === "DCW") {
    return runDcwPaidAgent<TResponse>(
      input.slug,
      input.body,
      input.authHeaders,
    );
  }

  const result = await payProtectedResource<TResponse, TBody>({
    url: getAgentRunUrl(input.slug),
    method: "POST",
    body: input.body,
    walletClient: input.walletClient,
    payer: input.payer,
    chainId: ARC_CHAIN_ID,
    headers: {
      "Content-Type": "application/json",
      ...input.authHeaders,
    },
    onAwaitSignature: input.onAwaitSignature,
  });

  return attachBrowserPaymentMetadata(input.slug, input.payer, result);
}

export async function finalizeBridgeRun(input: {
  requestId?: string;
  walletClient: WalletClient;
  payer: Address;
  authHeaders: Record<string, string>;
  body: {
    sourceChain: string;
    amount: number;
    sourceTxHash?: string | null;
    approvalTxHash?: string | null;
    mintTxHash?: string | null;
    recipientAddress?: string | null;
  };
  onAwaitSignature?: () => void;
}): Promise<{
  requestId: string;
  payment: {
    requestId: string;
    agent: string;
    price: string;
    payer: Address;
    mode: "eoa" | "dcw";
  } | null;
}> {
  const requestId = input.requestId?.trim() || createBrowserX402RequestId();
  const serverResponse = await fetch("/api/bridge/finalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agentflow-request-id": requestId,
      ...input.authHeaders,
    },
    body: JSON.stringify(input.body),
    cache: "no-store",
  });
  const serverPayload = (await serverResponse.json().catch(() => ({}))) as {
    error?: string;
    fallbackToEoa?: boolean;
    payment?: {
      requestId?: string;
      agent?: string;
      price?: string;
      payer?: string;
      mode?: string;
    } | null;
  };

  if (serverResponse.ok) {
    const payment = serverPayload.payment;
    return {
      requestId: payment?.requestId || requestId,
      payment: payment?.requestId
        ? {
            requestId: payment.requestId,
            agent: payment.agent || "bridge",
            price: payment.price || paymentPriceLabel("bridge"),
            payer: getAddress((payment.payer || input.payer) as Address),
            mode: payment.mode?.toLowerCase() === "eoa" ? "eoa" : "dcw",
          }
        : null,
    };
  }

  if (serverResponse.status !== 409 || !serverPayload.fallbackToEoa) {
    throw new Error(serverPayload.error || "Bridge finalize failed");
  }

  const fallbackRequestId = createBrowserX402RequestId();
  const { response, requestId: finalizedRequestId } = await payProtectedFetchWithMeta({
    url: "/api/bridge/finalize",
    method: "POST",
    requestId: fallbackRequestId,
    body: input.body,
    walletClient: input.walletClient,
    payer: input.payer,
    chainId: ARC_CHAIN_ID,
    headers: {
      "Content-Type": "application/json",
      "x-agentflow-bridge-rail": "eoa",
      ...input.authHeaders,
    },
    onAwaitSignature: input.onAwaitSignature,
  });

  if (!response.ok) {
    throw new Error("Bridge finalize failed");
  }

  const settlementHeader = response.headers.get("PAYMENT-RESPONSE");

  return {
    requestId: finalizedRequestId,
    payment: settlementHeader
      ? {
          requestId: finalizedRequestId,
          agent: "bridge",
          price: paymentPriceLabel("bridge"),
          payer: input.payer,
          mode: "eoa",
        }
      : null,
  };
}

export type GatewayWithdrawResult = {
  txHash: string;
  explorerLink: string;
  amount: string;
};

export type GatewayDepositResult = {
  ok: boolean;
  amount?: number | string;
  depositTxHash?: string;
};

export type GatewayDepositInfo = {
  depositAddress: string;
  network: string;
  instructions: string;
};

/** Resolve the on-chain address to fund Gateway (send Arc USDC here from your EOA). */
export async function fetchGatewayDepositInfo(
  authHeaders: Record<string, string>,
): Promise<GatewayDepositInfo> {
  const response = await fetch(getBrowserBackendUrl("/api/wallet/gateway/deposit"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
  });
  const json = (await response.json()) as GatewayDepositInfo & { error?: string };
  if (!response.ok) {
    throw new Error(json.error || "Could not load Gateway deposit address.");
  }
  return json;
}

export type GatewayBalanceApiResponse = {
  balance: string;
  currency: string;
  walletAddress: string;
  queriedDepositors: string[];
};

export type UnifiedBalanceApiResponse = {
  configured: boolean;
  token: "USDC";
  currency: "USDC";
  confirmed: string;
  pending: string;
  walletAddress?: string;
  queriedDepositors: string[];
  breakdown: Array<{
    depositor: string;
    totalConfirmed: string;
    totalPending: string;
    chains: Array<{
      chain: string;
      confirmed: string;
      pending: string;
      pendingTransactions: Array<{
        transactionHash: string;
        amount: string;
        blockTimestamp: string;
      }>;
    }>;
  }>;
  error?: string;
};

export async function fetchGatewayBalance(
  authHeaders: Record<string, string>,
): Promise<GatewayBalanceApiResponse> {
  const response = await fetchBrowserApi(`/api/wallet/unified-balance`, {
    headers: { ...authHeaders },
    cache: "no-store",
  });
  const json = (await response.json()) as UnifiedBalanceApiResponse;
  if (!response.ok) {
    throw new Error(json.error || "Gateway balance fetch failed");
  }
  return {
    balance: json.confirmed ?? "0",
    currency: "USDC",
    walletAddress: json.walletAddress ?? "",
    queriedDepositors: json.queriedDepositors ?? [],
  };
}

/** Read-only Arc Unified Balance via Circle App Kit; requires session. */
export async function fetchUnifiedBalance(
  authHeaders: Record<string, string>,
): Promise<UnifiedBalanceApiResponse> {
  const response = await fetchBrowserApi(`/api/wallet/unified-balance`, {
    headers: { ...authHeaders },
    cache: "no-store",
  });
  const json = (await response.json()) as UnifiedBalanceApiResponse & { error?: string };
  if (!response.ok) {
    throw new Error(json.error || "Unified Balance fetch failed");
  }
  return json;
}

/** Move USDC from Gateway funding balance to the DCW execution wallet on Arc. */
export async function moveGatewayToExecution(input: {
  authHeaders: Record<string, string>;
  amount: string;
}): Promise<{
  success: boolean;
  amount: string;
  executionWalletAddress: string;
  newBalance: string;
}> {
  const response = await fetch(getBrowserBackendUrl("/api/wallet/gateway/to-execution"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...input.authHeaders,
    },
    body: JSON.stringify({ amount: input.amount }),
  });
  const json = (await response.json()) as {
    success?: boolean;
    amount?: string;
    executionWalletAddress?: string;
    newBalance?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(json.error || "Move to execution wallet failed");
  }
  return {
    success: Boolean(json.success),
    amount: json.amount ?? "",
    executionWalletAddress: json.executionWalletAddress ?? "",
    newBalance: json.newBalance ?? "",
  };
}

/** Deposit USDC from the DCW execution wallet into Circle Gateway for x402/A2A nanopayments. */
export async function depositGatewayFromExecution(input: {
  authHeaders: Record<string, string>;
  amount: string;
}): Promise<GatewayDepositResult> {
  const response = await fetch(getBrowserBackendUrl("/api/wallet/gateway/deposit"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...input.authHeaders,
    },
    body: JSON.stringify({ amount: input.amount }),
  });
  const json = (await response.json()) as GatewayDepositResult & { error?: string };
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Gateway deposit failed");
  }
  return json;
}

/** Withdraw USDC from Circle Gateway funding wallet to an address (defaults to JWT wallet / EOA). */
export async function withdrawGatewayUsdc(input: {
  authHeaders: Record<string, string>;
  amount: string;
  toAddress?: string;
}): Promise<GatewayWithdrawResult> {
  const response = await fetch(getBrowserBackendUrl("/api/wallet/gateway/withdraw"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...input.authHeaders,
    },
    body: JSON.stringify({
      amount: input.amount,
      ...(input.toAddress ? { toAddress: input.toAddress } : {}),
    }),
  });
  const json = (await response.json()) as GatewayWithdrawResult & { error?: string };
  if (!response.ok) {
    throw new Error(json.error || "Gateway withdraw failed");
  }
  return json;
}

/** Withdraw USDC from DCW execution wallet to EOA using the signed AgentFlow session. */
export async function withdrawExecutionWalletUsdc(input: {
  authHeaders?: Record<string, string>;
  walletAddress?: string;
  message?: string;
  signature?: `0x${string}`;
  amountUsdc: number;
  toAddress: string;
}): Promise<{ success: boolean; txHash?: string }> {
  const response = await fetch(getBrowserBackendUrl("/api/wallet/withdraw"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.authHeaders ?? {}),
    },
    body: JSON.stringify({
      ...(input.walletAddress ? { walletAddress: input.walletAddress } : {}),
      ...(input.message ? { message: input.message } : {}),
      ...(input.signature ? { signature: input.signature } : {}),
      amountUsdc: input.amountUsdc,
      toAddress: input.toAddress,
    }),
  });
  const json = (await response.json()) as { success?: boolean; txHash?: string; error?: string };
  if (!response.ok) {
    throw new Error(json.error || "Execution wallet withdraw failed");
  }
  return { success: Boolean(json.success), txHash: json.txHash };
}
