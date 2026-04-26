"use client";

import {
  FormEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { formatUnits, getAddress } from "viem";
import Link from "next/link";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import { PromptComposer } from "@/components/chat/PromptComposer";
import type {
  ChatAttachment,
  LiveChatMessage,
  ReportMeta,
  ReportSource,
} from "@/components/chat/types";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS } from "@/lib/arcChain";
import { defaultPriceBySlug } from "@/lib/agentEndpoints";
import { authHeadersForWallet } from "@/lib/authSession";
import { normalizeChatHistoryFromStorage } from "@/lib/chatHistory";
import { type ChatCategory, type ChatHistoryItem } from "@/lib/appData";
import {
  fetchExecutionWalletSummary,
  runPaidAgent,
  runPortfolioAgent,
  streamConversationReply,
  streamAgentFlow,
  streamBridgeAgent,
  type PipelineEvent,
  type PortfolioAgentResponse,
  type ResearchPayload,
  type LiveDataPayload,
} from "@/lib/liveAgentClient";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { sidebarWidthClass, useSidebarPreference } from "@/lib/useSidebarPreference";
import {
  bridgeTraceFromStreamEvent,
  traceEntriesFromBridgeResult,
} from "@/lib/bridgeTrace";
import {
  executeEoaUsycPlan,
  preflightEoaUsycAction,
  type EoaUsycExecutionPlan,
} from "@/lib/usycEoa";

const HISTORY_STORAGE_KEY = "agentflow.chat.history";
const ARC_EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;

const ChatPaymentPanel = dynamic(
  () => import("@/components/chat/ChatPaymentPanel").then((mod) => mod.ChatPaymentPanel),
  { ssr: false },
);
const ChatThread = dynamic(
  () => import("@/components/chat/ChatThread").then((mod) => mod.ChatThread),
  {
    ssr: false,
    loading: () => <div className="min-h-0 flex-1" aria-hidden="true" />,
  },
);

function createChatSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `chat-${crypto.randomUUID()}`;
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function QuickAgentPromptStrip({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (prompt: QuickAgentPrompt) => void;
}) {
  return (
    <div
      className="mx-auto mt-5 flex max-w-5xl flex-wrap justify-center gap-2.5"
      aria-label="AgentFlow prompt starters"
    >
      {quickAgentPrompts.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(item)}
          title={item.prompt}
          className="min-h-11 rounded-full border border-white/10 bg-[#202020]/85 px-5 text-[11px] font-black uppercase tracking-[0.18em] text-white/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-[#f2ca50]/45 hover:bg-[#211f16] hover:text-[#f2ca50] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Fixed string so server + first client pass match; real id set in useEffect. */
const CHAT_SESSION_SSR_PLACEHOLDER = "chat-pending";

const promptTabs = [
  "Research",
  "AgentPay",
  "Swap",
  "Vault",
  "Bridge",
  "Portfolio",
] as const;
type PromptTab = (typeof promptTabs)[number];

type QuickAgentPrompt = {
  label: string;
  tab: PromptTab;
  prompt: string;
};

const quickAgentPrompts: QuickAgentPrompt[] = [
  {
    label: "Agent Runs",
    tab: "Research",
    prompt: "Research Arc stablecoin payments today and write a concise sourced report.",
  },
  {
    label: "AgentPay",
    tab: "AgentPay",
    prompt: "Show my contacts.",
  },
  {
    label: "Swap USDC",
    tab: "Swap",
    prompt: "Swap 1 USDC to EURC.",
  },
  {
    label: "Vault Yield",
    tab: "Vault",
    prompt: "What is the current AgentFlow Vault APY?",
  },
  {
    label: "Bridge to Arc",
    tab: "Bridge",
    prompt: "Bridge 0.1 USDC from Ethereum Sepolia to Arc.",
  },
  {
    label: "Portfolio Scan",
    tab: "Portfolio",
    prompt: "Show my portfolio.",
  },
];
type ExecutionTarget = "EOA" | "DCW";
type VaultAction =
  | "deposit"
  | "withdraw"
  | "check_apy"
  | "compound"
  | "usyc_deposit"
  | "usyc_withdraw";
type BridgeSource = "ethereum-sepolia" | "base-sepolia";
type ChatIntent = PromptTab | "Conversation" | "Vision";

type PendingChatAttachment = ChatAttachment & {
  dataUrl: string;
};

type VisionAgentResponse = {
  success: boolean;
  answer: string;
  sourceType: "image" | "pdf" | "text";
  extractor: "hermes" | "hermes-text" | "openai-fallback";
  notes?: string[];
  usage?: {
    usedToday: number;
    dailyLimit: number;
  };
  error?: string;
};

type TranscribeAgentResponse = {
  success: boolean;
  text: string;
  model: string;
  usage?: {
    usedToday: number;
    dailyLimit: number;
  };
  error?: string;
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

type AgentRunPaymentResult = {
  payment?: AgentRunPayment;
};

type VisionAgentResponseWithPayment = VisionAgentResponse & AgentRunPaymentResult;
type TranscribeAgentResponseWithPayment = TranscribeAgentResponse & AgentRunPaymentResult;

const contextLabels = ["x402", "Arc"] as const;

const tabCategoryMap: Record<PromptTab, ChatCategory> = {
  Research: "Research",
  AgentPay: "AgentPay",
  Swap: "Swap",
  Vault: "Vault",
  Bridge: "Bridge",
  Portfolio: "Portfolio",
};

const stepLabels: Record<string, string> = {
  research: "Research agent",
  analyst: "Analyst agent",
  writer: "Writer agent",
};

const conversationalPattern =
  /^(hi|hello|hey|gm|good morning|good evening|yo|thanks|thank you)\b|(\bhelp\b|\bwhat can you do\b|\bwhat do you do\b|\bwho are you\b|\bhow do you work\b|\bhow do you works\b|\bhow does this work\b|\bhow does agentflow work\b|\btell me about yourself\b|\bare you an ai agent\b|\bhow are you\b|\bwhy\b|\bexplain\b)/i;

const actionIntentPattern =
  /\b(research|analyze|analysis|report|compare|market|trend|news|thesis|risk|narrative|summarize|swap|trade|convert|exchange|vault|deposit|withdraw|apy|yield|compound|bridge|cctp|portfolio|holdings|allocation|pnl|position)\b/i;

const portfolioAnalysisVerbPattern =
  /\b(analyze|analysis|review|scan|summarize|summary|report|assess|value|valuate|break down|breakdown|check|show|display|overview)\b/i;

const portfolioAnalysisSubjectPattern =
  /\b(wallet|arc wallet|balances?|holdings?|portfolio|allocation|pnl|performance|positions?|vault shares?|swap liquidity|liquidity|lp|pool)\b/i;

const explicitVaultActionPattern =
  /\b(deposit|withdraw|redeem|subscribe|compound|apy|yield|earn)\b/i;

const explicitBridgeActionPattern = /\b(bridge|cctp)\b/i;

const explicitSwapActionPattern =
  /\b(swap|trade|convert|exchange)\b/i;

const metaConversationPattern =
  /\b(i thought|i assumed|i guess|i was wrong|my bad|sorry|you were right|you only|i didn't mean|i did not mean)\b/i;

const explicitResearchIntentPattern =
  /^(research|analyze|analyse|compare|summarize|summarise|brief|report on|look into)\b|\b(can you|could you|please|help me)\s+(research|analyze|analyse|compare|summarize|summarise|brief|look into)\b|\b(latest news|latest developments|news on|news about|market outlook|macro outlook|forecast|thesis)\b|\bhow does .* affect (me|my portfolio|stablecoin holders?|holders?)\b|\bwhat('s| is) the latest\b/i;

function normalizePromptForIntent(prompt: string): string {
  return prompt
    .trim()
    .toLowerCase()
    .replace(/\bpossitions?\b/g, "positions")
    .replace(/\bpossition\b/g, "position")
    .replace(/\bpositons?\b/g, "positions")
    .replace(/\bliqudity\b/g, "liquidity")
    .replace(/\bholdngs?\b/g, "holdings")
    .replace(/\bbalence(s)?\b/g, "balance$1");
}

type SwapAgentResponse = {
  success: boolean;
  executionMode?: "DCW";
  txHash?: string;
  error?: string;
  receipt?: {
    explorerLink?: string;
    amountIn?: number;
    executionTarget?: "DCW";
    optimalSlippage?: number;
    tokenPair?: { tokenIn: string; tokenOut: string };
    quoteOutRaw?: string;
  };
};

function arcTokenLabel(address: string): string {
  try {
    const a = getAddress(address);
    if (a.toLowerCase() === ARC_USDC_ADDRESS.toLowerCase()) {
      return "USDC";
    }
    if (a.toLowerCase() === ARC_EURC_ADDRESS.toLowerCase()) {
      return "EURC";
    }
  } catch {
    /* ignore */
  }
  return "token";
}

/** Human-readable swap size for chat receipt (matches swap agent `receipt`). */
function formatSwapAmountLine(input: {
  amountIn: number;
  quoteOutRaw?: string;
  tokenIn: string;
  tokenOut: string;
}): string {
  const inLabel = arcTokenLabel(input.tokenIn);
  const outLabel = arcTokenLabel(input.tokenOut);
  let outHuman = "";
  if (input.quoteOutRaw) {
    try {
      const out = formatUnits(BigInt(input.quoteOutRaw), 6);
      const n = Number(out);
      if (Number.isFinite(n)) {
        outHuman = `~${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${outLabel}`;
      }
    } catch {
      /* ignore */
    }
  }
  const arrow = outHuman || outLabel;
  return `**Swap:** ${input.amountIn} ${inLabel} -> ${arrow}`;
}

function paymentPriceLabel(agent: string): string {
  const price = defaultPriceBySlug[agent];
  return price ? `$${price} USDC` : "";
}

function shortPaymentRef(value?: string | null): string {
  if (!value) return "unknown";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function extractSettlementTx(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const txHash = record.txHash ?? record.rawTransaction ?? record.transaction ?? record.id;
  return typeof txHash === "string" && txHash.trim() ? txHash.trim() : null;
}

function formatVoicePaymentLabel(
  result: AgentRunPaymentResult,
  fallbackPayer?: string,
): string | null {
  const payment = result.payment;
  if (!payment?.requestId) {
    return null;
  }
  const price = payment.price || paymentPriceLabel("transcribe");
  const mode = payment.mode || "x402";
  const payer = payment.payer || fallbackPayer;
  const tx =
    payment.settlementTxHash ??
    payment.transactionRef ??
    payment.transaction ??
    extractSettlementTx(payment.settlement);
  return [
    `Nanopayment: Transcribe Agent charged ${price}`,
    `mode ${mode}`,
    `request ${shortPaymentRef(payment.requestId)}`,
    payer ? `payer ${shortPaymentRef(payer)}` : null,
    tx ? `tx ${shortPaymentRef(tx)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildPaymentMetaFromResult(
  agent: string,
  result: AgentRunPaymentResult,
  fallbackPayer?: string,
): LiveChatMessage["paymentMeta"] | undefined {
  const payment = result.payment;
  if (!payment?.requestId) {
    return undefined;
  }
  const mode = payment.sponsored
    ? "sponsored"
    : payment.mode?.toLowerCase() === "a2a"
      ? "a2a"
    : payment.mode?.toLowerCase() === "eoa"
      ? "eoa"
      : "dcw";
  const settlementTxHash =
    payment.settlementTxHash ?? extractSettlementTx(payment.settlement) ?? null;
  const transactionRef =
    payment.transactionRef ?? payment.transaction ?? extractSettlementTx(payment.settlement) ?? null;
  return {
    entries: [
      {
        requestId: payment.requestId,
        agent: payment.agent || agent,
        price: payment.price || paymentPriceLabel(agent),
        payer: payment.payer || fallbackPayer,
        mode,
        sponsored: mode === "sponsored" || payment.sponsored,
        buyerAgent: (payment as { buyerAgent?: string }).buyerAgent,
        sellerAgent: (payment as { sellerAgent?: string }).sellerAgent,
        transactionRef,
        settlementTxHash,
      },
    ],
  };
}

type VaultAgentResponse = {
  success: boolean;
  action?: string;
  apy?: number;
  txHash?: string;
  explorerLink?: string | null;
  usycReceived?: string;
  usdcReceived?: string;
  executionMode?: "EOA" | "DCW";
  eoaPlan?: EoaUsycExecutionPlan;
  error?: string;
};

type ExecutionBlockResult = {
  blocked: boolean;
  content?: string;
  trace?: string[];
};

function buildTask(category: ChatCategory, prompt: string, contexts: string[]): string {
  const contextLine =
    contexts.length > 0 ? `Execution context: ${contexts.join(", ")}.` : "";

  if (category === "Research" || category === "AgentPay") {
    return [prompt, contextLine].filter(Boolean).join("\n\n");
  }

  return `Category: ${category}

User request:
${prompt}

${contextLine}

Focus the response on ${category.toLowerCase()} decisions and operational tradeoffs on Arc.`;
}

function buildExecutionTargetGuard(input: {
  intent: ChatIntent;
  executionTarget: ExecutionTarget;
  vaultAction?: VaultAction;
}): ExecutionBlockResult {
  void input;
  return { blocked: false };
}

function inferPromptIntent(prompt: string, fallbackTab: PromptTab): ChatIntent {
  const normalized = normalizePromptForIntent(prompt);
  const mentionsStablecoin = /\b(usdc|eurc)\b/.test(normalized);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  if (fallbackTab === "AgentPay") {
    return "Conversation";
  }

  if (metaConversationPattern.test(normalized)) {
    return "Conversation";
  }

  if (
    portfolioAnalysisVerbPattern.test(normalized) &&
    portfolioAnalysisSubjectPattern.test(normalized)
  ) {
    return "Portfolio";
  }

  if (/\b(portfolio|holdings|allocation|pnl|position|positions)\b/.test(normalized)) {
    return "Portfolio";
  }

  if (
    /\b(show|scan|analyze|review|check|display|summarize|report)\b/.test(normalized) &&
    /\b(my|our)\b/.test(normalized) &&
    /\b(wallet|balances?|holdings?|positions?|vault shares?|liquidity|swap liquidity)\b/.test(
      normalized,
    )
  ) {
    return "Portfolio";
  }

  if (
    explicitBridgeActionPattern.test(normalized) ||
    /\b(sepolia|base sepolia|ethereum sepolia)\b/.test(normalized)
  ) {
    return "Bridge";
  }

  if (/\busyc\b/.test(normalized)) {
    return "Vault";
  }

  if (
    explicitVaultActionPattern.test(normalized) ||
    (/\bvault\b/.test(normalized) && !portfolioAnalysisSubjectPattern.test(normalized))
  ) {
    return "Vault";
  }

  if (
    explicitSwapActionPattern.test(normalized) ||
    (mentionsStablecoin && /\b(buy|sell)\b/.test(normalized))
  ) {
    return "Swap";
  }

  if (explicitResearchIntentPattern.test(normalized)) {
    return "Research";
  }

  if (
    conversationalPattern.test(normalized) ||
    ((/\b(you|your|agentflow)\b/.test(normalized) ||
      /\b(am i talking to|what are you)\b/.test(normalized)) &&
      !actionIntentPattern.test(normalized) &&
      wordCount <= 18)
  ) {
    return "Conversation";
  }

  return fallbackTab;
}

function buildLocalPromptGuard(
  prompt: string,
  attachment: PendingChatAttachment | null | undefined,
): string | null {
  const normalized = normalizePromptForIntent(prompt);
  if (!normalized) {
    return null;
  }

  const asksAboutCurrentAttachment =
    /\b(this|attached|uploaded|the)\s+(image|screenshot|screen\s*shot|photo|picture|attachment|file)\b/i.test(
      normalized,
    ) ||
    /\b(what'?s|what\s+is|analy[sz]e|describe|research|summari[sz]e)\b[\s\S]{0,60}\b(image|screenshot|screen\s*shot|photo|picture)\b/i.test(
      normalized,
    );

  if (!attachment && asksAboutCurrentAttachment) {
    return "Attach the image first, then ask me to analyze or research it. I will run the Vision agent on the real attachment instead of guessing from text.";
  }

  const asksForTranscription =
    /\b(transcribe|transcription|voice\s*note|audio|recording|microphone|mic|dictate)\b/i.test(
      normalized,
    ) &&
    /\b(this|my|the|turn|convert|return|only|transcript|text)\b/i.test(normalized) &&
    !/\b(how|what|why|explain|works?|does|about)\b/i.test(normalized);

  if (asksForTranscription) {
    return "Use the mic button to dictate. The Transcribe agent only turns your spoken audio into chat text; it does not run a separate chat task from typed instructions.";
  }

  if (
    /\b(liquidity\s*pool|lp\s*position|pool\s*position|swap\s*liquidity|yield\s*optimizer|weekly\s*dca|agent\s+positions?|strateg(?:y|ies))\b/i.test(
      normalized,
    ) &&
    !/\bgateway\s+strateg/i.test(normalized)
  ) {
    return "AgentFlow does not manage liquidity pools, strategy positions, or marketplace strategies. The live portfolio view is your Agent wallet, Gateway reserve, vault shares, and recent activity.";
  }

  return null;
}

function getAssistantTitle(intent: ChatIntent): string {
  return intent === "Conversation" ? "AgentFlow" : `${intent} Trace`;
}

function buildSessionSignatureMessage(executionTarget: ExecutionTarget): {
  content: string;
  trace: string;
} {
  if (executionTarget === "DCW") {
    return {
      content:
        "Confirm the AgentFlow session signature in your connected wallet. This is just session auth; task payment and execution will continue on DCW.",
      trace: "Preparing secure session for a DCW-backed run",
    };
  }

  return {
    content: "Confirm the AgentFlow session signature in your wallet. I'll continue as soon as it's signed.",
    trace: "Preparing secure session for paid agent access",
  };
}

function buildPaymentSignatureMessage(executionTarget: ExecutionTarget): {
  content: string;
  trace: string;
} {
  if (executionTarget === "DCW") {
    return {
      content:
        "Confirm the x402 payment in your connected wallet. The transaction execution target is still DCW.",
      trace: "Awaiting connected-wallet signature for x402 payment while keeping DCW as execution target",
    };
  }

  return {
    content: "Confirm the x402 payment in your connected wallet to continue.",
    trace: "Awaiting connected-wallet signature for x402 payment",
  };
}

function formatPipelineTrace(event: PipelineEvent): string | null {
  switch (event.type) {
    case "step_start":
      return `${stepLabels[event.step]} started - ${event.price}`;
    case "step_complete":
      return `${stepLabels[event.step]} settled${event.tx ? ` - ${event.tx.slice(0, 10)}...` : ""}`;
    case "receipt":
      return event.total ? `Receipt ready - total $${event.total}` : "Receipt ready";
    case "report":
      return "Writer report delivered";
    case "error":
      return event.step ? `${stepLabels[event.step]} failed` : "Run failed";
    default:
      return null;
  }
}

function parseAmount(prompt: string, fallback: number): number {
  const match = prompt.match(/(\d+(?:\.\d+)?)/);
  const parsed = match ? Number(match[1]) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSlippage(prompt: string, fallback: number): number {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*%/);
  const parsed = match ? Number(match[1]) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function detectVaultAction(prompt: string): VaultAction {
  if (/\busyc\b/i.test(prompt)) {
    if (/\b(redeem|withdraw|sell)\b/i.test(prompt)) return "usyc_withdraw";
    return "usyc_deposit";
  }
  if (/compound/i.test(prompt)) return "compound";
  if (/withdraw/i.test(prompt)) return "withdraw";
  if (/\b(deposit|earn|supply|add)\b/i.test(prompt)) return "deposit";
  if (/apy|yield/i.test(prompt) && !/deposit|withdraw|compound/i.test(prompt)) {
    return "check_apy";
  }
  return "check_apy";
}

function detectBridgeSource(prompt: string): BridgeSource {
  if (/base\s*sepolia/i.test(prompt)) {
    return "base-sepolia";
  }
  return "ethereum-sepolia";
}

/**
 * Arc testnet: both directions use the same pool path; the swap agent accepts any { tokenIn, tokenOut }.
 */
function resolveSwapTokenPair(prompt: string): {
  tokenIn: string;
  tokenOut: string;
  swapSpends: "usdc" | "eurc";
} {
  const t = prompt.trim();
  const forward =
    /\busdc\b\s+to\s+\beurc\b/i.test(t) ||
    (/\busdc\b/i.test(t) && /\bto\b/i.test(t) && /\beurc\b/i.test(t) && t.search(/\busdc\b/i) < t.search(/\beurc\b/i));
  const reverse =
    /\beurc\b\s+to\s+\busdc\b/i.test(t) ||
    (/\beurc\b/i.test(t) && /\bto\b/i.test(t) && /\busdc\b/i.test(t) && t.search(/\beurc\b/i) < t.search(/\busdc\b/i));
  if (reverse && !forward) {
    return {
      tokenIn: ARC_EURC_ADDRESS,
      tokenOut: ARC_USDC_ADDRESS,
      swapSpends: "eurc",
    };
  }
  return {
    tokenIn: ARC_USDC_ADDRESS,
    tokenOut: ARC_EURC_ADDRESS,
    swapSpends: "usdc",
  };
}

function formatDateLabel(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function friendlyChatErrorMessage(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : fallback;
  const message = raw.trim();
  const lower = message.toLowerCase();

  if (!message) return fallback;
  if (/user rejected|rejected|denied|declined|cancelled|canceled/.test(lower)) {
    return "The wallet request was cancelled, so AgentFlow did not start the run.";
  }
  if (/failed to fetch|networkerror|load failed|econnrefused|fetch failed/.test(lower)) {
    return "AgentFlow could not reach the backend. Check that the API is running, then try again.";
  }
  if (/conversation failed with status 401|unauthorized|jwt|session/i.test(message)) {
    return "Your secure chat session expired. Sign in with your wallet again, then retry.";
  }
  if (/conversation failed with status 429|rate limit|too many requests/i.test(message)) {
    return "AgentFlow is receiving too many requests right now. Wait a moment, then try again.";
  }
  if (/conversation failed with status 5\d\d|internal server error|bad gateway|gateway timeout/i.test(message)) {
    return "AgentFlow hit a backend error while preparing the reply. Try again in a moment.";
  }

  try {
    const parsed = JSON.parse(message) as { error?: string; message?: string };
    const parsedMessage = parsed.error || parsed.message;
    if (parsedMessage?.trim()) {
      return friendlyChatErrorMessage(parsedMessage, fallback);
    }
  } catch {
    /* Not JSON; keep the original message. */
  }

  return message.length > 240 ? `${message.slice(0, 237).trimEnd()}...` : message;
}

function attachmentSummaryLabel(attachment: PendingChatAttachment): string {
  if (attachment.kind === "image") {
    return `Attached image: ${attachment.name}`;
  }
  if (attachment.kind === "pdf") {
    return `Attached PDF: ${attachment.name}`;
  }
  return `Attached file: ${attachment.name}`;
}

function buildAttachmentPrompt(
  attachment: PendingChatAttachment,
  userPrompt: string,
): string {
  const trimmed = userPrompt.trim();
  if (trimmed) {
    return trimmed;
  }

  if (attachment.kind === "image") {
    return "Analyze this image and summarize the important visible content.";
  }
  if (attachment.kind === "pdf") {
    return "Read this PDF and summarize the important content.";
  }
  return "Read this file and summarize the important content.";
}

async function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Could not read the selected file."));
    };
    reader.onerror = () => {
      reject(new Error("Could not read the selected file."));
    };
    reader.readAsDataURL(file);
  });
}

/** Decode a (possibly base64) text/* data URL to its raw UTF-8 string. */
function decodeTextDataUrl(dataUrl?: string): string | null {
  if (!dataUrl) return null;
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) return null;
  const header = dataUrl.slice(5, commaIdx); // strip "data:"
  const payload = dataUrl.slice(commaIdx + 1);
  const isBase64 = /;\s*base64/i.test(header);
  try {
    if (isBase64) {
      const binary =
        typeof atob === "function"
          ? atob(payload)
          : Buffer.from(payload, "base64").toString("binary");
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/** Heuristic: does an attachment look like a batch-payment CSV? */
function isBatchCsvAttachment(attachment: PendingChatAttachment | null): boolean {
  if (!attachment || attachment.kind !== "text") return false;
  const name = attachment.name.toLowerCase();
  const mime = (attachment.mimeType || "").toLowerCase();
  return mime === "text/csv" || name.endsWith(".csv");
}

function buildExecutionBlockResult(input: {
  intent: "Swap" | "Vault";
  vaultAction?: VaultAction;
  executionWalletAddress: string;
  needsGasFunding: boolean;
  needsUsdcFunding: boolean;
  needsEurcFunding?: boolean;
  /** Which token is sold in the swap (Arc gas is always paid in USDC). */
  swapSpends?: "usdc" | "eurc";
  needsVaultShares: boolean;
}): ExecutionBlockResult {
  const addressLine = `Execution wallet: ${input.executionWalletAddress}`;

  if (input.intent === "Swap") {
    const spends = input.swapSpends ?? "usdc";
    if (input.needsGasFunding) {
      return {
        blocked: true,
        content: `I did not start the swap because your execution wallet does not have enough USDC on Arc for gas yet.\n\nArc uses USDC for fees; add a little USDC to the execution wallet, then try again.\n\n${addressLine}`,
        trace: [
          "Swap preflight stopped before payment",
          "Execution wallet needs USDC on Arc for gas",
        ],
      };
    }
    if (spends === "usdc" && input.needsUsdcFunding) {
      return {
        blocked: true,
        content: `I did not start the swap because your execution wallet has no USDC available for this swap.\n\nOpen the recent drawer on the left, send USDC to the execution wallet, then try again.\n\n${addressLine}`,
        trace: [
          "Swap preflight stopped before payment",
          "Execution wallet needs USDC balance to swap",
        ],
      };
    }
    if (spends === "eurc" && input.needsEurcFunding) {
      return {
        blocked: true,
        content: `I did not start the swap because your execution wallet has no EURC on Arc for this swap.\n\nSend EURC to the execution wallet first, then try again.\n\n${addressLine}`,
        trace: [
          "Swap preflight stopped before payment",
          "Execution wallet needs EURC balance for EURC -> USDC",
        ],
      };
    }
    return { blocked: false };
  }

  if (input.vaultAction === "deposit") {
    if (input.needsGasFunding && input.needsUsdcFunding) {
      return {
        blocked: true,
        content: `I did not start the vault deposit because your execution wallet has no usable USDC on Arc yet.\n\nOpen the recent drawer on the left and fund the execution wallet first.\n\n${addressLine}`,
        trace: [
          "Vault deposit preflight stopped before payment",
          "Execution wallet needs USDC on Arc for fees and deposit balance",
        ],
      };
    }
    if (input.needsGasFunding) {
      return {
        blocked: true,
        content: `I did not start the vault deposit because your execution wallet does not have enough USDC on Arc yet.\n\nOpen the recent drawer on the left, add a little more USDC, then try again.\n\n${addressLine}`,
        trace: [
          "Vault deposit preflight stopped before payment",
          "Execution wallet needs more USDC on Arc for fees",
        ],
      };
    }
    if (input.needsUsdcFunding) {
      return {
        blocked: true,
        content: `I did not start the vault deposit because your execution wallet has no USDC available to deposit.\n\nOpen the recent drawer on the left, send USDC to the execution wallet, then try again.\n\n${addressLine}`,
        trace: [
          "Vault deposit preflight stopped before payment",
          "Execution wallet needs USDC balance to deposit",
        ],
      };
    }
  }

  if (input.vaultAction === "usyc_deposit") {
    if (input.needsGasFunding && input.needsUsdcFunding) {
        return {
          blocked: true,
          content: `I did not start the USYC subscribe because your execution wallet has no usable USDC on Arc yet.\n\nFund the execution wallet first, then try again.\n\n${addressLine}`,
          trace: [
            "USYC subscribe preflight stopped before payment",
            "Execution wallet needs USDC on Arc for fees and the USYC position",
          ],
        };
    }
    if (input.needsGasFunding) {
      return {
        blocked: true,
        content: `I did not start the USYC subscribe because your execution wallet does not have enough USDC on Arc yet.\n\nAdd a little more USDC for fees, then try again.\n\n${addressLine}`,
        trace: [
          "USYC subscribe preflight stopped before payment",
          "Execution wallet needs more USDC on Arc for fees",
        ],
      };
    }
    if (input.needsUsdcFunding) {
      return {
        blocked: true,
        content: `I did not start the USYC subscribe because your execution wallet has no USDC available to subscribe.\n\nSend USDC to the execution wallet, then try again.\n\n${addressLine}`,
        trace: [
          "USYC subscribe preflight stopped before payment",
          "Execution wallet needs USDC balance to subscribe into USYC",
        ],
      };
    }
  }

  if (input.vaultAction === "usyc_withdraw" && input.needsGasFunding) {
    return {
      blocked: true,
      content: `I did not start the USYC redeem because your execution wallet does not have enough USDC on Arc for fees yet.\n\nAdd a little more USDC for fees, then try again.\n\n${addressLine}`,
      trace: [
        "USYC redeem preflight stopped before payment",
        "Execution wallet needs more USDC on Arc for fees",
      ],
    };
  }

  if (input.vaultAction === "withdraw") {
    if (input.needsGasFunding && input.needsVaultShares) {
      return {
        blocked: true,
        content: `I did not start the vault withdraw because your execution wallet does not have enough USDC on Arc for fees and it does not hold vault shares yet.\n\nAdd a little more USDC first. If you meant to withdraw, make sure this execution wallet actually holds the vault shares.\n\n${addressLine}`,
        trace: [
          "Vault withdraw preflight stopped before payment",
          "Execution wallet needs more USDC on Arc for fees",
          "Execution wallet has no vault shares to redeem",
        ],
      };
    }
    if (input.needsGasFunding) {
      return {
        blocked: true,
        content: `I did not start the vault withdraw because your execution wallet does not have enough USDC on Arc yet.\n\nOpen the recent drawer on the left, add a little more USDC, then try again.\n\n${addressLine}`,
        trace: [
          "Vault withdraw preflight stopped before payment",
          "Execution wallet needs more USDC on Arc for fees",
        ],
      };
    }
    if (input.needsVaultShares) {
      return {
        blocked: true,
        content: `I did not start the vault withdraw because your execution wallet does not currently hold vault shares.\n\nDeposit into the vault first from this execution wallet, then try the withdraw again.\n\n${addressLine}`,
        trace: [
          "Vault withdraw preflight stopped before payment",
          "Execution wallet has no vault shares to redeem",
        ],
      };
    }
  }

  return { blocked: false };
}

function uniqueSources(sources: ReportSource[]): ReportSource[] {
  const deduped = new Map<string, ReportSource>();
  for (const source of sources) {
    const key = `${source.name}|${source.url}`.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, source);
    }
  }
  return Array.from(deduped.values());
}

function buildResearchSources(research?: ResearchPayload | null): ReportSource[] {
  const rawSources = Array.isArray(research?.sources) ? research.sources : [];
  return uniqueSources(
    rawSources
      .filter((source) => typeof source?.name === "string" && typeof source?.url === "string")
      .map((source) => ({
        name: source.name as string,
        url: source.url as string,
        usedFor: typeof source.used_for === "string" ? source.used_for : undefined,
      })),
  ).slice(0, 6);
}

function buildEvidenceSummary(research?: ResearchPayload | null) {
  const statuses = [
    ...(Array.isArray(research?.facts) ? research.facts : []),
    ...(Array.isArray(research?.recent_developments) ? research.recent_developments : []),
  ]
    .map((item) => item?.status)
    .filter((status): status is "confirmed" | "reported" | "analysis" =>
      status === "confirmed" || status === "reported" || status === "analysis",
    );

  if (statuses.length === 0) {
    return undefined;
  }

  return {
    confirmed: statuses.filter((status) => status === "confirmed").length,
    reported: statuses.filter((status) => status === "reported").length,
    analysis: statuses.filter((status) => status === "analysis").length,
  };
}

function buildResearchReportMeta(reportEvent: Extract<PipelineEvent, { type: "report" }>): ReportMeta {
  const liveData = reportEvent.liveData as LiveDataPayload | null | undefined;
  const currentEvents = liveData?.current_events;
  const latestSeen = formatDateLabel(currentEvents?.latest_seen_at);
  const freshness: ReportMeta["freshness"] = currentEvents
    ? currentEvents.has_recent_articles || currentEvents.freshness === "fresh"
      ? {
          label: "Fresh sources",
          tone: "fresh",
          detail: latestSeen
            ? `Latest live event source: ${latestSeen}.`
            : "Recent dated current-event sources were found.",
        }
      : {
          label: "Thin live coverage",
          tone: "stale",
          detail: `No recent dated current-event sources were found inside the ${currentEvents.recency_window_days ?? "configured"} day window.`,
        }
    : {
        label: "Research report",
        tone: "neutral",
        detail: "Structured evidence was generated from the research pipeline.",
      };

  return {
    kind: "research",
    freshness,
    evidence: buildEvidenceSummary(reportEvent.research),
    premiseNote:
      typeof liveData?.premise_check?.note === "string"
        ? liveData.premise_check.note
        : undefined,
    sources: buildResearchSources(reportEvent.research),
  };
}

function buildPortfolioReportMeta(result: PortfolioAgentResponse): ReportMeta {
  const arcData = result.diagnostics.arcData;
  const diagnostics = [
    arcData?.rpcAvailable
      ? "Alchemy Arc RPC is live; balances use standard RPC, ERC-20 reads, Arcscan, and Gateway data."
      : arcData?.error
        ? `Arc RPC health check failed; partial fallback data may be shown. (${arcData.error})`
        : "Arc balances use standard RPC, ERC-20 reads, Arcscan, and Gateway data.",
    result.diagnostics.gatewayBalance.source === "gateway_api"
      ? "Gateway position uses the live Circle Gateway balance API."
      : "Gateway position is estimated from transfer history.",
  ];

  return {
    kind: "portfolio",
    freshness: {
      label:
        result.diagnostics.gatewayBalance.source === "gateway_api"
          ? "Live valuation"
          : "Partial fallback",
      tone:
        result.diagnostics.gatewayBalance.source === "gateway_api"
          ? "fresh"
          : "neutral",
      detail:
        result.diagnostics.gatewayBalance.source === "gateway_api"
          ? "Portfolio positions were valued from live Arc and Gateway reads."
          : "Some positions were estimated from fallback data paths.",
    },
    diagnostics,
    highlights: [
      `Risk score ${result.riskScore}/100`,
      `${result.holdings.length} holdings`,
      `${result.recommendations.length} AI recommendations`,
    ],
  };
}

function WalletPill({
  isAuthenticated,
  onSignIn,
  signInLoading,
}: {
  isAuthenticated: boolean;
  onSignIn: () => void;
  signInLoading: boolean;
}) {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const ready = mounted;
        const connected = ready && !!account && !!chain;

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="rounded-full border border-white/10 bg-[#131313] px-4 py-2 text-sm text-white/90 transition hover:bg-white/5"
            >
              Connect wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className="rounded-full bg-amber-400/10 px-4 py-2 text-sm text-amber-100"
            >
              Wrong network
            </button>
          );
        }

        return (
          <div className="flex items-center gap-2">
            {!isAuthenticated ? (
              <button
                type="button"
                onClick={onSignIn}
                disabled={signInLoading}
                className="af-btn-primary af-transition rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-110 disabled:opacity-60"
              >
                {signInLoading ? "Signing..." : "Sign session"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={openAccountModal}
              className="rounded-full border border-white/10 bg-[#131313] px-4 py-2 text-sm text-white/90 transition hover:bg-white/5"
            >
              {account.displayName}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

function ChatPageInner() {
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const {
    isAuthenticated,
    getAuthHeaders,
    signIn,
    loading: signInLoading,
  } = useAgentJwt();

  const initialTab = (searchParams.get("tab") as PromptTab | null) ?? "Research";
  const [selectedTab, setSelectedTab] = useState<PromptTab>(
    promptTabs.includes(initialTab as PromptTab) ? (initialTab as PromptTab) : "Research",
  );
  const [executionTarget] = useState<ExecutionTarget>("DCW");
  const [activeContexts, setActiveContexts] = useState<string[]>([...contextLabels]);
  const [input, setInput] = useState("");
  const [portfolioContext, setPortfolioContext] = useState<string | null>(null);
  const [portfolioWalletLabel, setPortfolioWalletLabel] = useState<string>("");
  const [chatSessionId, setChatSessionId] = useState(CHAT_SESSION_SSR_PLACEHOLDER);
  const sessionId = useMemo(
    () => (address ? `wallet-${address.toLowerCase()}-${chatSessionId}` : chatSessionId),
    [address, chatSessionId],
  );

  useEffect(() => {
    setChatSessionId(createChatSessionId());
  }, []);
  const [pendingAttachment, setPendingAttachment] = useState<PendingChatAttachment | null>(null);
  const [voicePaymentLabel, setVoicePaymentLabel] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [recentChats, setRecentChats] = useState<ChatHistoryItem[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPaymentPanelOpen, setIsPaymentPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const previousWalletRef = useRef<string | null | undefined>(undefined);
  const [queuedResearchJobId, setQueuedResearchJobId] = useState<string | null>(null);

  const selectedCategory = tabCategoryMap[selectedTab];
  const hasConversation = messages.length > 0;
  const assistantMessages = useMemo(
    () => messages.filter((message) => message.role === "assistant"),
    [messages],
  );
  const latestPaymentMessage = useMemo(
    () =>
      [...assistantMessages]
        .reverse()
        .find((message) => (message.paymentMeta?.entries?.length ?? 0) > 0) ?? null,
    [assistantMessages],
  );
  const selectedPaymentMessage = latestPaymentMessage;
  const contextItems = useMemo(
    () =>
      contextLabels.map((label) => ({
        label,
        active: activeContexts.includes(label),
      })),
    [activeContexts],
  );
  const executionContexts = useMemo(
    () => [executionTarget, ...activeContexts],
    [executionTarget, activeContexts],
  );

  useEffect(() => {
    if (!queuedResearchJobId) {
      return;
    }
    const jobId = queuedResearchJobId;

    const poll = async () => {
      const headers = getAuthHeaders();
      if (!headers?.Authorization) {
        return;
      }
      try {
        const res = await fetch(
          `/api/research/status/${encodeURIComponent(jobId)}`,
          {
            method: "GET",
            headers: { ...headers },
            credentials: "include",
            cache: "no-store",
          },
        );
        if (!res.ok) {
          return;
        }
        const job = (await res.json()) as {
          status?: string;
          result?: string;
          error?: string;
        };
        if (job.status === "done" && typeof job.result === "string" && job.result.trim()) {
          const reportText = job.result.trim();
          setQueuedResearchJobId(null);
          setMessages((previous) => [
            ...previous,
            {
              id: `assistant-research-done-${Date.now()}`,
              role: "assistant",
              title: "AgentFlow",
              content: reportText,
              status: "complete",
            },
          ]);
        } else if (job.status === "failed") {
          setQueuedResearchJobId(null);
          setMessages((previous) => [
            ...previous,
            {
              id: `assistant-research-failed-${Date.now()}`,
              role: "assistant",
              title: "AgentFlow",
              content: `Research failed: ${job.error || "unknown error"}`,
              status: "error",
            },
          ]);
        }
      } catch {
        /* transient network errors — next tick retries */
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [queuedResearchJobId, getAuthHeaders]);

  useEffect(() => {
    const raw = searchParams.get("message");
    const rawContext = searchParams.get("context");
    const rawWalletTab = searchParams.get("walletTab");
    if (!raw) {
      return;
    }
    try {
      setInput(decodeURIComponent(raw));
    } catch {
      setInput(raw);
    }
    if (rawContext) {
      try {
        setPortfolioContext(decodeURIComponent(rawContext));
      } catch {
        setPortfolioContext(rawContext);
      }
      const label =
        rawWalletTab === "dcw"
          ? "DCW wallet"
          : rawWalletTab === "eoa"
            ? "EOA wallet"
            : "combined";
      setPortfolioWalletLabel(label);
    }
    setSelectedTab("Portfolio");
    const next = new URLSearchParams(searchParams.toString());
    next.delete("message");
    next.delete("tab");
    next.delete("context");
    next.delete("walletTab");
    next.delete("executionTarget");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setRecentChats(normalizeChatHistoryFromStorage(parsed));
      }
    } catch {
      setRecentChats([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const currentWallet = address?.toLowerCase() ?? null;
    if (previousWalletRef.current === undefined) {
      previousWalletRef.current = currentWallet;
      return;
    }
    if (previousWalletRef.current === currentWallet) {
      return;
    }

    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput("");
    setPendingAttachment(null);
    setVoicePaymentLabel(null);
    setIsPaymentPanelOpen(false);
    setQueuedResearchJobId(null);
    setIsStreaming(false);
    setChatSessionId(createChatSessionId());
    previousWalletRef.current = currentWallet;
  }, [address]);

  useEffect(() => {
    if (selectedPaymentMessage?.paymentMeta?.entries?.length) {
      setIsPaymentPanelOpen(true);
    }
  }, [selectedPaymentMessage?.id, selectedPaymentMessage?.paymentMeta?.entries?.length]);

  const persistRecentChats = (updater: (previous: ChatHistoryItem[]) => ChatHistoryItem[]) => {
    setRecentChats((previous) => {
      const next = updater(previous);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  };

  const recordRecentChat = (title: string) => {
    const at = Date.now();
    persistRecentChats((previous) =>
      [
        {
          id: `chat-${at}`,
          title,
          at,
        },
        ...previous.filter((item) => item.title !== title),
      ].slice(0, 8),
    );
  };

  const updateMessage = (
    id: string,
    updater: (message: LiveChatMessage) => LiveChatMessage,
  ) => {
    setMessages((previous) =>
      previous.map((message) => (message.id === id ? updater(message) : message)),
    );
  };

  const resetChatThread = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput("");
    setPendingAttachment(null);
    setVoicePaymentLabel(null);
    setIsPaymentPanelOpen(false);
    setQueuedResearchJobId(null);
    setIsStreaming(false);
    setChatSessionId(createChatSessionId());
  };

  const handleQuickAgentPrompt = useCallback((item: QuickAgentPrompt) => {
    setSelectedTab(item.tab);
    setInput(item.prompt);
    setPendingAttachment(null);
    setVoicePaymentLabel(null);
  }, []);

  const handleStructuredConfirmation = async (input: {
    messageId: string;
    action: "schedule" | "split" | "invoice" | "batch";
    confirmId: string;
    label: string;
  }) => {
    const userMessage: LiveChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.label,
      status: "complete",
    };
    const assistantId = `assistant-${Date.now()}-confirm`;
    const assistantMessage: LiveChatMessage = {
      id: assistantId,
      role: "assistant",
      title: "AgentFlow",
      content: "",
      status: "streaming",
    };

    setMessages((previous) => [
      ...previous.map((message) =>
        message.id === input.messageId
          ? {
              ...message,
              confirmation: undefined,
              status: (message.status === "error" ? "error" : "complete") as "error" | "complete",
            }
          : message,
      ),
      userMessage,
      assistantMessage,
    ]);
    setIsStreaming(true);

    try {
      let authHeaders = address ? getAuthHeaders() : null;
      if (!authHeaders && address) {
        await signIn();
        authHeaders = getAuthHeaders();
      }

      const endpoint =
        input.action === "split"
          ? `/api/split/confirm/${encodeURIComponent(input.confirmId)}`
          : input.action === "invoice"
          ? `/api/invoice/confirm/${encodeURIComponent(input.confirmId)}`
          : input.action === "batch"
          ? `/api/batch/confirm/${encodeURIComponent(input.confirmId)}`
          : `/api/schedule/confirm/${encodeURIComponent(input.confirmId)}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeaders ?? {}),
        },
        credentials: "include",
        body: JSON.stringify({}),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        success?: boolean;
        error?: string;
        payment?: LiveChatMessage["paymentMeta"];
      };

      const fallbackMessage =
        input.action === "split"
          ? "Split confirmation failed."
          : input.action === "invoice"
          ? "Invoice creation failed."
          : input.action === "batch"
          ? "Batch payment failed."
          : "Schedule confirmation failed.";

      updateMessage(assistantId, (message) => ({
        ...message,
        content:
          typeof payload.message === "string" && payload.message.trim()
            ? payload.message
            : typeof payload.error === "string" && payload.error.trim()
              ? friendlyChatErrorMessage(payload.error, fallbackMessage)
            : fallbackMessage,
        paymentMeta: payload.payment ?? message.paymentMeta,
        activityMeta: payload.payment
          ? {
              mode: "brain",
              clusters: [
                input.action === "invoice"
                  ? "Invoice Agent"
                  : input.action === "batch"
                    ? "Batch Agent"
                    : input.action === "split"
                      ? "Split Agent"
                      : "Schedule Agent",
              ],
              stageBars: [28, 50, 74, 94, 30, 18],
            }
          : message.activityMeta,
        status: response.ok ? "complete" : "error",
      }));

      if (input.action === "schedule" && response.ok && typeof window !== "undefined") {
        localStorage.setItem("agentpay:schedules:refresh", String(Date.now()));
      }
    } catch (error) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content:
          friendlyChatErrorMessage(
            error,
            `Could not confirm the ${input.action} action.`,
          ),
        status: "error",
      }));
    } finally {
      setIsStreaming(false);
    }
  };

  const toggleContext = (label: string) => {
    setActiveContexts((previous) =>
      previous.includes(label)
        ? previous.filter((item) => item !== label)
        : [...previous, label],
    );
  };

  const resolvePaidClientContext = async () => {
    if (!address) {
      openConnectModal?.();
      throw new Error("Connect your wallet to run AgentFlow on Arc.");
    }

    if (chainId !== ARC_CHAIN_ID) {
      throw new Error("Switch to Arc Testnet before running this agent.");
    }

    if (!walletClient) {
      throw new Error(
        "Reconnect your wallet and try again. The browser wallet client is not ready yet.",
      );
    }

    let authHeaders = getAuthHeaders();
    if (!isAuthenticated || !authHeaders) {
      await signIn();
      authHeaders = authHeadersForWallet(address);
    }

    if (!authHeaders) {
      throw new Error(
        "The wallet signature completed, but the secure session did not attach correctly. Try again once.",
      );
    }

    return { address, walletClient, authHeaders };
  };

  const requirePaidAgentContext = async (
    assistantId: string,
    options: { executionTarget: ExecutionTarget },
  ) => {
    if (!address) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content: "Connect your wallet to run AgentFlow on Arc.",
        trace: ["Wallet connection required before execution can start"],
        status: "error",
      }));
      setIsStreaming(false);
      openConnectModal?.();
      return null;
    }

    if (chainId !== ARC_CHAIN_ID) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content: "Switch to Arc Testnet before running this agent.",
        trace: ["Arc wallet session required for x402 payment"],
        status: "error",
      }));
      setIsStreaming(false);
      return null;
    }

    if (!walletClient) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content: "Reconnect your wallet and try again. The browser wallet client is not ready yet.",
        trace: ["RainbowKit session did not expose a wallet client"],
        status: "error",
      }));
      setIsStreaming(false);
      return null;
    }

    let authHeaders = getAuthHeaders();
    if (!isAuthenticated || !authHeaders) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content: "Confirm the AgentFlow session signature in your wallet. I'll continue as soon as it's signed.",
        trace: [...(message.trace || []), "Preparing secure session for paid agent access"],
        status: "streaming",
      }));

      const sessionMessage = buildSessionSignatureMessage(options.executionTarget);
      updateMessage(assistantId, (message) => ({
        ...message,
        content: sessionMessage.content,
        trace: [...(message.trace || []), sessionMessage.trace],
        status: "streaming",
      }));

      try {
        await signIn();
        authHeaders = authHeadersForWallet(address);
      } catch (error) {
        const message =
          error instanceof Error ? error.message.toLowerCase() : "signature request was not completed";
        const cancelled =
          message.includes("rejected") ||
          message.includes("cancelled") ||
          message.includes("denied") ||
          message.includes("declined") ||
          message.includes("user rejected");

        updateMessage(assistantId, (current) => ({
          ...current,
          content: cancelled
            ? "The session signature was cancelled, so the paid run did not start."
            : "AgentFlow could not establish a signed session for this paid run.",
          trace: [
            ...(current.trace || []),
            cancelled
              ? "Wallet signature was cancelled before the session could start"
              : "Session signing failed",
          ],
          status: "error",
        }));
        setIsStreaming(false);
        return null;
      }
    }

    if (!authHeaders) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content: "The wallet signature completed, but the secure session did not attach correctly. Try again once.",
        trace: [...(message.trace || []), "Signed session was not available to the paid agent"],
        status: "error",
      }));
      setIsStreaming(false);
      return null;
    }

    if (!isAuthenticated) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content: "Session confirmed. Starting the paid run now.",
        trace: [...(message.trace || []), "Signed session confirmed"],
        status: "streaming",
      }));
      if (options.executionTarget === "DCW") {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: "Session confirmed. Continuing with DCW execution.",
          trace: [...(message.trace || []), "Signed session confirmed for DCW execution"],
          status: "streaming",
        }));
      }
    }

    return { address, walletClient, authHeaders };
  };

  const handleSelectAttachment = async (file: File) => {
    const { authHeaders } = await resolvePaidClientContext();
    const form = new FormData();
    form.append("file", file, file.name);

    const response = await fetch("/api/attachments/validate", {
      method: "POST",
      headers: {
        ...authHeaders,
      },
      body: form,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      attachment?: ChatAttachment;
      error?: string;
    };

    if (!response.ok || !payload.attachment) {
      throw new Error(payload.error || "Attachment validation failed");
    }

    const dataUrl = await fileToDataUrl(file);
    setPendingAttachment({
      ...payload.attachment,
      dataUrl,
      previewUrl: payload.attachment.kind === "image" ? dataUrl : undefined,
    });
  };

  const handleRequestTranscription = async (audio: {
    blob: Blob;
    name: string;
    mimeType: string;
    size: number;
  }) => {
    const paidContext = await resolvePaidClientContext();
    const dataUrl = await fileToDataUrl(audio.blob);

    const result = await runPaidAgent<TranscribeAgentResponseWithPayment, Record<string, unknown>>({
      slug: "transcribe",
      walletClient: paidContext.walletClient,
      payer: paidContext.address,
      authHeaders: paidContext.authHeaders,
      body: {
        audio: {
          name: audio.name,
          mimeType: audio.mimeType,
          size: audio.size,
          dataUrl,
        },
        executionTarget,
      },
    });

    if (!result.success) {
      throw new Error(result.error || "Voice transcription failed");
    }

    const text = result.text.trim();
    if (!text) {
      throw new Error("No speech was recognized in that recording.");
    }

    setVoicePaymentLabel(formatVoicePaymentLabel(result, paidContext.address));
    return text;
  };

  const submitMessage = async (
    rawInput: string,
    attachmentOverride?: PendingChatAttachment | null,
  ) => {
    const trimmed = rawInput.trim();
    const activeAttachment = attachmentOverride ?? pendingAttachment;
    if ((!trimmed && !activeAttachment) || isStreaming) {
      return;
    }

    const localGuardReply = buildLocalPromptGuard(trimmed, activeAttachment);
    if (localGuardReply) {
      const now = Date.now();
      recordRecentChat(trimmed || (activeAttachment ? attachmentSummaryLabel(activeAttachment) : ""));
      setMessages((previous) => [
        ...previous,
        {
          id: `user-${now}`,
          role: "user",
          content: trimmed,
          attachment: activeAttachment
            ? {
                kind: activeAttachment.kind,
                name: activeAttachment.name,
                mimeType: activeAttachment.mimeType,
                size: activeAttachment.size,
                previewUrl: activeAttachment.previewUrl,
              }
            : undefined,
          status: "complete",
        },
        {
          id: `assistant-${now}-guard`,
          role: "assistant",
          title: "AgentFlow",
          content: localGuardReply,
          status: "complete",
        },
      ]);
      setInput("");
      setPendingAttachment(null);
      setVoicePaymentLabel(null);
      return;
    }

    // Capture and clear portfolio context so it's injected only into this first message
    const contextToInject = portfolioContext;
    if (contextToInject) {
      setPortfolioContext(null);
    }
    const messageWithContext = contextToInject
      ? `${trimmed}\n\nPortfolio context:\n${contextToInject}`
      : trimmed;

    // CSV attachments → route to the batch-payment fast-path instead of Vision.
    // We inline the CSV body into the outgoing message with a "batch pay" header so
    // server.ts's shouldHandleAsBatchPayment picks it up.
    let csvBatchMessage: string | null = null;
    if (isBatchCsvAttachment(activeAttachment)) {
      const csvText = decodeTextDataUrl(activeAttachment?.dataUrl);
      if (csvText && csvText.trim()) {
        const prefix = trimmed || "batch pay";
        csvBatchMessage = `${prefix}\n${csvText.trim()}`;
      }
    }

    const inferredIntent = csvBatchMessage
      ? inferPromptIntent(csvBatchMessage, selectedTab)
      : activeAttachment
      ? "Vision"
      : inferPromptIntent(trimmed, selectedTab);
    const routedTab = promptTabs.includes(inferredIntent as PromptTab)
      ? (inferredIntent as PromptTab)
      : null;

    if (routedTab && routedTab !== selectedTab) {
      setSelectedTab(routedTab);
    }

    const intent: ChatIntent = csvBatchMessage
      ? inferredIntent
      : activeAttachment
      ? "Vision"
      : inferredIntent;
    const useBrainConversation = !activeAttachment || Boolean(csvBatchMessage);

    recordRecentChat(trimmed || (activeAttachment ? attachmentSummaryLabel(activeAttachment) : ""));

    const userMessage: LiveChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      attachment: activeAttachment
        ? {
            kind: activeAttachment.kind,
            name: activeAttachment.name,
            mimeType: activeAttachment.mimeType,
            size: activeAttachment.size,
            previewUrl: activeAttachment.previewUrl,
          }
        : undefined,
      status: "complete",
    };
    const assistantId = `assistant-${Date.now()}`;
    const assistantMessage: LiveChatMessage = {
      id: assistantId,
      role: "assistant",
      title: useBrainConversation ? "AgentFlow" : getAssistantTitle(intent),
      content:
        useBrainConversation
          ? ""
          : intent === "Conversation"
            ? ""
            : intent === "Vision"
              ? "Preparing attachment analysis..."
              : "Preparing the AgentFlow run...",
      trace: useBrainConversation || intent === "Conversation" ? undefined : [],
      status: "streaming",
    };

    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setInput("");
    setPendingAttachment(null);
    setVoicePaymentLabel(null);
    setIsStreaming(true);

    if (useBrainConversation) {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let receivedDelta = false;
      let streamedContent = "";
      let sawReportCompletion = false;
      let pipelineErrorHandled = false;
      /** Deduplicate when the server also sends a final `delta: "\\n\\n---\\n\\n" + report` after `type: report`. */
      let lastPipelineReportMarkdown: string | null = null;

      try {
        const outgoingMessage = csvBatchMessage ?? messageWithContext;
        await streamConversationReply({
          message: outgoingMessage,
          messages: [...messages, userMessage].map((message) => ({
            role: message.role,
            content: message.content,
          })),
          walletAddress: address,
          executionTarget,
          sessionId,
          signal: controller.signal,
          authHeaders: getAuthHeaders() ?? undefined,
          onMeta: (meta) => {
            if (meta.researchQueued?.jobId) {
              setQueuedResearchJobId(meta.researchQueued.jobId);
            }
            updateMessage(assistantId, (message) => ({
              ...message,
              title: meta.title ?? message.title,
              trace: meta.trace ?? message.trace,
              reportMeta: meta.reportMeta
                ? {
                    ...(message.reportMeta || {}),
                    ...meta.reportMeta,
                  }
                : message.reportMeta,
              activityMeta: meta.activityMeta
                ? {
                    ...(message.activityMeta || {}),
                    ...meta.activityMeta,
                  }
                : message.activityMeta,
              paymentMeta: meta.paymentMeta ?? message.paymentMeta,
              confirmation: meta.confirmation ?? message.confirmation,
              paymentLink: meta.paymentLink ?? message.paymentLink,
            }));
          },
          onDelta: (delta) => {
            if (lastPipelineReportMarkdown) {
              const duplicateSuffix = `\n\n---\n\n${lastPipelineReportMarkdown}`;
              if (delta === duplicateSuffix) {
                return;
              }
            }
            receivedDelta = true;
            streamedContent += delta;
            updateMessage(assistantId, (message) => ({
              ...message,
              content: `${message.content}${delta}`,
              status: "streaming",
            }));
          },
          onReport: (event) => {
            receivedDelta = true;
            sawReportCompletion = true;
            lastPipelineReportMarkdown = event.markdown;
            streamedContent += event.markdown;
            updateMessage(assistantId, (message) => {
              const body = event.markdown;
              const combined = message.content
                ? `${message.content}\n\n---\n\n${body}`.trim()
                : body;
              return {
                ...message,
                content: combined,
                status: "complete",
                reportMeta: buildResearchReportMeta(event),
              };
            });
          },
          onPipelineError: (errMsg) => {
            receivedDelta = true;
            pipelineErrorHandled = true;
            updateMessage(assistantId, (message) => ({
              ...message,
              content: errMsg,
              status: "error",
            }));
          },
        });

        if (!pipelineErrorHandled) {
          if (sawReportCompletion) {
            updateMessage(assistantId, (message) => ({
              ...message,
              status: "complete",
            }));
          } else {
            updateMessage(assistantId, (message) => ({
              ...message,
              content: message.content || "AgentFlow is ready when you are.",
              status: receivedDelta ? "complete" : "error",
            }));
          }
        }

        if (
          receivedDelta &&
          streamedContent.includes("research pipeline is busy") &&
          /Job ID:\s*/i.test(streamedContent)
        ) {
          const m = streamedContent.match(/Job ID:\s*(\S+)/i);
          if (m?.[1]) {
            setQueuedResearchJobId(m[1]);
          }
        }

        if (
          receivedDelta &&
          typeof window !== "undefined" &&
          /scheduled payment(?: is now)? (?:created|cancelled|canceled)|scheduled payment with id .* has been cancelled/i.test(
            streamedContent,
          )
        ) {
          localStorage.setItem("agentpay:schedules:refresh", String(Date.now()));
        }

        if (!receivedDelta && !sawReportCompletion && !pipelineErrorHandled) {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: "The assistant stream ended before a reply arrived.",
            status: "error",
          }));
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: "The previous reply was cancelled before completion.",
            status: "error",
          }));
        } else {
          updateMessage(assistantId, (message) => ({
            ...message,
            content:
              friendlyChatErrorMessage(error, "AgentFlow could not complete that reply."),
            status: "error",
          }));
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsStreaming(false);
      }
      return;
    }

    if (intent === "Research") {
      if (!address) {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: "Connect your wallet to run AgentFlow on Arc.",
          trace: ["Wallet connection required before execution can start"],
          status: "error",
        }));
        setIsStreaming(false);
        openConnectModal?.();
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let sawTerminalEvent = false;

      try {
        await streamAgentFlow({
          task: buildTask(selectedCategory, trimmed, executionContexts),
          walletAddress: address,
          signal: controller.signal,
          onEvent: (streamEvent) => {
            const nextTrace = formatPipelineTrace(streamEvent);

            updateMessage(assistantId, (message) => ({
              ...message,
              content:
                streamEvent.type === "report"
                  ? streamEvent.markdown
                  : streamEvent.type === "error"
                    ? streamEvent.message
                    : message.content,
              trace: nextTrace ? [...(message.trace || []), nextTrace] : message.trace,
              reportMeta:
                streamEvent.type === "report"
                  ? buildResearchReportMeta(streamEvent)
                  : message.reportMeta,
              paymentMeta:
                streamEvent.type === "receipt" && streamEvent.entries?.length
                  ? { entries: streamEvent.entries }
                  : message.paymentMeta,
              status:
                streamEvent.type === "report"
                  ? "complete"
                  : streamEvent.type === "error"
                    ? "error"
                    : "streaming",
            }));

            if (streamEvent.type === "report" || streamEvent.type === "error") {
              sawTerminalEvent = true;
            }
          },
        });

        if (!sawTerminalEvent) {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: "The live stream ended before a final report arrived.",
            trace: [...(message.trace || []), "Stream closed before the writer finished"],
            status: "error",
          }));
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: "The previous run was cancelled before completion.",
            trace: [...(message.trace || []), "Stream cancelled"],
            status: "error",
          }));
        } else {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: friendlyChatErrorMessage(error, "Live pipeline failed unexpectedly."),
            trace: [...(message.trace || []), "Pipeline request failed"],
            status: "error",
          }));
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsStreaming(false);
      }
      return;
    }

    if (intent === "Vision" && activeAttachment) {
      const paidContext = await requirePaidAgentContext(assistantId, {
        executionTarget,
      });
      if (!paidContext) {
        return;
      }

      try {
        updateMessage(assistantId, (message) => ({
          ...message,
          content:
            activeAttachment.kind === "image"
              ? "Vision agent is reading the image and preparing a natural response."
              : activeAttachment.kind === "pdf"
                ? "Vision agent is reading the single-page PDF and preparing a natural response."
                : "Vision agent is reading the attached file and preparing a natural response.",
          trace: [
            `Validated ${activeAttachment.kind} attachment`,
            `Attachment: ${activeAttachment.name}`,
            `Execution target: ${executionTarget}`,
          ],
        }));

        const result = await runPaidAgent<VisionAgentResponseWithPayment, Record<string, unknown>>({
          slug: "vision",
          walletClient: paidContext.walletClient,
          payer: paidContext.address,
          authHeaders: paidContext.authHeaders,
          onAwaitSignature: () => {
            const paymentMessage = buildPaymentSignatureMessage(executionTarget);
            updateMessage(assistantId, (message) => ({
              ...message,
              content: paymentMessage.content,
              trace: [...(message.trace || []), paymentMessage.trace],
              status: "streaming",
            }));
          },
          body: {
            prompt: buildAttachmentPrompt(activeAttachment, trimmed),
            attachment: {
              name: activeAttachment.name,
              mimeType: activeAttachment.mimeType,
              size: activeAttachment.size,
              dataUrl: activeAttachment.dataUrl,
            },
            executionTarget,
          },
        });

        if (!result.success) {
          throw new Error(result.error || "Attachment analysis failed");
        }

        updateMessage(assistantId, (message) => ({
          ...message,
          content: result.answer,
          trace: [
            ...(message.trace || []),
            `Extractor: ${result.extractor}`,
            ...(result.notes || []),
            result.usage
              ? `Attachment cap: ${result.usage.usedToday}/${result.usage.dailyLimit} today`
              : "Attachment analysis completed",
          ],
          paymentMeta: buildPaymentMetaFromResult("vision", result, paidContext.address),
          status: "complete",
        }));
      } catch (error) {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: friendlyChatErrorMessage(error, "Attachment analysis failed unexpectedly."),
          trace: [...(message.trace || []), "Attachment request failed"],
          status: "error",
        }));
      } finally {
        setIsStreaming(false);
      }
      return;
    }

    const paidContext = await requirePaidAgentContext(assistantId, {
      executionTarget,
    });
    if (!paidContext) {
      return;
    }

    const { address: payerAddress, walletClient: activeWalletClient, authHeaders } = paidContext;

    try {
      const executionGuard =
        intent === "Swap" || intent === "Vault" || intent === "Portfolio"
          ? buildExecutionTargetGuard({
              intent,
              executionTarget,
              vaultAction: intent === "Vault" ? detectVaultAction(trimmed) : undefined,
            })
          : { blocked: false };

      if (executionGuard.blocked) {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: executionGuard.content || message.content,
          trace: [...(message.trace || []), ...(executionGuard.trace || [])],
          status: "complete",
        }));
        return;
      }

      if (intent === "Portfolio") {
        let portfolioWalletAddress: `0x${string}` = payerAddress;
        let portfolioTargetLabel = "connected EOA";
        if (executionTarget === "DCW") {
          const executionSummary = await fetchExecutionWalletSummary(authHeaders);
          portfolioWalletAddress = getAddress(
            executionSummary.userAgentWalletAddress,
          ) as `0x${string}`;
          portfolioTargetLabel = "AgentFlow execution wallet (DCW)";
        }

        updateMessage(assistantId, (message) => ({
          ...message,
          content: `Reading live Arc balances from your ${portfolioTargetLabel}, valuing vault and swap positions, and asking Hermes for a portfolio narrative.`,
          trace: [
            `Portfolio target: ${executionTarget} (${portfolioWalletAddress})`,
            "Portfolio agent reading live wallet holdings",
            "PnL engine valuing vault and swap positions",
            "Hermes preparing the portfolio report",
          ],
        }));

        const result = await runPortfolioAgent({
          walletClient: activeWalletClient,
          payer: payerAddress,
          walletAddress: portfolioWalletAddress,
          executionTarget,
          authHeaders,
        });

        updateMessage(assistantId, (message) => ({
          ...message,
          content: result.report,
          reportMeta: buildPortfolioReportMeta(result),
          paymentMeta: buildPaymentMetaFromResult("portfolio", result, payerAddress),
          trace: [
            ...(message.trace || []),
            `Scanned wallet: ${portfolioWalletAddress}`,
            result.payment?.payer
              ? `Task paid from DCW Circle wallet ${result.payment.payer}`
              : "Task paid from DCW Circle wallet",
            `Paid portfolio run completed - ${result.holdings.length} holdings`,
            `Risk score ${result.riskScore}/100 - ${result.recommendations.length} recommendations`,
          ],
          status: "complete",
        }));
        return;
      }

      if (intent === "Swap") {
        const { tokenPair, swapSpends } = (() => {
          const r = resolveSwapTokenPair(trimmed);
          return {
            tokenPair: { tokenIn: r.tokenIn, tokenOut: r.tokenOut },
            swapSpends: r.swapSpends,
          };
        })();
        const executionSummary = await fetchExecutionWalletSummary(authHeaders);
        const block = buildExecutionBlockResult({
          intent: "Swap",
          executionWalletAddress: executionSummary.userAgentWalletAddress,
          needsGasFunding: executionSummary.fundingStatus.needsGasFunding,
          needsUsdcFunding: executionSummary.fundingStatus.needsUsdcFunding,
          needsEurcFunding: executionSummary.fundingStatus.needsEurcFunding,
          swapSpends,
          needsVaultShares: executionSummary.fundingStatus.needsVaultShares,
        });
        if (block.blocked) {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: block.content || message.content,
            trace: [...(message.trace || []), ...(block.trace || [])],
            status: "complete",
          }));
          return;
        }

        const amount = parseAmount(trimmed, 1);
        const slippage = parseSlippage(trimmed, 1);
        updateMessage(assistantId, (message) => ({
          ...message,
          content: "Fetching a live quote and routing the swap through AgentFlow Swap.",
          trace: [
            swapSpends === "eurc"
              ? `Preparing ${amount} EURC -> USDC swap request`
              : `Preparing ${amount} USDC -> EURC swap request`,
            `Using ${slippage}% slippage guard`,
            `Execution target: ${executionTarget}`,
          ],
        }));

        const result = await runPaidAgent<SwapAgentResponse & AgentRunPaymentResult, Record<string, unknown>>({
          slug: "swap",
          walletClient: activeWalletClient,
          payer: payerAddress,
          authHeaders,
          onAwaitSignature: () => {
            const paymentMessage = buildPaymentSignatureMessage(executionTarget);
            updateMessage(assistantId, (message) => ({
              ...message,
              content: paymentMessage.content,
              trace: [...(message.trace || []), paymentMessage.trace],
              status: "streaming",
            }));
          },
          body: {
            walletAddress: payerAddress,
            amount,
            slippage,
            tokenPair,
            executionTarget,
          },
        });

        if (!result.success) {
          throw new Error(result.error || "Swap agent failed");
        }

        updateMessage(assistantId, (message) => {
          const r = result.receipt;
          const resolvedExecutionTarget =
            r?.executionTarget ?? result.executionMode ?? executionTarget;
          const pairIn = r?.tokenPair?.tokenIn ?? tokenPair.tokenIn;
          const pairOut = r?.tokenPair?.tokenOut ?? tokenPair.tokenOut;
          const amountIn = r?.amountIn ?? amount;
          const amountBlock =
            result.txHash && amountIn > 0
              ? `${formatSwapAmountLine({
                  amountIn,
                  quoteOutRaw: r?.quoteOutRaw,
                  tokenIn: pairIn,
                  tokenOut: pairOut,
                })}\n\n`
              : "";
          return {
            ...message,
            content: result.txHash
              ? `${amountBlock}Swap complete on Arc.\n\nExecuted from: ${resolvedExecutionTarget}\nTx: ${result.txHash}\n\nExplorer: ${r?.explorerLink || "Unavailable"}`
              : "Swap completed, but no transaction hash was returned.",
            trace: [
              ...(message.trace || []),
              "Swap quote approved",
              `Swap executed from ${resolvedExecutionTarget}`,
              result.txHash ? `Swap verified - ${result.txHash.slice(0, 10)}...` : "Swap verified",
            ],
            paymentMeta: buildPaymentMetaFromResult("swap", result, payerAddress),
            status: "complete",
          };
        });
        return;
      }

      if (intent === "Vault") {
        const action = detectVaultAction(trimmed);
        const isUsycAction = action === "usyc_deposit" || action === "usyc_withdraw";
        if (isUsycAction && executionTarget === "EOA") {
          const preflight = await preflightEoaUsycAction({
            action,
            walletAddress: payerAddress,
            amount: parseAmount(trimmed, 1),
          });
          if (!preflight.ok) {
            updateMessage(assistantId, (message) => ({
              ...message,
              content: preflight.error,
              trace: [...(message.trace || []), ...preflight.trace],
              status: "complete",
            }));
            return;
          }

          updateMessage(assistantId, (message) => ({
            ...message,
            trace: [...(message.trace || []), ...preflight.trace],
          }));
        } else if (
          action === "deposit" ||
          action === "withdraw" ||
          action === "usyc_deposit" ||
          action === "usyc_withdraw"
        ) {
          const executionSummary = await fetchExecutionWalletSummary(authHeaders);
          const block = buildExecutionBlockResult({
            intent: "Vault",
            vaultAction: action,
            executionWalletAddress: executionSummary.userAgentWalletAddress,
            needsGasFunding: executionSummary.fundingStatus.needsGasFunding,
            needsUsdcFunding: executionSummary.fundingStatus.needsUsdcFunding,
            needsVaultShares: executionSummary.fundingStatus.needsVaultShares,
          });
          if (block.blocked) {
            updateMessage(assistantId, (message) => ({
              ...message,
              content: block.content || message.content,
              trace: [...(message.trace || []), ...(block.trace || [])],
              status: "complete",
            }));
            return;
          }
        }

        const amount = parseAmount(trimmed, 1);

        updateMessage(assistantId, (message) => ({
          ...message,
          content:
            action === "check_apy"
              ? "Checking the live AgentFlow Vault APY."
              : action === "usyc_deposit"
                ? executionTarget === "EOA"
                  ? `Preparing USYC subscribe from your connected wallet for ${amount} USDC.`
                  : `Running USYC subscribe for ${amount} USDC.`
                : action === "usyc_withdraw"
                  ? executionTarget === "EOA"
                    ? `Preparing USYC redeem from your connected wallet for ${amount} USYC.`
                    : `Running USYC redeem for ${amount} USYC.`
                  : `Running vault ${action} for ${amount} USDC.`,
          trace: [
            action === "check_apy"
              ? "Vault agent reading APY from chain"
              : action === "usyc_deposit"
                ? executionTarget === "EOA"
                  ? "Vault agent validating Circle USYC subscribe for the connected EOA"
                  : "Vault agent preparing Circle USYC subscribe transaction"
                : action === "usyc_withdraw"
                  ? executionTarget === "EOA"
                    ? "Vault agent validating Circle USYC redeem for the connected EOA"
                    : "Vault agent preparing Circle USYC redeem transaction"
                  : `Vault agent preparing ${action} transaction`,
          ],
        }));

        const result = await runPaidAgent<VaultAgentResponse & AgentRunPaymentResult, Record<string, unknown>>({
          slug: "vault",
          walletClient: activeWalletClient,
          payer: payerAddress,
          authHeaders,
          onAwaitSignature: () => {
            const paymentMessage = buildPaymentSignatureMessage(executionTarget);
            updateMessage(assistantId, (message) => ({
              ...message,
              content: paymentMessage.content,
              trace: [...(message.trace || []), paymentMessage.trace],
              status: "streaming",
            }));
          },
          body:
            action === "check_apy"
              ? { action, walletAddress: payerAddress }
              : { action, amount, walletAddress: payerAddress, executionTarget },
        });

        if (!result.success) {
          throw new Error(result.error || "Vault agent failed");
        }

        if (isUsycAction && executionTarget === "EOA" && result.executionMode === "EOA" && result.eoaPlan) {
          updateMessage(assistantId, (message) => ({
            ...message,
            content:
              action === "usyc_deposit"
                ? "Payment settled. Confirm the USYC subscribe transaction in your wallet."
                : "Payment settled. Confirm the USYC redeem transaction in your wallet.",
            trace: [
              ...(message.trace || []),
              action === "usyc_deposit"
                ? "Waiting for EOA signature on Teller deposit"
                : "Waiting for EOA signature on Teller redeem",
            ],
          }));

          const eoaResult = await executeEoaUsycPlan({
            walletClient: activeWalletClient,
            plan: result.eoaPlan,
          });

          updateMessage(assistantId, (message) => ({
            ...message,
            content:
              action === "usyc_deposit"
                ? `USYC subscribe complete on Arc.\n\nReceived: ~${eoaResult.usycReceived || "Unavailable"} USYC\nTx: ${eoaResult.txHash}\n\nExplorer: https://testnet.arcscan.app/tx/${eoaResult.txHash}`
                : `USYC redeem complete on Arc.\n\nReceived: ~${eoaResult.usdcReceived || "Unavailable"} USDC\nTx: ${eoaResult.txHash}\n\nExplorer: https://testnet.arcscan.app/tx/${eoaResult.txHash}`,
            trace: [
              ...(message.trace || []),
              eoaResult.approvalSkipped
                ? "Existing Teller allowance reused"
                : "Allowance approval confirmed in wallet",
              action === "usyc_deposit"
                ? `USYC subscribe verified - ${eoaResult.txHash.slice(0, 10)}...`
                : `USYC redeem verified - ${eoaResult.txHash.slice(0, 10)}...`,
            ],
            paymentMeta: buildPaymentMetaFromResult("vault", result, payerAddress),
            status: "complete",
          }));
          return;
        }

        updateMessage(assistantId, (message) => ({
          ...message,
          content:
            action === "check_apy"
              ? `AgentFlow Vault APY: ${typeof result.apy === "number" ? `${result.apy.toFixed(2)}%` : "Unavailable"}`
              : action === "usyc_deposit"
                ? result.txHash
                  ? `USYC subscribe complete on Arc.\n\nReceived: ~${result.usycReceived || "Unavailable"} USYC\nTx: ${result.txHash}\n\nExplorer: ${result.explorerLink || "Unavailable"}`
                  : "USYC subscribe completed."
                : action === "usyc_withdraw"
                  ? result.txHash
                    ? `USYC redeem complete on Arc.\n\nReceived: ~${result.usdcReceived || "Unavailable"} USDC\nTx: ${result.txHash}\n\nExplorer: ${result.explorerLink || "Unavailable"}`
                    : "USYC redeem completed."
              : result.txHash
                ? `Vault ${action} complete on Arc.\n\nTx: ${result.txHash}\n\nExplorer: ${result.explorerLink || "Unavailable"}`
                : `Vault ${action} completed.`,
          trace: [
            ...(message.trace || []),
            action === "check_apy"
              ? "Vault APY read complete"
              : action === "usyc_deposit"
                ? result.txHash
                  ? `USYC subscribe verified - ${result.txHash.slice(0, 10)}...`
                  : "USYC subscribe complete"
                : action === "usyc_withdraw"
                  ? result.txHash
                    ? `USYC redeem verified - ${result.txHash.slice(0, 10)}...`
                    : "USYC redeem complete"
              : result.txHash
                ? `Vault ${action} verified - ${result.txHash.slice(0, 10)}...`
                : `Vault ${action} complete`,
          ],
          paymentMeta: buildPaymentMetaFromResult("vault", result, payerAddress),
          status: "complete",
        }));
        return;
      }

      if (intent === "Bridge") {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const amount = parseAmount(trimmed, 0.1);
        const sourceChain = detectBridgeSource(trimmed);
        const bridgeHeadTrace: [string, string] = [
          `Bridge request prepared for ${amount} USDC`,
          `Source chain: ${sourceChain}`,
        ];

        updateMessage(assistantId, (message) => ({
          ...message,
          content: `Starting a bridge from ${sourceChain} to Arc.`,
          trace: [...bridgeHeadTrace],
        }));

        await streamBridgeAgent({
          walletClient: activeWalletClient,
          payer: payerAddress,
          authHeaders,
          body: {
            walletAddress: payerAddress,
            amount,
            sourceChain,
            targetChain: "arc-testnet",
          },
          signal: controller.signal,
          onEvent: ({ event, data }) => {
            if (event === "payment") {
              const mode: "dcw" | "eoa" = data.mode === "eoa" ? "eoa" : "dcw";
              updateMessage(assistantId, (message) => ({
                ...message,
                paymentMeta: {
                  entries: [
                    {
                      requestId: String(data.requestId || ""),
                      agent: String(data.agent || "bridge"),
                      price: String(data.price || paymentPriceLabel("bridge")),
                      payer: typeof data.payer === "string" ? data.payer : payerAddress,
                      mode,
                      sponsored: false,
                      transactionRef: null,
                      settlementTxHash: null,
                    },
                  ].filter((entry) => entry.requestId),
                },
              }));
              return;
            }
            if (event === "done") {
              const fromResult = traceEntriesFromBridgeResult(data.result, sourceChain);
              updateMessage(assistantId, (message) => {
                let trace = message.trace ?? [];
                if (data.success === true) {
                  if (fromResult.length > 0) {
                    trace = [...bridgeHeadTrace, ...fromResult, "Bridge run finished"];
                  } else {
                    const tail = bridgeTraceFromStreamEvent("done", data, sourceChain);
                    trace = tail ? [...(message.trace ?? []), tail] : (message.trace ?? []);
                  }
                } else {
                  trace = [
                    ...bridgeHeadTrace,
                    typeof data.reason === "string" ? data.reason : "Bridge failed",
                  ];
                }
                return {
                  ...message,
                  content:
                    data.success === true
                      ? "Bridge flow finished. Use the settlement timeline to open each transaction on a block explorer."
                      : typeof data.reason === "string"
                        ? data.reason
                        : message.content,
                  trace,
                  status: data.success === true ? "complete" : "error",
                };
              });
              return;
            }

            const nextTrace = bridgeTraceFromStreamEvent(event, data, sourceChain);

            updateMessage(assistantId, (message) => ({
              ...message,
              content:
                event === "error"
                  ? typeof data.message === "string"
                    ? data.message
                    : message.content
                  : message.content,
              trace: nextTrace ? [...(message.trace || []), nextTrace] : message.trace,
              status: event === "error" ? "error" : "streaming",
            }));
          },
        });

        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        return;
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: "The previous run was cancelled before completion.",
          trace: [...(message.trace || []), "Run cancelled"],
          status: "error",
        }));
      } else {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: friendlyChatErrorMessage(error, "Agent run failed unexpectedly."),
          trace: [...(message.trace || []), "Agent request failed"],
          status: "error",
        }));
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await submitMessage(input, pendingAttachment);
  };

  return (
    <main className="flex h-screen overflow-hidden bg-[#080808] text-white/90">
        <ChatSidebar
          collapsed={isCollapsed}
          onToggleCollapse={toggleSidebar}
          history={recentChats}
          onNewChat={resetChatThread}
          onHistorySelect={(value) => {
            setInput(value);
            setVoicePaymentLabel(null);
          }}
        />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#080808]">
        <ChatTopNavbar
          actions={
            <>
              <button
                type="button"
                onClick={resetChatThread}
                className="rounded-full border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55 transition hover:border-[#f2ca50]/35 hover:text-[#f2ca50] md:hidden"
                aria-label="Start new chat"
              >
                New chat
              </button>
              <WalletPill
                isAuthenticated={isAuthenticated}
                onSignIn={() => {
                  signIn().catch(() => {});
                }}
                signInLoading={signInLoading}
              />
            </>
          }
        />

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <section className="flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden bg-[#080808]">
            <div className="flex min-h-0 w-full max-w-6xl flex-1 px-6 xl:px-10">
            {hasConversation ? (
              <div className="flex min-h-0 min-w-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ChatThread
                  messages={messages}
                  onSendMessage={(message) => {
                    void submitMessage(message, null);
                  }}
                  onConfirmAction={(input) => {
                    void handleStructuredConfirmation(input);
                  }}
                />
                <div className="sticky bottom-0 z-10 flex-shrink-0 bg-transparent px-0 pb-4 pt-3">
                  {portfolioContext ? (
                    <div className="mx-auto mb-3 flex max-w-5xl items-center gap-2 rounded-lg border border-white/10 bg-[#151515]/90 px-3 py-2 text-xs">
                      <span aria-hidden>📊</span>
                      <span className="text-white/50">
                        Portfolio context loaded ({portfolioWalletLabel})
                      </span>
                      <button
                        type="button"
                        onClick={() => setPortfolioContext(null)}
                        className="ml-auto text-white/40 transition hover:text-white/90"
                        aria-label="Dismiss portfolio context"
                      >
                        <span className="material-symbols-outlined text-sm leading-none">
                          close
                        </span>
                      </button>
                    </div>
                  ) : null}
                  <PromptComposer
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                    canSubmit={Boolean(input.trim() || pendingAttachment)}
                    isStreaming={isStreaming}
                    placeholder="Ask AgentFlow..."
                    contextTags={contextItems}
                    onToggleContext={toggleContext}
                    pendingAttachment={pendingAttachment}
                    onSelectAttachment={handleSelectAttachment}
                    onClearAttachment={() => setPendingAttachment(null)}
                    onRequestTranscription={handleRequestTranscription}
                    voicePaymentLabel={voicePaymentLabel}
                    size="thread"
                  />
                </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-start px-6 pb-8 pt-[clamp(7rem,20vh,12rem)] xl:px-10">
                  <div className="text-center">
                    <h1 className="font-headline text-[clamp(2.35rem,4.2vw,3.5rem)] font-black leading-[1] tracking-tight text-white">
                      How can I help today?
                    </h1>
                  </div>

                  <div className="mt-[clamp(2.25rem,6vh,4rem)]">
                    {portfolioContext ? (
                      <div className="mb-3 flex items-center gap-2 rounded-lg bg-[#1c1b1b] px-3 py-2 text-xs">
                        <span aria-hidden>📊</span>
                        <span className="text-white/50">
                          Portfolio context loaded ({portfolioWalletLabel})
                        </span>
                        <button
                          type="button"
                          onClick={() => setPortfolioContext(null)}
                          className="ml-auto text-white/40 transition hover:text-white/90"
                          aria-label="Dismiss portfolio context"
                        >
                          <span className="material-symbols-outlined text-sm leading-none">
                            close
                          </span>
                        </button>
                      </div>
                    ) : null}
                    <PromptComposer
                      value={input}
                      onChange={setInput}
                      onSubmit={handleSubmit}
                      canSubmit={Boolean(input.trim() || pendingAttachment)}
                      isStreaming={isStreaming}
                      placeholder="Ask AgentFlow..."
                      contextTags={contextItems}
                      onToggleContext={toggleContext}
                      pendingAttachment={pendingAttachment}
                      onSelectAttachment={handleSelectAttachment}
                      onClearAttachment={() => setPendingAttachment(null)}
                      onRequestTranscription={handleRequestTranscription}
                      voicePaymentLabel={voicePaymentLabel}
                      size="hero"
                    />
                    <QuickAgentPromptStrip
                      disabled={isStreaming}
                      onSelect={handleQuickAgentPrompt}
                    />
                  </div>
                </div>
              </div>
            )}
            </div>
          </section>

          {selectedPaymentMessage ? (
            <ChatPaymentPanel
              message={selectedPaymentMessage}
              isOpen={isPaymentPanelOpen}
              onClose={() => setIsPaymentPanelOpen(false)}
              onOpen={() => setIsPaymentPanelOpen(true)}
            />
          ) : null}
        </div>
      </main>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<main className="h-screen bg-[#080808] text-white/90" />}>
      <ChatPageInner />
    </Suspense>
  );
}
