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
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSwitchChain, useWalletClient } from "wagmi";
import { getWalletClient } from "@wagmi/core";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { BridgeChain, BridgeKit } from "@circle-fin/bridge-kit";
import {
  createPublicClient,
  type Address,
  type EIP1193Provider,
  formatUnits,
  getAddress,
  http,
  parseAbi,
} from "viem";
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
import { ARC_CHAIN_ID, ARC_CHAIN_ID_HEX, ARC_EXPLORER_URL, ARC_USDC_ADDRESS } from "@/lib/arcChain";
import { defaultPriceBySlug } from "@/lib/agentEndpoints";
import { authHeadersForWallet } from "@/lib/authSession";
import { normalizeChatHistoryFromStorage } from "@/lib/chatHistory";
import { type ChatCategory, type ChatHistoryItem } from "@/lib/appData";
import {
  fetchExecutionWalletSummary,
  finalizeBridgeRun,
  runPaidAgent,
  runPortfolioAgent,
  streamConversationReply,
  streamAgentFlow,
  type PipelineEvent,
  type PortfolioAgentResponse,
  type ResearchPayload,
  type LiveDataPayload,
} from "@/lib/liveAgentClient";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { sidebarWidthClass, useSidebarPreference } from "@/lib/useSidebarPreference";
import { config as wagmiConfig } from "@/lib/wagmi";
import { createBrowserX402RequestId } from "@/lib/x402BrowserClient";
import {
  BRIDGE_SOURCE_CONFIG,
  detectBridgeSource,
  type BridgeSource,
} from "@/lib/bridgeSources";

const HISTORY_STORAGE_KEY = "agentflow.chat.history";
const EXECUTION_WALLET_CACHE_PREFIX = "agentflow.execution-wallet";
const ARC_EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;
const ERC20_ALLOWANCE_ABI = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
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

type X402AttemptSnapshot = {
  requestId: string;
  stage?: string;
  error?: string;
  transaction?: string;
  updatedAt?: string;
};

const BRIDGE_SWITCH_TIMEOUT_MS = 15_000;
const BRIDGE_WALLET_CLIENT_TIMEOUT_MS = 15_000;
const BRIDGE_FINALIZE_TIMEOUT_MS = 35_000;
const BRIDGE_FINALIZE_POLL_TIMEOUT_MS = 30_000;
const BRIDGE_FINALIZE_POLL_INTERVAL_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeHexChainId(value: string | number | bigint): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = trimmed.startsWith("0x") ? Number.parseInt(trimmed, 16) : Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function waitForConnectorChain(
  provider: EIP1193Provider | undefined,
  expectedChainId: number,
  timeoutMs: number,
): Promise<void> {
  if (!provider?.request) {
    return;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const rawChainId = await provider.request({ method: "eth_chainId" });
      const normalized = normalizeHexChainId(
        typeof rawChainId === "string" || typeof rawChainId === "number" || typeof rawChainId === "bigint"
          ? rawChainId
          : String(rawChainId),
      );
      if (normalized === expectedChainId) {
        return;
      }
    } catch {
      // keep polling until the wallet provider catches up after the network switch
    }
    await sleep(350);
  }

  throw new Error("Wallet network switch has not settled yet. Please keep the wallet on Arc and try again.");
}

async function requestWalletSwitchToArc(provider: EIP1193Provider | undefined): Promise<void> {
  if (!provider?.request) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_CHAIN_ID_HEX }],
    });
    return;
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? Number((error as { code?: unknown }).code)
        : NaN;

    if (code !== 4902) {
      throw error;
    }
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: ARC_CHAIN_ID_HEX,
        chainName: "Arc Testnet",
        nativeCurrency: {
          name: "USD Coin",
          symbol: "USDC",
          decimals: 18,
        },
        rpcUrls: ["https://rpc.testnet.arc.network"],
        blockExplorerUrls: [ARC_EXPLORER_URL],
      },
    ],
  });
}

function isChainMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /does not match the connection's chain|current chain id|expected chain id/i.test(message);
}

function isTerminalX402AttemptStage(stage?: string | null): boolean {
  return stage === "succeeded" || stage === "failed" || stage === "preflight_failed";
}

function isBridgeFinalizePendingStage(stage?: string | null): boolean {
  return stage === "started" ||
    stage === "preflight_ok" ||
    stage === "payment_required" ||
    stage === "payload_created" ||
    stage === "paid_request_sent";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer != null) {
      window.clearTimeout(timer);
    }
  }
}

async function readX402AttemptSnapshot(
  requestId: string,
): Promise<X402AttemptSnapshot | null> {
  try {
    const response = await fetch(`/api/x402/attempts/${encodeURIComponent(requestId)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as
      | X402AttemptSnapshot
      | { ok?: boolean; record?: X402AttemptSnapshot | null };
    if (payload && typeof payload === "object" && "record" in payload) {
      return payload.record ?? null;
    }
    return payload as X402AttemptSnapshot;
  } catch {
    return null;
  }
}

async function waitForX402AttemptTerminalState(
  requestId: string,
  timeoutMs: number = BRIDGE_FINALIZE_POLL_TIMEOUT_MS,
): Promise<X402AttemptSnapshot | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const attempt = await readX402AttemptSnapshot(requestId);
    if (attempt && isTerminalX402AttemptStage(attempt.stage)) {
      return attempt;
    }
    await sleep(BRIDGE_FINALIZE_POLL_INTERVAL_MS);
  }
  return await readX402AttemptSnapshot(requestId);
}

function executionWalletCacheKey(address: string): string {
  return `${EXECUTION_WALLET_CACHE_PREFIX}:${address.toLowerCase()}`;
}

function loadCachedExecutionWalletAddress(address: string): `0x${string}` | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(executionWalletCacheKey(address));
    if (!raw) {
      return null;
    }
    return getAddress(raw) as `0x${string}`;
  } catch {
    return null;
  }
}

function persistExecutionWalletAddress(
  address: string,
  executionWalletAddress: `0x${string}`,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(executionWalletCacheKey(address), executionWalletAddress);
  } catch {
    /* Ignore storage failures. */
  }
}

function QuickAgentPromptStrip({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (prompt: QuickAgentPrompt) => void;
}) {
  const [activeGroup, setActiveGroup] = useState<StarterGroup | null>(null);
  const groupPrompts = activeGroup
    ? quickAgentPrompts.filter((item) => item.group === activeGroup)
    : [];

  return (
    <div className="mx-auto mt-[22px] flex max-w-[1064px] flex-col items-center gap-4">
      {/* Category tabs */}
      <div className="flex flex-wrap justify-center gap-2" role="tablist" aria-label="Prompt categories">
        {starterGroups.map((group) => {
          const active = group === activeGroup;
          return (
            <button
              key={group}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveGroup((current) => (current === group ? null : group))}
              className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] transition ${
                active
                  ? "border border-[#f2ca50]/50 bg-[#211f16] text-[#f2ca50]"
                  : "border border-white/10 bg-transparent text-white/40 hover:text-white/75"
              }`}
            >
              {group}
            </button>
          );
        })}
      </div>

      {/* Bubble cloud for the active category */}
      {activeGroup ? (
        <div className="relative w-full px-2">
          <div
            key={activeGroup}
            className="animate-[starterBubbleCloud_320ms_cubic-bezier(0.2,0.9,0.2,1)_both] px-3 py-2"
            aria-label="AgentFlow prompt starters"
          >
            <div className="flex flex-wrap justify-center gap-3">
              {groupPrompts.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(item)}
                  title={item.prompt}
                  style={{ animationDelay: `${index * 42}ms` }}
                  className="min-h-[52px] rounded-full border border-white/10 bg-[#202020]/90 px-6 text-[11px] font-black uppercase tracking-[0.2em] text-white/45 opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_30px_rgba(0,0,0,0.28)] transition hover:-translate-y-[1px] hover:border-[#f2ca50]/45 hover:bg-[#211f16] hover:text-[#f2ca50] disabled:cursor-not-allowed disabled:opacity-50 [animation:starterChipPop_440ms_cubic-bezier(0.18,0.88,0.22,1.28)_forwards]"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
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

// Display-only grouping for the starter strip (decoupled from PromptTab routing).
// Newbies land on "Start here" (free info), then explore a service group where
// "learn" prompts sit next to a "try" action — information first, then action.
const starterGroups = [
  "Start here",
  "Payments",
  "DeFi & Trading",
  "Bridge & Funds",
  "Research & AI",
  "Agents & trust",
] as const;
type StarterGroup = (typeof starterGroups)[number];

type QuickAgentPrompt = {
  label: string;
  /** Routing fallback. Info prompts use "AgentPay" which inferPromptIntent maps
   * to free Conversation (product knowledge); action prompts use their service. */
  tab: PromptTab;
  group: StarterGroup;
  prompt: string;
  routeIntent?: ChatIntent;
  actionId?: string;
};

const quickAgentPrompts: QuickAgentPrompt[] = [
  // --- Start here: free discovery, no wallet/funds needed ---
  { label: "What can you do?", tab: "AgentPay", group: "Start here", prompt: "What can AgentFlow do for me?", routeIntent: "Conversation" },
  { label: "Get started", tab: "AgentPay", group: "Start here", prompt: "How do I get started with AgentFlow?", routeIntent: "Conversation" },
  { label: "Add funds", tab: "AgentPay", group: "Start here", prompt: "Explain how funding and Gateway work", routeIntent: "Conversation" },
  { label: "What it costs", tab: "AgentPay", group: "Start here", prompt: "What does AgentFlow cost per task?", routeIntent: "Conversation" },
  { label: "Use my language", tab: "AgentPay", group: "Start here", prompt: "Explain what languages AgentFlow supports", routeIntent: "Conversation" },

  // --- Payments: full AgentPay surface ---
  { label: "About AgentPay", tab: "AgentPay", group: "Payments", prompt: "Explain AgentPay and its features", routeIntent: "Conversation" },
  { label: "Send USDC", tab: "AgentPay", group: "Payments", prompt: "Explain how sending USDC works on AgentFlow", routeIntent: "Conversation" },
  { label: "Request & links", tab: "AgentPay", group: "Payments", prompt: "Explain payment requests, links and QR codes on AgentFlow", routeIntent: "Conversation" },
  { label: "Invoices", tab: "AgentPay", group: "Payments", prompt: "Explain how invoices work on AgentFlow", routeIntent: "Conversation" },
  { label: "Split a bill", tab: "AgentPay", group: "Payments", prompt: "Explain how split payments work on AgentFlow", routeIntent: "Conversation" },
  { label: "Batch / payroll", tab: "AgentPay", group: "Payments", prompt: "Explain how batch payments and payroll work", routeIntent: "Conversation" },
  { label: "Scheduled pay", tab: "AgentPay", group: "Payments", prompt: "Explain how scheduled and recurring payments work", routeIntent: "Conversation" },
  { label: "Contacts & .arc", tab: "AgentPay", group: "Payments", prompt: "Explain how contacts and .arc handles work", routeIntent: "Conversation" },

  // --- DeFi & Trading: learn, then try ---
  { label: "How swaps work", tab: "AgentPay", group: "DeFi & Trading", prompt: "Explain how token swaps work on AgentFlow", routeIntent: "Conversation" },
  { label: "Try a swap", tab: "Swap", group: "DeFi & Trading", prompt: "Swap 1 USDC to EURC.", routeIntent: "Swap" },
  { label: "Vaults & yield", tab: "AgentPay", group: "DeFi & Trading", prompt: "Explain how vaults and yield work on AgentFlow", routeIntent: "Conversation" },
  { label: "Show vaults", tab: "Vault", group: "DeFi & Trading", prompt: "Show available vaults.", routeIntent: "Vault" },
  { label: "Prediction markets", tab: "AgentPay", group: "DeFi & Trading", prompt: "Explain how prediction markets work on AgentFlow", routeIntent: "Conversation" },
  { label: "Show markets", tab: "AgentPay", group: "DeFi & Trading", prompt: "Show prediction markets.", routeIntent: "Conversation" },

  // --- Bridge & Funds ---
  { label: "How to bridge", tab: "Bridge", group: "Bridge & Funds", prompt: "Explain how bridging USDC to Arc works", routeIntent: "Bridge" },
  { label: "Supported chains", tab: "Bridge", group: "Bridge & Funds", prompt: "Which chains can I bridge from?", routeIntent: "Bridge" },
  { label: "My portfolio", tab: "Portfolio", group: "Bridge & Funds", prompt: "Show my portfolio.", routeIntent: "Portfolio" },

  // --- Research & AI ---
  { label: "About Research", tab: "AgentPay", group: "Research & AI", prompt: "What can the Research agent do?", routeIntent: "Conversation" },
  { label: "Image analysis", tab: "AgentPay", group: "Research & AI", prompt: "What can you do with an image I upload?", routeIntent: "Conversation" },
  { label: "Voice to text", tab: "AgentPay", group: "Research & AI", prompt: "Explain how voice to text works on AgentFlow", routeIntent: "Conversation" },
  { label: "Remembers me", tab: "AgentPay", group: "Research & AI", prompt: "Explain how AgentFlow remembers my preferences and past chats", routeIntent: "Conversation" },
  { label: "On Telegram", tab: "AgentPay", group: "Research & AI", prompt: "Explain how to use AgentFlow on Telegram", routeIntent: "Conversation" },

  // --- Agents & trust ---
  { label: "Agent Store", tab: "AgentPay", group: "Agents & trust", prompt: "What is the Agent Store?", routeIntent: "Conversation" },
  { label: "Reputation & ratings", tab: "AgentPay", group: "Agents & trust", prompt: "Explain how agent reputation and ratings work", routeIntent: "Conversation" },
  { label: "The AI runtime", tab: "AgentPay", group: "Agents & trust", prompt: "What AI powers AgentFlow?", routeIntent: "Conversation" },
];

type ExecutionTarget = "EOA" | "DCW";
type VaultAction =
  | "deposit"
  | "withdraw"
  | "check_apy"
  | "compound";
type VaultSemanticAction = VaultAction | "list" | "position";
type ChatIntent = PromptTab | "Conversation" | "Vision";

type PendingBridgeDraft = {
  assistantId: string;
  sourceChain: BridgeSource;
  amount: number;
  payerAddress: `0x${string}`;
  userDcwAddress: `0x${string}`;
  authHeaders: Record<string, string>;
};

type PendingBridgeSelection = {
  assistantId: string;
  sourceChain: BridgeSource;
  payerAddress: `0x${string}`;
  authHeaders: Record<string, string>;
};

type PendingSwapSelection = {
  assistantId: string;
  tokenInSymbol: "USDC" | "EURC";
  tokenOutSymbol: "USDC" | "EURC";
  payerAddress: `0x${string}`;
  authHeaders: Record<string, string>;
};

type PendingSwapDraft = {
  assistantId: string;
  payerAddress: `0x${string}`;
  authHeaders: Record<string, string>;
  amount: number;
  tokenPair: { tokenIn: `0x${string}`; tokenOut: `0x${string}` };
  tokenInSymbol: "USDC" | "EURC";
  tokenOutSymbol: "USDC" | "EURC";
  requestedSlippage: number;
  provider: string;
  routeData: unknown;
  expectedOutRaw: string;
  quoteOutRaw: string;
  optimalSlippage?: number;
};

type PendingVaultSelection = {
  assistantId: string;
  action: "deposit" | "withdraw";
  vaultSymbol: "luneUSDC" | "luneEURC";
  amount?: number | null;
  payerAddress: `0x${string}`;
  authHeaders: Record<string, string>;
};

type PendingVaultDraft = {
  assistantId: string;
  action: "deposit" | "withdraw";
  vaultSymbol: "luneUSDC" | "luneEURC";
  vaultAddress: `0x${string}`;
  amount: number;
  payerAddress: `0x${string}`;
  authHeaders: Record<string, string>;
};

type BridgeSourceHolding = {
  sourceChain: BridgeSource;
  label: string;
  usdcBalanceRaw: bigint;
  nativeBalanceRaw: bigint;
};

function formatBridgeSourceUsdcBalance(value: bigint): string {
  const numeric = Number(formatUnits(value, 6));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0 USDC";
  }
  if (numeric >= 100) {
    return `${numeric.toFixed(0)} USDC`;
  }
  if (numeric >= 10) {
    return `${numeric.toFixed(2).replace(/\.?0+$/, "")} USDC`;
  }
  return `${numeric.toFixed(3).replace(/\.?0+$/, "")} USDC`;
}

const VAULT_ADDRESS_BY_SYMBOL: Record<"luneUSDC" | "luneEURC", `0x${string}`> = {
  luneUSDC: "0x66CF9CA9D75FD62438C6E254bA35E61775EF9496",
  luneEURC: "0xcF2C839B12ECf6D9eEcd4607521B73fcFb7E8713",
};

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
type TranscribeAgentResponseWithPayment = TranscribeAgentResponse & Partial<AgentRunPaymentResult>;

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
    .replace(/\bbalence(s)?\b/g, "balance$1")
    .replace(/\bbri+dge+\b/g, "bridge")
    .replace(/\bbridg\b/g, "bridge")
    .replace(/\bbroidge\b/g, "bridge")
    .replace(/\bbrdige\b/g, "bridge");
}

type SwapAgentResponse = {
  success: boolean;
  action?: "preview";
  provider?: string;
  expectedOutRaw?: string;
  expectedOutFormatted?: string;
  route?: Array<{
    isV3: boolean;
    path: `0x${string}`[];
    fees: number[];
    bps: number;
  }>;
  payload?: {
    provider: string;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    amount: number;
    requestedSlippage: number;
    optimalSlippage?: number;
    quoteAmountOutRaw: string;
    routeData: unknown;
  };
  executionMode?: "DCW";
  txHash?: string;
  approvalTxHash?: string | null;
  error?: string;
  receipt?: {
    explorerLink?: string;
    approvalExplorerLink?: string | null;
    amountIn?: number;
    executionTarget?: "DCW";
    optimalSlippage?: number;
    tokenPair?: { tokenIn: `0x${string}`; tokenOut: `0x${string}` };
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
  quoteOutRaw?: string | null;
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

function isSoftPendingAcknowledgement(message: string): boolean {
  return /^(?:ok|okay|sure|got it|understood|alright|fine|cool|yep|yeah|yes please|go ahead|do it|continue)$/i.test(
    message.trim(),
  );
}

function buildSwapPreviewContent(input: {
  amount: number;
  tokenInSymbol: "USDC" | "EURC";
  tokenOutSymbol: "USDC" | "EURC";
  expectedOutFormatted?: string;
  optimalSlippage?: number;
  provider?: string;
}): string {
  const amountLine = `**Swap:** ${input.amount} ${input.tokenInSymbol} -> ${
    input.expectedOutFormatted ? `~${input.expectedOutFormatted} ${input.tokenOutSymbol}` : input.tokenOutSymbol
  }`;
  const providerLine = input.provider ? `Provider: ${input.provider}` : null;
  const slippageLine =
    typeof input.optimalSlippage === "number"
      ? `Slippage guard: ${input.optimalSlippage}%`
      : null;

  return [
    amountLine,
    providerLine,
    slippageLine,
    "",
    "Reply YES to execute or NO to cancel.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeQuickActionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'.,!?():[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeQuickActionMessage(value: string): {
  displayText: string;
  prompt: string | null;
  actionId: string | null;
  routeIntent: ChatIntent | null;
} {
  const match = value.match(/^\[\[AF_ACTION:([^\]]+)]]([\s\S]*)$/);
  if (!match) {
    return { displayText: value, prompt: null, actionId: null, routeIntent: null };
  }

  let prompt: string | null = null;
  let actionId: string | null = null;
  let routeIntent: ChatIntent | null = null;
  try {
    const decoded = decodeURIComponent(match[1]);
    try {
      const payload = JSON.parse(decoded) as {
        prompt?: unknown;
        actionId?: unknown;
        routeIntent?: unknown;
      };
      prompt = typeof payload.prompt === "string" ? payload.prompt : null;
      actionId = typeof payload.actionId === "string" ? payload.actionId : null;
      routeIntent =
        payload.routeIntent === "Research" ||
        payload.routeIntent === "AgentPay" ||
        payload.routeIntent === "Swap" ||
        payload.routeIntent === "Vault" ||
        payload.routeIntent === "Bridge" ||
        payload.routeIntent === "Portfolio" ||
        payload.routeIntent === "Conversation" ||
        payload.routeIntent === "Vision"
          ? payload.routeIntent
          : null;
    } catch {
      // Keep older quick-action envelopes working during rolling frontend updates.
      prompt = decoded;
    }
  } catch {
    prompt = null;
  }

  return {
    displayText: match[2] || "",
    prompt,
    actionId,
    routeIntent,
  };
}

function tabForIntent(intent: ChatIntent | PromptTab): PromptTab {
  switch (intent) {
    case "Swap":
      return "Swap";
    case "Vault":
      return "Vault";
    case "Bridge":
      return "Bridge";
    case "Portfolio":
      return "Portfolio";
    case "Research":
      return "Research";
    case "AgentPay":
    case "Conversation":
    case "Vision":
    default:
      return "AgentPay";
  }
}

function resolveQuickActionIntentOverride(input: {
  routeIntent?: ChatIntent | null;
  actionId?: string | null;
}): ChatIntent | null {
  if (input.routeIntent) {
    return input.routeIntent;
  }
  if (input.actionId === "bridge.funded_chains") {
    return "Bridge";
  }
  return null;
}

function flattenQuickActions(
  groups: LiveChatMessage["quickActionGroups"] | undefined,
): Array<{ label: string; prompt: string }> {
  if (!groups?.length) {
    return [];
  }
  return groups.flatMap((group) =>
    group.actions.map((action) => ({
      label: action.label,
      prompt: action.prompt,
    })),
  );
}

function findLatestAssistantQuickActions(
  messages: LiveChatMessage[],
): Array<{ label: string; prompt: string }> {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }
    const actions = flattenQuickActions(message.quickActionGroups);
    if (actions.length) {
      return actions;
    }
  }
  return [];
}

function resolveQuickActionPromptFromReply(
  reply: string,
  messages: LiveChatMessage[],
): string | null {
  const normalizedReply = normalizeQuickActionText(reply);
  if (!normalizedReply) {
    return null;
  }

  const actions = findLatestAssistantQuickActions(messages);
  if (!actions.length) {
    return null;
  }

  const exact = actions.find(
    (action) =>
      normalizeQuickActionText(action.label) === normalizedReply ||
      normalizeQuickActionText(action.prompt) === normalizedReply,
  );
  if (exact) {
    return exact.prompt;
  }

  const ordinalMatchers: Array<{ matcher: RegExp; index: number }> = [
    { matcher: /^(?:the\s+)?(?:first|1st|one)\s+one$|^(?:first|1st)$/i, index: 0 },
    { matcher: /^(?:the\s+)?(?:second|2nd|two)\s+one$|^(?:second|2nd)$/i, index: 1 },
    { matcher: /^(?:the\s+)?(?:third|3rd|three)\s+one$|^(?:third|3rd)$/i, index: 2 },
    { matcher: /^(?:the\s+)?(?:fourth|4th|four)\s+one$|^(?:fourth|4th)$/i, index: 3 },
  ];

  for (const { matcher, index } of ordinalMatchers) {
    if (matcher.test(reply.trim()) && actions[index]) {
      return actions[index].prompt;
    }
  }

  if (/^(?:that|this)\s+one$/i.test(reply.trim()) && actions.length === 1) {
    return actions[0].prompt;
  }

  if (/^(?:the\s+)?other\s+one$/i.test(reply.trim()) && actions.length === 2) {
    return actions[1].prompt;
  }

  if (/^(?:the\s+)?last\s+one$|^last$/i.test(reply.trim())) {
    return actions[actions.length - 1]?.prompt ?? null;
  }

  return null;
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
  vaults?: Array<Record<string, unknown>>;
  txHash?: string;
  explorerLink?: string | null;
  approvalTxHash?: string | null;
  receipt?: {
    approvalExplorerLink?: string | null;
    explorerLink?: string | null;
  };
  provider?: string;
  vaultSymbol?: string;
  sharesReceivedFormatted?: string;
  sharesBurnedFormatted?: string;
  assetsReceivedFormatted?: string;
  usdcReceived?: string;
  executionMode?: "EOA" | "DCW";
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

  const vaultIntent = normalizeVaultIntent(prompt);
  if (
    vaultIntent.isVaultDomain &&
    !(
      portfolioAnalysisVerbPattern.test(normalized) &&
      portfolioAnalysisSubjectPattern.test(normalized) &&
      !/\bvault\b/.test(normalized)
    )
  ) {
    return "Vault";
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
    (hasBridgeIntentFraming(prompt) && Boolean(detectBridgeSource(prompt))) ||
    isBareBridgeSourceReply(prompt) ||
    /\b(sepolia|base sepolia|ethereum sepolia)\b/.test(normalized)
  ) {
    return "Bridge";
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
    return "AgentFlow does not manage liquidity pools, strategy positions, or third-party strategy agents. The live portfolio view is your Agent wallet, Gateway reserve, vault shares, and recent activity.";
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

function parseOptionalAmount(prompt: string): number | null {
  const match = prompt.match(/(?:[$]\s*)?(\d+(?:\.\d+)?)(?:\s*[$])?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseSlippage(prompt: string, fallback: number): number {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*%/);
  const parsed = match ? Number(match[1]) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function detectVaultAction(prompt: string): VaultAction {
  if (/compound/i.test(prompt)) return "compound";
  if (/\b(withdraw|redeem|unstake|take\s+out|pull\s+out|remove)\b/i.test(prompt)) return "withdraw";
  if (/\b(deposit|earn|supply|add|stake|park|allocate|fund)\b/i.test(prompt)) return "deposit";
  if (
    /\b(put|move|stash|place)\b/i.test(prompt) &&
    /\b(vault|yield|earn|passive income|idle funds?)\b/i.test(prompt)
  ) {
    return "deposit";
  }
  if (/apy|yield/i.test(prompt) && !/deposit|withdraw|compound/i.test(prompt)) {
    return "check_apy";
  }
  return "check_apy";
}

function isBareBridgeSourceReply(prompt: string): boolean {
  return /^(?:eth(?:ereum)?(?:[\s-]+sep(?:olia)?)|base(?:[\s-]+sep(?:olia)?)|arb(?:itrum)?(?:[\s-]+sep(?:olia)?)|op(?:timism)?(?:[\s-]+sep(?:olia)?)|avalanche(?:[\s-]+fuji)?|fuji|polygon(?:[\s-]+amoy)?|amoy|linea(?:[\s-]+sep(?:olia)?)|unichain(?:[\s-]+sep(?:olia)?)|codex(?:[\s-]+testnet)?|sonic(?:[\s-]+testnet)?|monad(?:[\s-]+testnet)?|ink(?:[\s-]+testnet|[\s-]+sep(?:olia)?)|sei(?:[\s-]+testnet)?|morph(?:[\s-]+testnet)?|pharos(?:[\s-]+atlantic|[\s-]+testnet)?|plume(?:[\s-]+testnet)?|injective(?:[\s-]+testnet)?|world(?:[\s-]+chain)?(?:[\s-]+sep(?:olia)?)|xdc(?:[\s-]+apothem)?|hyperevm(?:[\s-]+testnet)?)$/i.test(
    prompt.trim(),
  );
}

function hasBridgeIntentFraming(prompt: string): boolean {
  return /\b(bridge|bridging|source chain|from there to arc|to arc|move.*to arc|send.*to arc)\b/i.test(
    prompt,
  );
}

function detectVaultSymbol(prompt: string): "luneUSDC" | "luneEURC" | null {
  if (/\blune\s*eurc\b|\bluneeurc\b|\beurc vault\b/i.test(prompt)) {
    return "luneEURC";
  }
  if (/\blune\s*usdc\b|\bluneusdc\b|\busdc vault\b/i.test(prompt)) {
    return "luneUSDC";
  }
  return null;
}

function inferVaultSymbolFromAssetHint(prompt: string): "luneUSDC" | "luneEURC" | null {
  if (/\beurc\b/i.test(prompt)) {
    return "luneEURC";
  }
  if (/\busdc\b/i.test(prompt)) {
    return "luneUSDC";
  }
  return null;
}

function vaultAssetSymbol(vaultSymbol: "luneUSDC" | "luneEURC"): "USDC" | "EURC" {
  return vaultSymbol === "luneEURC" ? "EURC" : "USDC";
}

function vaultLabel(vaultSymbol: "luneUSDC" | "luneEURC"): string {
  return vaultSymbol === "luneEURC" ? "Lunex EURC Vault" : "Lunex USDC Vault";
}

function inferPendingVaultSelectionFromAssistantReply(input: {
  assistantId: string;
  content: string;
  payerAddress: `0x${string}` | null | undefined;
  authHeaders: Record<string, string> | null | undefined;
}): PendingVaultSelection | null {
  const { assistantId, content, payerAddress, authHeaders } = input;
  if (!payerAddress || !authHeaders) {
    return null;
  }

  const vaultSymbol = detectVaultSymbol(content);
  if (!vaultSymbol) {
    return null;
  }

  let action: "deposit" | "withdraw" | null = null;
  if (/\bhow much\b[\s\S]*\bdeposit\b/i.test(content)) {
    action = "deposit";
  } else if (/\bhow much\b[\s\S]*\bwithdraw\b/i.test(content)) {
    action = "withdraw";
  }

  if (!action) {
    return null;
  }

  return {
    assistantId,
    action,
    vaultSymbol,
    amount: null,
    payerAddress,
    authHeaders,
  };
}

function inferPendingSwapSelectionFromAssistantReply(input: {
  assistantId: string;
  content: string;
  payerAddress: `0x${string}` | null | undefined;
  authHeaders: Record<string, string> | null | undefined;
}): PendingSwapSelection | null {
  const { assistantId, content, payerAddress, authHeaders } = input;
  if (!payerAddress || !authHeaders) {
    return null;
  }

  const match = content.match(/\bhow much\s+(USDC|EURC)\s+do you want to swap into\s+(USDC|EURC)\b/i);
  if (!match) {
    return null;
  }

  const tokenInSymbol = match[1].toUpperCase() as "USDC" | "EURC";
  const tokenOutSymbol = match[2].toUpperCase() as "USDC" | "EURC";
  if (tokenInSymbol === tokenOutSymbol) {
    return null;
  }

  return {
    assistantId,
    tokenInSymbol,
    tokenOutSymbol,
    payerAddress,
    authHeaders,
  };
}

function normalizeVaultIntent(prompt: string): {
  isVaultDomain: boolean;
  action: VaultSemanticAction;
  vaultSymbol: "luneUSDC" | "luneEURC" | null;
  amount: number | null;
} {
  const normalized = normalizePromptForIntent(prompt);
  const explicitVaultSymbol = detectVaultSymbol(prompt);
  const amount = parseOptionalAmount(prompt);
  const asksPositions =
    /\b(my vault positions?|my positions?|show positions?|what(?:'s| is) in my vault|vault holdings?)\b/i.test(
      normalized,
    );

  if (asksPositions) {
    return { isVaultDomain: true, action: "position", vaultSymbol: explicitVaultSymbol, amount };
  }

  const asksApy =
    /\b(apy|apr|rate|return|yield)\b/i.test(normalized) &&
    !/\b(deposit|withdraw|stake|unstake|move|put|park)\b/i.test(normalized);
  const signalsVaultMeaning =
    explicitVaultSymbol != null ||
    explicitVaultActionPattern.test(normalized) ||
    /\bvault\b/i.test(normalized) ||
    /\b(passive income|idle funds?|earn options?|yield options?|safer yield|yield opportunity|yield opportunities)\b/i.test(
      normalized,
    ) ||
    (/\b(park|grow|earn|yield|put|move|stash|allocate)\b/i.test(normalized) &&
      /\b(usdc|eurc|funds?|cash|stablecoins?|money)\b/i.test(normalized)) ||
    /\b(where|how|what|which)\b[\s\S]*\b(earn|yield|passive income)\b/i.test(normalized);

  if (!signalsVaultMeaning) {
    return { isVaultDomain: false, action: "check_apy", vaultSymbol: explicitVaultSymbol, amount };
  }

  if (
    /\b(show|list|browse|compare|explore|which|what)\b/i.test(normalized) &&
    /\b(vaults?|yield|earn|passive income)\b/i.test(normalized) &&
    !/\b(deposit|withdraw|stake|unstake|redeem)\b/i.test(normalized)
  ) {
    return { isVaultDomain: true, action: "list", vaultSymbol: explicitVaultSymbol, amount };
  }

  if (
    /\b(where can i|how can i|what should i use|best place|best option|safer option)\b/i.test(normalized) &&
    /\b(usdc|eurc|funds?|cash|stablecoins?|money|idle funds?)\b/i.test(normalized)
  ) {
    return { isVaultDomain: true, action: "list", vaultSymbol: explicitVaultSymbol, amount };
  }

  const detectedAction = asksApy ? "check_apy" : detectVaultAction(prompt);
  const inferredVaultSymbol =
    explicitVaultSymbol ??
    ((detectedAction === "deposit" || detectedAction === "withdraw")
      ? inferVaultSymbolFromAssetHint(prompt)
      : null);

  return {
    isVaultDomain: true,
    action: detectedAction,
    vaultSymbol: inferredVaultSymbol,
    amount,
  };
}

function isBridgeInfoPrompt(prompt: string): boolean {
  return /\b(how|what|which|supported|support|explain|works?|flow|chains?)\b/i.test(prompt);
}

function isBridgeSourceDiscoveryPrompt(prompt: string): boolean {
  return (
    /\bbridge\b/i.test(prompt) &&
    /\b(?:which|what|where|from\s+which|source|balance|balances|have\s+balance|has\s+balance|funded|funds|usdc|gas)\b/i.test(
      prompt,
    )
  );
}

function isBridgeFundedChainsQuickAction(input: {
  prompt?: string | null;
  actionId?: string | null;
}): boolean {
  if (input.actionId === "bridge.funded_chains") {
    return true;
  }
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) {
    return false;
  }
  return (
    /\bshow my funded chains\b/i.test(prompt) ||
    /\bwhich bridge source chains have usdc and gas\b/i.test(prompt) ||
    /\bsupported source chains where this wallet already has usdc and gas\b/i.test(prompt)
  );
}

function formatBridgeAmountPrompt(amount: number | null, label: string): string {
  return amount
    ? `Bridge ${amount} USDC from ${label} to Arc.`
    : `Bridge from ${label} to Arc.`;
}

function findPendingBridgeAmountSource(messages: LiveChatMessage[]): BridgeSource | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.content) {
      continue;
    }
    if (
      /\bhow much\s+usdc\b[\s\S]*\bbridge\b/i.test(message.content) ||
      /\bsource chain locked\b[\s\S]*\btell me how much\b/i.test(message.content) ||
      /\bhow much\s+usdc\s+from\b[\s\S]*\b(?:pick an amount|say\s+"?all"?|say\s+'?all'?)\b/i.test(
        message.content,
      )
    ) {
      const source = detectBridgeSource(message.content);
      if (source) {
        return source;
      }
    }
  }
  return null;
}

function formatBridgeBalanceShort(raw: bigint, decimals: number): string {
  const formatted = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(formatted)) {
    return "0";
  }
  if (formatted === 0) {
    return "0";
  }
  if (formatted < 0.01) {
    return "<0.01";
  }
  return formatted.toFixed(formatted >= 100 ? 0 : formatted >= 10 ? 2 : 3).replace(/\.?0+$/, "");
}

function bridgeTxExplorerUrl(sourceChain: BridgeSource, txHash: string): string {
  return `${BRIDGE_SOURCE_CONFIG[sourceChain].explorerTxBase}${txHash}`;
}

function arcTxExplorerUrl(txHash: string): string {
  return `https://testnet.arcscan.app/tx/${txHash}`;
}

function buildBridgeReceiptContent(input: {
  amount: number;
  sourceChain: BridgeSource;
  sourceLabel: string;
  userDcwAddress: `0x${string}`;
  approvalTxHash?: string | null;
  burnTxHash: string;
  mintTxHash?: string | null;
  paymentRequestId?: string | null;
}): string {
  const lines = [
    `- **Amount:** ${input.amount} USDC`,
    `- **Route:** ${input.sourceLabel} -> Arc`,
    `- **Source signer:** Connected EOA on ${input.sourceLabel}`,
    `- **AgentFlow wallet:** **${input.userDcwAddress}**`,
  ];

  if (input.approvalTxHash) {
    lines.push(
      "",
      "### Source approval",
      `- **Explorer:** [View on ${input.sourceLabel}](${bridgeTxExplorerUrl(input.sourceChain, input.approvalTxHash)})`,
    );
  }

  lines.push(
    "",
    "### Source burn",
    `- **Explorer:** [View on ${input.sourceLabel}](${bridgeTxExplorerUrl(input.sourceChain, input.burnTxHash)})`,
  );

  if (input.mintTxHash) {
    lines.push(
      "",
      "### Arc mint",
      `- **Explorer:** [View on Arcscan](${arcTxExplorerUrl(input.mintTxHash)})`,
    );
  } else {
    lines.push(
      "",
      "### Arc mint",
      "- Mint completed through Circle forwarder.",
    );
  }

  return lines.join("\n");
}

function buildVaultListContent(vaults: Array<Record<string, unknown>>): string {
  if (!vaults.length) {
    return "No vault options are available right now.";
  }

  const lines = ["## Yield vaults on Arc Testnet", ""];
  for (const vault of vaults) {
    const apy =
      typeof (vault as { apy?: { apy?: number } }).apy?.apy === "number" &&
      Number.isFinite((vault as { apy?: { apy?: number } }).apy?.apy)
        ? `${((vault as { apy?: { apy?: number } }).apy?.apy as number).toFixed(1)}%`
        : "5.3%";
    const method = String((vault as { apy?: { method?: string } }).apy?.method || "");
    lines.push(`### ${String(vault.label || "Vault")}`);
    lines.push(`- **APY:** ${apy}${method === "mock_fallback" ? " (preview)" : ""}`);
    lines.push(`- **Provider:** ${String(vault.provider || "unknown")}`);
    lines.push(
      `- **Network:** ${String(vault.network || "testnet")}${vault.experimental ? " (experimental)" : ""}`,
    );
    const notes = Array.isArray(vault.notes) ? vault.notes : [];
    if (notes.length) {
      lines.push(`- **Notes:** ${String(notes[0])}`);
    }
    lines.push("");
  }
  lines.push("Choose a vault below or tell me how much you want to deposit.");
  return lines.join("\n");
}

function buildVaultExecutionContent(input: {
  action: "deposit" | "withdraw";
  txHash: string;
  explorerLink?: string | null;
  approvalTxHash?: string | null;
  approvalExplorerLink?: string | null;
  provider?: string | null;
  vaultSymbol?: string | null;
  sharesReceivedFormatted?: string | null;
  sharesBurnedFormatted?: string | null;
  assetsReceivedFormatted?: string | null;
}): string {
  if (input.action === "deposit") {
    return [
      "Vault deposit complete on Arc.",
      input.vaultSymbol ? `Vault: ${input.vaultSymbol}` : null,
      input.approvalTxHash ? "Approval tx:" : null,
      input.approvalTxHash ?? null,
      input.approvalTxHash && input.approvalExplorerLink
        ? `Approval explorer: ${input.approvalExplorerLink}`
        : null,
      "Deposit tx:",
      input.txHash,
      input.explorerLink ? `Explorer: ${input.explorerLink}` : null,
      input.sharesReceivedFormatted && input.vaultSymbol
        ? `Shares received: ${input.sharesReceivedFormatted} ${input.vaultSymbol}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "Vault withdraw complete on Arc.",
    input.vaultSymbol ? `Vault: ${input.vaultSymbol}` : null,
    "Withdraw tx:",
    input.txHash,
    input.explorerLink ? `Explorer: ${input.explorerLink}` : null,
    input.sharesBurnedFormatted && input.vaultSymbol
      ? `Shares burned: ${input.sharesBurnedFormatted} ${input.vaultSymbol}`
      : null,
    input.assetsReceivedFormatted
      ? `Assets received: ${input.assetsReceivedFormatted}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSwapExecutionContent(input: {
  amountIn: number;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  quoteOutRaw?: string | null;
  txHash: string;
  explorerLink?: string | null;
  approvalTxHash?: string | null;
  approvalExplorerLink?: string | null;
  executionTarget?: string | null;
  provider?: string | null;
}): string {
  const txOwnerLabel = input.executionTarget ? `${input.executionTarget} Tx:` : "Tx:";
  const lines = [
    formatSwapAmountLine({
      amountIn: input.amountIn,
      quoteOutRaw: input.quoteOutRaw,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
    }),
    "Swap complete on Arc.",
    input.approvalTxHash ? "Approval tx:" : null,
    input.approvalTxHash ?? null,
    input.executionTarget ? `Executed from: ${txOwnerLabel}` : txOwnerLabel,
    input.txHash,
    input.explorerLink ? `Explorer: ${input.explorerLink}` : null,
  ];
  return lines.filter(Boolean).join("\n\n");
}

type BridgeKitStepLike = {
  name?: string;
  state?: string;
  txHash?: string;
  explorerUrl?: string;
  forwarded?: boolean;
};

function findBridgeStepTx(
  steps: BridgeKitStepLike[] | undefined,
  matcher: RegExp,
): string | null {
  if (!steps) {
    return null;
  }
  for (const step of steps) {
    if (typeof step.name === "string" && matcher.test(step.name) && typeof step.txHash === "string") {
      return step.txHash;
    }
  }
  return null;
}

/**
 * Arc testnet: both directions use the same pool path; the swap agent accepts any { tokenIn, tokenOut }.
 */
function resolveSwapTokenPair(prompt: string): {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
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
  if (/aborterror|operation was aborted|the operation was aborted/i.test(message)) {
    return "The wallet handoff was interrupted before AgentFlow could finish this step. Try the bridge again and keep the wallet prompt open until it completes.";
  }
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

  return message.length > 1200 ? `${message.slice(0, 1197).trimEnd()}...` : message;
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

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^["']|["']$/g, "").trim());
}

function buildSplitPromptFromCsv(name: string, csvText: string): string | null {
  const lowerName = name.toLowerCase();
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines[0]?.toLowerCase() ?? "";
  const isSplit = lowerName.includes("split") || firstLine.split(/\t|,/).some((cell) => cell.trim() === "split");
  if (!isSplit) return null;

  const headerIndex = lines.findIndex((line) => {
    const normalized = splitCsvLine(line).map((cell) => cell.toLowerCase().replace(/[_-]+/g, " "));
    return normalized.some((cell) => ["recipient", "address", "wallet", "to"].includes(cell));
  });
  if (headerIndex < 0) return null;

  const headers = splitCsvLine(lines[headerIndex]).map((cell) => cell.toLowerCase().replace(/[_-]+/g, " "));
  const recipientIndex = headers.findIndex((cell) => ["recipient", "address", "wallet", "to"].includes(cell));
  const noteIndex = headers.findIndex((cell) => ["note", "remark", "memo", "description"].includes(cell));
  if (recipientIndex < 0) return null;

  const rows = lines.slice(headerIndex + 1).map(splitCsvLine).filter((cells) => cells.length > recipientIndex);
  const recipients = rows.map((cells) => cells[recipientIndex]).filter(Boolean);
  if (recipients.length < 2) return null;

  const firstCells = splitCsvLine(lines[0] ?? "");
  const titleAmount = Number((lines[0]?.match(/(\d+(?:\.\d+)?)\s*(?:usdc|usd)?/i)?.[1] ?? "").trim());
  const total = titleAmount;
  if (!Number.isFinite(total) || total <= 0) return null;

  const notes = noteIndex >= 0 ? rows.map((cells) => cells[noteIndex]?.trim() ?? "").filter(Boolean) : [];
  const uniqueNotes = Array.from(new Set(notes));
  const titleRemark =
    firstCells[0]?.toLowerCase() === "split" && firstCells.length >= 3
      ? firstCells
          .slice(2)
          .join(" ")
          .replace(/\b(?:usdc|usd|total|amount|remark|note)\b/gi, "")
          .trim()
      : (lines[0]?.match(/\b(?:for|remark|note)\s+(.+)$/i)?.[1] ?? "").trim();
  const remark = uniqueNotes.length === 1 ? uniqueNotes[0] : titleRemark;
  return `split ${total} USDC between ${recipients.join(", ")}${remark ? ` for ${remark}` : ""}`;
}

function buildSchedulePromptFromCsv(name: string, csvText: string): string | null {
  const lowerName = name.toLowerCase();
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const firstCells = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase().replace(/[_-]+/g, " "));
  const looksLikeSchedule =
    /\bscheduled?[_-]?payment\b|\bschedule\b/.test(lowerName) ||
    firstCells.includes("schedule") ||
    firstCells.includes("schedule name") ||
    firstCells.includes("frequency") ||
    firstCells.includes("cadence");
  if (!looksLikeSchedule) return null;

  const headerIndex = lines.findIndex((line) => {
    const normalized = splitCsvLine(line).map((cell) => cell.toLowerCase().replace(/[_-]+/g, " "));
    return (
      normalized.some((cell) => ["recipient", "address", "wallet", "to"].includes(cell)) &&
      normalized.some((cell) => cell === "amount" || cell.startsWith("amount "))
    );
  });
  if (headerIndex < 0) return null;

  const headers = splitCsvLine(lines[headerIndex]).map((cell) => cell.toLowerCase().replace(/[_-]+/g, " "));
  const recipientIndex = headers.findIndex((cell) => ["recipient", "address", "wallet", "to"].includes(cell));
  const amountIndex = headers.findIndex((cell) => cell === "amount" || cell.startsWith("amount "));
  const currencyIndex = headers.findIndex((cell) => ["currency", "token", "asset"].includes(cell));
  const frequencyIndex = headers.findIndex((cell) => ["frequency", "cadence", "schedule"].includes(cell));
  const dayIndex = headers.findIndex((cell) => ["day", "weekday", "day of week", "day of month"].includes(cell));
  const noteIndex = headers.findIndex((cell) => ["note", "remark", "memo", "description"].includes(cell));
  if (recipientIndex < 0 || amountIndex < 0 || frequencyIndex < 0) return null;

  const rows = lines.slice(headerIndex + 1).map(splitCsvLine).filter((cells) => cells.length > Math.max(recipientIndex, amountIndex, frequencyIndex));
  if (rows.length !== 1) return null;

  const row = rows[0];
  const recipient = row[recipientIndex]?.trim();
  const amount = Number((row[amountIndex] ?? "").replace(/[$,]/g, ""));
  const currency = (currencyIndex >= 0 ? row[currencyIndex] : "USDC")?.trim().toUpperCase() || "USDC";
  const frequency = (row[frequencyIndex] ?? "").trim().toLowerCase();
  const day = dayIndex >= 0 ? (row[dayIndex] ?? "").trim() : "";
  const remark = noteIndex >= 0 ? (row[noteIndex] ?? "").trim() : "";
  if (!recipient || !Number.isFinite(amount) || amount <= 0 || !frequency) return null;

  let cadence = frequency;
  if (/weekly|week/.test(frequency)) {
    cadence = day ? `every ${day.toLowerCase()}` : "weekly";
  } else if (/monthly|month/.test(frequency)) {
    cadence = day ? `every ${day.toLowerCase()}` : "monthly";
  } else if (/daily|day/.test(frequency)) {
    cadence = "daily";
  }

  return `schedule ${amount} ${currency} to ${recipient} ${cadence}${remark ? ` for ${remark}` : ""}`;
}

function buildInvoicePromptFromCsv(name: string, csvText: string): string | null {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;

  const marker = splitCsvLine(lines[0])[0]?.trim().toLowerCase();
  if (marker !== "invoice") return null;

  const headers = splitCsvLine(lines[1]).map((cell) => cell.toLowerCase().replace(/[_-]+/g, " "));
  const recipientIndex = headers.findIndex((cell) => ["recipient", "address", "wallet", "to", "vendor", "vendor handle"].includes(cell));
  const amountIndex = headers.findIndex((cell) => cell === "amount" || cell.startsWith("amount "));
  const currencyIndex = headers.findIndex((cell) => ["currency", "token", "asset"].includes(cell));
  const descriptionIndex = headers.findIndex((cell) => ["description", "remark", "note", "memo", "for"].includes(cell));
  if (recipientIndex < 0 || amountIndex < 0) return null;

  const rows = lines.slice(2).map(splitCsvLine).filter((cells) => cells.length > Math.max(recipientIndex, amountIndex));
  if (rows.length !== 1) return null;

  const row = rows[0];
  const recipient = row[recipientIndex]?.trim();
  const amount = Number((row[amountIndex] ?? "").replace(/[$,]/g, ""));
  const currency = (currencyIndex >= 0 ? row[currencyIndex] : "USDC")?.trim().toUpperCase() || "USDC";
  const description = descriptionIndex >= 0 ? (row[descriptionIndex] ?? "").trim() : "";
  if (!recipient || !Number.isFinite(amount) || amount <= 0 || currency !== "USDC") return null;

  return `create invoice for ${recipient} ${amount} USDC${description ? ` for ${description}` : ""}`;
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
  const normalizeSourceUrl = (value: string): string => {
    try {
      const url = new URL(value);
      url.hash = "";
      const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${normalizedPath}${url.search}`.toLowerCase();
    } catch {
      return value.trim().replace(/\/+$/, "").toLowerCase();
    }
  };

  const deduped = new Map<string, ReportSource>();
  for (const source of sources) {
    const key = normalizeSourceUrl(source.url) || source.name.trim().toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, source);
    }
  }
  return Array.from(deduped.values());
}

function buildResearchSources(
  reportSources?: ReportSource[] | null,
  research?: ResearchPayload | null,
  liveData?: LiveDataPayload | null,
): ReportSource[] {
  const finalSources = Array.isArray(reportSources) ? reportSources : [];
  const rawSources = Array.isArray(research?.sources) ? research.sources : [];
  const liveSources = Array.isArray(liveData?.sources) ? liveData.sources : [];
  const dynamicSources = Array.isArray(liveData?.dynamic_sources?.articles)
    ? liveData.dynamic_sources.articles
    : [];
  const coingeckoAssets = Array.isArray(liveData?.coingecko?.assets)
    ? liveData.coingecko.assets
    : [];
  return uniqueSources(
    [
      ...finalSources
        .filter((source) => typeof source?.name === "string" && typeof source?.url === "string")
        .map((source) => ({
          name: source.name,
          url: source.url,
          usedFor: typeof source.usedFor === "string" ? source.usedFor : undefined,
        })),
      ...rawSources
        .filter((source) => typeof source?.name === "string" && typeof source?.url === "string")
        .map((source) => ({
          name: source.name as string,
          url: source.url as string,
          usedFor:
            typeof source.usedFor === "string"
              ? source.usedFor
              : typeof source.used_for === "string"
                ? source.used_for
                : undefined,
        })),
      ...liveSources
        .filter((source) => typeof source?.url === "string")
        .map((source) => ({
          name:
            typeof source?.title === "string"
              ? source.title
              : typeof source?.domain === "string"
                ? source.domain
                : "Retrieved source",
          url: source.url as string,
          usedFor:
            typeof source?.summary === "string"
              ? source.summary
              : undefined,
        })),
      ...dynamicSources
        .filter((source) => typeof source?.url === "string")
        .map((source) => ({
          name:
            typeof source?.publisher === "string" && source.publisher.trim().length > 0
              ? source.publisher
              : typeof source?.title === "string" && source.title.trim().length > 0
                ? source.title
                : "Retrieved source",
          url: source.url as string,
          usedFor:
            typeof source?.summary === "string"
              ? source.summary
              : undefined,
        })),
      ...coingeckoAssets
        .filter((asset) => typeof asset?.coinId === "string" && asset.coinId.trim().length > 0)
        .map((asset) => ({
          name: "CoinGecko",
          url: `https://www.coingecko.com/en/coins/${encodeURIComponent(asset.coinId as string)}`,
        })),
    ],
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
    sources: buildResearchSources(reportEvent.sources as ReportSource[] | null | undefined, reportEvent.research, liveData),
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
  signInError,
}: {
  isAuthenticated: boolean;
  onSignIn: () => void;
  signInLoading: boolean;
  signInError?: string | null;
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
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {!isAuthenticated ? (
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={signInLoading}
                  className="rounded-[10px] bg-[#f2ca50] px-5 py-2.5 text-sm font-semibold text-[#221900] shadow-[0_12px_34px_rgba(242,202,80,0.18)] transition hover:brightness-110 disabled:opacity-70"
                >
                  {signInLoading ? "Signing..." : "Sign session"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={openAccountModal}
                className="rounded-full border border-white/10 bg-[#131313] px-5 py-2.5 text-sm font-semibold text-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:bg-white/5 hover:text-white/90"
              >
                {account.displayName}
              </button>
            </div>
            {!isAuthenticated && signInError ? (
              <div className="max-w-[320px] text-right text-xs text-rose-300">
                {signInError}
              </div>
            ) : null}
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
  const { address, isConnected, connector } = useAccount();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const {
    isAuthenticated,
    getAuthHeaders,
    signIn,
    loading: signInLoading,
    error: signInError,
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
  const [pendingBridgeDraft, setPendingBridgeDraft] = useState<PendingBridgeDraft | null>(null);
  const [pendingBridgeSelection, setPendingBridgeSelection] = useState<PendingBridgeSelection | null>(null);
  const [pendingSwapSelection, setPendingSwapSelection] = useState<PendingSwapSelection | null>(null);
  const [pendingSwapDraft, setPendingSwapDraft] = useState<PendingSwapDraft | null>(null);
  const [pendingVaultSelection, setPendingVaultSelection] = useState<PendingVaultSelection | null>(null);
  const [pendingVaultDraft, setPendingVaultDraft] = useState<PendingVaultDraft | null>(null);
  const [cachedExecutionWalletAddress, setCachedExecutionWalletAddress] = useState<
    `0x${string}` | null
  >(null);
  const [voicePaymentLabel, setVoicePaymentLabel] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [recentChats, setRecentChats] = useState<ChatHistoryItem[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPaymentPanelOpen, setIsPaymentPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const previousWalletRef = useRef<string | null | undefined>(undefined);
  const [queuedResearchJobId, setQueuedResearchJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setCachedExecutionWalletAddress(null);
      return;
    }

    const cached = loadCachedExecutionWalletAddress(address);
    if (cached) {
      setCachedExecutionWalletAddress(cached);
      return;
    }

    setCachedExecutionWalletAddress(null);
  }, [address]);

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
  const executionWarmKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const authHeaders = getAuthHeaders();
    if (!isAuthenticated || !authHeaders?.Authorization) {
      executionWarmKeyRef.current = null;
      return;
    }

    const warmKey = `${address?.toLowerCase() ?? "unknown"}::${authHeaders.Authorization}`;
    if (executionWarmKeyRef.current === warmKey) {
      return;
    }
    executionWarmKeyRef.current = warmKey;

    let cancelled = false;
    void fetchExecutionWalletSummary(authHeaders)
      .then((summary) => {
        if (cancelled || !summary.userAgentWalletAddress || !address) {
          return;
        }
        const executionWalletAddress = getAddress(
          summary.userAgentWalletAddress,
        ) as `0x${string}`;
        setCachedExecutionWalletAddress(executionWalletAddress);
        persistExecutionWalletAddress(address, executionWalletAddress);
      })
      .catch(() => {
        /* Ignore background cache warmup failures. */
      });

    return () => {
      cancelled = true;
    };
  }, [address, getAuthHeaders, isAuthenticated]);

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
          reportPayload?: Extract<PipelineEvent, { type: "report" }> | null;
          receipt?: Extract<PipelineEvent, { type: "receipt" }> | null;
          error?: string;
        };
        if (job.status === "done" && typeof job.result === "string" && job.result.trim()) {
          const reportText = job.result.trim();
          const reportPayload =
            job.reportPayload && job.reportPayload.type === "report"
              ? job.reportPayload
              : ({
                  type: "report",
                  markdown: reportText,
                } as Extract<PipelineEvent, { type: "report" }>);
          setQueuedResearchJobId(null);
          setMessages((previous) => [
            ...previous,
            {
              id: `assistant-research-done-${Date.now()}`,
              role: "assistant",
              title: "AgentFlow",
              content: reportText,
              reportMeta: buildResearchReportMeta(reportPayload),
              paymentMeta:
                job.receipt?.entries && job.receipt.entries.length > 0
                  ? { entries: job.receipt.entries }
                  : undefined,
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
    setPendingBridgeDraft(null);
    setPendingBridgeSelection(null);
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

  const handleAssistantFeedback = async (
    messageId: string,
    feedback: "positive" | "negative",
  ) => {
    const target = messages.find((message) => message.id === messageId);
    if (!target?.eventId) {
      return;
    }
    updateMessage(messageId, (message) => ({ ...message, feedback }));
    try {
      await fetch("/api/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          event_id: target.eventId,
          feedback,
        }),
      });
    } catch {
      updateMessage(messageId, (message) => ({ ...message, feedback: undefined }));
    }
  };

  const handleAgentRating = async (
    messageId: string,
    stars: number,
    ratingMeta: NonNullable<LiveChatMessage["ratingMeta"]>,
  ) => {
    const headers = getAuthHeaders();
    if (!headers?.Authorization) {
      return;
    }

    updateMessage(messageId, (message) => ({
      ...message,
      ratingMeta: message.ratingMeta ?? ratingMeta,
      agentRating: {
        stars,
        status: "pending",
      },
    }));

    try {
      const response = await fetch("/api/agent-ratings", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          ...ratingMeta,
          stars,
          surface: "web",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        status?: "pending" | "confirmed" | "failed";
        reputationTx?: string | null;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to rate this paid task.");
      }

      updateMessage(messageId, (message) => ({
        ...message,
        ratingMeta: message.ratingMeta ?? ratingMeta,
        agentRating: {
          stars,
          status: payload.status === "confirmed" ? "confirmed" : "pending",
          reputationTx: payload.reputationTx ?? null,
        },
      }));
    } catch (error) {
      updateMessage(messageId, (message) => ({
        ...message,
        ratingMeta: message.ratingMeta ?? ratingMeta,
        agentRating: {
          stars,
          status: "failed",
          error: error instanceof Error ? error.message : "Unable to rate this paid task.",
        },
      }));
    }
  };

  const resetChatThread = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput("");
    setPendingAttachment(null);
    setPendingBridgeDraft(null);
    setPendingBridgeSelection(null);
    setVoicePaymentLabel(null);
    setIsPaymentPanelOpen(false);
    setQueuedResearchJobId(null);
    setIsStreaming(false);
    setChatSessionId(createChatSessionId());
  };

  const handleQuickAgentPrompt = useCallback((item: QuickAgentPrompt) => {
    setSelectedTab(tabForIntent(item.routeIntent ?? item.tab));
    setInput(item.prompt);
    setPendingAttachment(null);
    setPendingBridgeDraft(null);
    setPendingBridgeSelection(null);
    setPendingVaultDraft(null);
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
        payment?: AgentRunPayment;
      };
      const paymentMeta = buildPaymentMetaFromResult(input.action, payload);

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
        paymentMeta: paymentMeta ?? message.paymentMeta,
        activityMeta: paymentMeta
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

  const resolveAttachmentSessionContext = async () => {
    if (!address) {
      openConnectModal?.();
      throw new Error("Connect your wallet before attaching files.");
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

    return { authHeaders };
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
    const { authHeaders } = await resolveAttachmentSessionContext();
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

    setVoicePaymentLabel(null);
    return text;
  };

  const resolveBridgeSessionContext = async (assistantId: string) => {
    if (!address) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content: "Connect your wallet to prepare a bridge.",
        trace: [...(message.trace || []), "Wallet connection required for bridge flow"],
        status: "error",
      }));
      setIsStreaming(false);
      openConnectModal?.();
      return null;
    }

    let authHeaders = getAuthHeaders();
    if (!isAuthenticated || !authHeaders) {
      const sessionMessage = buildSessionSignatureMessage("EOA");
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
        updateMessage(assistantId, (message) => ({
          ...message,
          content: friendlyChatErrorMessage(error, "Bridge session signing failed."),
          trace: [...(message.trace || []), "Bridge session signing failed"],
          status: "error",
        }));
        setIsStreaming(false);
        return null;
      }
    }

    if (!authHeaders) {
      updateMessage(assistantId, (message) => ({
        ...message,
        content: "The signed session was not available after wallet confirmation.",
        trace: [...(message.trace || []), "Bridge session was not attached"],
        status: "error",
      }));
      setIsStreaming(false);
      return null;
    }

    updateMessage(assistantId, (message) => ({
      ...message,
      content: "Secure session ready. Preparing your bridge destination wallet.",
      trace: [...(message.trace || []), "Secure bridge session confirmed"],
      status: "streaming",
    }));

    return {
      payerAddress: getAddress(address) as `0x${string}`,
      authHeaders,
    };
  };

  const fetchBridgeSourceHoldings = async (
    owner: `0x${string}`,
  ): Promise<BridgeSourceHolding[]> => {
    const entries = Object.entries(BRIDGE_SOURCE_CONFIG) as Array<
      [BridgeSource, (typeof BRIDGE_SOURCE_CONFIG)[BridgeSource]]
    >;

    const holdings = await Promise.all(
      entries.map(async ([sourceChain, sourceConfig]) => {
        const publicClient = createPublicClient({
          chain: sourceConfig.chain,
          transport: http(),
        });

        const [usdcBalanceRaw, nativeBalanceRaw] = await Promise.all([
          publicClient
            .readContract({
              address: sourceConfig.usdcAddress,
              abi: ERC20_ALLOWANCE_ABI,
              functionName: "balanceOf",
              args: [owner],
            })
            .then((value) => value as bigint)
            .catch(() => BigInt(0)),
          publicClient.getBalance({ address: owner }).catch(() => BigInt(0)),
        ]);

        return {
          sourceChain,
          label: sourceConfig.label,
          usdcBalanceRaw,
          nativeBalanceRaw,
        };
      }),
    );

    return holdings.sort((a, b) => {
      if (a.usdcBalanceRaw === b.usdcBalanceRaw) {
        return a.label.localeCompare(b.label);
      }
      return a.usdcBalanceRaw > b.usdcBalanceRaw ? -1 : 1;
    });
  };

  const prepareBridgeDraftInChat = async (input: {
    assistantId: string;
    amount: number;
    sourceChain: BridgeSource;
    bridgeContext: {
      payerAddress: `0x${string}`;
      authHeaders: Record<string, string>;
    };
  }) => {
    const { assistantId, amount, sourceChain, bridgeContext } = input;
    const sourceConfig = BRIDGE_SOURCE_CONFIG[sourceChain];
    const knownDestination = cachedExecutionWalletAddress;
    updateMessage(assistantId, (message) => ({
      ...message,
      content: `Preparing a ${amount} USDC bridge from ${sourceConfig.label} to Arc.`,
      trace: [
        `Source chain: ${sourceConfig.label}`,
        knownDestination
          ? `Using your AgentFlow wallet on Arc (${knownDestination})`
          : "Loading your AgentFlow wallet on Arc",
      ],
      status: "streaming",
    }));

    const userDcwAddress = await (async () => {
      if (knownDestination) {
        return knownDestination;
      }

      const slowPrepTimer = window.setTimeout(() => {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: `Still preparing your ${sourceConfig.label} bridge. This first session can take a few extra seconds while AgentFlow loads your Arc wallet address.`,
          trace: [...(message.trace || []), "Still loading your AgentFlow wallet address for this browser session"],
          status: "streaming",
        }));
      }, 4000);

      try {
        const executionSummary = await fetchExecutionWalletSummary(bridgeContext.authHeaders);
        const destination = getAddress(
          executionSummary.userAgentWalletAddress,
        ) as `0x${string}`;
        setCachedExecutionWalletAddress(destination);
        persistExecutionWalletAddress(bridgeContext.payerAddress, destination);
        return destination;
      } finally {
        window.clearTimeout(slowPrepTimer);
      }
    })();

    updateMessage(assistantId, (message) => ({
      ...message,
      content: `Preparing a ${amount} USDC bridge from ${sourceConfig.label} to Arc.`,
      trace: [
        `Source chain: ${sourceConfig.label}`,
        `Mint recipient: ${userDcwAddress}`,
        "Bridge will use your connected wallet for approval and burn",
        "Circle Forwarder will complete the Arc mint",
      ],
      status: "streaming",
    }));

    updateMessage(assistantId, (message) => ({
      ...message,
      content: `Preparing a ${amount} USDC bridge from ${sourceConfig.label} to Arc.`,
      trace: [...(message.trace || []), "AgentFlow is validating the native Circle bridge route"],
      status: "streaming",
    }));

    setPendingBridgeDraft({
      assistantId,
      sourceChain,
      amount,
      payerAddress: bridgeContext.payerAddress,
      userDcwAddress,
      authHeaders: bridgeContext.authHeaders,
    });

    updateMessage(assistantId, (message) => ({
      ...message,
      content:
        `Ready to bridge ${amount} USDC from ${sourceConfig.label} to Arc.\n\n` +
        `Your USDC will arrive in your AgentFlow wallet (${userDcwAddress}).\n\n` +
        `Click Yes, bridge to approve USDC if needed, sign the source-chain bridge in your browser wallet, then let AgentFlow record the bridge receipt and nanopayment after Circle forwards the funds to Arc.`,
      trace: [
        ...(message.trace || []),
        "Native Circle bridge route ready",
        "Next wallet actions happen on the source chain first",
        "AgentFlow records the paid bridge receipt after Circle completes the forwarder mint to Arc",
      ],
      confirmation: {
        required: true,
        action: "bridge",
      },
      status: "complete",
    }));
  };

  const continuePendingBridgeSelection = async (input: {
    amount: number;
    selection: PendingBridgeSelection;
  }) => {
    const { amount, selection } = input;
    setIsStreaming(true);
    const followupAssistantId = `assistant-bridge-${Date.now()}`;

    setMessages((previous) => [
      ...previous,
      {
        id: followupAssistantId,
        role: "assistant",
        title: "Bridge",
        content: "",
        trace: [],
        status: "streaming",
      },
    ]);

    try {
      await prepareBridgeDraftInChat({
        assistantId: followupAssistantId,
        amount,
        sourceChain: selection.sourceChain,
        bridgeContext: {
          payerAddress: selection.payerAddress,
          authHeaders: selection.authHeaders,
        },
      });
      setPendingBridgeSelection(null);
    } catch (error) {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content: friendlyChatErrorMessage(error, "Bridge flow failed."),
        trace: [...(message.trace || []), "Bridge flow failed"],
        status: "error",
      }));
    } finally {
      setIsStreaming(false);
    }
  };

  const continuePendingVaultSelection = async (input: {
    amount: number;
    selection: PendingVaultSelection;
  }) => {
    const { amount, selection } = input;
    setIsStreaming(true);
    const followupAssistantId = `assistant-vault-${Date.now()}`;
    const assetSymbol = vaultAssetSymbol(selection.vaultSymbol);
    const vaultAddress = VAULT_ADDRESS_BY_SYMBOL[selection.vaultSymbol];

    setMessages((previous) => [
      ...previous,
      {
        id: followupAssistantId,
        role: "assistant",
        title: "Vault",
        content: "",
        trace: [],
        status: "streaming",
      },
    ]);

    try {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content: `Preparing a vault ${selection.action} preview for ${amount} ${assetSymbol}.`,
        trace: [
          `Vault selected: ${vaultLabel(selection.vaultSymbol)}`,
          `Amount captured: ${amount} ${assetSymbol}`,
          "AgentFlow is preparing the live vault preview",
        ],
        status: "streaming",
      }));

      const result = await runPaidAgent<VaultAgentResponse & AgentRunPaymentResult, Record<string, unknown>>({
        slug: "vault",
        walletClient: walletClient!,
        payer: selection.payerAddress,
        authHeaders: selection.authHeaders,
        onAwaitSignature: () => {
          const paymentMessage = buildPaymentSignatureMessage("DCW");
          updateMessage(followupAssistantId, (message) => ({
            ...message,
            content: paymentMessage.content,
            trace: [...(message.trace || []), paymentMessage.trace],
            status: "streaming",
          }));
        },
        body: {
          action: selection.action,
          amount,
          walletAddress: selection.payerAddress,
          executionTarget: "DCW",
          vaultAddress,
          vaultSymbol: selection.vaultSymbol,
          amountTokenHint: assetSymbol,
        },
      });

      if (!result.success) {
        throw new Error(result.error || "Vault preview failed");
      }

      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content:
          selection.action === "deposit"
            ? `Ready to deposit ${amount} ${assetSymbol} into ${vaultLabel(selection.vaultSymbol)}.\n\nReply YES to continue or NO to cancel.`
            : `Ready to withdraw ${amount} ${assetSymbol} from ${vaultLabel(selection.vaultSymbol)}.\n\nReply YES to continue or NO to cancel.`,
        trace: [...(message.trace || []), "Vault preview is ready"],
        confirmation: {
          required: true,
          action: "vault",
        },
        status: "complete",
      }));
      setPendingVaultDraft({
        assistantId: followupAssistantId,
        action: selection.action,
        vaultSymbol: selection.vaultSymbol,
        vaultAddress,
        amount,
        payerAddress: selection.payerAddress,
        authHeaders: selection.authHeaders,
      });
      setPendingVaultSelection(null);
    } catch (error) {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content: friendlyChatErrorMessage(error, "Vault preparation failed."),
        trace: [...(message.trace || []), "Vault preparation failed"],
        status: "error",
      }));
    } finally {
      setIsStreaming(false);
    }
  };

  const continuePendingSwapSelection = async (input: {
    amount: number;
    selection: PendingSwapSelection;
  }) => {
    const { amount, selection } = input;
    const followupAssistantId = selection.assistantId;
    const syntheticPrompt = `swap ${amount} ${selection.tokenInSymbol} to ${selection.tokenOutSymbol}`;
    const { tokenIn, tokenOut, swapSpends } = resolveSwapTokenPair(syntheticPrompt);
    const tokenPair = { tokenIn, tokenOut };
    const slippage = 1;

    try {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content: "Fetching a live quote and routing the swap through AgentFlow Swap.",
        trace: [
          swapSpends === "eurc"
            ? `Preparing ${amount} EURC -> USDC swap request`
            : `Preparing ${amount} USDC -> EURC swap request`,
          `Using ${slippage}% slippage guard`,
          "Execution target: DCW",
        ],
        status: "streaming",
      }));

      const result = await runPaidAgent<SwapAgentResponse & AgentRunPaymentResult, Record<string, unknown>>({
        slug: "swap",
        walletClient: walletClient!,
        payer: selection.payerAddress,
        authHeaders: selection.authHeaders,
        onAwaitSignature: () => {
          const paymentMessage = buildPaymentSignatureMessage("DCW");
          updateMessage(followupAssistantId, (message) => ({
            ...message,
            content: paymentMessage.content,
            trace: [...(message.trace || []), paymentMessage.trace],
            status: "streaming",
          }));
        },
        body: {
          walletAddress: selection.payerAddress,
          amount,
          slippage,
          tokenPair,
          executionTarget: "DCW",
        },
      });

      if (!result.success) {
        throw new Error(result.error || "Swap agent failed");
      }

      updateMessage(followupAssistantId, (message) => {
        const r = result.receipt;
        const amountIn = r?.amountIn ?? amount;
        const isPreview = result.action === "preview" && Boolean(result.payload);
        if (isPreview) {
          return {
            ...message,
            content: buildSwapPreviewContent({
              amount,
              tokenInSymbol: selection.tokenInSymbol,
              tokenOutSymbol: selection.tokenOutSymbol,
              expectedOutFormatted: result.expectedOutFormatted,
              optimalSlippage: result.payload?.optimalSlippage,
              provider: result.provider,
            }),
            trace: [
              ...(message.trace || []),
              result.provider ? `Provider: ${result.provider}` : "Swap quote prepared",
              typeof result.payload?.optimalSlippage === "number"
                ? `Slippage guard: ${result.payload.optimalSlippage}%`
                : "Slippage guard prepared",
            ],
            quickActionGroups: [
              {
                title: `${selection.tokenInSymbol} -> ${selection.tokenOutSymbol}`,
                actions: [
                  { label: "YES", prompt: "YES" },
                  { label: "NO", prompt: "NO", tone: "secondary" },
                ],
              },
            ],
            status: "complete",
          };
        }

        const swapReceipt = result.txHash
          ? buildSwapExecutionContent({
              amountIn,
              quoteOutRaw: r?.quoteOutRaw,
              tokenIn: r?.tokenPair?.tokenIn ?? tokenPair.tokenIn,
              tokenOut: r?.tokenPair?.tokenOut ?? tokenPair.tokenOut,
              txHash: result.txHash,
              explorerLink: r?.explorerLink,
              approvalTxHash: result.approvalTxHash,
              approvalExplorerLink: r?.approvalExplorerLink,
              executionTarget: r?.executionTarget ?? "DCW",
              provider: result.provider ?? null,
            })
          : "";
        return {
          ...message,
          content: result.txHash
            ? swapReceipt
            : "Swap completed, but no transaction hash was returned.",
          trace: [
            ...(message.trace || []),
            "Swap quote approved",
            `Swap executed from ${r?.executionTarget ?? "DCW"}`,
            result.txHash ? `Swap verified - ${result.txHash.slice(0, 10)}...` : "Swap verified",
          ],
          paymentMeta: buildPaymentMetaFromResult("swap", result, selection.payerAddress),
          status: "complete",
        };
      });

      if (result.action === "preview" && result.payload) {
        setPendingSwapDraft({
          assistantId: followupAssistantId,
          payerAddress: selection.payerAddress,
          authHeaders: selection.authHeaders,
          amount,
          tokenPair,
          tokenInSymbol: selection.tokenInSymbol,
          tokenOutSymbol: selection.tokenOutSymbol,
          requestedSlippage: slippage,
          provider: result.payload.provider,
          routeData: result.payload.routeData,
          expectedOutRaw: result.expectedOutRaw || result.payload.quoteAmountOutRaw,
          quoteOutRaw: result.payload.quoteAmountOutRaw,
          optimalSlippage: result.payload.optimalSlippage,
        });
      }
      setPendingSwapSelection(null);
    } catch (error) {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content: friendlyChatErrorMessage(error, "Swap flow failed."),
        trace: [...(message.trace || []), "Swap flow failed"],
        status: "error",
      }));
    }
  };

  const executePendingVault = async (draft: PendingVaultDraft) => {
    const followupAssistantId = `assistant-vault-${Date.now()}-execute`;
    setMessages((previous) => [
      ...previous,
      {
        id: followupAssistantId,
        role: "assistant",
        title: "Vault",
        content: "",
        trace: [],
        status: "streaming",
      },
    ]);

    try {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content:
          draft.action === "deposit"
            ? `Executing deposit of ${draft.amount} ${vaultAssetSymbol(draft.vaultSymbol)} into ${vaultLabel(draft.vaultSymbol)}.`
            : `Executing withdraw of ${draft.amount} ${vaultAssetSymbol(draft.vaultSymbol)} from ${vaultLabel(draft.vaultSymbol)}.`,
        trace: [
          `Vault selected: ${vaultLabel(draft.vaultSymbol)}`,
          `Amount confirmed: ${draft.amount} ${vaultAssetSymbol(draft.vaultSymbol)}`,
          "AgentFlow is executing the vault transaction",
        ],
        status: "streaming",
      }));

      const result = await runPaidAgent<VaultAgentResponse & AgentRunPaymentResult, Record<string, unknown>>({
        slug: "vault",
        walletClient: walletClient!,
        payer: draft.payerAddress,
        authHeaders: draft.authHeaders,
        onAwaitSignature: () => {
          const paymentMessage = buildPaymentSignatureMessage("DCW");
          updateMessage(followupAssistantId, (message) => ({
            ...message,
            content: paymentMessage.content,
            trace: [...(message.trace || []), paymentMessage.trace],
            status: "streaming",
          }));
        },
        body: {
          action: draft.action,
          amount: draft.amount,
          walletAddress: draft.payerAddress,
          executionTarget: "DCW",
          vaultAddress: draft.vaultAddress,
          vaultSymbol: draft.vaultSymbol,
          amountTokenHint: vaultAssetSymbol(draft.vaultSymbol),
          confirmed: true,
        },
      });

      if (!result.success) {
        throw new Error(result.error || "Vault execution failed");
      }

      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content:
          result.txHash
              ? buildVaultExecutionContent({
                  action: draft.action,
                  txHash: result.txHash,
                  explorerLink: result.receipt?.explorerLink,
                  approvalTxHash: result.approvalTxHash,
                  approvalExplorerLink: result.receipt?.approvalExplorerLink,
                  provider: result.provider || null,
                vaultSymbol: result.vaultSymbol || draft.vaultSymbol,
                sharesReceivedFormatted: result.sharesReceivedFormatted || null,
                sharesBurnedFormatted: result.sharesBurnedFormatted || null,
                assetsReceivedFormatted: result.assetsReceivedFormatted || null,
              })
            : `Vault ${draft.action} completed.`,
        trace: [
          ...(message.trace || []),
          result.txHash
            ? `Vault ${draft.action} verified - ${result.txHash.slice(0, 10)}...`
            : `Vault ${draft.action} complete`,
        ],
        paymentMeta: buildPaymentMetaFromResult("vault", result, draft.payerAddress),
        status: "complete",
      }));
      setPendingVaultDraft(null);
    } catch (error) {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content: friendlyChatErrorMessage(error, "Vault execution failed."),
        trace: [...(message.trace || []), "Vault execution failed"],
        quickActionGroups: [
          {
            title: vaultLabel(draft.vaultSymbol),
            actions: [
              { label: "YES", prompt: "YES" },
              { label: "NO", prompt: "NO", tone: "secondary" },
            ],
          },
        ],
        status: "error",
      }));
    } finally {
      setIsStreaming(false);
    }
  };

  const executePendingSwap = async (draft: PendingSwapDraft) => {
    const followupAssistantId = `assistant-swap-${Date.now()}-execute`;
    setMessages((previous) => [
      ...previous,
      {
        id: followupAssistantId,
        role: "assistant",
        title: "Swap",
        content: "",
        trace: [],
        status: "streaming",
      },
    ]);

    try {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content: `Executing swap of ${draft.amount} ${draft.tokenInSymbol} to ${draft.tokenOutSymbol}.`,
        trace: [
          `Amount confirmed: ${draft.amount} ${draft.tokenInSymbol}`,
          `Route confirmed: ${draft.tokenInSymbol} -> ${draft.tokenOutSymbol}`,
          "AgentFlow is executing the swap transaction",
        ],
        status: "streaming",
      }));

      const result = await runPaidAgent<SwapAgentResponse & AgentRunPaymentResult, Record<string, unknown>>({
        slug: "swap",
        walletClient: walletClient!,
        payer: draft.payerAddress,
        authHeaders: draft.authHeaders,
        onAwaitSignature: () => {
          const paymentMessage = buildPaymentSignatureMessage("DCW");
          updateMessage(followupAssistantId, (message) => ({
            ...message,
            content: paymentMessage.content,
            trace: [...(message.trace || []), paymentMessage.trace],
            status: "streaming",
          }));
        },
        body: {
          walletAddress: draft.payerAddress,
          amount: draft.amount,
          slippage: draft.requestedSlippage,
          tokenPair: draft.tokenPair,
          executionTarget: "DCW",
          confirmed: true,
          provider: draft.provider,
          routeData: draft.routeData,
          expectedOutRaw: draft.expectedOutRaw,
        },
      });

      if (!result.success || !result.txHash) {
        throw new Error(result.error || "Swap execution failed");
      }
      const txHash = result.txHash;

      updateMessage(followupAssistantId, (message) => {
        const r = result.receipt;
        const amountIn = r?.amountIn ?? draft.amount;
        return {
          ...message,
          content: buildSwapExecutionContent({
            amountIn,
            quoteOutRaw: r?.quoteOutRaw ?? draft.quoteOutRaw,
            tokenIn: r?.tokenPair?.tokenIn ?? draft.tokenPair.tokenIn,
            tokenOut: r?.tokenPair?.tokenOut ?? draft.tokenPair.tokenOut,
            txHash,
            explorerLink: r?.explorerLink,
            approvalTxHash: result.approvalTxHash,
            approvalExplorerLink: r?.approvalExplorerLink,
            executionTarget: r?.executionTarget ?? "DCW",
            provider: result.provider ?? null,
          }),
          trace: [
            ...(message.trace || []),
            "Swap quote approved",
            `Swap executed from ${r?.executionTarget ?? "DCW"}`,
            `Swap verified - ${txHash.slice(0, 10)}...`,
          ],
          paymentMeta: buildPaymentMetaFromResult("swap", result, draft.payerAddress),
          status: "complete",
        };
      });
      setPendingSwapDraft(null);
    } catch (error) {
      updateMessage(followupAssistantId, (message) => ({
        ...message,
        content: friendlyChatErrorMessage(error, "Swap execution failed."),
        trace: [...(message.trace || []), "Swap execution failed"],
        quickActionGroups: [
          {
            title: `${draft.tokenInSymbol} -> ${draft.tokenOutSymbol}`,
            actions: [
              { label: "YES", prompt: "YES" },
              { label: "NO", prompt: "NO", tone: "secondary" },
            ],
          },
        ],
        status: "error",
      }));
    } finally {
      setIsStreaming(false);
    }
  };

  const executePendingBridge = async (draft: PendingBridgeDraft) => {
    if (!address) {
      throw new Error("Connect your wallet to continue the bridge.");
    }

    const connectedAddress = getAddress(address) as `0x${string}`;
    if (connectedAddress !== draft.payerAddress) {
      throw new Error("Reconnect the same wallet you used to prepare this bridge, then try again.");
    }

    const sourceConfig = BRIDGE_SOURCE_CONFIG[draft.sourceChain];
    if (!sourceConfig.bridgeKitChain) {
      throw new Error(
        `${sourceConfig.label} is not enabled in the native Circle bridge path yet.`,
      );
    }

    if (chainId !== sourceConfig.chainId) {
      updateMessage(draft.assistantId, (message) => ({
        ...message,
        content: `Switching your wallet to ${sourceConfig.label} so we can sign the bridge from the source chain.`,
        trace: [...(message.trace || []), `Requesting wallet network switch to ${sourceConfig.label}`],
        status: "streaming",
      }));

      try {
        await withTimeout(
          switchChainAsync({ chainId: sourceConfig.chainId }),
          BRIDGE_SWITCH_TIMEOUT_MS,
          `Wallet switch to ${sourceConfig.label} timed out. Approve the network switch and try the bridge again.`,
        );
      } catch (error) {
        throw new Error(
          `Wallet switch to ${sourceConfig.label} was not completed. Approve the network switch and try the bridge again.`,
        );
      }
    }

    if (!connector) {
      throw new Error("Selected wallet provider is not available. Reconnect your wallet and try the bridge again.");
    }

    const browserProvider = (await connector.getProvider?.({
      chainId: sourceConfig.chainId,
    })) as EIP1193Provider | undefined;
    if (!browserProvider) {
      throw new Error(
        `AgentFlow could not read the selected ${connector.name} provider on ${sourceConfig.label}.`,
      );
    }

    updateMessage(draft.assistantId, (message) => ({
      ...message,
      content: `Connecting ${connector.name} for your ${sourceConfig.label} bridge.`,
      trace: [
        ...(message.trace || []),
        `Using selected wallet provider: ${connector.name}`,
        `Connector id: ${connector.id}`,
      ],
      status: "streaming",
    }));

    updateMessage(draft.assistantId, (message) => ({
      ...message,
      content: `MetaMask should now prompt for the source-chain bridge on ${sourceConfig.label}.`,
      trace: [
        ...(message.trace || []),
        "Circle BridgeKit will request approval only if it is needed",
        "Circle Forwarder will handle the Arc mint automatically",
      ],
      status: "streaming",
    }));

    const adapter = await createViemAdapterFromProvider({
      provider: browserProvider,
      capabilities: {
        addressContext: "user-controlled",
      },
    });

    const kit = new BridgeKit();
    const amount = draft.amount.toString();
    let bridgeStage: "start" | "approve" | "burn" | "attestation" | "mint" = "start";
    let progressWatchdog: number | null = null;

    const clearProgressWatchdog = () => {
      if (progressWatchdog != null) {
        window.clearTimeout(progressWatchdog);
        progressWatchdog = null;
      }
    };

    const scheduleProgressWatchdog = () => {
      clearProgressWatchdog();
      const messageByStage: Record<typeof bridgeStage, { content: string; trace: string }> = {
        start: {
          content: `Still waiting for the ${sourceConfig.label} bridge confirmation in your browser wallet.`,
          trace: "Browser wallet confirmation is still pending",
        },
        approve: {
          content: `Approval is done on ${sourceConfig.label}. Circle is still preparing the bridge burn.`,
          trace: "Waiting for the source-chain burn transaction",
        },
        burn: {
          content: `Burn confirmed on ${sourceConfig.label}. Circle is still waiting on attestation and forwarder delivery to Arc.`,
          trace: "Waiting for Circle attestation and Arc delivery",
        },
        attestation: {
          content: "Circle attestation is ready. Waiting for the Arc mint confirmation.",
          trace: "Waiting for the Arc mint confirmation",
        },
        mint: {
          content: "Arc mint is confirmed. AgentFlow is still recording the bridge receipt and nanopayment.",
          trace: "Waiting for AgentFlow to record the paid bridge receipt",
        },
      };

      progressWatchdog = window.setTimeout(() => {
        const next = messageByStage[bridgeStage];
        updateMessage(draft.assistantId, (message) => ({
          ...message,
          content: next.content,
          trace: [...(message.trace || []), next.trace],
          status: "streaming",
        }));
      }, 12000);
    };

    const bridgeEventHandler: Parameters<BridgeKit["on"]>[1] = (event) => {
      const method = typeof event?.method === "string" ? event.method : "";
      const values = event?.values;
      const txHash =
        values &&
        typeof values === "object" &&
        "txHash" in values &&
        typeof values.txHash === "string"
          ? values.txHash
          : null;

      if (/approve/i.test(method)) {
        bridgeStage = "approve";
        updateMessage(draft.assistantId, (message) => ({
          ...message,
          content: `Approval confirmed on ${sourceConfig.label}. Circle is now preparing the source-chain burn.`,
          trace: [
            ...(message.trace || []),
            ...(txHash
              ? [
                  {
                    label: "Approval confirmed",
                    txHash,
                    explorerUrl: bridgeTxExplorerUrl(draft.sourceChain, txHash),
                  },
                ]
              : ["Approval confirmed"]),
          ],
          status: "streaming",
        }));
        scheduleProgressWatchdog();
        return;
      }

      if (/burn/i.test(method)) {
        bridgeStage = "burn";
        updateMessage(draft.assistantId, (message) => ({
          ...message,
          content: `Burn confirmed on ${sourceConfig.label}. Waiting for Circle attestation before forwarding the funds to Arc.`,
          trace: [
            ...(message.trace || []),
            ...(txHash
              ? [
                  {
                    label: "Burn confirmed",
                    txHash,
                    explorerUrl: bridgeTxExplorerUrl(draft.sourceChain, txHash),
                  },
                ]
              : ["Burn confirmed"]),
          ],
          status: "streaming",
        }));
        scheduleProgressWatchdog();
        return;
      }

      if (/fetchAttestation/i.test(method)) {
        bridgeStage = "attestation";
        updateMessage(draft.assistantId, (message) => ({
          ...message,
          content: "Circle attestation received. Waiting for the Arc mint confirmation.",
          trace: [...(message.trace || []), "Circle attestation received"],
          status: "streaming",
        }));
        scheduleProgressWatchdog();
        return;
      }

      if (/mint/i.test(method)) {
        bridgeStage = "mint";
        updateMessage(draft.assistantId, (message) => ({
          ...message,
          content: "Arc mint confirmed. AgentFlow is now recording the bridge receipt and nanopayment.",
          trace: [
            ...(message.trace || []),
            ...(txHash
              ? [
                  {
                    label: "Arc mint confirmed",
                    txHash,
                    explorerUrl: arcTxExplorerUrl(txHash),
                  },
                ]
              : ["Arc mint confirmed"]),
          ],
          status: "streaming",
        }));
        scheduleProgressWatchdog();
      }
    };

    kit.on("*", bridgeEventHandler);

    updateMessage(draft.assistantId, (message) => ({
      ...message,
      content: `Running the native Circle bridge from ${sourceConfig.label} to Arc.`,
      trace: [...(message.trace || []), "Waiting for Circle to complete the bridge flow"],
      status: "streaming",
    }));
    scheduleProgressWatchdog();

    let result;
    try {
      result = await kit.bridge({
        from: {
          adapter,
          chain: sourceConfig.bridgeKitChain,
        },
        to: {
          chain: BridgeChain.Arc_Testnet,
          recipientAddress: draft.userDcwAddress,
          useForwarder: true,
        },
        amount,
      });
    } finally {
      clearProgressWatchdog();
      kit.off("*", bridgeEventHandler);
    }

    const steps = (Array.isArray(result.steps) ? result.steps : []) as BridgeKitStepLike[];
    if (result.state !== "success") {
      const failedStep = steps.find((step) => step.state === "error");
      const failedName = failedStep?.name ? `${failedStep.name} failed.` : "Circle bridge failed.";
      throw new Error(failedName);
    }

    const approvalTxHash = findBridgeStepTx(steps, /approve/i);
    const burnTxHash = findBridgeStepTx(steps, /burn/i);
    const mintTxHash = findBridgeStepTx(steps, /mint/i);

    if (!burnTxHash) {
      throw new Error("Circle bridge completed without returning the source-chain burn transaction hash.");
    }

    updateMessage(draft.assistantId, (message) => ({
      ...message,
      content: `Circle finished forwarding your bridge to Arc. AgentFlow is now recording the receipt and nanopayment.`,
      trace: [
        ...(message.trace || []),
        ...(approvalTxHash
          ? [
              {
                label: "Approval confirmed",
                txHash: approvalTxHash,
                explorerUrl: bridgeTxExplorerUrl(draft.sourceChain, approvalTxHash),
              },
            ]
          : []),
        {
          label: "Burn confirmed",
          txHash: burnTxHash,
          explorerUrl: bridgeTxExplorerUrl(draft.sourceChain, burnTxHash),
        },
        ...(mintTxHash
          ? [
              {
                label: "Arc mint confirmed",
                txHash: mintTxHash,
                explorerUrl: arcTxExplorerUrl(mintTxHash),
              },
            ]
          : ["Circle Forwarder completed the Arc delivery"]),
      ],
      status: "streaming",
    }));

    const finalizeRequestId = createBrowserX402RequestId();
    let paymentRequestId: string | null = null;
    let paymentMode: "eoa" | "dcw" = "dcw";
    let paymentPayer: Address = connectedAddress;
    let paymentAttemptSnapshot: X402AttemptSnapshot | null = null;
    let finalizeWarning: string | null = null;

    if (sourceConfig.chainId !== ARC_CHAIN_ID) {
      updateMessage(draft.assistantId, (message) => ({
        ...message,
        trace: [...(message.trace || []), "Switching wallet back to Arc"],
        status: message.status,
      }));

      try {
        await requestWalletSwitchToArc(browserProvider);
        await withTimeout(
          switchChainAsync({ chainId: ARC_CHAIN_ID }),
          BRIDGE_SWITCH_TIMEOUT_MS,
          "Wallet switch back to Arc timed out. You can switch networks manually if needed.",
        );
      } catch {
        updateMessage(draft.assistantId, (message) => ({
          ...message,
          trace: [
            ...(message.trace || []),
            "Bridge finished, but automatic switch back to Arc was skipped",
          ],
          status: message.status,
        }));
      }
    }

    try {
      const arcProvider = (await connector?.getProvider?.({
        chainId: ARC_CHAIN_ID,
      })) as EIP1193Provider | undefined;
      await waitForConnectorChain(
        arcProvider,
        ARC_CHAIN_ID,
        BRIDGE_WALLET_CLIENT_TIMEOUT_MS,
      );
      const arcWalletClient = await withTimeout(
        getWalletClient(wagmiConfig, {
          account: connectedAddress,
          chainId: ARC_CHAIN_ID,
          connector,
        }),
        BRIDGE_WALLET_CLIENT_TIMEOUT_MS,
        "Arc wallet session took too long to reconnect for the bridge receipt payment.",
      );
      const finalized = await withTimeout(
        finalizeBridgeRun({
          requestId: finalizeRequestId,
          walletClient: arcWalletClient,
          payer: connectedAddress,
          authHeaders: getAuthHeaders() ?? draft.authHeaders,
          body: {
            sourceChain: draft.sourceChain,
            amount: draft.amount,
            sourceTxHash: burnTxHash,
            approvalTxHash,
            mintTxHash,
            recipientAddress: draft.userDcwAddress,
          },
          onAwaitSignature: () => {
            updateMessage(draft.assistantId, (message) => ({
              ...message,
              content: "MetaMask should now prompt for the AgentFlow bridge receipt payment on Arc.",
              trace: [...(message.trace || []), "Waiting for x402 bridge receipt payment signature"],
              status: "streaming",
            }));
          },
        }),
        BRIDGE_FINALIZE_TIMEOUT_MS,
        `Bridge receipt payment verification timed out. Request ID: ${finalizeRequestId}`,
      );
      paymentMode = finalized.payment?.mode ?? paymentMode;
      paymentPayer = (finalized.payment?.payer ?? paymentPayer) as Address;
      paymentRequestId = finalized.requestId;
      paymentAttemptSnapshot = await readX402AttemptSnapshot(finalized.requestId);
    } catch (error) {
      paymentAttemptSnapshot = await waitForX402AttemptTerminalState(finalizeRequestId);
      if (paymentAttemptSnapshot?.stage === "succeeded") {
        paymentRequestId = finalizeRequestId;
      } else if (isBridgeFinalizePendingStage(paymentAttemptSnapshot?.stage)) {
        paymentRequestId = finalizeRequestId;
        finalizeWarning = `The bridge reached Arc, and AgentFlow is still verifying the bridge receipt payment. Request ID: ${finalizeRequestId}`;
      } else if (isChainMismatchError(error)) {
        paymentRequestId = finalizeRequestId;
        finalizeWarning = `The bridge reached Arc, but your wallet is still connected to the source chain. Switch back to Arc to finish the AgentFlow bridge receipt payment. Request ID: ${finalizeRequestId}`;
      } else if (paymentAttemptSnapshot) {
        paymentRequestId = finalizeRequestId;
        finalizeWarning = paymentAttemptSnapshot.error
          ? `${paymentAttemptSnapshot.error}\nRequest ID: ${finalizeRequestId}`
          : friendlyChatErrorMessage(
              error,
              `The bridge finished, but AgentFlow could not record the bridge receipt payment. Request ID: ${finalizeRequestId}`,
            );
      } else {
        paymentRequestId = null;
        finalizeWarning = friendlyChatErrorMessage(
          error,
          `The bridge finished, but AgentFlow could not record the bridge receipt payment. Request ID: ${finalizeRequestId}`,
        );
      }
    }

    updateMessage(draft.assistantId, (message) => ({
      ...message,
      content: [
        buildBridgeReceiptContent({
          amount: draft.amount,
          sourceChain: draft.sourceChain,
          sourceLabel: sourceConfig.label,
          userDcwAddress: draft.userDcwAddress,
          approvalTxHash,
          burnTxHash,
          mintTxHash,
          paymentRequestId,
        }),
        finalizeWarning ? `\n\nPayment note: ${finalizeWarning}` : null,
      ]
        .filter(Boolean)
        .join(""),
      paymentMeta: paymentRequestId
        ? {
            entries: [
              {
                requestId: paymentRequestId,
                agent: "bridge",
                price: paymentPriceLabel("bridge"),
                payer: paymentPayer,
                mode: paymentMode,
              },
            ],
          }
        : message.paymentMeta,
      trace: finalizeWarning
        ? [
            ...(message.trace || []),
            paymentAttemptSnapshot?.stage && isBridgeFinalizePendingStage(paymentAttemptSnapshot.stage)
              ? `Bridge receipt payment still pending verification (${paymentAttemptSnapshot.stage})`
              : "Bridge receipt payment was not completed",
          ]
        : [...(message.trace || []), "Bridge receipt recorded by AgentFlow"],
      status: "complete",
    }));

    if (paymentRequestId) {
      setIsPaymentPanelOpen(true);
    }
  };

  const submitMessage = async (
    rawInput: string,
    attachmentOverride?: PendingChatAttachment | null,
  ) => {
    const decodedQuickAction = decodeQuickActionMessage(rawInput);
    const trimmed = decodedQuickAction.displayText.trim();
    const activeAttachment = attachmentOverride ?? pendingAttachment;
    if ((!trimmed && !activeAttachment) || isStreaming) {
      return;
    }

    const resolvedQuickActionPrompt =
      decodedQuickAction.prompt ??
      ((!activeAttachment &&
        !pendingSwapSelection &&
        !pendingVaultSelection &&
        !pendingBridgeSelection &&
        !pendingSwapDraft &&
        !pendingVaultDraft &&
        !pendingBridgeDraft)
        ? resolveQuickActionPromptFromReply(trimmed, messages)
        : null);
    const effectiveInput = resolvedQuickActionPrompt ?? trimmed;
    const quickActionIntentOverride = resolveQuickActionIntentOverride({
      routeIntent: decodedQuickAction.routeIntent,
      actionId: decodedQuickAction.actionId,
    });

    if (pendingSwapSelection && !activeAttachment) {
      const followupAmount = parseOptionalAmount(trimmed);
      if (followupAmount != null) {
        const now = Date.now();
        recordRecentChat(trimmed);
        setMessages((previous) => [
          ...previous,
          {
            id: `user-${now}`,
            role: "user",
            content: trimmed,
            status: "complete",
          },
        ]);
        setInput("");
        setPendingAttachment(null);
        setVoicePaymentLabel(null);
        await continuePendingSwapSelection({
          amount: followupAmount,
          selection: pendingSwapSelection,
        });
        return;
      }
    }

    if (pendingVaultSelection && !activeAttachment) {
      const followupAmount = parseOptionalAmount(trimmed);
      if (followupAmount != null) {
        const now = Date.now();
        recordRecentChat(trimmed);
        setMessages((previous) => [
          ...previous,
          {
            id: `user-${now}`,
            role: "user",
            content: trimmed,
            status: "complete",
          },
        ]);
        setInput("");
        setPendingAttachment(null);
        setVoicePaymentLabel(null);
        await continuePendingVaultSelection({
          amount: followupAmount,
          selection: pendingVaultSelection,
        });
        return;
      }
    }

    if (pendingBridgeSelection && !activeAttachment) {
      const followupAmount = parseOptionalAmount(trimmed);
      if (followupAmount != null) {
        const now = Date.now();
        recordRecentChat(trimmed);
        setMessages((previous) => [
          ...previous,
          {
            id: `user-${now}`,
            role: "user",
            content: trimmed,
            status: "complete",
          },
        ]);
        setInput("");
        setPendingAttachment(null);
        setVoicePaymentLabel(null);
        await continuePendingBridgeSelection({
          amount: followupAmount,
          selection: pendingBridgeSelection,
        });
        return;
      }
    }

    if (
      (pendingSwapSelection || pendingVaultSelection || pendingBridgeSelection) &&
      !activeAttachment &&
      (/^yes$/i.test(trimmed) || isSoftPendingAcknowledgement(trimmed))
    ) {
      const now = Date.now();
      const pendingTitle = pendingSwapSelection
        ? "Swap"
        : pendingVaultSelection
          ? "Vault"
          : "Bridge";
      const pendingReminder = pendingSwapSelection
        ? `Tell me the ${pendingSwapSelection.tokenInSymbol} amount you want to swap into ${pendingSwapSelection.tokenOutSymbol}.`
        : pendingVaultSelection
          ? `Tell me how much ${vaultAssetSymbol(pendingVaultSelection.vaultSymbol)} you want to ${pendingVaultSelection.action} ${pendingVaultSelection.vaultSymbol}.`
          : `Tell me how much USDC you want to bridge from ${BRIDGE_SOURCE_CONFIG[pendingBridgeSelection!.sourceChain].label}.`;

      recordRecentChat(trimmed);
      setMessages((previous) => [
        ...previous,
        {
          id: `user-${now}`,
          role: "user",
          content: trimmed,
          status: "complete",
        },
        {
          id: `assistant-${now}-amount-reminder`,
          role: "assistant",
          title: pendingTitle,
          content: pendingReminder,
          trace: ["Awaiting amount"],
          status: "complete",
        },
      ]);
      setInput("");
      setPendingAttachment(null);
      setVoicePaymentLabel(null);
      return;
    }

    if (!activeAttachment && !pendingBridgeSelection) {
      const recoveredSourceChain = findPendingBridgeAmountSource(messages);
      const followupAmount = parseOptionalAmount(trimmed);
      if (recoveredSourceChain && followupAmount != null) {
        const now = Date.now();
        const assistantId = `assistant-bridge-${now}`;
        recordRecentChat(trimmed);
        setMessages((previous) => [
          ...previous,
          {
            id: `user-${now}`,
            role: "user",
            content: trimmed,
            status: "complete",
          },
          {
            id: assistantId,
            role: "assistant",
            title: "Bridge",
            content: "",
            trace: [],
            status: "streaming",
          },
        ]);
        setInput("");
        setPendingAttachment(null);
        setVoicePaymentLabel(null);
        setIsStreaming(true);
        try {
          const bridgeContext = await resolveBridgeSessionContext(assistantId);
          if (!bridgeContext) {
            return;
          }
          await prepareBridgeDraftInChat({
            assistantId,
            amount: followupAmount,
            sourceChain: recoveredSourceChain,
            bridgeContext,
          });
        } catch (error) {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: friendlyChatErrorMessage(error, "Bridge flow failed."),
            trace: [...(message.trace || []), "Bridge flow failed"],
            status: "error",
          }));
        } finally {
          setIsStreaming(false);
        }
        return;
      }
    }

    if (pendingSwapDraft && !activeAttachment && /^(yes|no)$/i.test(trimmed)) {
      const now = Date.now();
      const isConfirm = /^yes$/i.test(trimmed);
      recordRecentChat(trimmed);
      setInput("");
      setPendingAttachment(null);
      setVoicePaymentLabel(null);
      const followupAssistantId = `assistant-swap-${now}-confirm`;

      if (!isConfirm) {
        setPendingSwapDraft(null);
        setMessages((previous) => [
          ...previous.map((message) =>
            message.id === pendingSwapDraft.assistantId
              ? {
                  ...message,
                  quickActionGroups: undefined,
                  status: (message.status === "error" ? "error" : "complete") as "error" | "complete",
                }
              : message,
          ),
          {
            id: `user-${now}`,
            role: "user",
            content: "NO",
            status: "complete",
          },
          {
            id: followupAssistantId,
            role: "assistant",
            title: "Swap",
            content: "Swap cancelled.",
            trace: ["Swap cancelled"],
            status: "complete",
          },
        ]);
        return;
      }

      const executionDraft: PendingSwapDraft = { ...pendingSwapDraft };
      flushSync(() => {
        setMessages((previous) => [
          ...previous.map((message) =>
            message.id === pendingSwapDraft.assistantId
              ? {
                  ...message,
                  quickActionGroups: undefined,
                  status: (message.status === "error" ? "error" : "complete") as "error" | "complete",
                }
              : message,
          ),
          {
            id: `user-${now}`,
            role: "user",
            content: "YES",
            status: "complete",
          },
        ]);
      });

      setIsStreaming(true);
      await executePendingSwap(executionDraft);
      return;
    }

    if ((pendingSwapDraft || pendingVaultDraft || pendingBridgeDraft) && !activeAttachment && isSoftPendingAcknowledgement(trimmed)) {
      const pendingTitle = pendingSwapDraft ? "Swap" : pendingVaultDraft ? "Vault" : "Bridge";
      const pendingReminder = pendingSwapDraft
        ? "Your swap quote is still pending. Reply YES to execute or NO to cancel."
        : pendingVaultDraft
          ? "Your vault action is still pending. Reply YES to continue or NO to cancel."
          : "Your bridge is still pending. Reply YES to continue or NO to cancel.";
      const now = Date.now();
      recordRecentChat(trimmed);
      setMessages((previous) => [
        ...previous,
        {
          id: `user-${now}`,
          role: "user",
          content: trimmed,
          status: "complete",
        },
        {
          id: `assistant-${now}-pending-reminder`,
          role: "assistant",
          title: pendingTitle,
          content: pendingReminder,
          trace: ["Pending action reminder"],
          status: "complete",
        },
      ]);
      setInput("");
      setPendingAttachment(null);
      setVoicePaymentLabel(null);
      return;
    }

    if (pendingBridgeDraft && !activeAttachment && /^(yes|no)$/i.test(trimmed)) {
      const now = Date.now();
      const isConfirm = /^yes$/i.test(trimmed);
      const userConfirmationMessage: LiveChatMessage = {
        id: `user-${now}`,
        role: "user",
        content: trimmed.toUpperCase(),
        status: "complete",
      };
      recordRecentChat(trimmed);
      setInput("");
      setPendingAttachment(null);
      setVoicePaymentLabel(null);

      if (!isConfirm) {
        setMessages((previous) => [
          ...previous.map((message) =>
            message.id === pendingBridgeDraft.assistantId
              ? {
                  ...message,
                  content: "Bridge cancelled before any source-chain transaction was sent.",
                  trace: [...(message.trace || []), "Bridge cancelled"],
                  confirmation: undefined,
                  status: "complete" as const,
                }
              : message,
          ),
          userConfirmationMessage,
        ]);
        setPendingBridgeDraft(null);
        return;
      }

      setIsStreaming(true);
      const followupAssistantId = `assistant-bridge-exec-${Date.now()}`;
      const executionDraft: PendingBridgeDraft = {
        assistantId: followupAssistantId,
        sourceChain: pendingBridgeDraft.sourceChain,
        amount: pendingBridgeDraft.amount,
        payerAddress: pendingBridgeDraft.payerAddress,
        userDcwAddress: pendingBridgeDraft.userDcwAddress,
        authHeaders: pendingBridgeDraft.authHeaders,
      };
      flushSync(() => {
        setMessages((previous) => [
          ...previous.map((message) =>
            message.id === pendingBridgeDraft.assistantId
              ? {
                  ...message,
                  confirmation: undefined,
                  status: (message.status === "error" ? "error" : "complete") as
                    | "error"
                    | "complete",
                }
              : message,
          ),
          userConfirmationMessage,
          {
            id: followupAssistantId,
            role: "assistant",
            title: "Bridge",
            content: "",
            trace: [],
            status: "streaming",
          },
        ]);
      });

      try {
        await executePendingBridge(executionDraft);
        setPendingBridgeDraft(null);
      } catch (error) {
        updateMessage(followupAssistantId, (message) => ({
          ...message,
          content: friendlyChatErrorMessage(error, "Bridge execution failed."),
          trace: [...(message.trace || []), "Bridge execution failed"],
          confirmation: {
            required: true,
            action: "bridge",
          },
          status: "error",
        }));
      } finally {
        setIsStreaming(false);
      }
      return;
    }

    if (pendingVaultDraft && !activeAttachment && /^(yes|no)$/i.test(trimmed)) {
      const now = Date.now();
      const isConfirm = /^yes$/i.test(trimmed);
      recordRecentChat(trimmed);
      const followupAssistantId = `assistant-vault-${now}-confirm`;

      if (!isConfirm) {
        setPendingVaultDraft(null);
        setMessages((previous) => [
          ...previous.map((message) =>
            message.id === pendingVaultDraft.assistantId
              ? {
                  ...message,
                  quickActionGroups: undefined,
                  status: (message.status === "error" ? "error" : "complete") as "error" | "complete",
                }
              : message,
          ),
          {
            id: `user-${now}`,
            role: "user",
            content: "NO",
            status: "complete",
          },
          {
            id: followupAssistantId,
            role: "assistant",
            title: "Vault",
            content: "Vault action cancelled.",
            trace: ["Vault action cancelled"],
            status: "complete",
          },
        ]);
        return;
      }

      const executionDraft: PendingVaultDraft = { ...pendingVaultDraft };
      flushSync(() => {
        setMessages((previous) => [
          ...previous.map((message) =>
            message.id === pendingVaultDraft.assistantId
              ? {
                  ...message,
                  quickActionGroups: undefined,
                  status: (message.status === "error" ? "error" : "complete") as "error" | "complete",
                }
              : message,
          ),
          {
            id: `user-${now}`,
            role: "user",
            content: "YES",
            status: "complete",
          },
        ]);
      });

      setIsStreaming(true);
      try {
        await executePendingVault(executionDraft);
      } finally {
        setPendingVaultDraft(null);
      }
      return;
    }

    const localGuardReply = buildLocalPromptGuard(effectiveInput, activeAttachment);
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
      ? `${effectiveInput}\n\nPortfolio context:\n${contextToInject}`
      : effectiveInput;

    // CSV attachments → route to the batch-payment fast-path instead of Vision.
    // We inline the CSV body into the outgoing message with a "batch pay" header so
    // server.ts's shouldHandleAsBatchPayment picks it up.
    let csvBatchMessage: string | null = null;
    if (isBatchCsvAttachment(activeAttachment)) {
      const csvText = decodeTextDataUrl(activeAttachment?.dataUrl);
      if (csvText && csvText.trim()) {
        const trimmedCsv = csvText.trim();
        const csvStartsWithBatchCommand =
          /^\s*(?:batch\s+pay(?:ment)?|payroll|bulk\s+pay|pay\s+multiple|pay\s+everyone)\b/i.test(trimmedCsv);
        csvBatchMessage =
          buildInvoicePromptFromCsv(activeAttachment?.name ?? "", csvText) ??
          buildSchedulePromptFromCsv(activeAttachment?.name ?? "", csvText) ??
          buildSplitPromptFromCsv(activeAttachment?.name ?? "", csvText) ??
          (trimmed
            ? `${trimmed}\n${trimmedCsv}`
            : csvStartsWithBatchCommand
              ? trimmedCsv
              : `batch pay\n${trimmedCsv}`);
      }
    }

    const inferredIntent = quickActionIntentOverride ??
      (csvBatchMessage
      ? inferPromptIntent(csvBatchMessage, selectedTab)
      : activeAttachment
      ? "Vision"
      : inferPromptIntent(effectiveInput, selectedTab));
    const routedTab = promptTabs.includes(inferredIntent as PromptTab)
      ? (inferredIntent as PromptTab)
      : tabForIntent(inferredIntent);

    if (routedTab && routedTab !== selectedTab) {
      setSelectedTab(routedTab);
    }

    const intent: ChatIntent = csvBatchMessage
      ? inferredIntent
      : activeAttachment
      ? "Vision"
      : inferredIntent;
    const normalizedEffectiveInput = normalizePromptForIntent(effectiveInput);
    const promptBridgeSource = detectBridgeSource(effectiveInput);
    const bridgeFundedChainsQuickAction = isBridgeFundedChainsQuickAction({
      prompt: decodedQuickAction.prompt,
      actionId: decodedQuickAction.actionId,
    });
    const useNativeBridgeFlow =
      !activeAttachment &&
      (Boolean(promptBridgeSource) ||
        (intent === "Bridge" &&
          explicitBridgeActionPattern.test(normalizedEffectiveInput) &&
          (!isBridgeInfoPrompt(normalizedEffectiveInput) ||
            isBridgeSourceDiscoveryPrompt(normalizedEffectiveInput))) ||
        bridgeFundedChainsQuickAction);
    const useBrainConversation =
      (!activeAttachment || Boolean(csvBatchMessage)) && !useNativeBridgeFlow;

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
      title: useNativeBridgeFlow
        ? "Bridge"
        : useBrainConversation
          ? "AgentFlow"
          : getAssistantTitle(intent),
      content:
        useNativeBridgeFlow
          ? "Preparing bridge..."
          : useBrainConversation
          ? ""
          : intent === "Conversation"
            ? ""
            : intent === "Vision"
              ? "Preparing attachment analysis..."
              : "Preparing the AgentFlow run...",
      trace:
        useNativeBridgeFlow
          ? []
          : useBrainConversation || intent === "Conversation"
            ? undefined
            : [],
      status: "streaming",
    };

    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setInput("");
    setPendingAttachment(null);
    setVoicePaymentLabel(null);
    setIsStreaming(true);

    if (useNativeBridgeFlow) {
      setPendingBridgeSelection(null);
      const bridgeContext = await resolveBridgeSessionContext(assistantId);
      if (!bridgeContext) {
        return;
      }

      const sourceChain = promptBridgeSource;
      const amount = parseOptionalAmount(effectiveInput);

      if (!sourceChain) {
        try {
          const holdings = await fetchBridgeSourceHoldings(bridgeContext.payerAddress);
          const fundedChains = holdings.filter((entry) => entry.usdcBalanceRaw > BigInt(0));
          const choices = (fundedChains.length ? fundedChains : holdings).map((entry) => ({
            label: entry.label,
            detail: formatBridgeSourceUsdcBalance(entry.usdcBalanceRaw),
            prompt: formatBridgeAmountPrompt(amount, entry.label),
            routeIntent: "Bridge" as const,
            tone: "primary" as const,
          }));

          updateMessage(assistantId, (message) => ({
            ...message,
            content:
              fundedChains.length > 0
                ? amount
                  ? `I found supported source chains where this wallet already holds USDC. Choose one and I will build the ${amount} USDC bridge without making you type the source chain.`
                  : "I found supported source chains where this wallet already holds USDC. Choose one below, then tell me how much USDC you want to bridge."
                : "I did not detect USDC on the currently supported source chains for this wallet. You can still choose a supported chain below if you plan to fund it first.",
            trace: [
              "Bridge source-chain check completed",
              "Circle/Arc bridge flow signs approve and burn on the source chain in your browser wallet",
            ],
            quickActionGroups: choices.length
              ? [
                  {
                    title: fundedChains.length
                      ? "Choose source chain"
                      : "Supported source chains",
                    actions: choices,
                  },
                ]
              : undefined,
            status: "complete",
          }));
        } catch (error) {
          updateMessage(assistantId, (message) => ({
            ...message,
            content:
              "I couldn't read supported source-chain balances right now. Tell me which source chain you want to use, or ask me to try the balance check again.",
            trace: [
              ...(message.trace || []),
              friendlyChatErrorMessage(error, "Bridge source-chain lookup failed."),
            ],
            status: "error",
          }));
        } finally {
          setIsStreaming(false);
        }
        return;
      }

      if (amount == null) {
        setPendingBridgeSelection({
          assistantId,
          sourceChain,
          payerAddress: bridgeContext.payerAddress,
          authHeaders: bridgeContext.authHeaders,
        });
        updateMessage(assistantId, (message) => ({
          ...message,
          content: `Source chain locked to ${BRIDGE_SOURCE_CONFIG[sourceChain].label}. Tell me how much USDC you want to bridge from there to Arc.`,
          trace: [
            `Source chain selected: ${BRIDGE_SOURCE_CONFIG[sourceChain].label}`,
            "Next step needs the USDC amount before preparing the browser-wallet signing flow",
          ],
          status: "complete",
        }));
        setIsStreaming(false);
        return;
      }

      try {
        await prepareBridgeDraftInChat({
          assistantId,
          amount,
          sourceChain,
          bridgeContext,
        });
      } catch (error) {
        updateMessage(assistantId, (message) => ({
          ...message,
          content:
            (error as Error).name === "AbortError"
              ? "Bridge flow was interrupted before any transaction was created."
              : friendlyChatErrorMessage(error, "Bridge flow failed."),
          trace: [...(message.trace || []), "Bridge flow failed"],
          status: "error",
        }));
      } finally {
        setIsStreaming(false);
      }
      return;
    }

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
          rawUserMessage: effectiveInput,
          quickActionContext: decodedQuickAction.prompt
            ? {
                prompt: decodedQuickAction.prompt,
                ...(decodedQuickAction.actionId
                  ? { actionId: decodedQuickAction.actionId }
                  : {}),
              }
            : undefined,
          messages: [...messages, userMessage].map((message) => ({
            role: message.role,
            content: message.content,
          })),
          walletAddress: address,
          executionTarget,
          browserTimeZone:
            typeof Intl !== "undefined"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : undefined,
          browserLocale:
            typeof navigator !== "undefined" ? navigator.language : undefined,
          sessionId,
          signal: controller.signal,
          authHeaders: getAuthHeaders() ?? undefined,
          onMeta: (meta) => {
            if (meta.researchQueued?.jobId) {
              setQueuedResearchJobId(meta.researchQueued.jobId);
            }
            updateMessage(assistantId, (message) => ({
              ...message,
              eventId: meta.eventId ?? message.eventId,
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
              ratingMeta: meta.ratingMeta ?? message.ratingMeta,
              confirmation: meta.confirmation ?? message.confirmation,
              quickActionGroups: meta.quickActionGroups ?? message.quickActionGroups,
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
                reportMeta: {
                  ...(message.reportMeta || {}),
                  ...buildResearchReportMeta(event),
                },
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

        const inferredPendingVaultSelection = inferPendingVaultSelectionFromAssistantReply({
          assistantId,
          content: streamedContent,
          payerAddress: address as `0x${string}` | null | undefined,
          authHeaders: getAuthHeaders(),
        });
        const inferredPendingSwapSelection = inferPendingSwapSelectionFromAssistantReply({
          assistantId,
          content: streamedContent,
          payerAddress: address as `0x${string}` | null | undefined,
          authHeaders: getAuthHeaders(),
        });
        if (inferredPendingSwapSelection) {
          setPendingSwapSelection(inferredPendingSwapSelection);
        }
        if (inferredPendingVaultSelection) {
          setPendingVaultSelection(inferredPendingVaultSelection);
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
                  ? {
                      ...(message.reportMeta || {}),
                      ...buildResearchReportMeta(streamEvent),
                    }
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

    if (intent === "Bridge") {
      setPendingBridgeSelection(null);
      const bridgeContext = await resolveBridgeSessionContext(assistantId);
      if (!bridgeContext) {
        return;
      }

      try {
        const sourceChain = detectBridgeSource(trimmed);
        const amount = parseOptionalAmount(trimmed);
        if (!sourceChain || amount == null) {
          throw new Error("Bridge request needs both an amount and a supported source chain.");
        }
        await prepareBridgeDraftInChat({
          assistantId,
          amount,
          sourceChain,
          bridgeContext,
        });
      } catch (error) {
        updateMessage(assistantId, (message) => ({
          ...message,
          content: friendlyChatErrorMessage(error, "Bridge flow failed."),
          trace: [...(message.trace || []), "Bridge flow failed"],
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
          return {
            ...message,
            content: result.txHash
              ? buildSwapExecutionContent({
                  amountIn,
                  quoteOutRaw: r?.quoteOutRaw,
                  tokenIn: pairIn,
                  tokenOut: pairOut,
                  txHash: result.txHash,
                  explorerLink: r?.explorerLink,
                  approvalTxHash: result.approvalTxHash,
                  approvalExplorerLink: r?.approvalExplorerLink,
                  executionTarget: resolvedExecutionTarget,
                  provider: result.provider ?? null,
                })
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
        const vaultIntent = normalizeVaultIntent(trimmed);
        const action = vaultIntent.action === "list" || vaultIntent.action === "position"
          ? "check_apy"
          : vaultIntent.action;
        const parsedAmount = vaultIntent.amount;
        const selectedVaultSymbol = vaultIntent.vaultSymbol;

        setPendingVaultSelection(null);

        if (vaultIntent.action === "position") {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: "Loading your live vault positions on Arc.",
            trace: ["Vault agent is checking current vault positions"],
            status: "streaming",
          }));

          const positionResult = await runPaidAgent<VaultAgentResponse & AgentRunPaymentResult, Record<string, unknown>>({
            slug: "vault",
            walletClient: activeWalletClient,
            payer: payerAddress,
            authHeaders,
            body: { action: "position", walletAddress: payerAddress, executionTarget: "DCW" },
          });

          updateMessage(assistantId, (message) => ({
            ...message,
            content: positionResult.success
              ? String((positionResult as unknown as { answer?: string; message?: string }).answer || (positionResult as unknown as { message?: string }).message || "Vault positions loaded.")
              : positionResult.error || "I couldn't load your vault positions.",
            paymentMeta: buildPaymentMetaFromResult("vault", positionResult, payerAddress),
            status: "complete",
          }));
          return;
        }

        if ((action === "deposit" || action === "withdraw") && selectedVaultSymbol && parsedAmount == null) {
          setPendingVaultSelection({
            assistantId,
            action: action as "deposit" | "withdraw",
            vaultSymbol: selectedVaultSymbol,
            amount: null,
            payerAddress,
            authHeaders,
          });

          updateMessage(assistantId, (message) => ({
            ...message,
            content:
              `Vault selected: ${vaultLabel(selectedVaultSymbol)}.\n\n` +
              `Tell me how much ${vaultAssetSymbol(selectedVaultSymbol)} you want to ${action === "deposit" ? "deposit" : "withdraw"}.`,
            quickActionGroups: [
              {
                title: vaultLabel(selectedVaultSymbol),
                actions: [
                  {
                    label: `1 ${vaultAssetSymbol(selectedVaultSymbol)}`,
                    prompt: `${action} 1 ${vaultAssetSymbol(selectedVaultSymbol)} ${action === "deposit" ? "to" : "from"} ${selectedVaultSymbol}`,
                  },
                  {
                    label: `10 ${vaultAssetSymbol(selectedVaultSymbol)}`,
                    prompt: `${action} 10 ${vaultAssetSymbol(selectedVaultSymbol)} ${action === "deposit" ? "to" : "from"} ${selectedVaultSymbol}`,
                  },
                  {
                    label: `100 ${vaultAssetSymbol(selectedVaultSymbol)}`,
                    prompt: `${action} 100 ${vaultAssetSymbol(selectedVaultSymbol)} ${action === "deposit" ? "to" : "from"} ${selectedVaultSymbol}`,
                  },
                ],
              },
            ],
            trace: [
              `Vault selected: ${vaultLabel(selectedVaultSymbol)}`,
              `Next step needs the ${vaultAssetSymbol(selectedVaultSymbol)} amount`,
            ],
            status: "complete",
          }));
          return;
        }

        if (
          (vaultIntent.action === "list" ||
            ((action === "deposit" || action === "withdraw") ||
              (action === "check_apy" && parsedAmount == null))) &&
          !selectedVaultSymbol
        ) {
          updateMessage(assistantId, (message) => ({
            ...message,
            content: "Loading live vault options on Arc.",
            trace: ["Vault agent is fetching live vault options and APY"],
            status: "streaming",
          }));

          const vaultList = await runPaidAgent<VaultAgentResponse & AgentRunPaymentResult, Record<string, unknown>>({
            slug: "vault",
            walletClient: activeWalletClient,
            payer: payerAddress,
            authHeaders,
            body: { action: "list", walletAddress: payerAddress, executionTarget: "DCW" },
          });

          updateMessage(assistantId, (message) => ({
            ...message,
            content: buildVaultListContent(Array.isArray(vaultList.vaults) ? vaultList.vaults : []),
            quickActionGroups: [
              {
                title:
                  (action === "deposit" || action === "withdraw") && parsedAmount != null
                    ? `Choose vault for ${action} ${parsedAmount}`
                    : "Choose vault",
                actions: [
                  {
                    label: "Lunex USDC Vault",
                    prompt:
                      (action === "deposit" || action === "withdraw") && parsedAmount != null
                        ? `${action} ${parsedAmount} USDC ${action === "deposit" ? "to" : "from"} luneUSDC`
                        : "use luneUSDC vault",
                  },
                  {
                    label: "Lunex EURC Vault",
                    prompt:
                      (action === "deposit" || action === "withdraw") && parsedAmount != null
                        ? `${action} ${parsedAmount} EURC ${action === "deposit" ? "to" : "from"} luneEURC`
                        : "use luneEURC vault",
                  },
                  {
                    label: "My positions",
                    prompt: "show my vault positions",
                    actionId: "vault.position",
                    tone: "secondary",
                  },
                ],
              },
            ],
            trace: [
              "Vault options loaded",
              (action === "deposit" || action === "withdraw") && parsedAmount != null
                ? `Amount understood: ${parsedAmount}. Choose the vault next.`
                : "Choose a vault first, then AgentFlow will ask for amount",
            ],
            status: "complete",
          }));
          return;
        }

        if (action === "deposit" || action === "withdraw") {
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
              : `Running vault ${action} for ${amount} USDC.`,
          trace: [
            action === "check_apy"
              ? "Vault agent reading APY from chain"
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
              : {
                  action,
                  amount,
                  walletAddress: payerAddress,
                  executionTarget,
                  ...(selectedVaultSymbol ? { vaultSymbol: selectedVaultSymbol, amountTokenHint: vaultAssetSymbol(selectedVaultSymbol) } : {}),
                },
        });

        if (!result.success) {
          throw new Error(result.error || "Vault agent failed");
        }

        updateMessage(assistantId, (message) => ({
          ...message,
          content:
            action === "check_apy"
              ? `## AgentFlow Vault APY\n\n- **Current APY:** ${typeof result.apy === "number" ? `${result.apy.toFixed(2)}%` : "Unavailable"}`
              : result.txHash
                ? buildVaultExecutionContent({
                    action: action as "deposit" | "withdraw",
                    txHash: result.txHash,
                    explorerLink: result.receipt?.explorerLink,
                    approvalTxHash: result.approvalTxHash,
                    approvalExplorerLink: result.receipt?.approvalExplorerLink,
                    provider: result.provider || null,
                    vaultSymbol: result.vaultSymbol || null,
                    sharesReceivedFormatted: result.sharesReceivedFormatted || null,
                    sharesBurnedFormatted: result.sharesBurnedFormatted || null,
                    assetsReceivedFormatted: result.assetsReceivedFormatted || null,
                  })
                : `Vault ${action} completed.`,
          trace: [
            ...(message.trace || []),
            action === "check_apy"
              ? "Vault APY read complete"
              : result.txHash
                ? `Vault ${action} verified - ${result.txHash.slice(0, 10)}...`
                : `Vault ${action} complete`,
          ],
          paymentMeta: buildPaymentMetaFromResult("vault", result, payerAddress),
          status: "complete",
        }));
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
                signInError={signInError}
              />
            </>
          }
        />

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <section className="flex min-h-0 min-w-0 flex-1 justify-center overflow-x-hidden overflow-y-visible bg-[#080808]">
            <div className="flex min-h-0 w-full max-w-6xl flex-1 px-6 xl:px-10">
            {hasConversation ? (
              <div className="flex min-h-0 min-w-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ChatThread
                  messages={messages}
                  onFeedback={handleAssistantFeedback}
                  onRateAgent={handleAgentRating}
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
              <div className="flex min-h-0 min-w-0 flex-1 overflow-visible">
                <div className="mx-auto flex h-full w-full max-w-[1064px] flex-col justify-start px-6 pb-8 pt-[clamp(11.25rem,26vh,14rem)] xl:px-10">
                  <div className="overflow-visible pt-2 pb-5 text-center">
                    <h1 className="inline-block pb-[0.2em] font-headline text-[clamp(2.6rem,4.35vw,4.05rem)] font-black leading-[1.22] tracking-tight text-white [text-shadow:0_1px_0_rgba(255,255,255,0.14),0_6px_0_rgba(0,0,0,0.16),0_14px_24px_rgba(0,0,0,0.42)]">
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
    <>
      <style jsx global>{`
        @keyframes starterBubbleCloud {
          0% {
            opacity: 0;
            transform: translateY(-10px) scale(0.96);
            filter: blur(8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes starterChipPop {
          0% {
            opacity: 0;
            transform: translateY(-14px) scale(0.72);
            filter: blur(10px);
          }
          58% {
            opacity: 1;
            transform: translateY(2px) scale(1.06);
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }
      `}</style>
      <Suspense fallback={<main className="h-screen bg-[#080808] text-white/90" />}>
        <ChatPageInner />
      </Suspense>
    </>
  );
}
