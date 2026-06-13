import './lib/loadEnv';
import express, { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getAddress, isAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  BatchFacilitatorClient,
  createGatewayMiddleware,
  isBatchPayment,
} from '@circlefin/x402-batching/server';
import {
  callHermesFast,
} from './lib/hermes';
import { resolveReportLanguage } from './lib/reportLanguage';
import { translateReportMarkdown } from './lib/reportTranslate';
import {
  buildBrainConfirmationMeta,
  buildBrainMetaFromToolResults,
  runAgentBrain,
  type BrainMessageMeta,
} from './lib/agent-brain';
import {
  answerModeRequiresFinancialContext,
  buildFinancialAdvisoryScopeReply,
  classifyAnswerMode,
  isFinancialAdvisoryScopeMessage,
} from './lib/answer-mode';
import {
  classifyIntent,
  IntentRouterParseError,
  IntentRouterRequestError,
  IntentRouterSchemaError,
  IntentRouterTimeoutError,
} from './lib/intent-router';
import { dispatchIntent } from './lib/intent-router/dispatcher';
import { AgentFlowDomain, AgentFlowIntentName, type AgentFlowIntent } from './lib/intent-router/types';
import { validateIntent, type ValidationResult } from './lib/intent-router/validator';
import {
  logBrainEvent,
  updateBrainEvent,
  type BrainEventOutcome,
  type BrainToolTelemetry,
} from './lib/brain-telemetry';
import {
  appendRecentExecutionEntries,
  clearPendingAction,
  executeTool,
  loadPendingAction,
  takeRecentExecutionMeta,
} from './lib/tool-executor';
import { detectForecastingIntent, fetchLiveData, shouldGatherCurrentEvents } from './lib/live-data';
import { detectPortfolioImpactIntent, stripPortfolioImpactPhrasing } from './lib/portfolio-impact-intent';
import { classifyPortfolioRequestMode } from './lib/portfolio-request-intent';
import { extractAgentpayRemark } from './lib/agentpay-remark';
import { generateInvoiceNumber } from './lib/invoice-number';
import {
  isAmbiguousPredictionMarketIntent,
  isPredictionMarketBrowseIntent,
  looksLikePredictionMarketResearch,
} from './lib/prediction-market-intent';
import { isSwapExecutionIntent, looksLikeSwapResearch } from './lib/swap-intent';
import { isVaultDiscoveryIntent } from './lib/vault-discovery-intent';
import { isBridgeExecutionIntent, looksLikeBridgeResearch } from './lib/bridge-intent';
import { analyzeCapabilityAwareRouting } from './lib/capability-aware-routing';
import { detectProtocolQueryShape } from './lib/protocol-query-shape';
import { inferResearchReasoningMode } from './lib/researchMode';
import { isCreatorAudienceMetricTask } from './lib/source-policy';
import { isExplicitResearchRequest } from './lib/research-request-intent';
import { hasExplicitResearchReportRequest } from './lib/research-routing-precedence';
import {
  beginResearchPipelineRun,
  enqueueResearch,
  endResearchPipelineRun,
  getJobStatus,
  getQueueStats,
  processResearchQueue,
  releaseResearchSlot,
  tryAcquireResearchSlot,
} from './lib/research-queue';
import {
  createUserWallet,
  findCircleWalletForUser,
  getCircleWalletForUser,
  getOrCreateCircleWalletForUser,
  getOrCreateWalletSetId,
} from './lib/circleWallet';
import {
  ANALYST_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  WRITER_SYSTEM_PROMPT,
} from './lib/agentPrompts';
import {
  CHAT_SYSTEM_PROMPT,
  buildCurrentDateContext,
  buildWalletProfileLlmContext,
} from './lib/chatPersona';
import {
  buildSemanticMemoryContext,
  rememberSemanticMemory,
} from './lib/semantic-memory';
import { buildSemanticContinuationContext } from './lib/semantic-continuation';
import {
  buildAnalystModelInput,
  buildWriterModelInput,
} from './lib/reportInputs';
import { finalizeReportMarkdown } from './lib/reportPipeline';
import { setWalletForUser } from './lib/walletStore';
import { payProtectedResourceServer } from './lib/x402ServerClient';
import { insertAgentToAgentLedger } from './lib/a2a-ledger';
import { buildSemanticMemoryMetricsReport } from './lib/semantic-memory-metrics';
import {
  buildSemanticMemoryReviewCases,
  buildSemanticMemoryReviewDataset,
  saveSemanticMemoryReviewLabel,
} from './lib/semantic-memory-review';
import {
  buildConversationReviewCases,
  buildConversationReviewDataset,
  saveConversationReviewLabel,
} from './lib/conversation-review';
import { loadChatFeedbackEntries } from './lib/chat-feedback-review';
import { getFacilitatorBaseUrl } from './lib/facilitator-url';
import { scheduleChatToolPostA2a } from './lib/a2a-chat-scheduler';
import { runInvoiceVendorResearchFollowup, runPortfolioFollowupAfterToolWithPayment } from './lib/a2a-followups';
import {
  X402InflightConflictError,
  acquireX402InflightLock,
  readX402AttemptRecord,
  releaseX402InflightLock,
  writeX402AttemptRecord,
  type X402AttemptMode,
  type X402AttemptStage,
} from './lib/x402AttemptLedger';
import { sendGAEvent } from './lib/gaServer';
import { detectWalletIntent } from './lib/orchestrator';
import authApiRouter from './api/auth';
import walletApiRouter from './api/wallet';
import extensionApiRouter from './api/extension';
import businessApiRouter from './api/business';
import payApiRouter, { fetchPayHistoryForBrain } from './api/pay';
import agentStoreApiRouter, { CORE_AGENT_SPECS } from './api/agent-store';
import agentRatingsApiRouter from './api/agent-ratings';
import agentEconomyLedgerApiRouter from './api/agent-economy-ledger';
import portfolioApiRouter from './api/portfolio';
import settingsApiRouter from './api/settings';
import telegramApiRouter from './api/telegram';
import emailWebhookRouter from './api/webhooks/email';
import { authMiddleware, generateJWT, verifyJWT, type JWTPayload } from './lib/auth';
import { getOrCreateUserAgentWallet } from './lib/dcw';
import { loadAgentOwnerWallet } from './lib/agent-owner-wallet';
import { readDailyUsageCap } from './lib/usageCaps';
import { adminDb, getRedis } from './db/client';
import { resolvePayee } from './lib/agentpay-payee';
import { getPreferredAgentpayPaymentLinkHandle } from './lib/agentpay-registry';
import { getTxStats, incrementTxCount } from './lib/tx-counter';
import { getTreasuryStats, runTreasuryTopUp } from './lib/agent-treasury';
import {
  assessCounterpartyRisk,
  formatCounterpartyRiskReport,
  type CounterpartyRiskAssessment,
} from './lib/counterparty-risk';
import {
  buildCapabilityThreadContext,
  hasProductRoutingBypassSignals,
  isNoiseOnlyChatProbe,
  resolveCapabilityRoutingProbe,
  shouldHandleAsAgentFlowCapabilityQuestion,
  type CapabilityThreadContext,
} from './lib/chatRouting';
import {
  formatAgentFlowCapabilityReply as formatSharedAgentFlowCapabilityReply,
  formatAgentFlowDefinitionReply as formatSharedAgentFlowDefinitionReply,
  formatAgentFlowHowItWorksReply as formatSharedAgentFlowHowItWorksReply,
  isExplicitFullCapabilityRequest,
} from './lib/agentflowProduct';
import { answerProductQuestion, PRODUCT_KNOWLEDGE } from './lib/product-rag';
import { VISION_DAILY_LIMIT_DEFAULT, TRANSCRIBE_DAILY_LIMIT_DEFAULT } from './lib/usageLimits';
import { searchRag } from './lib/rag/search';
import {
  canonicalRedisSessionId,
  clearPendingRedisKeys,
  getFirstPendingRedisValue,
  redisPendingExists,
} from './lib/chatSessionRedis';
import {
  parseBatchPaymentsFromMessage,
  parseCSVBatch,
  type BatchPaymentRow,
} from './lib/csv-batch-parser';
import {
  ensureUserPaidAgentLedger,
  executeDcwPaidAgentViaX402,
  executeUserPaidAgentViaX402,
} from './lib/paidAgentX402';
import {
  checkHttpHealth,
  deriveHealthUrlFromRunUrl,
  resolveFacilitatorHealthUrl,
} from './lib/x402Health';
import { AGENT_DEFAULT_PORTS, isAgentHealthy } from './lib/a2a-health';
import {
  formatPaidPortfolioAgentChatBody,
  formatPortfolioSnapshotRecordsForChat,
} from './lib/format-portfolio-chat';
import {
  getMarketDetail as getPredmarketDetail,
  listAllMarkets as listPredmarketMarkets,
} from './lib/predmarket/router';
import {
  BRIDGE_SOURCE_DOMAIN,
  parseSupportedBridgeSourceChain as detectSupportedBridgeSourceChain,
  SUPPORTED_BRIDGE_SOURCES as SUPPORTED_BRIDGE_SOURCE_SUMMARY,
} from './lib/bridge/supportedSources';
type OrchestratorStep = 'research' | 'analyst' | 'writer';

type ProxyEvent =
  | { type: 'proxy_start'; step: OrchestratorStep }
  | {
      type: 'payment_required';
      step: OrchestratorStep;
      paymentRequiredHeader: string;
    }
  | {
      type: 'proxy_response';
      step: OrchestratorStep;
      status: number;
      transaction?: string;
      data: unknown;
    }
  | { type: 'error'; message: string; step?: OrchestratorStep; status?: number };

type PipelineTimingTracePoint = {
  label: string;
  at_ms: number;
  delta_ms: number;
  meta?: Record<string, unknown>;
};

type DcwPaidAgentSlug = 'swap' | 'vault' | 'portfolio' | 'vision' | 'transcribe';


function listSupportedBridgeSourcesDetailed() {
  return SUPPORTED_BRIDGE_SOURCE_SUMMARY.map((source) => ({
    ...source,
    domain: BRIDGE_SOURCE_DOMAIN[source.key],
  }));
}

function listSupportedBridgeSourceLabels(): string {
  return listSupportedBridgeSourcesDetailed().map((source) => source.label).join(', ');
}

function formatBridgeExecutionReply(): string {
  return [
    'Bridge to Arc starts from your connected wallet on the source chain.',
    '',
    'Pick a supported source chain, review the bridge, approve USDC if needed, and sign the source-chain transaction from that wallet.',
    'After that, AgentFlow completes the Arc receive step and delivers USDC into your AgentFlow wallet on Arc.',
  ].join('\n');
}

function buildBridgeChoiceQuickActionGroups() {
  return [
    {
      title: 'Bridge to Arc',
      actions: [
        {
          label: 'Show my funded chains',
          prompt: 'show the supported source chains where this wallet already has USDC and gas for bridge',
          actionId: 'bridge.funded_chains',
        },
      ],
    },
  ];
}

function formatBridgeOverviewReply(): string {
  return [
    'Bridge to Arc moves USDC from a supported source chain into your AgentFlow wallet on Arc.',
    '',
    'The important choice is the source chain: use a supported chain where your connected wallet already has USDC and enough gas to sign the source-chain transaction.',
    '',
    'If you want, I can show the supported chains where this wallet already has USDC so you can pick one quickly.',
  ].join('\n');
}

function formatBridgeSourcesReply(): string {
  return [
    `Supported bridge source chains: ${listSupportedBridgeSourceLabels()}.`,
    '',
    'The best source is usually the supported chain where your connected wallet already has USDC and enough native gas.',
    'If you want, I can also show the supported chains where this wallet already has USDC so you can choose faster.',
  ].join('\n');
}

function isBridgeSpecificChainSelectionPrompt(message: string): boolean {
  return /\b(?:i\s+(?:already\s+)?have|use|pick|choose)\s+(?:a\s+)?(?:specific\s+)?source\s+chain\b/i.test(
    message,
  );
}

function formatSwapOverviewReply(): string {
  return [
    'AgentFlow can quote and swap between USDC and EURC on Arc.',
    '',
    'The normal flow is: get a live quote, review it, then reply YES to execute.',
    'Say "swap 1 USDC to EURC" to get a live quote, or "swap 1 EURC to USDC" for the reverse direction.',
  ].join('\n');
}

function formatVaultOverviewReply(): string {
  return [
    'AgentFlow currently supports these integrated vault options on Arc:',
    '- Lunex USDC Vault',
    '- Lunex EURC Vault',
    '',
    'Choose one below and I can help you deposit, or ask for your vault positions if you already have funds there.',
  ].join('\n');
}

function getAgentFlowCircleStackSummary(): string {
  const supported = listSupportedBridgeSourcesDetailed()
    .map((source) => `- ${source.label} (${source.key}, CCTP domain ${source.domain})`)
    .join('\n');

  return [
    'AgentFlow current Circle stack:',
    '',
    '- AgentPay for send/request/split/batch/schedule flows.',
    '- Arc execution wallets and Gateway balance tracking.',
    '- Swap, provider vault, and prediction market flows executed from user AgentFlow wallets.',
    '- Native Circle bridge flow with user-EOA signing on the source chain and forwarding into the AgentFlow wallet on Arc.',
    '',
    'Supported bridge source chains:',
    supported,
  ].join('\n');
}

const NETWORK_NAME = 'Arc Testnet';
const CHAIN_ID = 5042002;
const RESEARCH_TIMING_TRACE = /^(1|true|yes|on)$/i.test(
  String(process.env.RESEARCH_TIMING_TRACE || '').trim(),
);
const isFeatureEnabled = (name: string): boolean =>
  /^(1|true|yes|on)$/i.test(String(process.env[name] ?? '').trim());
const ARC_TESTNET_DOMAIN = Number(process.env.GATEWAY_DOMAIN || 26);
const GATEWAY_API_BASE_URL =
  process.env.GATEWAY_API_BASE_URL || 'https://gateway-api-testnet.circle.com/v1';
const MIN_GATEWAY_BALANCE = 1;

const FACILITATOR_PORT = Number(process.env.FACILITATOR_PORT || 3000);
const RESEARCH_PORT = Number(process.env.RESEARCH_AGENT_PORT || 3001);
const ANALYST_PORT = Number(process.env.ANALYST_AGENT_PORT || 3002);
const WRITER_PORT = Number(process.env.WRITER_AGENT_PORT || 3003);
const VISION_PORT = Number(process.env.VISION_AGENT_PORT || 3016);
const TRANSCRIBE_PORT = Number(process.env.TRANSCRIBE_AGENT_PORT || 3017);
const PUBLIC_PORT = Number(process.env.PORT || 4000);

/** Split deploy (e.g. Railway): set FACILITATOR_URL or FACILITATOR_PORT; must match agents — see lib/facilitator-url.ts */
const FACILITATOR_URL = getFacilitatorBaseUrl();
const RESEARCH_URL = resolveAgentRunUrl(
  process.env.RESEARCH_AGENT_URL?.trim(),
  `http://127.0.0.1:${RESEARCH_PORT}/run`,
);
const ANALYST_URL = resolveAgentRunUrl(
  process.env.ANALYST_AGENT_URL?.trim(),
  `http://127.0.0.1:${ANALYST_PORT}/run`,
);
const WRITER_URL = resolveAgentRunUrl(
  process.env.WRITER_AGENT_URL?.trim(),
  `http://127.0.0.1:${WRITER_PORT}/run`,
);
const SWAP_URL = resolveAgentRunUrl(
  process.env.SWAP_AGENT_URL?.trim(),
  'http://127.0.0.1:3011/run',
);
const VAULT_URL = resolveAgentRunUrl(
  process.env.VAULT_AGENT_URL?.trim(),
  'http://127.0.0.1:3012/run',
);
const BRIDGE_URL = resolveAgentRunUrl(
  process.env.BRIDGE_AGENT_URL?.trim(),
  'http://127.0.0.1:3021/run',
);
const PORTFOLIO_URL = resolveAgentRunUrl(
  process.env.PORTFOLIO_AGENT_URL?.trim(),
  'http://127.0.0.1:3014/run',
);
const VISION_URL = resolveAgentRunUrl(
  process.env.VISION_AGENT_URL?.trim(),
  `http://127.0.0.1:${VISION_PORT}/run`,
);
const TRANSCRIBE_URL = resolveAgentRunUrl(
  process.env.TRANSCRIBE_AGENT_URL?.trim(),
  `http://127.0.0.1:${TRANSCRIBE_PORT}/run`,
);
const SCHEDULE_PORT = Number(process.env.SCHEDULE_AGENT_PORT || 3018);
const SCHEDULE_AGENT_BASE_URL =
  process.env.SCHEDULE_AGENT_URL?.trim() || `http://127.0.0.1:${SCHEDULE_PORT}`;
const SPLIT_PORT = Number(process.env.SPLIT_AGENT_PORT || 3019);
const SPLIT_AGENT_BASE_URL =
  process.env.SPLIT_AGENT_URL?.trim() || `http://127.0.0.1:${SPLIT_PORT}`;
const BATCH_PORT = Number(process.env.BATCH_AGENT_PORT || 3020);
const BATCH_AGENT_BASE_URL =
  process.env.BATCH_AGENT_URL?.trim() || `http://127.0.0.1:${BATCH_PORT}`;
const INTENT_ROUTER_ENABLED = /^true$/i.test(process.env.INTENT_ROUTER_ENABLED || '');
const FASTPATH_EXECUTION_CONFIDENCE = Number.parseFloat(
  process.env.FASTPATH_EXECUTION_CONFIDENCE || '0.86',
);
const FASTPATH_EXECUTION_POLICY = {
  contacts: {
    [AgentFlowIntentName.ContactsList]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_CONTACTS_LIST || '0.8',
    ),
    [AgentFlowIntentName.ContactsCreate]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_CONTACTS_CREATE || '0.84',
    ),
    [AgentFlowIntentName.ContactsUpdate]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_CONTACTS_UPDATE || '0.88',
    ),
    [AgentFlowIntentName.ContactsDelete]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_CONTACTS_DELETE || '0.9',
    ),
  },
  schedule: {
    [AgentFlowIntentName.ScheduleCreate]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_SCHEDULE_CREATE || '0.9',
    ),
    [AgentFlowIntentName.ScheduleCancel]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_SCHEDULE_CANCEL || '0.9',
    ),
    [AgentFlowIntentName.ScheduleList]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_SCHEDULE_LIST || '0.84',
    ),
  },
  agentpay: {
    [AgentFlowIntentName.AgentpayHistory]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_AGENTPAY_HISTORY || '0.8',
    ),
    [AgentFlowIntentName.AgentpayPaymentLink]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_PAYMENT_LINK || '0.88',
    ),
  },
  execution: {
    [AgentFlowIntentName.BatchExecute]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_BATCH_EXECUTE || '0.92',
    ),
    [AgentFlowIntentName.SplitExecute]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_SPLIT_EXECUTE || '0.92',
    ),
  },
  invoices: {
    [AgentFlowIntentName.InvoiceCreate]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_INVOICE_CREATE || '0.9',
    ),
    [AgentFlowIntentName.InvoiceStatus]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_INVOICE_STATUS || '0.84',
    ),
  },
  research: {
    [AgentFlowIntentName.ResearchReport]: Number.parseFloat(
      process.env.FASTPATH_CONFIDENCE_RESEARCH_REPORT || '0.93',
    ),
  },
} as const;
const FASTPATH_EXECUTION_CONFIDENCE_BY_INTENT: Partial<Record<AgentFlowIntentName, number>> = {
  ...FASTPATH_EXECUTION_POLICY.contacts,
  ...FASTPATH_EXECUTION_POLICY.schedule,
  ...FASTPATH_EXECUTION_POLICY.agentpay,
  ...FASTPATH_EXECUTION_POLICY.execution,
  ...FASTPATH_EXECUTION_POLICY.invoices,
  ...FASTPATH_EXECUTION_POLICY.research,
};
const STRICT_ROUTER_APPROVAL_INTENTS = new Set<AgentFlowIntentName>([
  AgentFlowIntentName.ContactsList,
  AgentFlowIntentName.ContactsCreate,
  AgentFlowIntentName.ContactsUpdate,
  AgentFlowIntentName.ContactsDelete,
  AgentFlowIntentName.ScheduleCreate,
  AgentFlowIntentName.ScheduleCancel,
  AgentFlowIntentName.ScheduleList,
  AgentFlowIntentName.AgentpayHistory,
  AgentFlowIntentName.AgentpayPaymentLink,
  AgentFlowIntentName.BatchExecute,
  AgentFlowIntentName.SplitExecute,
  AgentFlowIntentName.InvoiceCreate,
  AgentFlowIntentName.InvoiceStatus,
  AgentFlowIntentName.ResearchReport,
]);

function getFastpathExecutionConfidenceThreshold(intent: AgentFlowIntentName): number {
  const threshold = FASTPATH_EXECUTION_CONFIDENCE_BY_INTENT[intent];
  return Number.isFinite(threshold) ? Number(threshold) : FASTPATH_EXECUTION_CONFIDENCE;
}
const INVOICE_PORT = Number(process.env.INVOICE_AGENT_PORT || 3015);
const INVOICE_AGENT_BASE_URL =
  process.env.INVOICE_AGENT_URL?.trim() || `http://127.0.0.1:${INVOICE_PORT}`;

/**
 * Accepts either a valid JWT Bearer token OR the Hermes brain internal key.
 * When called from Hermes (Python), there is no JWT — only the internal-key header.
 * walletAddress is taken from req.body.walletAddress in that case.
 */
function internalOrAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const sentKey = (req.headers['x-agentflow-brain-internal'] as string | undefined)?.trim();
  if (internalKey && sentKey === internalKey) {
    const walletAddress = String(req.body?.walletAddress ?? '').trim();
    (req as any).auth = {
      walletAddress,
      accessModel: 'pay_per_task',
      exp: 0,
    } satisfies JWTPayload;
    next();
    return;
  }
  authMiddleware(req, res, next);
}

function parseInternalAdminWallets(): Set<string> {
  return new Set(
    String(process.env.INTERNAL_ADMIN_WALLETS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isLoopbackAddress(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim();
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1' ||
    normalized === 'localhost'
  );
}

function isLocalAdminBypassAllowed(req: Request): boolean {
  if (!/^true$/i.test(String(process.env.INTERNAL_ADMIN_BYPASS_LOCAL ?? '').trim())) {
    return false;
  }

  const forwardedFor = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const remoteIp = req.ip || req.socket.remoteAddress || '';

  return [remoteIp, ...forwardedFor].every((value) => isLoopbackAddress(value));
}

function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isLocalAdminBypassAllowed(req)) {
    next();
    return;
  }

  authMiddleware(req, res, () => {
    const auth = (req as any).auth as JWTPayload | undefined;
    const walletAddress = auth?.walletAddress?.trim().toLowerCase();
    const allowlist = parseInternalAdminWallets();
    if (!walletAddress || !allowlist.size || !allowlist.has(walletAddress)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}

const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 80_000);
const RESEARCH_AGENT_TIMEOUT_MS = Number(
  process.env.RESEARCH_AGENT_TIMEOUT_MS || 140_000,
);
const ANALYST_AGENT_TIMEOUT_MS = Number(
  process.env.ANALYST_AGENT_TIMEOUT_MS || AGENT_TIMEOUT_MS,
);
const WRITER_AGENT_TIMEOUT_MS = Number(
  process.env.WRITER_AGENT_TIMEOUT_MS || AGENT_TIMEOUT_MS,
);
const LIVE_DATA_TIMEOUT_MS_DEFAULT = Number(process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS || 45_000);
const LIVE_DATA_TIMEOUT_MS_FORECASTING = Number(
  process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS_FORECASTING || 120_000,
);
const LIVE_DATA_TIMEOUT_MS_NICHE_PROTOCOL = Number(
  process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS_NICHE_PROTOCOL || 90_000,
);
const LIVE_DATA_TIMEOUT_MS_CREATOR_AUDIENCE = Number(
  process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS_CREATOR_AUDIENCE || 90_000,
);
const LIVE_DATA_TIMEOUT_MS_CURRENT_EVENTS = Number(
  process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS_CURRENT_EVENTS || 60_000,
);
const SSE_HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS || 15_000);
const AGENT_JSON_LIMIT = process.env.AGENT_JSON_LIMIT?.trim() || '20mb';

const SYSTEM_PROMPTS = {
  research: `You are a research agent. Given a topic, find and summarize key facts, recent developments, and relevant data. Be thorough and factual. Return structured JSON. When the user message includes LIVE DATA, use it for current figures. Do not use training data for prices or recent events when live data is provided. CRITICAL: Never start any line with >. Never use blockquote formatting. Write in clean plain paragraphs.`,
  analyst: `You are an analyst agent. Given raw research data, extract key insights, identify patterns, and provide analytical conclusions. Return structured JSON. Do NOT start any line or sentence with the > symbol. Do NOT use blockquote formatting. Write in clean plain paragraphs.`,
  writer: `You are a writer agent. Given research and analysis, write a clear, well-structured report. Use markdown formatting. Make it professional and readable. CRITICAL FORMATTING RULES: Never use > at the start of any line. Never use blockquote markdown. Write every sentence as plain paragraph text or bullet points with - only. If you use > anywhere it will break the output. Structure the report exactly as follows: # [Topic] — Research Report; **Prepared by:** AgentFlow AI; ---; ## Executive Summary (2-3 sentence overview); ## Key Facts (clean bullet points); ## Recent Developments (paragraphs, no >); ## Data & Statistics (markdown table where appropriate); ## Analysis (analytical conclusions from analyst agent); ## Conclusion (final summary); ---; Then add exactly one blockquote at the very end: > ⚠️ Disclaimer: This report was generated by AI. Financial figures and statistics may be based on training data and not reflect current values. Always verify with live sources such as CoinMarketCap, CoinGecko, Bloomberg, or Reuters.`,
};

const pendingEmergencyWithdrawConfirmations = new Map<string, number>();

const researchPrice = parsePrice(process.env.RESEARCH_AGENT_PRICE, '0.005');
const analystPrice = parsePrice(process.env.ANALYST_AGENT_PRICE, '0.003');
const writerPrice = parsePrice(process.env.WRITER_AGENT_PRICE, '0.008');
const portfolioPrice = parsePrice(process.env.PORTFOLIO_AGENT_PRICE, '0.015');
const swapPrice = parsePrice(process.env.SWAP_AGENT_PRICE, '0.010');
const vaultPrice = parsePrice(process.env.VAULT_AGENT_PRICE, '0.012');
const invoicePrice = parsePrice(process.env.INVOICE_AGENT_PRICE, '0.025');
const schedulePrice = parsePrice(process.env.SCHEDULE_AGENT_PRICE, '0.005');
const splitPrice = parsePrice(process.env.SPLIT_AGENT_PRICE, '0.005');
const batchPrice = parsePrice(process.env.BATCH_AGENT_PRICE, '0.010');

const sellerAddress = resolveSellerAddress();

function parsePrice(input: string | undefined, fallback: string): string {
  return `$${(Number(input || fallback) || Number(fallback)).toFixed(3)}`;
}

/** Non-blocking vendor research after chat-created invoice (HTTP confirm or chat YES). */
function scheduleChatInvoiceResearchFollowup(pending: {
  vendorHandle: string;
  amount: string;
  issuerWalletAddress?: string;
}): void {
  const vendor = pending.vendorHandle?.trim();
  const amt = parseFloat(pending.amount);
  if (!vendor || !Number.isFinite(amt) || amt <= 10) {
    if (vendor && Number.isFinite(amt) && amt <= 10) {
      console.log('[a2a] invoice→research skipped (amount <= 10 USDC gate)', { vendor, amt });
    }
    return;
  }
  console.log('[a2a] invoice→research follow-up scheduled (chat path)', { vendor, amt });
  setImmediate(() => {
    void (async () => {
      try {
        await runInvoiceVendorResearchFollowup({
          vendor,
          amount: amt,
          issuerWalletAddress: pending.issuerWalletAddress,
          researchRunUrl: RESEARCH_URL,
          researchPriceLabel: researchPrice,
        });
        console.log('[a2a] invoice→research follow-up finished (chat path)');
      } catch (e) {
        console.warn('[a2a] invoice→research failed:', e instanceof Error ? e.message : e);
      }
    })();
  });
}

function usdAmountFromPriceLabel(price: string): number {
  return Number(price.replace(/^\$/, '').trim()) || 0;
}

function parseAmount(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}


function resolveAgentRunUrl(configured: string | undefined, fallback: string): string {
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

function resolveSellerAddress(): Address {
  const configured = process.env.SELLER_ADDRESS?.trim();
  if (configured) {
    if (!isAddress(configured)) {
      throw new Error('SELLER_ADDRESS is configured but invalid.');
    }
    return getAddress(configured);
  }

  const privateKey =
    process.env.PRIVATE_KEY?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (privateKey) {
    const normalized = (privateKey.startsWith('0x')
      ? privateKey
      : `0x${privateKey}`) as `0x${string}`;
    const account = privateKeyToAccount(normalized);
    const src = process.env.PRIVATE_KEY?.trim() ? 'PRIVATE_KEY' : 'DEPLOYER_PRIVATE_KEY';
    console.warn(
      `[Boot] SELLER_ADDRESS is not set. Falling back to address derived from ${src} (${account.address}) for seller pay-to only.`,
    );
    return account.address;
  }

  throw new Error(
    'SELLER_ADDRESS is required when neither PRIVATE_KEY nor DEPLOYER_PRIVATE_KEY is set. Backend no longer signs buyer payments.',
  );
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function pushPipelineTimingTrace(
  trace: PipelineTimingTracePoint[],
  traceStart: number,
  label: string,
  meta?: Record<string, unknown>,
): void {
  if (!RESEARCH_TIMING_TRACE) return;
  const atMs = Date.now() - traceStart;
  const prev = trace[trace.length - 1];
  trace.push({
    label,
    at_ms: atMs,
    delta_ms: prev ? atMs - prev.at_ms : atMs,
    ...(meta ? { meta } : {}),
  });
}

type ParseOutcome = 'success_without_unwrapping' | 'success_after_unwrapping' | 'failed';

function safeParseObject(value: string): Record<string, unknown> | null {
  return parseObjectWithDiagnostics(value).parsed;
}

function parseObjectWithDiagnostics(value: string): {
  parsed: Record<string, unknown> | null;
  outcome: ParseOutcome;
} {
  if (!value.trim()) {
    return { parsed: null, outcome: 'failed' };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return {
      parsed:
        parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null,
      outcome: 'success_without_unwrapping',
    };
  } catch {
    const unwrapped = unwrapJsonLikeResponse(value);
    if (!unwrapped || unwrapped === value.trim()) {
      return { parsed: null, outcome: 'failed' };
    }
    try {
      const parsed = JSON.parse(unwrapped) as unknown;
      return {
        parsed:
          parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null,
        outcome: 'success_after_unwrapping',
      };
    } catch {
      return { parsed: null, outcome: 'failed' };
    }
  }
}

function unwrapJsonLikeResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  let candidate = trimmed;

  const fencedMatch = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    candidate = fencedMatch[1].trim();
  } else {
    const firstFenceIndex = candidate.search(/```(?:json)?/i);
    if (firstFenceIndex >= 0) {
      const afterFence = candidate.slice(firstFenceIndex).replace(/^```(?:json)?\s*/i, '');
      const closingFenceIndex = afterFence.lastIndexOf('```');
      candidate =
        closingFenceIndex >= 0
          ? afterFence.slice(0, closingFenceIndex).trim()
          : afterFence.trim();
    }
  }

  const firstArray = candidate.indexOf('[');
  const firstObject = candidate.indexOf('{');
  const firstJsonIndex =
    firstArray === -1
      ? firstObject
      : firstObject === -1
        ? firstArray
        : Math.min(firstArray, firstObject);
  if (firstJsonIndex > 0) {
    candidate = candidate.slice(firstJsonIndex).trim();
  }

  const lastArray = candidate.lastIndexOf(']');
  const lastObject = candidate.lastIndexOf('}');
  const lastJsonIndex = Math.max(lastArray, lastObject);
  if (lastJsonIndex >= 0 && lastJsonIndex < candidate.length - 1) {
    candidate = candidate.slice(0, lastJsonIndex + 1).trim();
  }

  return candidate;
}

async function writeResearchOutputDebug(params: {
  query: string;
  mode: 'fast' | 'deep';
  rawResearchText: string;
  parserOutcome: ParseOutcome;
  parsedValue: Record<string, unknown> | null;
}): Promise<void> {
  if (process.env.RESEARCH_OUTPUT_DEBUG !== '1') {
    return;
  }

  const dir = path.join('tmp', 'research-output-debug');
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  const filePath = path.join(dir, `${safeTimestamp}.json`);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      {
        timestamp,
        query: params.query,
        mode: params.mode,
        raw_research_text: params.rawResearchText,
        parser_outcome: params.parserOutcome,
        parsed_value: params.parsedValue,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function canonicalSourceDisplayKey(value: string): string {
  const clean = value.replace(/^https?:\/\//i, '').trim().toLowerCase();
  const domain = clean.replace(/^www\./, '').replace(/\/.*$/, '');
  return domain
    .replace(/\.(com|org|net|io|co|ai|gov|edu|news|trade|finance)$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function formatLiveSourceDisplayName(value: string): string {
  const clean = value.replace(/^https?:\/\//i, '').trim();
  const domain = clean.replace(/^www\./i, '').replace(/\/.*$/, '');
  const haystack = `${clean} ${domain}`.toLowerCase();

  if (haystack.includes('finance.yahoo.com')) return 'Yahoo Finance';
  if (haystack.includes('coinmarketcap')) return 'CoinMarketCap';
  if (haystack.includes('coingecko')) return 'CoinGecko';
  if (haystack.includes('defillama')) return 'DefiLlama';
  if (haystack.includes('coindesk')) return 'CoinDesk';
  if (haystack.includes('tradingview')) return 'TradingView';
  if (haystack.includes('wikipedia')) return 'Wikipedia';
  if (haystack.includes('forbes')) return 'Forbes';
  if (haystack.includes('bitcoin.org')) return 'bitcoin.org';

  return domain || clean;
}

function liveSourceDisplayPriority(value: string): number {
  if (/^(?:CoinGecko|CoinMarketCap|DefiLlama|CoinDesk|Yahoo Finance|TradingView|Forbes|Wikipedia|bitcoin\.org)$/i.test(value)) {
    return 10;
  }
  return 0;
}

function summarizeLiveDataSourceNames(liveData: Record<string, unknown> | null): string[] {
  if (!liveData) return [];
  const names = new Set<string>();
  const canonicalNames = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const clean = value.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (/^(firecrawl|gdelt|google news rss|dynamic rss|source registry)$/i.test(clean)) return;
    const displayName = formatLiveSourceDisplayName(clean);
    const canonical = canonicalSourceDisplayKey(displayName);
    if (canonicalNames.has(canonical)) return;
    canonicalNames.add(canonical);
    names.add(displayName);
  };
  const addArticle = (item: unknown) => {
    const article = recordValue(item);
    if (!article) return;
    add(article.publisher);
    add(article.source_name);
    add(article.name);
    add(article.domain);
  };

  if (arrayValue(recordValue(liveData.coingecko)?.assets).length > 0) {
    names.add('CoinGecko');
  }
  if (arrayValue(recordValue(liveData.defillama)?.chains).length > 0) {
    names.add('DefiLlama');
  }
  if (arrayValue(recordValue(liveData.wikipedia)?.pages).length > 0) {
    names.add('Wikipedia');
  }
  if (recordValue(liveData.duckduckgo)) {
    names.add('DuckDuckGo');
  }

  const currentEvents = recordValue(liveData.current_events);
  for (const item of arrayValue(currentEvents?.articles)) addArticle(item);
  for (const item of arrayValue(currentEvents?.article_snapshots)) addArticle(item);
  for (const item of arrayValue(currentEvents?.background_articles)) addArticle(item);
  for (const item of arrayValue(liveData.sources)) addArticle(item);
  for (const item of arrayValue(recordValue(liveData.dynamic_sources)?.articles)) addArticle(item);
  for (const item of arrayValue(recordValue(liveData.the_hacker_news)?.articles)) addArticle(item);

  return [...names]
    .sort((left, right) => liveSourceDisplayPriority(right) - liveSourceDisplayPriority(left))
    .slice(0, 8);
}

function formatLiveDataSourceSummary(sources: string[]): string {
  const visibleSources = sources.slice(0, 4);
  const hiddenSourceCount = sources.length - visibleSources.length;
  return `${visibleSources.join(', ')}${hiddenSourceCount > 0 ? ` +${hiddenSourceCount} more` : ''}`;
}

function parseLiveDataPayload(liveData: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(liveData) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getCurrentEventSnapshotCount(payload: Record<string, unknown> | null): number {
  const currentEvents = payload?.current_events;
  if (!currentEvents || typeof currentEvents !== 'object') {
    return 0;
  }

  const snapshots = (currentEvents as { article_snapshots?: unknown }).article_snapshots;
  return Array.isArray(snapshots) ? snapshots.length : 0;
}

type LiveDataTimeoutClass = 'forecasting' | 'niche_protocol' | 'creator_audience' | 'current_events' | 'default';

function classifyLiveDataTimeout(task: string): { timeoutMs: number; queryClass: LiveDataTimeoutClass } {
  if (detectForecastingIntent(task).forecasting) {
    return {
      timeoutMs: LIVE_DATA_TIMEOUT_MS_FORECASTING,
      queryClass: 'forecasting',
    };
  }

  const protocolShape = detectProtocolQueryShape(task);
  if (protocolShape === 'strong_crypto' || protocolShape === 'weak_status') {
    return {
      timeoutMs: LIVE_DATA_TIMEOUT_MS_NICHE_PROTOCOL,
      queryClass: 'niche_protocol',
    };
  }

  if (isCreatorAudienceMetricTask(task)) {
    return {
      timeoutMs: LIVE_DATA_TIMEOUT_MS_CREATOR_AUDIENCE,
      queryClass: 'creator_audience',
    };
  }

  if (shouldGatherCurrentEvents(task)) {
    return {
      timeoutMs: LIVE_DATA_TIMEOUT_MS_CURRENT_EVENTS,
      queryClass: 'current_events',
    };
  }

  return {
    timeoutMs: LIVE_DATA_TIMEOUT_MS_DEFAULT,
    queryClass: 'default',
  };
}

function requiresLiveEvidence(task: string): boolean {
  return /\b(current|latest|today|right now|ongoing|war|conflict|ceasefire|strike|iran|israel|russia|ukraine|hormuz|red sea|geopolitical)\b/i.test(
    task,
  );
}

function buildSparseEvidenceResearch(task: string, asOf: string): string {
  return JSON.stringify({
    topic: task,
    scope: {
      timeframe: `as of ${asOf.slice(0, 10)}`,
      entities: [],
      questions: ['Current source-backed status', 'Portfolio implications'],
    },
    executive_summary:
      'Live retrieval did not return enough dated source evidence in this run to support a current-event report. No conflict status, market move, or portfolio impact should be asserted from this empty snapshot.',
    facts: [],
    recent_developments: [],
    metrics: [],
    comparisons: [],
    risks_or_caveats: [
      'Current-event evidence is required for war, geopolitics, and market-impact claims.',
      'Retry with live retrieval or deep mode before making portfolio decisions.',
    ],
    open_questions: ['Which dated public sources currently support the user premise?'],
    sources: [],
  });
}

function formatChatAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toFixed(6).replace(/\.?0+$/g, '');
}

function extractRequestedUsdcAmount(message: string): number | null {
  const match = message.match(/\b(\d+(?:\.\d+)?)\s*USDC\b/i);
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function tryBuildWalletIntentReply(input: {
  message: string;
  walletAddress?: Address;
  signature?: string;
  signatureMessage?: string;
}): Promise<string | null> {
  if (!input.walletAddress) {
    return null;
  }

  const normalizedWallet = getAddress(input.walletAddress);
  const confirmationKey = normalizedWallet.toLowerCase();
  const upper = input.message.trim().toUpperCase();

  if (upper === 'CONFIRM') {
    const expiresAt = pendingEmergencyWithdrawConfirmations.get(confirmationKey);
    if (!expiresAt || expiresAt < Date.now()) {
      pendingEmergencyWithdrawConfirmations.delete(confirmationKey);
      return null;
    }

    pendingEmergencyWithdrawConfirmations.delete(confirmationKey);

    if (!input.signature || !input.signatureMessage) {
      return 'Confirmation received. To complete emergency withdrawal I still need a wallet-signed emergency withdrawal message, because this flow verifies wallet ownership before moving funds.';
    }

    const response = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/api/wallet/emergency-withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: normalizedWallet,
        signature: input.signature,
        message: input.signatureMessage,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as {
      dcwTxHash?: string;
      gatewayTxHash?: string;
      totalWithdrawn?: string;
      error?: string;
    };

    if (!response.ok) {
      return `Emergency withdrawal failed: ${json.error ?? `HTTP ${response.status}`}`;
    }

    return [
      `Emergency withdrawal completed for ${json.totalWithdrawn ?? '0'} USDC.`,
      json.dcwTxHash ? `Execution wallet tx: ${json.dcwTxHash}` : 'Execution wallet tx: none',
      json.gatewayTxHash ? `Gateway tx: ${json.gatewayTxHash}` : 'Gateway tx: none',
    ].join('\n');
  }

  const walletIntent = detectWalletIntent(input.message);
  if (!walletIntent) {
    return null;
  }

  switch (walletIntent) {
    case 'GATEWAY_DEPOSIT_INFO': {
      const circleWallet = await getOrCreateCircleFundingWalletForChat(normalizedWallet);
      return `Send USDC on Arc Testnet to your Gateway funding wallet: ${circleWallet.address}. After the transfer lands, refresh funding or move it into the execution wallet.`;
    }
    case 'GATEWAY_BALANCE': {
      const circleWallet = await getOrCreateCircleFundingWalletForChat(normalizedWallet);
      const gatewayBalance = await fetchGatewayBalanceForAddress(circleWallet.address);
      return `Gateway balance: ${gatewayBalance.available} USDC available for ${circleWallet.address}.`;
    }
    case 'ALL_BALANCES': {
      const circleWallet = await getOrCreateCircleFundingWalletForChat(normalizedWallet);
      const gatewayBalance = await fetchGatewayBalanceForAddress(circleWallet.address);
      const executionBalance = await getExecutionWalletBalanceForChat(normalizedWallet);
      const gatewayUsdc = Number(gatewayBalance.available || '0');
      const executionUsdc = Number(executionBalance.usdc || '0');
      const requestedUsdc = extractRequestedUsdcAmount(input.message);
      const affordabilityLine =
        requestedUsdc !== null
          ? gatewayUsdc + executionUsdc >= requestedUsdc
            ? `Yes, your current AgentFlow balances can cover ${formatChatAmount(requestedUsdc)} USDC.`
            : `No, your current AgentFlow balances cannot cover ${formatChatAmount(requestedUsdc)} USDC. You have ${formatChatAmount(gatewayUsdc + executionUsdc)} USDC available across Gateway and execution wallet.`
          : '';
      return [
        affordabilityLine,
        `Connected wallet: ${normalizedWallet}`,
        `Gateway wallet: ${circleWallet.address}`,
        `Gateway balance: ${gatewayBalance.available} USDC`,
        `Execution wallet: ${executionBalance.address}`,
        `Execution wallet USDC: ${executionBalance.usdc}`,
      ].filter(Boolean).join('\n');
    }
    case 'GATEWAY_TO_EXECUTION': {
      const executionBalance = await getExecutionWalletBalanceForChat(normalizedWallet);
      return `Your execution wallet is ${executionBalance.address}. Use the portfolio Gateway panel to move Gateway USDC into it before running DeFi actions.`;
    }
    case 'GATEWAY_WITHDRAW': {
      const circleWallet = await getOrCreateCircleFundingWalletForChat(normalizedWallet);
      const gatewayBalance = await fetchGatewayBalanceForAddress(circleWallet.address);
      return `Gateway withdrawal is ready. Current available balance is ${gatewayBalance.available} USDC. Use the portfolio Gateway panel to choose the amount and recipient wallet.`;
    }
    case 'EMERGENCY_WITHDRAW_CONFIRM': {
      pendingEmergencyWithdrawConfirmations.set(
        confirmationKey,
        Date.now() + 5 * 60 * 1000,
      );
      return '⚠️ This will withdraw ALL funds from both your execution wallet\nand Circle Gateway to your personal wallet. Type CONFIRM to proceed.';
    }
  }
}

async function getOrCreateCircleFundingWalletForChat(userWalletAddress: Address): Promise<{
  walletId: string;
  address: Address;
}> {
  const existing = await findCircleWalletForUser(userWalletAddress);
  if (existing?.walletId && existing.address) {
    return {
      walletId: existing.walletId,
      address: getAddress(existing.address),
    };
  }

  await getOrCreateWalletSetId();
  const created = await createUserWallet(userWalletAddress);
  setWalletForUser(userWalletAddress, {
    circleWalletId: created.id,
    circleWalletAddress: created.address,
  });

  return {
    walletId: created.id,
    address: getAddress(created.address),
  };
}

async function getExecutionWalletBalanceForChat(userWalletAddress: Address): Promise<{
  address: Address;
  usdc: string;
}> {
  const { createPublicClient, formatUnits, http } = await import('viem');
  const { getOrCreateUserAgentWallet } = await import('./lib/dcw');
  const executionWallet = await getOrCreateUserAgentWallet(userWalletAddress);
  const executionAddress = getAddress(executionWallet.address);
  const client = createPublicClient({
    transport: http(process.env.ARC_RPC?.trim() || 'https://rpc.testnet.arc.network'),
  });
  const usdc = (await client.readContract({
    address: '0x3600000000000000000000000000000000000000',
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ],
    functionName: 'balanceOf',
    args: [executionAddress],
  })) as bigint;

  return {
    address: executionAddress,
    usdc: formatUnits(usdc, 6),
  };
}

type BrainWalletContext = {
  walletAddress: string;
  executionWalletId?: string;
  executionWalletAddress?: string;
  executionTarget?: 'EOA' | 'DCW';
  profileContext?: string;
};

type ResearchWalletContext = {
  source: 'agentflow_portfolio_snapshot';
  requested_for_task: boolean;
  owner_wallet_address: string;
  execution_target: 'DCW' | 'EOA';
  scanned_wallet_address: string;
  as_of: string;
  total_value_usd: number;
  cost_basis_usd: number;
  pnl_usd: number;
  pnl_pct: number;
  holdings: Array<{
    symbol: string;
    name: string;
    kind: string;
    balance: string;
    usd_value: number | null;
    notes: string[];
  }>;
  positions: Array<{
    name: string;
    protocol: string;
    kind: string;
    amount: string;
    usd_value: number | null;
    pnl_usd: number | null;
    notes: string[];
  }>;
  diagnostics?: Record<string, unknown>;
  error?: string;
};

type BrainConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function buildFastpathBrainEventFields(finalIntent: string) {
  return {
    final_intent: finalIntent,
    layer_used: 'fastpath' as const,
    fastpath_confidence: 1.0,
    llm_intent_json: null,
    validator_passed: null,
    experiment_variant: null,
  };
}

function buildIntentRouterBrainEventFields(intent: AgentFlowIntent, validatorPassed: boolean) {
  return {
    final_intent: intent.intent,
    layer_used: 'intent_router' as const,
    fastpath_confidence: null,
    llm_intent_json: intent,
    validator_passed: validatorPassed,
    experiment_variant: null,
  };
}

function buildHermesBrainEventFields() {
  return {
    final_intent: null,
    layer_used: 'hermes_agent' as const,
    fastpath_confidence: null,
    llm_intent_json: null,
    validator_passed: null,
    experiment_variant: null,
  };
}

function buildClassifierHistory(
  history: BrainConversationMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history
    .slice(-4)
    .filter(
      (m): m is typeof m & { role: 'user' | 'assistant' } =>
        m.role === 'user' || m.role === 'assistant',
    )
    .map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
              .replace(/\[TOOL_CALL:[^\]]+\]/g, '')
              .replace(/\[TOOL_RESULT:[^\]]+\]/g, '')
              .trim()
              .slice(0, 280)
          : '',
    }))
    .filter((m) => m.content.length > 0);
}


type BrainUserProfileRow = {
  display_name?: string | null;
  preferences?: Record<string, unknown> | null;
  memory_notes?: string | null;
};

const LOCAL_BRAIN_MEMORY_DIR = path.join(process.cwd(), '.agentflow-memory');
const LOCAL_BRAIN_HISTORY_FILE = path.join(LOCAL_BRAIN_MEMORY_DIR, 'history.json');
const LOCAL_BRAIN_PROFILES_FILE = path.join(LOCAL_BRAIN_MEMORY_DIR, 'profiles.json');
const LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED =
  process.env.AGENTFLOW_LOCAL_MEMORY_FALLBACK === 'true';

async function ensureLocalBrainMemoryDir(): Promise<void> {
  await fs.mkdir(LOCAL_BRAIN_MEMORY_DIR, { recursive: true });
}

async function readLocalBrainJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeLocalBrainJson<T>(filePath: string, value: T): Promise<void> {
  try {
    await ensureLocalBrainMemoryDir();
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  } catch (error) {
    console.warn('[brain] local memory write failed:', getErrorMessage(error));
  }
}

function brainHistoryKey(sessionId: string): string {
  return `chat:history:${sessionId}`;
}

/** When the client sends `x-session-id: wallet-0xabc...-chat-{uuid}`, isolate brain history per thread. */
function deriveBrainMemorySessionId(
  walletAddress: Address | undefined,
  requestSessionId: string,
  actionSessionId: string,
): string {
  const req = requestSessionId.trim();
  if (!walletAddress) {
    return req || actionSessionId;
  }
  const prefix = `wallet-${walletAddress.toLowerCase()}-`;
  if (req.startsWith(prefix) && req.length > prefix.length) {
    return req;
  }
  return actionSessionId;
}

function isAgentflowChatSessionTraceDebug(): boolean {
  return String(process.env.AGENTFLOW_CHAT_SESSION_TRACE ?? '').trim().toLowerCase() === 'true';
}

function isAgentflowChatSseDebug(): boolean {
  return String(process.env.AGENTFLOW_CHAT_SSE_DEBUG ?? '').trim().toLowerCase() === 'true';
}

function logChatSseDebug(payload: Record<string, unknown>): void {
  if (!isAgentflowChatSseDebug()) return;
  console.info('[chat-sse-debug]', payload);
}

function isAgentflowFastPathDebug(): boolean {
  return String(process.env.AGENTFLOW_FASTPATH_DEBUG ?? '').trim().toLowerCase() === 'true';
}

function logFastPathDebug(payload: Record<string, unknown>): void {
  if (!isAgentflowFastPathDebug()) return;
  console.info('[fast-path]', payload);
}

/** Shown only when SSE ends with meta (or zero) chunks and no assistant delta reached the UI. */
const CHAT_SSE_EMPTY_REPLY_FALLBACK =
  'AgentFlow did not return a complete response for that message. Please retry in a moment.';

type BrainInputValidationResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too_short' | 'symbol_noise' | 'garbage_pattern' };

type BrainInputAnalysis = {
  trimmed: string;
  visibleChars: string[];
  alphaCharCount: number;
  alphaNumCharCount: number;
  symbolCharCount: number;
  nonAlphaRatio: number;
  letterTokens: string[];
  noisyLetterTokens: string[];
};

function analyzeBrainInput(message: string): BrainInputAnalysis {
  const trimmed = message.trim();
  const visibleChars = Array.from(trimmed).filter((char) => !/\s/u.test(char));
  const alphaChars = visibleChars.filter((char) => /\p{L}/u.test(char));
  const alphaNumChars = visibleChars.filter((char) => /[\p{L}\p{N}]/u.test(char));
  const symbolCharCount = visibleChars.length - alphaNumChars.length;
  const nonAlphaRatio =
    visibleChars.length > 0 ? (visibleChars.length - alphaChars.length) / visibleChars.length : 0;
  const letterTokens = Array.from(trimmed.matchAll(/\p{L}+/gu)).map((match) => match[0]);
  const noisyLetterTokens = letterTokens.filter(isLikelyNoiseWord);

  return {
    trimmed,
    visibleChars,
    alphaCharCount: alphaChars.length,
    alphaNumCharCount: alphaNumChars.length,
    symbolCharCount,
    nonAlphaRatio,
    letterTokens,
    noisyLetterTokens,
  };
}

function isLikelyNoiseWord(token: string): boolean {
  const normalized = token.toLowerCase();
  if (normalized.length < 6) {
    return false;
  }
  if (!/^\p{L}+$/u.test(normalized)) {
    return false;
  }
  // The vowel/consonant heuristics below are only meaningful for Latin-script
  // tokens. Applying them to Cyrillic, Arabic, CJK, Thai, etc. causes valid
  // multilingual input to be mislabeled as noise.
  if (!/^\p{Script=Latin}+$/u.test(normalized)) {
    return false;
  }

  const vowels = Array.from(normalized).filter((char) => /[aeiouy]/i.test(char)).length;
  const vowelRatio = vowels / normalized.length;
  const consonantRuns = normalized.match(/[^aeiouy]{4,}/gi) ?? [];
  const longestConsonantRun = consonantRuns.reduce((max, run) => Math.max(max, run.length), 0);

  if (normalized.length >= 10 && vowels <= 1) {
    return true;
  }
  if (normalized.length >= 8 && vowelRatio < 0.25 && longestConsonantRun >= 4) {
    return true;
  }
  if (normalized.length >= 6 && vowelRatio < 0.2 && longestConsonantRun >= 5) {
    return true;
  }

  return false;
}

function validateChatInputForBrain(message: string): BrainInputValidationResult {
  const analysis = analyzeBrainInput(message);
  const { trimmed, visibleChars, alphaCharCount, alphaNumCharCount, symbolCharCount, noisyLetterTokens } = analysis;
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }
  if (trimmed.length < 2) {
    return { ok: false, reason: 'too_short' };
  }
  if (/^[^\p{L}\p{N}]+$/u.test(trimmed)) {
    return { ok: false, reason: 'garbage_pattern' };
  }

  if (visibleChars.length === 1 && /\p{Extended_Pictographic}/u.test(visibleChars[0] || '')) {
    return { ok: false, reason: 'garbage_pattern' };
  }

  if (visibleChars.length >= 6 && symbolCharCount / visibleChars.length >= 0.75) {
    return { ok: false, reason: 'symbol_noise' };
  }

  if (
    alphaCharCount >= 6 &&
    alphaNumCharCount > 0 &&
    symbolCharCount / visibleChars.length >= 0.15 &&
    noisyLetterTokens.length >= 2
  ) {
    return { ok: false, reason: 'garbage_pattern' };
  }

  if (
    alphaCharCount >= 18 &&
    noisyLetterTokens.length >= 3
  ) {
    return { ok: false, reason: 'garbage_pattern' };
  }

  if (visibleChars.length > 0) {
    const alphaNumRatio = alphaNumCharCount / visibleChars.length;
    if (alphaNumRatio < 0.35 && alphaCharCount < 4) {
      return { ok: false, reason: 'symbol_noise' };
    }
  }

  return { ok: true };
}

function maybeLogInputFilterDebug(message: string): void {
  const analysis = analyzeBrainInput(message);
  if (analysis.visibleChars.length >= 8 || analysis.nonAlphaRatio <= 0.3) {
    return;
  }

  console.info('[INPUT_FILTER_DEBUG]', {
    preview: analysis.trimmed.slice(0, 40),
    visible_chars: analysis.visibleChars.length,
    non_alpha_ratio: Number(analysis.nonAlphaRatio.toFixed(3)),
    noisy_letter_tokens: analysis.noisyLetterTokens,
  });
}

function maybeLowConfidenceClarify(message: string): string | null {
  const normalized = message.trim();
  if (!/\b(?:swap|trade|exchange|convert)\b/i.test(normalized)) {
    if (
      /\bwithdraw\b/i.test(normalized) &&
      /\bvault\b/i.test(normalized) &&
      !/\blune(?:usdc|eurc)\b/i.test(normalized)
    ) {
      return 'Which vault should I use: luneUSDC or luneEURC?';
    }
    return null;
  }
  const hasTargetToken = /\b(?:to|for)\s+(?:USDC|EURC|usd coin|euro?s?|eurc)\b/i.test(normalized);
  const hasSourceToken = /\b\d+(?:\.\d+)?\s*(?:USDC|EURC)\b/i.test(normalized);
  const hasAmount = /\b\d+(?:\.\d+)?\b/.test(normalized);
  if (hasAmount && hasSourceToken && !hasTargetToken) {
    return 'Do you want a live swap quote, or do you want me to explain how swaps work on AgentFlow?';
  }
  if (hasAmount && hasTargetToken && !hasSourceToken) {
    return 'Which token should I swap from: USDC or EURC?';
  }
  return null;
}

function buildLowConfidenceClarifyRoute(message: string): DirectAgentFlowRoute | null {
  const normalized = message.trim();

  if (/\b(?:swap|trade|exchange|convert)\b/i.test(normalized)) {
    const hasGenericHelpCue =
      /\b(?:help|how|explain|walk\s+me\s+through|guide|tell\s+me)\b/i.test(normalized);
    const sourceMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*(USDC|EURC)\b/i);
    const targetMatch = normalized.match(/\b(?:to|for)\s+(USDC|EURC)\b/i);

    if (hasGenericHelpCue && !sourceMatch && !targetMatch) {
      return {
        type: 'reply',
        text: 'I can explain how swaps work on AgentFlow, or I can fetch a live USDC/EURC quote for you. Which do you want?',
        quickActionGroups: [
          {
            title: 'Swap help',
            actions: [
              { label: 'How swaps work', prompt: 'how do swaps work on AgentFlow' },
              { label: 'Quote 1 USDC to EURC', prompt: 'swap 1 USDC to EURC' },
              { label: 'Quote 1 EURC to USDC', prompt: 'swap 1 EURC to USDC' },
            ],
          },
        ],
      };
    }

    if (sourceMatch && !targetMatch) {
      const amount = sourceMatch[1];
      const sourceToken = sourceMatch[2].toUpperCase();
      const defaultTarget = sourceToken === 'USDC' ? 'EURC' : 'USDC';
      return {
        type: 'reply',
        text: `Do you want me to explain how swaps work on AgentFlow, or do you want a live quote for ${amount} ${sourceToken} to ${defaultTarget}?`,
        quickActionGroups: [
          {
            title: 'Swap help',
            actions: [
              { label: 'How swaps work', prompt: 'how do swaps work on AgentFlow' },
              { label: 'Get quote', prompt: `swap ${amount} ${sourceToken} to ${defaultTarget}` },
            ],
          },
        ],
      };
    }

    if (targetMatch && !sourceMatch) {
      const targetToken = targetMatch[1].toUpperCase();
      const sourceOptions = ['USDC', 'EURC'].filter((token) => token !== targetToken);
      return {
        type: 'reply',
        text: `Which token do you want to swap from for ${targetToken}?`,
        quickActionGroups: [
          {
            title: 'Choose source token',
            actions: sourceOptions.map((token) => ({
              label: token,
              prompt: `swap 1 ${token} to ${targetToken}`,
            })),
          },
        ],
      };
    }
  }

  const lowConfidenceClarification = maybeLowConfidenceClarify(message);
  return lowConfidenceClarification
    ? {
        type: 'reply',
        text: lowConfidenceClarification,
      }
    : null;
}

const recentBrainEventsBySession = new Map<
  string,
  { eventId: string; assistantAt: number }
>();

function summarizeTelemetryValue(value: unknown, max = 160): string {
  if (value == null) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

function summarizeToolParams(params: Record<string, unknown>): string {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (/address|wallet|signature|jwt|token|auth/i.test(key)) {
      safe[key] = '[redacted]';
    } else {
      safe[key] = value;
    }
  }
  return summarizeTelemetryValue(safe, 240);
}

function startsLikeCorrection(message: string): boolean {
  return /^(?:no|wait|actually|correction|wrong|not quite|that's wrong)\b/i.test(message.trim());
}

async function markPossibleBrainCorrection(
  sessionId: string,
  message: string,
): Promise<void> {
  const previous = recentBrainEventsBySession.get(sessionId);
  if (!previous || Date.now() - previous.assistantAt > 60_000 || !startsLikeCorrection(message)) {
    return;
  }
  await updateBrainEvent(previous.eventId, { user_correction: message });
}

async function appendBrainToolTelemetry(
  eventId: string,
  tools: BrainToolTelemetry[],
  entry: BrainToolTelemetry,
): Promise<void> {
  tools.push(entry);
  await updateBrainEvent(eventId, { tools_called: tools });
}

function classifyBrainToolResult(responseText: string): {
  success: boolean;
  outcome: BrainEventOutcome;
  failureReason: string | null;
} {
  const text = responseText.trim();
  if (/^Tool validation error\b/i.test(text)) {
    return {
      success: false,
      outcome: 'validation_error',
      failureReason: text,
    };
  }
  if (/^Error executing\b/i.test(text)) {
    return {
      success: false,
      outcome: 'tool_error',
      failureReason: text,
    };
  }
  return {
    success: true,
    outcome: 'success',
    failureReason: null,
  };
}

function lastAssistantContentPreview(
  history: ReadonlyArray<{ role: string; content: string }>,
  maxLen = 200,
): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const t = history[i];
    if (t.role === 'assistant' && typeof t.content === 'string') {
      return t.content.trim().slice(0, maxLen);
    }
  }
  return '';
}

async function loadLocalBrainConversationHistory(
  sessionId: string,
): Promise<BrainConversationMessage[]> {
  const store = await readLocalBrainJson<Record<string, BrainConversationMessage[]>>(
    LOCAL_BRAIN_HISTORY_FILE,
    {},
  );
  return normalizeBrainConversationHistory(store[sessionId] || []);
}

async function storeLocalBrainConversationHistory(
  sessionId: string,
  history: BrainConversationMessage[],
): Promise<void> {
  const store = await readLocalBrainJson<Record<string, BrainConversationMessage[]>>(
    LOCAL_BRAIN_HISTORY_FILE,
    {},
  );
  store[sessionId] = normalizeBrainConversationHistory(history);
  await writeLocalBrainJson(LOCAL_BRAIN_HISTORY_FILE, store);
}

async function loadLocalBrainUserProfile(
  walletAddress: Address,
): Promise<BrainUserProfileRow | null> {
  const store = await readLocalBrainJson<Record<string, BrainUserProfileRow>>(
    LOCAL_BRAIN_PROFILES_FILE,
    {},
  );
  return store[walletAddress] || null;
}

async function storeLocalBrainUserProfile(
  walletAddress: Address,
  update: {
    display_name?: string | null;
    preferences?: Record<string, unknown>;
    memory_notes?: string | null;
  },
): Promise<void> {
  const store = await readLocalBrainJson<Record<string, BrainUserProfileRow>>(
    LOCAL_BRAIN_PROFILES_FILE,
    {},
  );
  const existing = store[walletAddress] || {};
  store[walletAddress] = {
    ...existing,
    ...update,
    preferences: {
      ...(existing.preferences || {}),
      ...(update.preferences || {}),
    },
  };
  await writeLocalBrainJson(LOCAL_BRAIN_PROFILES_FILE, store);
}

function normalizeBrainConversationHistory(
  items: BrainConversationMessage[],
): BrainConversationMessage[] {
  return items
    .filter(
      (item): item is BrainConversationMessage =>
        Boolean(
          item &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string',
        ),
    )
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 4000),
    }))
    .filter((item) => item.content.length > 0)
    .slice(-20);
}

function brainMessagesEqual(
  a: BrainConversationMessage,
  b: BrainConversationMessage,
): boolean {
  return a.role === b.role && a.content.trim() === b.content.trim();
}

function mergeBrainConversationHistory(
  persisted: BrainConversationMessage[],
  incoming: BrainConversationMessage[],
): BrainConversationMessage[] {
  const normalizedPersisted = normalizeBrainConversationHistory(persisted);
  const normalizedIncoming = normalizeBrainConversationHistory(incoming);

  if (normalizedPersisted.length === 0) {
    return normalizedIncoming;
  }
  if (normalizedIncoming.length === 0) {
    return normalizedPersisted;
  }

  let overlap = 0;
  const maxOverlap = Math.min(normalizedPersisted.length, normalizedIncoming.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    const persistedSuffix = normalizedPersisted.slice(-size);
    const incomingPrefix = normalizedIncoming.slice(0, size);
    const matches = persistedSuffix.every((item, index) =>
      brainMessagesEqual(item, incomingPrefix[index]!),
    );
    if (matches) {
      overlap = size;
      break;
    }
  }

  return normalizeBrainConversationHistory([
    ...normalizedPersisted,
    ...normalizedIncoming.slice(overlap),
  ]);
}

async function loadBrainConversationHistory(
  sessionId: string,
): Promise<BrainConversationMessage[]> {
  if (!sessionId) {
    return [];
  }

  try {
    const raw = await getRedis().get(brainHistoryKey(sessionId));
    if (!raw) {
      return LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED
        ? await loadLocalBrainConversationHistory(sessionId)
        : [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED
        ? await loadLocalBrainConversationHistory(sessionId)
        : [];
    }
    return normalizeBrainConversationHistory(parsed as BrainConversationMessage[]);
  } catch (error) {
    console.warn('[brain] history load failed:', getErrorMessage(error));
    return LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED
      ? await loadLocalBrainConversationHistory(sessionId)
      : [];
  }
}

async function storeBrainConversationHistory(
  sessionId: string,
  history: BrainConversationMessage[],
): Promise<void> {
  if (!sessionId) {
    return;
  }

  try {
    await getRedis().set(
      brainHistoryKey(sessionId),
      JSON.stringify(normalizeBrainConversationHistory(history)),
      'EX',
      60 * 60 * 24 * 30,
    );
  } catch (error) {
    console.warn('[brain] history store failed:', getErrorMessage(error));
  }

  if (LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED) {
    await storeLocalBrainConversationHistory(sessionId, history);
  }
}

const ERROR_RESPONSE_PATTERNS = [
  /backend services seem to be experiencing issues/i,
  /AgentFlow is restarting/i,
  /please try again in a moment/i,
  /restore normal operations/i,
  /something unexpected happened/i,
];

function isErrorResponse(text: string): boolean {
  return ERROR_RESPONSE_PATTERNS.some((re) => re.test(text));
}

async function appendBrainConversationTurn(
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
  redisActionScopeKey?: string,
): Promise<void> {
  if (isErrorResponse(assistantMessage)) {
    console.warn('[brain] skipping history write — response looks like an error state');
    return;
  }
  const existing = await loadBrainConversationHistory(sessionId);
  const merged = mergeBrainConversationHistory(existing, [
    { role: 'user', content: userMessage },
    { role: 'assistant', content: assistantMessage },
  ]);
  await storeBrainConversationHistory(sessionId, merged);

  await persistResearchConfirmationOfferRedis(
    redisActionScopeKey?.trim(),
    userMessage,
    assistantMessage,
  ).catch(() => null);

  await maybeCaptureEpisodicMemory(sessionId, userMessage, assistantMessage).catch((error) => {
    console.warn('[semantic-memory] episodic capture failed:', getErrorMessage(error));
  });
}

async function loadBrainUserProfile(walletAddress?: Address): Promise<BrainUserProfileRow | null> {
  if (!walletAddress) {
    return null;
  }

  try {
    const { data } = await adminDb
      .from('user_profiles')
      .select('display_name, preferences, memory_notes')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (!data) {
      return LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED
        ? await loadLocalBrainUserProfile(walletAddress)
        : null;
    }

    return data as BrainUserProfileRow;
  } catch (error) {
    console.warn('[brain] profile load failed:', getErrorMessage(error));
    return LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED
      ? await loadLocalBrainUserProfile(walletAddress)
      : null;
  }
}

function buildBrainProfileContext(profile: BrainUserProfileRow | null): string {
  return buildWalletProfileLlmContext(profile);
}

const GREETING_PATTERNS =
  /^(hi|hello|hey|sup|what'?s up|good morning|good evening|good afternoon|greetings|howdy|yo)\b/i;

const FOLLOWUP_PATTERNS =
  /what did you find|what was.*about|tell me more|continue|go ahead|yeah go|do it|what happened|show me|what were the results|previous research|last report|what topic/i;

const SESSION_CONTEXT_PATTERNS =
  /\b(?:previous conversation|last time|earlier|before|what did i tell you|what did we talk about|what were we talking about|pick up where we left off|where did we leave off|continue|go on|carry on|resume|remember|do you remember|you remember|what happened before|last report|previous research)\b/i;

type BrainSemanticQueryIntent =
  | 'none'
  | 'profile_name'
  | 'profile_preference'
  | 'routing_policy'
  | 'episodic_recall';

function detectBrainSemanticQueryIntent(message: string): BrainSemanticQueryIntent {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return 'none';
  }
  if (
    /\b(?:my name|remember my name|do you remember my name|what'?s my name|who am i|call me|what did you call me)\b/i.test(
      normalized,
    )
  ) {
    return 'profile_name';
  }
  if (
    /\b(?:prefer|preference|style|answer me|reply style|how should you answer|short direct answers)\b/i.test(
      normalized,
    )
  ) {
    return 'profile_preference';
  }
  if (
    /\b(?:telegram|policy|intent|router|routing|chat mode|fallback|bot policy|agentflow|hermes|standalone)\b/i.test(
      normalized,
    ) &&
    /\b(?:should|shouldn'?t|do not|don'?t|instead|why|act like|behave|route|routing|policy|mode)\b/i.test(
      normalized,
    )
  ) {
    return 'routing_policy';
  }
  if (SESSION_CONTEXT_PATTERNS.test(normalized)) {
    return 'episodic_recall';
  }
  return 'none';
}

function isBareGreetingMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  if (!GREETING_PATTERNS.test(trimmed)) {
    return false;
  }
  if (
    /\b(?:swap|vault|bridge|portfolio|balance|wallet|send|pay|request|invoice|research|market|prediction|schedule|split|batch)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount <= 5;
}

function buildContextualGreetingReply(
  message: string,
  history: BrainConversationMessage[] = [],
): string | null {
  if (!isBareGreetingMessage(message)) {
    return null;
  }

  const recentMeaningfulTurn = [...history]
    .reverse()
    .find((turn) => turn?.content?.trim() && !isBareGreetingMessage(turn.content));

  if (recentMeaningfulTurn) {
    return "Hey, I'm here - want to pick up where we left off?";
  }

  return "Hey, I'm here. What do you want to do?";
}

function isConversationRecallRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return /\b(?:what were we talking about|what did we talk about|what did i tell you|do you remember|you remember|what do you remember|where did we leave off|pick up where we left off|what happened before|what did you call me)\b/i.test(
    normalized,
  );
}

function compactRecallLine(text: string, maxLen = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) {
    return clean;
  }
  return `${clean.slice(0, maxLen - 3).trim()}...`;
}

function isLowValueAssistantChitChat(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    isBareGreetingMessage(text) ||
    normalized === "hey, i'm here - want to pick up where we left off?" ||
    normalized === "hey, i'm here. what do you want to do?"
  );
}

function extractWalletAddressFromSessionId(sessionId: string): Address | undefined {
  const trimmed = sessionId.trim().toLowerCase();
  if (!trimmed) return undefined;
  const match = trimmed.match(/wallet-(0x[a-f0-9]{40})/i) ?? trimmed.match(/^(0x[a-f0-9]{40})$/i);
  if (!match?.[1]) {
    return undefined;
  }
  try {
    return getAddress(match[1]);
  } catch {
    return undefined;
  }
}

function episodicCategoryForMessage(message: string): string | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;
  if (/\b(?:portfolio|holdings|positions|balance|wallet|vault shares|gateway reserve)\b/.test(normalized)) {
    return 'portfolio_context';
  }
  if (/\b(?:research|report|analy[sz]e|news|market context)\b/.test(normalized)) {
    return 'research_context';
  }
  if (/\b(?:swap|vault|bridge|send|pay|request|invoice|schedule|split|batch)\b/.test(normalized)) {
    return 'workflow_context';
  }
  if (/\b(?:telegram|agentpay|predmarket|dcw|eoa|intent|router|policy)\b/.test(normalized)) {
    return 'product_policy';
  }
  return null;
}

function shouldCaptureEpisodicMemory(userMessage: string, assistantMessage: string): boolean {
  const user = userMessage.trim();
  const assistant = assistantMessage.trim();
  if (!user || !assistant) return false;
  if (isErrorResponse(assistant) || isLowValueAssistantChitChat(assistant)) return false;
  if (user.length < 8 || assistant.length < 16) return false;
  if (!episodicCategoryForMessage(user)) return false;
  if (/^I could not|^I couldn't|couldn't route|could not route|link your wallet first/i.test(assistant)) {
    return false;
  }
  return true;
}

async function maybeCaptureEpisodicMemory(
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const walletAddress = extractWalletAddressFromSessionId(sessionId);
  const category = episodicCategoryForMessage(userMessage);
  if (!walletAddress || !category || !shouldCaptureEpisodicMemory(userMessage, assistantMessage)) {
    return;
  }

  await rememberSemanticMemory({
    wallet_address: walletAddress,
    session_id: sessionId,
    memory_type: 'episodic',
    category,
    content: `Earlier in this thread, the user asked: ${userMessage.replace(/\s+/g, ' ').trim()} | AgentFlow replied: ${assistantMessage.replace(/\s+/g, ' ').trim().slice(0, 700)}`,
    source_user_message: userMessage,
    source_assistant_message: assistantMessage.slice(0, 1200),
    confidence: 0.72,
  });
}

function buildConversationRecallReply(
  message: string,
  history: BrainConversationMessage[] = [],
  profile: BrainUserProfileRow | null = null,
): string | null {
  if (!isConversationRecallRequest(message)) {
    return null;
  }

  const lastUser = [...history]
    .reverse()
    .find((turn) => turn.role === 'user' && turn.content.trim() && !isBareGreetingMessage(turn.content));
  const lastAssistant = [...history]
    .reverse()
    .find(
      (turn) =>
        turn.role === 'assistant' &&
        turn.content.trim() &&
        !isLowValueAssistantChitChat(turn.content),
    );
  const safeDisplayName = sanitizeDisplayNameForReply(profile?.display_name);

  if (!lastUser && !lastAssistant && !safeDisplayName) {
    return "We haven't really started a thread here yet.";
  }

  const parts: string[] = [];
  if (lastUser) {
    parts.push(`You last asked about ${compactRecallLine(lastUser.content)}.`);
  }
  if (lastAssistant) {
    parts.push(`I last replied with ${compactRecallLine(lastAssistant.content)}.`);
  }
  if (
    /\b(?:what did you call me|do you remember|what do you remember|my name)\b/i.test(
      message.trim().toLowerCase(),
    ) &&
    safeDisplayName
  ) {
    parts.push(`For this wallet profile, I have your saved name as ${safeDisplayName}.`);
  }

  return parts.join(' ');
}

function buildReferentialWorkflowClarification(
  message: string,
  history: BrainConversationMessage[] = [],
): string | null {
  const normalized = message.trim().toLowerCase();
  if (!/^(?:yeah make that|make that|set up that payment every.+|do that|do that every.+|continue with that)$/i.test(normalized)) {
    return null;
  }

  const recentUserTurns = history
    .filter((turn) => turn.role === 'user' && typeof turn.content === 'string')
    .map((turn) => turn.content.trim())
    .filter(Boolean);
  const lastUser = recentUserTurns.at(-1) ?? '';
  const previousUser = recentUserTurns.at(-2) ?? '';
  const recentContext = `${previousUser}\n${lastUser}`.toLowerCase();

  if (/\b(payment link|pay link|qr|scan to pay|scan\b.*pay)\b/i.test(recentContext)) {
    const amountMatch = `${previousUser}\n${lastUser}`.match(/\b(\d+(?:\.\d+)?)\s*USDC\b/i);
    const amountHint = amountMatch?.[1] ? ` for ${amountMatch[1]} USDC` : '';
    return `Who should pay through the payment link${amountHint}?`;
  }

  if (
    /\b(send|pay|transfer)\b/i.test(previousUser) &&
    /\bto\s+[a-z0-9_.-]+(?:\.arc)?\b/i.test(previousUser) &&
    /\b(recurring payment|every month|every week|every monday|monthly|weekly|daily)\b/i.test(
      `${previousUser}\n${lastUser}`,
    )
  ) {
    const recipientMatch = previousUser.match(/\bto\s+([a-z0-9_.-]+(?:\.arc)?|0x[a-f0-9]{40})\b/i);
    const amountMatch = previousUser.match(/\b(\d+(?:\.\d+)?)\s*USDC\b/i);
    const recipient = recipientMatch?.[1];
    const amount = amountMatch?.[1];
    if (recipient && amount) {
      return `Set up a recurring payment of ${amount} USDC to ${recipient}? If yes, tell me the exact cadence like "every month" or "every monday".`;
    }
  }

  return null;
}

function shouldAttachBrainProfileContext(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  return (
    /\b(my name|do you know my name|what'?s my name|who am i|call me|remember me|remember my|what do you remember|profile|preference|prefer|what did you call me)\b/i.test(
      normalized,
    ) || SESSION_CONTEXT_PATTERNS.test(normalized)
  );
}

function shouldAttachBrainSemanticMemoryContext(message: string): boolean {
  return detectBrainSemanticQueryIntent(message) !== 'none';
}

function buildPreferenceMemoryAck(message: string, walletAddress?: Address): string | null {
  const normalized = message.trim();
  if (!normalized) return null;
  if (!/\b(?:my name is|call me|i prefer|remember that|remember my)\b/i.test(normalized)) {
    return null;
  }

  const displayNameUsagePreference = extractDisplayNameUsagePreference(normalized);
  if (displayNameUsagePreference) {
    const scope = walletAddress ? ' for this wallet profile' : ' for this chat';
    return `Got it. I'll use your saved name more often${scope}.`;
  }

  const nameMatch = normalized.match(/\bmy name is\s+([a-z][a-z0-9_-]{1,40})\b/i);
  const prefersShort = /\b(?:short|direct|concise|brief)\b/i.test(normalized);
  if (!nameMatch && !prefersShort) {
    return null;
  }

  const parts: string[] = [];
  if (nameMatch?.[1]) {
    parts.push(nameMatch[1]);
  }
  if (prefersShort) {
    parts.push('short direct answers');
  }

  const scope = walletAddress ? ' for this wallet profile' : ' for this chat';
  return `Got it${parts.length ? `: ${parts.join(', ')}` : ''}. I’ll use that${scope}.`;
}

async function buildNameAddressingPreferenceFollowupReply(
  message: string,
  history: BrainConversationMessage[] = [],
  walletAddress?: Address,
): Promise<string | null> {
  const normalized = message.trim().toLowerCase();
  if (!/^(?:yes|y|yeah|yep|sure|ok|okay|yes please|go ahead)$/i.test(normalized)) {
    return null;
  }

  const lastAssistant = [...history]
    .reverse()
    .find((turn) => turn.role === 'assistant' && turn.content.trim());
  if (!lastAssistant) {
    return null;
  }

  if (!/\bwant me to call you by name more often\??/i.test(lastAssistant.content)) {
    return null;
  }

  if (walletAddress) {
    await rememberUserProfileFact(
      walletAddress,
      NAME_ADDRESSING_PREFERENCE_KEY,
      NAME_ADDRESSING_MORE_OFTEN_VALUE,
    );
  }

  const scope = walletAddress ? ' for this wallet profile' : ' for this chat';
  return `Got it. I'll use your saved name more often${scope}.`;
}

function isCasualSmallTalkTurn(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (FOLLOWUP_PATTERNS.test(message.trim())) {
    return false;
  }

  if (shouldAttachBrainProfileContext(normalized)) {
    return false;
  }

  if (
    /\b(swap|bridge|vault|portfolio|invoice|payment|send|transfer|withdraw|deposit|research|report|analyze|transcribe|schedule|split|batch|balance|history|previous|last|earlier|remember|name)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  return /^(hi|hello|hey|sup|yo|gm|gn|thanks|thank you|ok|okay|lol|haha)\b/i.test(normalized) ||
    /\b(how are you|how r u|had you dinner|have you had dinner|did you eat|what'?s up|wassup)\b/i.test(
      normalized,
    );
}

function shouldKeepPersistentConversationContext(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  return (
    GREETING_PATTERNS.test(trimmed) ||
    FOLLOWUP_PATTERNS.test(trimmed) ||
    SESSION_CONTEXT_PATTERNS.test(trimmed)
  );
}

function shouldPrefetchFinancialContext(message: string): boolean {
  if (isVaultPositionIntent(message)) {
    return false;
  }
  if (shouldHandleAsResearchRequest(message)) {
    return false;
  }
  const portfolioRequestMode = classifyPortfolioRequestMode(message);
  if (portfolioRequestMode === 'snapshot' || portfolioRequestMode === 'clarify') {
    return false;
  }
  return answerModeRequiresFinancialContext(classifyAnswerMode(message));
}

function isFinancialAdvisoryScopeIntent(message: string): boolean {
  return isFinancialAdvisoryScopeMessage(message);
}

async function buildFinancialContextNote(
  message: string,
  walletCtx: {
    walletAddress: string;
    executionWalletId?: string;
    executionWalletAddress?: string;
    executionTarget?: 'EOA' | 'DCW';
    profileContext?: string;
  },
  sessionId: string,
): Promise<string> {
  if (!walletCtx.walletAddress.trim()) {
    return '';
  }
  if (walletCtx.executionTarget === 'EOA') {
    return '';
  }
  if (!shouldPrefetchFinancialContext(message)) {
    return '';
  }
  if (isFinancialAdvisoryScopeIntent(message)) {
    return '';
  }

  const [balanceResult, portfolioResult] = await Promise.all([
    executeTool('get_balance', {}, walletCtx, sessionId),
    executeTool('get_portfolio', {}, walletCtx, sessionId),
  ]);

  return [
    'Current wallet context for this request:',
    balanceResult,
    '',
    portfolioResult,
    '',
    'Use only this wallet context when answering the user unless they explicitly ask for research, news, or market context.',
    'Do not say you are going to check balances or portfolio first.',
    'If the user asked for wallet, vault shares, Gateway reserve, or recent activity, cover those requested parts in the answer. Include one concise next step. Do not suggest a test swap unless the user explicitly asked to execute or demonstrate a trade.',
    'Do not invent extra buckets such as bridge-locked funds, off-chain positions, or market narratives unless they are explicitly present above.',
    'Treat Gateway reserve as x402 and agent-to-agent payment liquidity. Do not recommend depositing it into vaults as though it were already deployable investment capital; explain that the user would first choose an amount to move into the execution wallet.',
    'For portfolio-aware answers, describe options factually by default. Avoid unsolicited "you should", "you could", "I recommend", "consider moving", "consider depositing", or "consider allocating" language about user funds.',
    'Only recommend a specific move when the user explicitly asks what they should do, what you would do, or asks for a recommendation. When giving that advice, include caveats and state that the user decides whether to act.',
    'If the user asks how a recent action changed their wallet, combine this live wallet context with the current conversation history. Do not pretend you need them to repeat an action that already happened in this session.',
  ].join('\n');
}

async function loadBrainProfileContext(walletAddress?: Address): Promise<string> {
  const profile = await loadBrainUserProfile(walletAddress);
  return buildBrainProfileContext(profile);
}

async function buildBrainSemanticMemoryContext(
  walletAddress: Address | undefined,
  sessionId: string,
  message: string,
): Promise<string> {
  if (!walletAddress || !message.trim()) {
    return '';
  }
  const queryIntent = detectBrainSemanticQueryIntent(message);
  if (queryIntent === 'none') {
    return '';
  }
  const types =
    queryIntent === 'profile_name' || queryIntent === 'profile_preference'
      ? (['profile'] as const)
      : queryIntent === 'routing_policy'
        ? (['routing_example'] as const)
        : (['episodic', 'session_summary'] as const);
  return buildSemanticMemoryContext({
    walletAddress,
    sessionId,
    query: message,
    limit: queryIntent === 'episodic_recall' ? 3 : 2,
    types: [...types],
  });
}

async function upsertBrainUserProfile(
  walletAddress: Address,
  update: {
    display_name?: string | null;
    preferences?: Record<string, unknown>;
    memory_notes?: string | null;
  },
): Promise<void> {
  let supabaseError: unknown = null;

  try {
    const { error } = await adminDb.from('user_profiles').upsert(
      {
        wallet_address: walletAddress,
        ...update,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'wallet_address',
      },
    );

    if (error) {
      supabaseError = error;
      console.error('[memory] Supabase write failed:', error);
    }
  } catch (error) {
    supabaseError = error;
    console.error('[memory] Supabase write failed:', error);
  }

  if (LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED) {
    await storeLocalBrainUserProfile(walletAddress, update);
  }

  if (supabaseError) {
    throw supabaseError instanceof Error
      ? supabaseError
      : new Error(getErrorMessage(supabaseError));
  }
}

async function rememberUserProfileFact(
  walletAddress: Address,
  key: string,
  value: string,
): Promise<void> {
  const normalizedKey = key.trim().toLowerCase();
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return;
  }

  if (normalizedKey === 'display_name') {
    await upsertBrainUserProfile(walletAddress, { display_name: trimmedValue });
    await rememberSemanticMemory({
      wallet_address: walletAddress,
      memory_type: 'profile',
      category: 'display_name',
      content: `Saved display name: ${trimmedValue}`,
      structured: { key: normalizedKey, value: trimmedValue },
      keywords: ['name', 'display_name', trimmedValue],
      confidence: 0.98,
    });
    return;
  }

  if (normalizedKey === 'memory_notes') {
    await upsertBrainUserProfile(walletAddress, { memory_notes: trimmedValue });
    await rememberSemanticMemory({
      wallet_address: walletAddress,
      memory_type: 'profile',
      category: 'memory_note',
      content: trimmedValue,
      structured: { key: normalizedKey, value: trimmedValue },
      confidence: 0.82,
    });
    return;
  }

  let preferences =
    (LOCAL_BRAIN_MEMORY_FALLBACK_ENABLED
      ? (((await loadLocalBrainUserProfile(walletAddress))?.preferences as Record<
          string,
          unknown
        >) || {})
      : {});

  try {
    const { data, error } = await adminDb
      .from('user_profiles')
      .select('preferences')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (error) {
      console.error('[memory] Supabase preference read failed:', error);
      throw error;
    }

    preferences =
      data?.preferences && typeof data.preferences === 'object'
        ? { ...(data.preferences as Record<string, unknown>) }
        : preferences;
  } catch (error) {
    console.warn('[brain] preference save failed:', getErrorMessage(error));
  }

  preferences[normalizedKey] = trimmedValue;
  await upsertBrainUserProfile(walletAddress, { preferences });
  await rememberSemanticMemory({
    wallet_address: walletAddress,
    memory_type: 'profile',
    category: `preference:${normalizedKey}`,
    content: `User preference for ${normalizedKey}: ${trimmedValue}`,
    structured: { key: normalizedKey, value: trimmedValue },
    keywords: [normalizedKey, ...trimmedValue.split(/\s+/)],
    confidence: 0.9,
  });
}

function shouldCaptureSemanticCorrection(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    !startsLikeCorrection(normalized) &&
    !/\b(?:we need|should|shouldn't|do not|don't|instead|not in telegram|use web|dcw|eoa)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }
  return /\b(?:telegram|web|agentpay|vault|swap|bridge|portfolio|balance|predmarket|research|intent|router|dcw|eoa)\b/i.test(
    normalized,
  );
}

async function maybeCaptureSemanticCorrection(
  walletAddress: Address | undefined,
  sessionId: string,
  message: string,
): Promise<void> {
  if (!walletAddress || !shouldCaptureSemanticCorrection(message)) {
    return;
  }

  await rememberSemanticMemory({
    wallet_address: walletAddress,
    session_id: sessionId,
    memory_type: 'routing_example',
    category: 'user_correction',
    content: `User correction or policy guidance: ${message.replace(/\s+/g, ' ').trim()}`,
    source_user_message: message,
    keywords: ['correction', 'policy', ...message.split(/\s+/)],
    confidence: 0.78,
  });
}

const PROFILE_FACT_TRIGGER =
  /\b(my name|call me|i prefer|remember|i like|i want)\b/i;

type ExtractedProfileFacts = {
  name?: string | null;
  preference?: string | null;
  note?: string | null;
};

const NAME_ADDRESSING_PREFERENCE_KEY = 'name_addressing_preference';
const NAME_ADDRESSING_MORE_OFTEN_VALUE = 'Use my saved display name more often in direct replies.';

function normalizeDisplayName(value: string): string {
  return value
    .trim()
    .replace(/[.!?,;:]+$/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !/^(lol|lmao|haha|hehe|bro|dude|man|please|pls)$/i.test(part))
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function looksLikePseudoDisplayName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) {
    return false;
  }
  return (
    normalized === 'by my name' ||
    normalized === 'by my name more often' ||
    normalized === 'my name' ||
    normalized === 'my name more often' ||
    normalized === 'by name' ||
    normalized === 'name' ||
    /\b(?:my name|your name|by name|more often)\b/.test(normalized)
  );
}

function sanitizeDisplayNameForReply(value?: string | null): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ') || '';
  if (!normalized || looksLikePseudoDisplayName(normalized)) {
    return null;
  }
  return normalized;
}

function isProfileFactQuestion(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('?') ||
    /^(?:do|does|did|who|what|where|why|how|can|could|would|should|is|are)\b/i.test(
      normalized,
    )
  );
}

function extractExplicitDisplayName(message: string): string | null {
  if (isProfileFactQuestion(message)) {
    return null;
  }
  if (/\bmy\s+name\s+is\s+not\b/i.test(message)) {
    return null;
  }

  const patterns = [
    /\b(?:remember\s+)?my\s+name\s+is\s+([a-z][a-z .'-]{0,48})(?:[.!?,;:]|$)/i,
    /\bcall\s+me\s+(?!by\b)([a-z][a-z .'-]{0,48})(?:[.!?,;:]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const candidate = normalizeDisplayName(match[1]);
    if (
      candidate &&
      /^[A-Za-z][A-Za-z .'-]{0,48}$/.test(candidate) &&
      !looksLikePseudoDisplayName(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

function extractDisplayNameUsagePreference(message: string): string | null {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  if (
    /\b(?:call\s+me\s+by\s+(?:my\s+)?name(?:\s+more\s+often)?|use\s+my\s+name\s+more\s+often|address\s+me\s+by\s+(?:my\s+)?name)\b/i.test(
      normalized,
    )
  ) {
    return NAME_ADDRESSING_MORE_OFTEN_VALUE;
  }

  return null;
}

function parseExtractedProfileFacts(raw: string): ExtractedProfileFacts | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(normalized) as ExtractedProfileFacts;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('[memory] fact extraction parse failed:', getErrorMessage(error));
    return null;
  }
}

async function extractProfileFact(message: string, walletAddress?: Address): Promise<void> {
  if (!walletAddress) {
    return;
  }

  const normalized = message.trim();
  if (!normalized || !PROFILE_FACT_TRIGGER.test(normalized)) {
    return;
  }

  const displayNameUsagePreference = extractDisplayNameUsagePreference(normalized);
  if (displayNameUsagePreference) {
    await rememberUserProfileFact(
      walletAddress,
      NAME_ADDRESSING_PREFERENCE_KEY,
      displayNameUsagePreference,
    );
    return;
  }

  const explicitName = extractExplicitDisplayName(normalized);
  if (explicitName) {
    await rememberUserProfileFact(walletAddress, 'display_name', explicitName);
    return;
  }

  if (isProfileFactQuestion(normalized)) {
    return;
  }

  const rawExtraction = await callHermesFast(
    `Extract user facts from the message.
Return JSON only with this exact shape:
{"name": string | null, "preference": string | null, "note": string | null}

Rules:
- "name" is only for the user's display name.
- "preference" is only for stable user preferences they want remembered.
- "note" is only for a durable fact worth remembering that is not just the preference.
- Return null for fields not mentioned.
- Do not infer a name from a question.
- Never return markdown or explanation.`,
    normalized,
  );
  const extracted = parseExtractedProfileFacts(rawExtraction);
  if (!extracted) {
    return;
  }

  if (typeof extracted.preference === 'string' && extracted.preference.trim()) {
    const preference = extracted.preference.trim();
    const preferenceKey = /\bdeep research\b/i.test(preference)
      ? 'research_mode'
      : 'general_preference';
    await rememberUserProfileFact(walletAddress, preferenceKey, preference);
  }

  if (typeof extracted.note === 'string' && extracted.note.trim()) {
    await rememberUserProfileFact(walletAddress, 'memory_notes', extracted.note.trim());
  }
}

function resolveBrainWalletAddress(
  walletAddress: unknown,
  sessionId?: unknown,
): Address | undefined {
  if (typeof walletAddress === 'string' && isAddress(walletAddress)) {
    return getAddress(walletAddress);
  }
  if (typeof sessionId === 'string' && isAddress(sessionId)) {
    return getAddress(sessionId);
  }
  return undefined;
}

type DirectAgentFlowRoute =
  | {
      type: 'tool';
      tool:
        | 'get_balance'
        | 'get_portfolio'
        | 'swap_tokens'
        | 'vault_action'
        | 'predict_action'
        | 'bridge_precheck'
        | 'agentpay_send'
        | 'agentpay_request';
      args: Record<string, unknown>;
      postActionNote?: string;
      quickActionGroups?: Array<{
        title?: string;
        actions: Array<{
          label: string;
          prompt: string;
          actionId?: string;
          tone?: 'primary' | 'secondary';
        }>;
      }>;
    }
  | {
      type: 'reply';
      text: string;
      quickActionGroups?: Array<{
        title?: string;
        actions: Array<{
          label: string;
          prompt: string;
          actionId?: string;
          tone?: 'primary' | 'secondary';
        }>;
      }>;
    };

function normalizeDirectRouteMessage(message: string): string {
  return message.trim().replace(/[!?.]+$/g, '').trim();
}

function parseQuickActionIntent(actionId: unknown, rawMessage: string): AgentFlowIntent | null {
  if (typeof actionId !== 'string') {
    return null;
  }

  switch (actionId.trim()) {
    case AgentFlowIntentName.VaultList:
      return {
        domain: AgentFlowDomain.Vault,
        intent: AgentFlowIntentName.VaultList,
        slots: {},
        confidence: 1,
        source: 'fastpath',
        raw_message: rawMessage,
      };
    case AgentFlowIntentName.VaultPosition:
      return {
        domain: AgentFlowDomain.Vault,
        intent: AgentFlowIntentName.VaultPosition,
        slots: {},
        confidence: 1,
        source: 'fastpath',
        raw_message: rawMessage,
      };
    default:
      return null;
  }
}

function getMostRecentAssistantMessage(history: BrainConversationMessage[] = []): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (item?.role === 'assistant' && typeof item.content === 'string' && item.content.trim()) {
      return item.content.trim();
    }
  }
  return '';
}

function isTelegramProductQuestion(normalized: string): boolean {
  return (
    /\btelegram\b/i.test(normalized) &&
    (/(?:^|\b)(?:what|how|why|which|explain|tell\s+me\s+about)\b/i.test(normalized) ||
      /\bwhat\s+is\b/i.test(normalized) ||
      /\bhow\s+does\b/i.test(normalized) ||
      /\b(?:connect|link|use)\b/i.test(normalized))
  );
}

function buildTelegramHelpRoute(): DirectAgentFlowRoute {
  return {
    type: 'reply',
    text: [
      'You can link AgentFlow to Telegram and keep using the same account there.',
      '',
      'Connect the same wallet on the web app first, then open AgentFlow in Telegram.',
      '',
      'Swaps, research, and AgentPay features work in Telegram.',
      '',
      'Do you want setup steps or do you want to see what works in Telegram?',
    ].join('\n'),
    quickActionGroups: [
      {
        title: 'Telegram',
        actions: [
          { label: 'Show setup steps', prompt: 'how do i connect telegram' },
          { label: 'What works there?', prompt: 'what works in telegram' },
          { label: 'Telegram notifications', prompt: 'how do telegram notifications work', tone: 'secondary' },
        ],
      },
    ],
  };
}

function buildTelegramSetupReply(): string {
  return [
    'To use AgentFlow in Telegram, connect the same wallet on the web app first.',
    '',
    'Then open AgentFlow in Telegram and it will carry over that linked account.',
    '',
    'Once linked, you can continue swaps, research, and AgentPay flows there.',
  ].join('\n');
}

function buildTelegramCapabilitiesReply(): string {
  return [
    'In Telegram, AgentFlow supports swaps, research, and AgentPay features.',
    '',
    'That includes requests, payment links, invoices, contacts, schedules, split payments, and batch payouts.',
    '',
    'If Telegram is linked, AgentFlow can also notify you there when longer research finishes.',
  ].join('\n');
}

function isShortReferentialFollowup(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    /\bwhat(?:'s| is)\s+that\b/i.test(normalized) ||
    /\bwhat\s+do\s+you\s+mean(?:\s+by\s+that)?\b/i.test(normalized) ||
    /\bintroductory\s+skills\b/i.test(normalized)
  );
}

function isClearlyOffTopicAssistantReply(text: string): boolean {
  if (!text.trim()) return false;
  if (/\b(?:screen capture|unity asset store|jonah'?s ladder|skill package)\b/i.test(text)) {
    return true;
  }
  if (
    /\b(?:introductory|note taking)\b/i.test(text) &&
    !/\b(?:agentflow|agentpay|arc|usdc|eurc|gateway|vault|portfolio|swap|bridge|research|vision|transcribe|invoice|schedule|split|batch)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

function buildReferentialRecoveryReply(lastAssistantMessage: string): string {
  if (
    /\b(?:introductory|note taking)\b/i.test(lastAssistantMessage) ||
    /\b(?:screen capture|unity asset store|jonah'?s ladder|skill package)\b/i.test(lastAssistantMessage)
  ) {
    return "That previous reply was wrong and unrelated to AgentFlow. \"Introductory skills\" is not an AgentFlow product or capability here. I misread the context instead of grounding on the actual conversation.\n\nIn AgentFlow, the relevant capabilities are things like swaps, vault actions, bridging, portfolio views, research, vision, transcribe, and AgentPay workflows.";
  }

  return "That refers to my previous message. I should answer it directly from the last AgentFlow reply instead of guessing from unrelated context.";
}

function isBridgeOverviewReply(text: string): boolean {
  return (
    /\bbridge\s+to\s+arc\s+starts\s+from\s+the\s+source\s+chain\b/i.test(text) ||
    /\bsupported\s+sources\s+include\b/i.test(text) ||
    /\bsay\s+["']?i\s+want\s+to\s+bridge/i.test(text)
  );
}

function isBridgeWordingFollowup(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(?:different|diffrent|another|other|alternate|alternative)\s+(?:word|words|phrase|phrasing|way)\b/i.test(normalized) ||
    /\b(?:what|which)\s+(?:else|other)\s+can\s+i\s+say\b/i.test(normalized) ||
    /\bcan\s+i\s+say\s+(?:it\s+)?(?:another|different|diffrent|other)\s+way\b/i.test(normalized) ||
    /\b(?:rephrase|phrase\s+it|say\s+instead)\b/i.test(normalized)
  );
}

function buildBridgeWordingFollowupReply(): string {
  return [
    'Yes. For bridge, you can use natural wording like:',
    '',
    '- "I want to bridge"',
    '- "Move USDC to Arc"',
    '- "Bridge 1 USDC from Codex Testnet to Arc"',
    '- "Check which source chains have USDC and gas"',
    '- "Use Codex Testnet as the source"',
    '',
    'If you only say the source chain, I will ask for the amount. If you only say the amount after that, I will continue the bridge draft.',
  ].join('\n');
}

function isVoiceToTextAssistantReply(text: string): boolean {
  return /\b(?:voice\s+to\s+text|dictation|mic(?:rophone)?|transcribe)\b/i.test(text);
}

function isVoiceToTextIntent(message: string): boolean {
  return /\b(?:voice\s+to\s+text|voice-to-text|dictation|dictate|mic(?:rophone)?|transcribe|speech\s+to\s+text)\b/i.test(
    message,
  );
}

function buildVoiceToTextGuideReply(): string {
  return [
    'Use the mic button in the chat composer.',
    '',
    '1. Click the mic icon beside the send button.',
    '2. Allow microphone permission if the browser asks.',
    '3. Speak naturally.',
    '4. Click the mic again to stop.',
    '5. AgentFlow transcribes your speech into the input box, then you can edit or send it.',
    '',
    'If the wrong mic is selected, use the small dropdown next to the mic icon and choose the correct input.',
  ].join('\n');
}

function hasSequentialIntentCue(message: string): boolean {
  return /\b(?:and|then|after|afterward|afterwards|next|also|follow(?:ed)?\s+with|follow(?:ed)?\s+by|once\s+(?:done|complete|completed|it\s+is\s+done)|when\s+(?:done|complete|completed)|one\s+by\s+one|a2a)\b|[,;]/i.test(
    message,
  );
}

function hasPortfolioFollowupIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  const asksForPortfolio =
    /\b(?:portfolio|holdings|positions|wallet|funds)\b/i.test(normalized) &&
    /\b(?:report|summary|summar(?:y|ize)|analysis|analy(?:s|z)e|scan|review|show|generate|create|prepare|write|explain|break\s*down|walk\s+me\s+through)\b/i.test(
      normalized,
    );
  const asksForReportAfterExecution =
    /\b(?:generate|create|prepare|write|make|pull|produce|build|genrate|genrerate|genraate)\b[\s\S]{0,40}\b(?:report|summary|analysis)\b/i.test(
      normalized,
    ) && /\b(?:portfolio|holdings|positions|wallet|funds)\b/i.test(normalized);
  const asksToExplainPortfolio =
    /\b(?:explain|break\s*down|walk\s+me\s+through)\b[\s\S]{0,40}\b(?:portfolio|holdings|positions|wallet|funds)\b/i.test(
      normalized,
    );
  return asksForPortfolio || asksForReportAfterExecution || asksToExplainPortfolio;
}

function hasResearchFollowupIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  return (
    hasSequentialIntentCue(normalized) &&
    /\b(?:research|verify|reputation|background|risk|due\s+diligence|look\s+up|investigate|analy(?:s|z)e)\b/i.test(
      normalized,
    )
  );
}

function isPortfolioSnapshotIntent(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  if (detectPortfolioImpactIntent(normalized)) return false;
  if (isPredictionMarketPositionIntent(normalized) || isPredictionMarketPositionHowToIntent(normalized)) {
    return false;
  }
  if (isVaultPositionIntent(normalized)) {
    return false;
  }
  if (
    /\b(?:swap|trade|convert|exchange|bridge|deposit|withdraw|stake|send|pay|invoice|request)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  return classifyPortfolioRequestMode(normalized) === 'snapshot';
}

function shouldClarifyPortfolioRequest(message: string): boolean {
  return classifyPortfolioRequestMode(message) === 'clarify';
}

function isPortfolioReferentialFollowup(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  return (
    /^(?:is|are|was|were)\b/i.test(normalized) ||
    /\b(?:that|this|it|the report above|above report|previous report)\b/i.test(normalized) ||
    /^(?:where\s+can\s+i\s+(?:see|view|find|open|check)\s+it|where\s+is\s+it|how\s+do\s+i\s+(?:see|view|find|open|check)\s+it)\??$/i.test(
      normalized,
    )
  );
}

function buildPortfolioCheckClarificationReply(): string {
  return [
    'I can check your current AgentFlow portfolio here.',
    '',
    'Do you want me to run the portfolio check now? It reads your live holdings and uses the paid Portfolio Agent.',
  ].join('\n');
}

function lastAssistantLooksLikePortfolioSnapshot(message: string): boolean {
  // Report-presence is read off the visible thread to decide referential follow-ups
  // ("is that my portfolio?", "is it good?"). Missing a real report here pushes the
  // follow-up into a fresh *paid* portfolio check, so the anchor set is intentionally
  // broad but still report-specific (section labels the agent emits, not casual chat).
  const hasReportAnchor = /\b(?:portfolio|holdings)\b/i.test(message);
  const hasReportSection =
    /\b(?:wallet tokens?|gateway reserve|vault shares?|vault position|prediction market positions?|total marked value|marked value|allocation|payment liquidity)\b/i.test(
      message,
    );
  return hasReportAnchor && hasReportSection;
}

function findRecentPortfolioSnapshotMessage(
  history: BrainConversationMessage[],
): string | null {
  return (
    [...history]
      .reverse()
      .slice(0, 24)
      .find(
        (turn) =>
          turn.role === 'assistant' &&
          lastAssistantLooksLikePortfolioSnapshot(turn.content),
      )?.content ?? null
  );
}

function hasRecentPortfolioConversationContext(
  history: BrainConversationMessage[],
): boolean {
  if (findRecentPortfolioSnapshotMessage(history)) {
    return true;
  }
  return [...history]
    .reverse()
    .slice(0, 24)
    .some(
      (turn) =>
        turn.role === 'assistant' &&
        /\b(?:portfolio|holdings|gateway reserve|vault shares?|allocation|payment liquidity)\b/i.test(
          turn.content,
        ),
    );
}

function buildPortfolioContextualFollowupReply(message: string): string {
  if (/^(?:is|are|was|were)\b/i.test(message.trim())) {
    return 'Yes. The report above is your current AgentFlow portfolio snapshot.';
  }
  return 'You already checked it in the report above. Whenever you want a fresh live snapshot, ask me to show your portfolio.';
}

function isReferentialNoAntecedentQuestion(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  return (
    words.length <= 12 &&
    /\b(?:it|that|this|there)\b/i.test(normalized) &&
    /^(?:where|what|which|how|is|are|was|were|do|does|did|can|could|should)\b/i.test(
      normalized,
    )
  );
}

function buildMissingReferentReply(): string {
  return 'What do you mean by “it” here — your portfolio report, wallet balance, vaults, or something else?';
}

function isPortfolioQualityReferentialFollowup(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  return (
    words.length <= 12 &&
    /\b(?:it|that|this)\b/i.test(normalized) &&
    /\b(?:good|bad|okay|ok|safe|risky|balanced|healthy|worth|fine|better)\b/i.test(
      normalized,
    )
  );
}

function shouldGroundPortfolioAdviceContinuation(
  message: string,
  history: BrainConversationMessage[],
): boolean {
  const normalized = message.trim();
  if (
    !/^(?:and\s+)?(?:(?:what\s+should\s+i\s+do\s+next|what\s+now|what(?:'s| is)\s+next|next\s+step|how\s+should\s+i\s+continue)|(?:should|could|would)\s+i\b[\s\S]{0,80}\b(?:invest|allocate|add|move|increase|decrease|reduce|change|do)\b[\s\S]*)\??$/i.test(
      normalized,
    ) &&
    !isPortfolioQualityReferentialFollowup(normalized)
  ) {
    return false;
  }
  return hasRecentPortfolioConversationContext(history);
}

function isVaultPositionIntent(message: string): boolean {
  if (isPredictionMarketPositionIntent(message) || isPredictionMarketPositionHowToIntent(message)) {
    return false;
  }
  const normalized = message.trim();
  if (!normalized) return false;
  return (
    /\bvault\b[\s\S]{0,40}\b(?:positions?|holdings?|shares?|balance|balances?)\b/i.test(normalized) ||
    /\b(?:positions?|holdings?|shares?|balance|balances?)\b[\s\S]{0,40}\bvault\b/i.test(normalized) ||
    /\bin my vault\b/i.test(normalized)
  );
}

function isPredictionMarketPositionHowToIntent(message: string): boolean {
  const normalized = normalizeDirectRouteMessage(message).toLowerCase();
  if (!normalized) return false;
  return (
    /\b(?:prediction|predmarket|market)\b/i.test(normalized) &&
    /\bpositions?\b/i.test(normalized) &&
    /\b(?:how\s+(?:do|can)\s+i\s+(?:check|see|view|show)|how\s+to\s+(?:check|see|view|show))\b/i.test(
      normalized,
    )
  );
}

function isPredictionMarketPositionIntent(message: string): boolean {
  const normalized = normalizeDirectRouteMessage(message)
    .toLowerCase()
    .replace(/^(?:and|also|then|ok(?:ay)?)\s+/i, '')
    .trim();
  if (!normalized) return false;
  if (isPredictionMarketPositionHowToIntent(normalized)) return false;

  const hasPredictionMarket =
    /\b(?:prediction\s+markets?|predmarket|market\s+positions?|predictions?)\b/i.test(normalized);
  const hasPosition = /\b(?:positions?|holdings?|holding|shares?|bets?)\b/i.test(normalized);
  const hasOwnPredictionShortcut = /\bmy\s+predictions\b/i.test(normalized);
  const asksWhichPredictionMarkets =
    /\bwhat\s+prediction\s+markets\s+am\s+i\s+in\b/i.test(normalized) ||
    /\bwhich\s+prediction\s+markets\s+am\s+i\s+in\b/i.test(normalized);
  const asksForOwn =
    /\bmy\b/i.test(normalized) ||
    /\b(?:am\s+i\s+in|i\s+hold|i\s+holding|do\s+i\s+have|do\s+i\s+own)\b/i.test(normalized);
  const asksToShow =
    /^(?:show|list|check|view|see|what(?:'s| is| are)?|where)\b/i.test(normalized);

  return (
    (hasPredictionMarket && hasPosition && (asksForOwn || asksToShow)) ||
    hasOwnPredictionShortcut ||
    asksWhichPredictionMarkets
  );
}

function extractBridgeAmount(message: string): string | undefined {
  const normalized = message
    .toLowerCase()
    .replace(/\b1o\b/g, '10')
    .replace(/\bio\b/g, '10')
    .replace(/\s+/g, ' ')
    .trim();

  const explicitNumeric =
    normalized.match(/\b(\d+(?:\.\d+)?)\b(?=\s*usdc\b)/i) ??
    normalized.match(/\b(\d+(?:\.\d+)?)\b/);
  if (explicitNumeric?.[1]) {
    return explicitNumeric[1];
  }

  const wordAmounts: Array<[RegExp, string]> = [
    [/\bhalf\b(?:\s+usdc)?\b/i, '0.5'],
    [/\bzero\s+point\s+five\b(?:\s+usdc)?\b/i, '0.5'],
    [/\bone\b(?:\s+usdc)?\b/i, '1'],
    [/\ba\s+couple(?:\s+of)?\b(?:\s+usdc)?\b/i, '2'],
    [/\bcouple(?:\s+of)?\b(?:\s+usdc)?\b/i, '2'],
    [/\btwo\b(?:\s+usdc)?\b/i, '2'],
    [/\bthree\b(?:\s+usdc)?\b/i, '3'],
    [/\bfour\b(?:\s+usdc)?\b/i, '4'],
    [/\bfive\b(?:\s+usdc)?\b/i, '5'],
    [/\bsix\b(?:\s+usdc)?\b/i, '6'],
    [/\bseven\b(?:\s+usdc)?\b/i, '7'],
    [/\beight\b(?:\s+usdc)?\b/i, '8'],
    [/\bnine\b(?:\s+usdc)?\b/i, '9'],
    [/\bten\b(?:\s+usdc)?\b/i, '10'],
  ];

  for (const [pattern, value] of wordAmounts) {
    if (pattern.test(normalized)) {
      return value;
    }
  }

  return undefined;
}

function isBridgePrecheckIntent(message: string): boolean {
  if (!/\bbridge\b/i.test(message)) {
    return false;
  }

  if (/\b(?:gas|balance|balances|enough|ready|readiness|source wallet)\b/i.test(message)) {
    return true;
  }

  if (
    /\busdc\b/i.test(message) &&
    /\b(?:check|has|have|enough|balance|balances)\b/i.test(message)
  ) {
    return true;
  }

  if (
    /\b(?:supported|support|available|which|what)\b/i.test(message) &&
    /\b(?:bridge|source)\s+chains?\b/i.test(message)
  ) {
    return true;
  }

  if (/\bcan you bridge from\b/i.test(message)) {
    return true;
  }

  return false;
}

function isBridgeCostOrSponsorshipQuestion(message: string): boolean {
  if (!/\bbridge\b/i.test(message)) {
    return false;
  }

  const asksAboutCostOrPayment =
    /\b(?:free|sponsor[a-z]*|sponser[a-z]*|costs?|fees?|charge[sd]?|paid|payment|paying|gateway\s+balance|gas|funds?|need|require[sd]?)\b/i.test(
      message,
    );
  if (!asksAboutCostOrPayment) {
    return false;
  }

  return (
    /^(?:and\s+|na+h?\s+|no+\s+|nah\s+)?(?:i\s+am\s+asking\s+)?(?:is|are|do|does|can|could|will|would|should|how|what|who|why)\b/i.test(
      message,
    ) ||
    /\b(?:i\s+am\s+asking|i'?m\s+asking|asking)\b/i.test(message) ||
    /\b(?:is|are)\s+(?:the\s+)?bridge\b/i.test(message) ||
    /\bbridge\b[\s\S]{0,40}\b(?:free|sponsor[a-z]*|sponser[a-z]*|costs?|fees?|gas|gateway\s+balance)\b/i.test(
      message,
    )
  );
}

function formatBridgeCostOrSponsorshipReply(): string {
  return (
    'Yes. The AgentFlow Bridge agent is sponsored in chat, so you do not need a Gateway balance for the bridge-agent fee. ' +
    'You still need enough USDC in the source wallet for the amount you want to bridge. ' +
    'When you want to execute, say something like: bridge 0.1 USDC from Ethereum Sepolia to Arc.'
  );
}

function isBareSupportedBridgeChainReply(message: string): boolean {
  return /^(?:eth(?:ereum)?(?:[\s-]+sep(?:olia)?)|base(?:[\s-]+sep(?:olia)?)?)$/i.test(
    message.trim(),
  );
}

function recentBridgeContextWantsPrecheck(history: BrainConversationMessage[] = []): boolean {
  const recentAssistant = [...history]
    .reverse()
    .find((entry) => entry.role === 'assistant' && typeof entry.content === 'string')
    ?.content ?? '';

  if (!/\bbridge\b/i.test(recentAssistant)) {
    return false;
  }

  if (/supported bridge source chains right now/i.test(recentAssistant)) {
    return false;
  }

  return /\b(?:gas|enough|source wallet|ready|readiness|precheck|check)\b/i.test(
    recentAssistant,
  );
}

function shouldHandleCounterpartyRiskRequest(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) return false;
  return (
    /\b(?:risk|reputation|trust|safe\s+to\s+pay|counterparty|background|due\s+diligence)\b/i.test(normalized) &&
    /\b(?:of|for|on|about|pay|send|invoice|contact)\b/i.test(normalized)
  );
}

function parseCounterpartyRiskRequest(message: string): {
  counterparty: string;
  amountUsdc?: number;
  purpose?: string;
} | null {
  const amountMatch = message.match(/\b(\d+(?:\.\d+)?)\s*USDC\b/i);
  const amountUsdc = amountMatch ? Number(amountMatch[1]) : undefined;
  const cleaned = message
    .replace(/\b(?:research|check|verify|analyze|analyse|run|show|tell\s+me)\b/gi, ' ')
    .replace(/\b(?:counterparty|payment|payee|recipient|contact|vendor)?\s*(?:risk|reputation|trust|background|due\s+diligence)\b/gi, ' ')
    .replace(/\b(?:is|for|of|on|about|to|pay|send|invoice|safe|safe\s+to\s+pay|with|USDC)\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/[?.,;:!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const token = cleaned.split(/\s+/).find((part) =>
    /^0x[a-fA-F0-9]{40}$/.test(part) || /^[a-z0-9][a-z0-9_.-]{1,63}(?:\.arc)?$/i.test(part),
  );
  if (!token) return null;
  return {
    counterparty: token,
    amountUsdc: Number.isFinite(amountUsdc) ? amountUsdc : undefined,
    purpose: /invoice/i.test(message) ? 'invoice' : /schedule/i.test(message) ? 'scheduled payment' : 'payment',
  };
}

function portfolioA2aPostActionNote(agentName: string): string {
  return `After you confirm, the ${agentName} will trigger the portfolio agent through A2A to generate the portfolio report.`;
}

function researchA2aPostActionNote(agentName: string): string {
  return `After you confirm, the ${agentName} will trigger the research agent through A2A for the requested follow-up.`;
}

type PortfolioA2aBuyer = 'swap' | 'vault' | 'bridge' | 'batch' | 'split';
type RequestedPortfolioA2a = {
  buyerAgentSlug: PortfolioA2aBuyer;
  trigger: string;
};

function requestedPortfolioA2aKey(sessionId: string): string {
  return `chat:requested-portfolio-a2a:${canonicalRedisSessionId(sessionId)}`;
}

async function storeRequestedPortfolioA2a(
  sessionId: string,
  value: RequestedPortfolioA2a,
): Promise<void> {
  await getRedis().set(requestedPortfolioA2aKey(sessionId), JSON.stringify(value), 'EX', 300);
}

async function takeRequestedPortfolioA2a(sessionId: string): Promise<RequestedPortfolioA2a | null> {
  const key = requestedPortfolioA2aKey(sessionId);
  const raw = await getRedis().get(key).catch(() => null);
  await getRedis().del(key).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      buyerAgentSlug?: unknown;
      trigger?: unknown;
    };
    const allowed: PortfolioA2aBuyer[] = ['swap', 'vault', 'bridge', 'batch', 'split'];
    if (allowed.includes(parsed.buyerAgentSlug as PortfolioA2aBuyer) && typeof parsed.trigger === 'string' && parsed.trigger.trim()) {
      return {
        buyerAgentSlug: parsed.buyerAgentSlug as PortfolioA2aBuyer,
        trigger: parsed.trigger.trim(),
      };
    }
  } catch {}
  return null;
}

function requestedInvoiceResearchA2aKey(sessionId: string): string {
  return `chat:requested-invoice-research-a2a:${canonicalRedisSessionId(sessionId)}`;
}

async function storeRequestedInvoiceResearchA2a(sessionId: string): Promise<void> {
  await getRedis().set(requestedInvoiceResearchA2aKey(sessionId), '1', 'EX', 300);
}

async function takeRequestedInvoiceResearchA2a(sessionId: string): Promise<boolean> {
  const key = requestedInvoiceResearchA2aKey(sessionId);
  const raw = await getRedis().get(key).catch(() => null);
  await getRedis().del(key).catch(() => null);
  return raw === '1';
}

function agentDisplayName(slug: string): string {
  return `${slug.charAt(0).toUpperCase()}${slug.slice(1)} Agent`;
}

function formatPortfolioMoney(value: unknown, digits = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }
  return numeric.toFixed(digits);
}

function roundPortfolioUsd(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function formatPortfolioAmount(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  if (numeric === 0) {
    return '0';
  }
  if (Math.abs(numeric) < 0.001) {
    return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (Math.abs(numeric) < 1) {
    return numeric.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  return numeric.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatSignedPortfolioMoney(value: unknown, digits = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '$0.00';
  }
  const prefix = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  const abs = Math.abs(numeric);
  const precision = abs >= 0.01 ? digits : abs >= 0.0001 ? 4 : 6;
  return `${prefix}$${abs.toFixed(precision)}`;
}

function formatSignedPortfolioPercent(value: unknown, digits = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0.00%';
  }
  const prefix = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  const abs = Math.abs(numeric);
  const precision = abs >= 0.01 ? digits : abs >= 0.0001 ? 4 : 6;
  return `${prefix}${abs.toFixed(precision)}%`;
}

function stripSensitivePortfolioReport(report: string): string {
  return report
    .replace(/^Wallet scanned:.*$/gim, '')
    .replace(/^Risk score:.*$/gim, '')
    .replace(/^Portfolio Analysis for.*$/gim, 'Portfolio analysis')
    .replace(/^Methodology\s*$/gim, '')
    .replace(/^Research Pipeline\s*$/gim, '')
    .replace(/^.*\beth_getBalance\b.*$/gim, '')
    .replace(/^.*\bbalanceOf\b.*$/gim, '')
    .replace(/^.*\bArcscan\b.*$/gim, '')
    .replace(/^.*\bGateway data not required\b.*$/gim, '')
    .replace(/0x[a-fA-F0-9]{40}/g, '[wallet]')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function summarizePortfolioA2aPayload(payload: Record<string, unknown>): string[] {
  const holdings = Array.isArray(payload.holdings)
    ? (payload.holdings as Array<Record<string, unknown>>)
    : [];
  const positions = Array.isArray(payload.positions)
    ? (payload.positions as Array<Record<string, unknown>>)
    : [];
  const recommendations = Array.isArray(payload.recommendations)
    ? payload.recommendations.map((item) => String(item)).filter(Boolean)
    : [];
  const pnl =
    payload.pnl && typeof payload.pnl === 'object'
      ? (payload.pnl as Record<string, unknown>)
      : payload.pnlSummary && typeof payload.pnlSummary === 'object'
        ? (payload.pnlSummary as Record<string, unknown>)
      : null;
  const formatHoldingSummary = (holding: Record<string, unknown>): string => {
    const symbol = String(holding.symbol || holding.name || 'Asset').trim();
    const balance = formatPortfolioAmount(holding.balanceFormatted);
    const usdValue = Number(holding.usdValue ?? 0);
    if (!symbol || !balance) {
      return '';
    }
    if (Number.isFinite(usdValue) && usdValue > 0) {
      return `${balance} ${symbol} ($${formatPortfolioMoney(usdValue)})`;
    }
    return `${balance} ${symbol}`;
  };
  const formatPositionSummary = (position: Record<string, unknown>): string => {
    const name = String(position.name || position.protocol || 'Position').trim();
    const amountRaw = position.amountFormatted;
    const amount =
      typeof amountRaw === 'string'
        ? amountRaw.trim()
        : formatPortfolioAmount(amountRaw);
    const usdValue = Number(position.usdValue ?? 0);
    if (!name) {
      return '';
    }
    if (amount) {
      return `${name}: ${amount}${usdValue > 0 ? ` ($${formatPortfolioMoney(usdValue)})` : ''}`;
    }
    if (usdValue > 0) {
      return `${name}: $${formatPortfolioMoney(usdValue)}`;
    }
    return name;
  };
  const positiveHoldings = holdings
    .filter((holding) => Number(holding.usdValue ?? 0) > 0 || Number(holding.balanceFormatted ?? 0) > 0);
  const tokenHoldings = positiveHoldings
    .filter((holding) => String(holding.kind || '') !== 'vault_share')
    .sort((left, right) => Number(right.usdValue ?? 0) - Number(left.usdValue ?? 0))
    .slice(0, 6)
    .map(formatHoldingSummary)
    .filter(Boolean);
  const vaultShareHoldings = positiveHoldings
    .filter((holding) => String(holding.kind || '') === 'vault_share')
    .map(formatHoldingSummary)
    .filter(Boolean);
  const positivePositions = positions
    .filter((position) => Number(position.usdValue ?? 0) > 0 || Number(position.amountFormatted ?? 0) > 0);
  const gatewayPositionRows = positions.filter(
    (position) => String(position.kind || '') === 'gateway_position',
  );
  const lpPositions = positivePositions
    .filter((position) => String(position.kind || '') === 'swap_liquidity')
    .map(formatPositionSummary)
    .filter(Boolean);
  const gatewayPositions = positivePositions
    .filter((position) => String(position.kind || '') === 'gateway_position')
    .map(formatPositionSummary)
    .filter(Boolean);
  const otherPositions = positivePositions
    .filter((position) => {
      const kind = String(position.kind || '');
      return kind !== 'swap_liquidity' && kind !== 'gateway_position';
    })
    .map(formatPositionSummary)
    .filter(Boolean);

  const totalValue =
    pnl && typeof pnl.currentValueUsd === 'number'
      ? Number(pnl.currentValueUsd)
      : Number.NaN;
  const pnlUsd =
    pnl && typeof pnl.pnlUsd === 'number'
      ? Number(pnl.pnlUsd)
      : Number.NaN;
  const pnlPct =
    pnl && typeof pnl.pnlPct === 'number'
      ? Number(pnl.pnlPct)
      : Number.NaN;
  const costBasisUsd =
    pnl && typeof pnl.costBasisUsd === 'number'
      ? Number(pnl.costBasisUsd)
      : Number.NaN;
  const gatewayValueUsd = roundPortfolioUsd(
    gatewayPositionRows.reduce((sum, position) => sum + Number(position.usdValue ?? 0), 0),
  );
  const gatewayCostBasisUsd = roundPortfolioUsd(
    gatewayPositionRows.reduce((sum, position) => sum + Number(position.costBasisUsd ?? 0), 0),
  );
  const gatewayPnlUsd = roundPortfolioUsd(
    gatewayPositionRows.reduce((sum, position) => sum + Number(position.pnlUsd ?? 0), 0),
  );
  const stableSymbols = new Set(['USDC', 'EURC', 'USDT', 'DAI', 'PYUSD', 'USDS', 'FRAX']);
  const tokenSymbols = positiveHoldings
    .filter((holding) => String(holding.kind || '') !== 'vault_share')
    .map((holding) => String(holding.symbol || '').toUpperCase())
    .filter(Boolean);
  const stableOnlyWallet =
    tokenSymbols.length > 0 &&
    tokenSymbols.every((symbol) => stableSymbols.has(symbol)) &&
    lpPositions.length === 0 &&
    otherPositions.length === 0;
  const walletOnlyTotalValue =
    Number.isFinite(totalValue) ? Math.max(0, roundPortfolioUsd(totalValue - gatewayValueUsd)) : Number.NaN;
  const walletOnlyCostBasisUsd =
    Number.isFinite(costBasisUsd)
      ? Math.max(0, roundPortfolioUsd(costBasisUsd - gatewayCostBasisUsd))
      : Number.NaN;
  const walletOnlyPnlUsd =
    Number.isFinite(pnlUsd) ? roundPortfolioUsd(pnlUsd - gatewayPnlUsd) : Number.NaN;
  const walletOnlyPnlPct =
    Number.isFinite(walletOnlyCostBasisUsd) && walletOnlyCostBasisUsd > 0 && Number.isFinite(walletOnlyPnlUsd)
      ? (walletOnlyPnlUsd / walletOnlyCostBasisUsd) * 100
      : Number.NaN;
  const usableRecommendation = recommendations.find(
    (item) =>
      item.trim().length > 0 &&
      !/\b(?:test|testing|simulate|simulation|network conditions|stability of execution|demo)\b/i.test(
        item,
      ),
  );
  let nextStep = usableRecommendation || '';
  if (!nextStep) {
    if (vaultShareHoldings.length > 0 && tokenHoldings.length > 0) {
      nextStep =
        'Decide how much should stay liquid in the wallet versus remain in the vault for yield.';
    } else if (gatewayPositions.length > 0) {
      nextStep =
        'Check whether Gateway funds need to stay parked there or be moved back to the execution wallet for your next action.';
    } else if (tokenHoldings.length > 0) {
      nextStep =
        'Most of this wallet is sitting in liquid token balances, so the next decision is whether to keep it idle, move some into the vault, or leave it untouched.';
    }
  }

  const lines = ['Current balances after this action:', ''];
  lines.push(
    tokenHoldings.length > 0
      ? `- Token balances: ${tokenHoldings.join(', ')}`
      : '- Token balances: no tracked token balances found.',
  );
  lines.push(
    vaultShareHoldings.length > 0
      ? `- Vault shares: ${vaultShareHoldings.join(', ')}`
      : '- Vault shares: none found.',
  );
  lines.push(
    gatewayPositions.length > 0
      ? `- Gateway reserve: ${gatewayPositions.join('; ')}`
      : '- Gateway reserve: none found.',
  );
  if (otherPositions.length > 0) {
    lines.push(`- Other positions: ${otherPositions.join('; ')}`);
  }
  const displayedPnlUsd = gatewayPositions.length > 0 ? walletOnlyPnlUsd : pnlUsd;
  const displayedPnlPct = gatewayPositions.length > 0 ? walletOnlyPnlPct : pnlPct;
  if (Number.isFinite(displayedPnlUsd) && Number.isFinite(displayedPnlPct)) {
    const pnlLine = gatewayPositions.length > 0
      ? `- Wallet PnL (excluding Gateway): ${formatSignedPortfolioMoney(displayedPnlUsd)} (${formatSignedPortfolioPercent(displayedPnlPct)})`
      : `- PnL: ${formatSignedPortfolioMoney(displayedPnlUsd)} (${formatSignedPortfolioPercent(displayedPnlPct)})`;
    lines.push(
      stableOnlyWallet &&
      Number.isFinite(gatewayPositions.length > 0 ? walletOnlyCostBasisUsd : costBasisUsd) &&
      (gatewayPositions.length > 0 ? walletOnlyCostBasisUsd : costBasisUsd) > 0
        ? `${pnlLine}. For a stablecoin-only wallet, this mostly reflects swap fees and tracked flows rather than market-price volatility.`
        : pnlLine,
    );
  }
  if (gatewayPositions.length > 0 && Number.isFinite(walletOnlyTotalValue) && walletOnlyTotalValue > 0) {
    lines.push(`- Wallet marked value (excluding Gateway): $${formatPortfolioMoney(walletOnlyTotalValue)}`);
  } else if (Number.isFinite(totalValue) && totalValue > 0) {
    lines.push(`- Total marked value: $${formatPortfolioMoney(totalValue)}`);
  }
  if (gatewayPositions.length > 0 && Number.isFinite(totalValue) && totalValue > 0) {
    lines.push(`- Combined wallet + Gateway reserve: $${formatPortfolioMoney(totalValue)}`);
  }
  if (nextStep) {
    lines.push(`- Next step: ${nextStep}`);
  }
  return lines;
}

function formatPortfolioA2aReport(
  payload: Record<string, unknown> | null,
  _buyerAgentSlug: PortfolioA2aBuyer,
): string {
  if (!payload) {
    return 'Portfolio Agent did not return a report payload.';
  }
  const conciseSummary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
  if (conciseSummary) {
    return conciseSummary;
  }
  const report = typeof payload.report === 'string' ? payload.report.trim() : '';
  const structuredSummary = summarizePortfolioA2aPayload(payload);
  const hasStructuredPortfolioData =
    (Array.isArray(payload.holdings) && payload.holdings.length > 0) ||
    (Array.isArray(payload.positions) && payload.positions.length > 0) ||
    Boolean(payload.pnl);

  if (hasStructuredPortfolioData) {
    const snapshotMd = formatPortfolioSnapshotRecordsForChat({
      holdings: (payload.holdings as Array<Record<string, unknown>>) ?? [],
      positions: (payload.positions as Array<Record<string, unknown>>) ?? [],
      recentTransactions: (payload.recentTransactions as Array<Record<string, unknown>>) ?? [],
      pnl:
        payload.pnl && typeof payload.pnl === 'object'
          ? (payload.pnl as Record<string, unknown>)
          : payload.pnlSummary && typeof payload.pnlSummary === 'object'
            ? (payload.pnlSummary as Record<string, unknown>)
            : null,
    });
    if (report) {
      return `${snapshotMd}\n\n## Analysis\n\n${stripSensitivePortfolioReport(report)}`.trim();
    }
    return snapshotMd.trim();
  }

  if (report && !hasStructuredPortfolioData) {
    const safeReport = stripSensitivePortfolioReport(report);
    if (safeReport && safeReport !== 'Portfolio analysis') {
      const safeHighlights = safeReport
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter(
          (line) =>
            !/^current holdings$/i.test(line) &&
            !/^risk assessment$/i.test(line) &&
            !/^recommendations:?$/i.test(line),
        )
        .slice(0, 3);
      if (safeHighlights.length > 0) {
        structuredSummary.push(...safeHighlights);
      }
    }
  }

  return structuredSummary.join('\n').trim();
}

function formatResearchA2aReport(
  payload: Record<string, unknown> | null,
  buyerAgentSlug: 'invoice' | 'vision',
): string {
  if (!payload) {
    return 'Research Agent did not return a report payload.';
  }
  const task = typeof payload.task === 'string' ? payload.task.trim() : '';
  const result = sanitizeResearchA2aVisibleResult(payload, buyerAgentSlug);
  const lines = [`A2A complete: ${agentDisplayName(buyerAgentSlug)} -> Research Agent`, '', 'Research report:'];
  if (task) lines.push(`Task: ${task}`);
  if (result) lines.push('', result);
  return lines.join('\n').trim();
}

function sanitizeResearchA2aVisibleResult(
  payload: Record<string, unknown>,
  buyerAgentSlug: 'invoice' | 'vision',
): string {
  const raw = typeof payload.result === 'string' ? payload.result.trim() : '';
  const textWithoutJson = stripTrailingStructuredJson(raw).trim();
  if (textWithoutJson) return textWithoutJson;

  const structured =
    payload.structured && typeof payload.structured === 'object'
      ? (payload.structured as Record<string, unknown>)
      : payload.report && typeof payload.report === 'object'
        ? (payload.report as Record<string, unknown>)
        : null;
  if (!structured) return raw && !looksLikeRawStructuredJson(raw) ? raw : '';

  const summary =
    typeof structured.executive_summary === 'string'
      ? structured.executive_summary.trim()
      : typeof structured.summary === 'string'
        ? structured.summary.trim()
        : '';
  const facts = Array.isArray(structured.facts)
    ? structured.facts
        .map((fact) =>
          fact && typeof fact === 'object'
            ? String((fact as Record<string, unknown>).claim ?? '').trim()
            : String(fact ?? '').trim(),
        )
        .filter(Boolean)
        .slice(0, buyerAgentSlug === 'vision' ? 4 : 3)
    : [];
  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (facts.length > 0) parts.push(facts.map((fact) => `- ${fact}`).join('\n'));
  return parts.join('\n\n').trim();
}

function stripTrailingStructuredJson(text: string): string {
  if (!text) return '';
  const jsonStart = findTrailingStructuredJsonStart(text);
  if (jsonStart < 0) return text;
  return text.slice(0, jsonStart).trim();
}

function findTrailingStructuredJsonStart(text: string): number {
  const candidates = ['{ "topic"', '{"topic"', '{\n  "topic"', '{\r\n  "topic"', '{ "executive_summary"', '{"executive_summary"'];
  for (const candidate of candidates) {
    const index = text.indexOf(candidate);
    if (index >= 0 && looksLikeRawStructuredJson(text.slice(index))) return index;
  }
  return -1;
}

function looksLikeRawStructuredJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return false;
  if (!/"(?:topic|scope|executive_summary|facts|recent_developments|metrics|sources)"\s*:/.test(trimmed)) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return trimmed.length > 500 && /"facts"\s*:\s*\[/.test(trimmed);
  }
}

async function executePortfolioAgentForChat(input: {
  userWalletAddress: string;
  sessionId: string;
  fallback: () => Promise<string>;
}): Promise<string> {
  try {
    if (await isAgentHealthy('portfolio')) {
      const paid = await executeDcwPaidAgentViaX402<Record<string, unknown>>({
        userWalletAddress: input.userWalletAddress.trim(),
        agent: 'portfolio',
        price: portfolioPrice,
        url: PORTFOLIO_URL,
        requestId: `portfolio_chat_${canonicalRedisSessionId(input.sessionId)}_${Date.now()}`,
      });
      const data = paid.data ?? {};
      const errMsg = typeof data.error === 'string' ? data.error.trim() : '';
      const failed =
        paid.status < 200 ||
        paid.status >= 300 ||
        data.success === false ||
        Boolean(errMsg);
      if (!failed) {
        appendRecentExecutionEntries(input.sessionId, [paid.paymentEntry]);
        return formatPaidPortfolioAgentChatBody(data, portfolioPrice);
      }
    }
  } catch (err) {
    console.warn(
      '[chat/respond] paid portfolio agent failed:',
      getErrorMessage(err),
    );
  }
  return input.fallback();
}

function isRequestedPortfolioA2aSuccess(requested: RequestedPortfolioA2a, result: string): boolean {
  if (requested.buyerAgentSlug === 'swap') return /^Executed swap:/i.test(result);
  if (requested.buyerAgentSlug === 'vault') {
    return /^Executed (deposit|withdraw):/i.test(result) || /Vault (deposit|withdrawal) complete/i.test(result);
  }
  if (requested.buyerAgentSlug === 'bridge') return /Bridged/i.test(result) && /USDC to Arc/i.test(result);
  return /\b(success|complete|sent|executed)\b/i.test(result);
}

async function appendRequestedPortfolioA2aReport(input: {
  baseMessage: string;
  requested: RequestedPortfolioA2a | null;
  userWalletAddress: string;
  details: unknown;
  sessionId?: string;
}): Promise<string> {
  if (!input.requested || !input.userWalletAddress) return input.baseMessage;
  if (typeof input.baseMessage === 'string' && !isRequestedPortfolioA2aSuccess(input.requested, input.baseMessage)) {
    return input.baseMessage;
  }
  try {
    const portfolioFollowup = await runPortfolioFollowupAfterToolWithPayment({
      buyerAgentSlug: input.requested.buyerAgentSlug,
      userWalletAddress: input.userWalletAddress,
      portfolioRunUrl: PORTFOLIO_URL,
      portfolioPriceLabel: portfolioPrice,
      trigger: input.requested.trigger,
      details: input.details,
    });
    if (input.sessionId && portfolioFollowup.paymentEntry) {
      appendRecentExecutionEntries(input.sessionId, [portfolioFollowup.paymentEntry]);
    }
    return `${input.baseMessage}\n\n${formatPortfolioA2aReport(portfolioFollowup.data, input.requested.buyerAgentSlug)}`;
  } catch (a2aErr) {
    const msg = a2aErr instanceof Error ? a2aErr.message : String(a2aErr);
    console.warn('[a2a] requested portfolio follow-up failed:', msg);
    return `${input.baseMessage}\n\nA2A portfolio report failed: ${msg}`;
  }
}

function shouldUseSemanticScheduleResolver(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(?:yes|no|confirm|cancel|y|n|yeah|yep|nope)$/i.test(normalized)) return false;
  return (
    /\b(?:scheduled?|recurring|autopay|automatic payment|next run)\b/i.test(normalized) ||
    /\b(?:daily|weekly|monthly)\b/i.test(normalized) ||
    (/\b(?:pay|send|transfer)\b/i.test(normalized) &&
      /\b(?:tomorrow|tonight|later|morning|afternoon|evening|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+\d{1,2}(?:st|nd|rd|th)?|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i.test(normalized)) ||
    /\bevery\s+(?:day|week|month|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|\d{1,2}(?:st|nd|rd|th))\b/i.test(normalized) ||
    (/\b(?:pay|send|transfer)\b/i.test(normalized) && /\b(?:every|weekly|daily|monthly|recurring|scheduled)\b/i.test(normalized)) ||
    (/\b(?:cancel|delete|remove|stop)\b/i.test(normalized) && /\b(?:payment|payments|schedule|scheduled|recurring|latest|last|current|weekly|daily|monthly)\b/i.test(normalized)) ||
    (/\b(?:show|list|view|check|do i have|what are)\b/i.test(normalized) && /\b(?:scheduled|recurring)\s+payments?\b/i.test(normalized))
  );
}

function shouldHandleAsScheduleRequest(message: string): boolean {
  return shouldUseSemanticScheduleResolver(message);
}

function shouldHandleAsAgentPayHistoryRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (
    /\b(?:how|explain|about|format|example|examples)\b/i.test(normalized) &&
    /\b(?:split|batch|scheduled?|recurring|payment\s+link|pay\s+link|invoice|request)\b/i.test(normalized) &&
    !/\b(?:history|recent|latest|last|previous|earlier|records?|activity|transactions?)\b/i.test(normalized)
  ) {
    return false;
  }
  return (
    /\b(?:show|list|view|check|pull|get|see|display)\b[\s\S]{0,80}\b(?:agentpay|payment|payments|pay|paid|sent|received|transfer|transfers|transaction|transactions|activity|records?)\b/i.test(normalized) ||
    /\b(?:agentpay|payment|payments|pay|paid|sent|received|transfer|transfers|transaction|transactions|activity|records?)\b[\s\S]{0,80}\b(?:show|list|view|check|pull|get|see|display|history|records?|activity)\b/i.test(normalized) ||
    /\bwhat\s+(?:payments|transfers|transactions)\s+have\s+i\s+(?:sent|made|received)\b/i.test(normalized) ||
    /\bwhat\s+(?:payments|transfers|transactions)\s+did\s+i\s+(?:send|make|receive)\b/i.test(normalized) ||
    /\b(?:payments|transfers|transactions)\s+(?:i\s+)?(?:sent|made|received)\b/i.test(normalized) ||
    /\bwhat\s+have\s+i\s+(?:sent|paid|received)\b/i.test(normalized) ||
    /\bwhat\s+did\s+i\s+(?:pay|send|transfer|receive)(?:\s+(?:earlier|before|previously|recently|last|latest))?\b/i.test(normalized) ||
    /\b(?:payment|payments|pay|paid|sent|received|transfer|transfers|transaction|transactions)\b[\s\S]{0,80}\b(?:history|last|latest|recent|previous|earlier|happened)\b/i.test(normalized) ||
    /\b(?:history|last|latest|recent|previous|earlier|what happened)\b[\s\S]{0,80}\b(?:payment|payments|pay|paid|sent|received|transfer|transfers|transaction|transactions)\b/i.test(normalized) ||
    /\bagentpay\s+history\b/i.test(normalized)
  );
}

function buildAgentPayHistoryFastpathIntent(message: string): AgentFlowIntent | null {
  if (hasExplicitResearchReportRequest(message)) {
    return null;
  }
  if (!shouldHandleAsAgentPayHistoryRequest(message)) {
    return null;
  }
  const normalized = message.toLowerCase();
  const category = /\b(received|incoming|inbound)\b/i.test(normalized)
    ? 'received'
    : /\b(sent|paid|outgoing|outbound)\b/i.test(normalized)
      ? 'sent'
      : undefined;
  return {
    domain: AgentFlowDomain.AgentPay,
    intent: AgentFlowIntentName.AgentpayHistory,
    slots: {
      filter: {
        ...(category ? { category } : {}),
        ...(isAllAgentPayHistoryRequest(message) ? { limit: 10 } : {}),
      },
    },
    confidence: 0.96,
    source: 'fastpath',
    raw_message: message,
  };
}

function isAllAgentPayHistoryRequest(message: string): boolean {
  return /\b(?:all|full|entire|complete|everything|every)\b[\s\S]{0,60}\b(?:agentpay|payment|payments|transfer|transfers|transaction|transactions|history|records?)\b/i.test(message);
}

function normalizeBrowserTimeZone(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return undefined;
  }
}

function normalizeBrowserLocale(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  try {
    new Intl.DateTimeFormat(trimmed).format(new Date());
    return trimmed;
  } catch {
    return undefined;
  }
}

function parseServerTimestampUtc(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const direct = new Date(value);
    return Number.isNaN(direct.getTime()) ? null : direct;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const direct = new Date(raw);
    return Number.isNaN(direct.getTime()) ? null : direct;
  }
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const tagged = new Date(`${iso}Z`);
  return Number.isNaN(tagged.getTime()) ? null : tagged;
}

function formatTxHash(hash: unknown): string {
  const text = typeof hash === 'string' ? hash.trim() : '';
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-8)}` : text;
}

function describeAgentPayHistoryRow(row: Record<string, any>): string {
  const isIncoming = row.direction === 'in';
  const isOutgoing = row.direction === 'out';
  const actionType = typeof row.action_type === 'string' ? row.action_type.trim().toLowerCase() : '';
  if (actionType === 'agentpay_request') {
    return isOutgoing ? 'payment request paid' : 'payment request received';
  }
  if (actionType === 'agentpay_external') {
    return isOutgoing ? 'external send recorded' : 'external receive recorded';
  }
  if (actionType === 'agentpay_send') {
    return isOutgoing ? 'direct payment sent' : 'direct payment received';
  }
  return isIncoming ? 'incoming' : isOutgoing ? 'outgoing' : 'payment';
}

function formatAgentPayHistoryForChat(
  rows: Array<Record<string, any>>,
  options: {
    requestedLimit?: number;
    allRequested?: boolean;
    browserTimeZone?: string;
    browserLocale?: string;
  } = {},
): string {
  if (!rows.length) {
    return 'I checked AgentPay payment history for this wallet and found no payment records yet.';
  }

  const limit = Math.max(1, Math.min(10, Math.floor(options.requestedLimit ?? 10)));
  const visibleRows = rows.slice(0, limit);
  const timeZone = normalizeBrowserTimeZone(options.browserTimeZone);
  const locale = normalizeBrowserLocale(options.browserLocale) || 'en-US';
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    ...(timeZone ? { timeZone } : {}),
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const zoneLabel = timeZone ? ` (${timeZone})` : '';

  const lines = [
    options.allRequested
      ? `I can show the latest ${visibleRows.length} AgentPay records here. For full history, open the AgentPay history/export view.`
      : `Showing your latest ${visibleRows.length} AgentPay record${visibleRows.length === 1 ? '' : 's'}.`,
    '',
  ];

  for (const [index, row] of visibleRows.entries()) {
    const amount = row.amount ? `${row.amount} USDC` : 'unknown amount';
    const direction = describeAgentPayHistoryRow(row);
    const status = typeof row.status === 'string' && row.status.trim() ? row.status.trim() : 'recorded';
    const counterparty =
      row.direction === 'in'
        ? row.from_wallet || row.from || row.payer || ''
        : row.to_wallet || row.to || row.payee || '';
    const when = parseServerTimestampUtc(row.created_at);
    const whenText = when ? dateFormatter.format(when) : 'recently';
    const txHash = row.arc_tx_id ? String(row.arc_tx_id) : '';
    const txText = row.explorerLink
      ? `[${formatTxHash(txHash) || 'explorer'}](${row.explorerLink})`
      : txHash
        ? formatTxHash(txHash)
        : 'not available';

    lines.push(
      `${index + 1}. **${direction} ${amount}** - ${status}`,
      `   - Counterparty: ${counterparty || 'unknown'}`,
      `   - Time: ${whenText}${zoneLabel}`,
      `   - Tx: ${txText}`,
    );
  }

  if (rows.length > visibleRows.length) {
    lines.push('', `There are more records available. I’m showing ${visibleRows.length} in chat to keep it readable.`);
  }

  return lines.join('\n');
}

function formatAgentFlowCapabilityReply(message: string): string {
  if (isExplicitFullCapabilityRequest(message)) {
    return getAgentFlowCircleStackSummary();
  }
  return formatSharedAgentFlowCapabilityReply();
}

function buildExternalPersonUnknownReply(message: string): string | null {
  const match = message.trim().match(
    /^who\s+is\s+(.+?)\s+from\s+([a-z][a-z0-9 .&-]{1,60})\??$/i,
  );
  if (!match) return null;

  const personRaw = match[1]?.trim().replace(/\s+/g, ' ');
  const companyRaw = match[2]?.trim().replace(/\s+/g, ' ');
  if (!personRaw || !companyRaw) return null;

  const normalized = `${personRaw} ${companyRaw}`.toLowerCase();
  if (/\b(agentflow|you|your app|this app)\b/i.test(normalized)) {
    return null;
  }

  const person = personRaw
    .split(' ')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
  const company = /^cicle$/i.test(companyRaw) ? 'Circle' : companyRaw;
  return `I don't have information about ${person} from ${company} in my current context.`;
}

function formatAgentFlowDefinitionReply(): string {
  return formatSharedAgentFlowDefinitionReply();
}

function formatAgentFlowHowItWorksReply(): string {
  return formatSharedAgentFlowHowItWorksReply();
}

function isVaultApyLookup(normalizedProbe: string): boolean {
  // v2 vault: check_apy removed. Use action='list' which returns per-vault
  // live APY. Older saved scripts will need to be updated.
  return /\bvault\b/i.test(normalizedProbe) && /\b(?:apy|yield|rate|return)\b/i.test(normalizedProbe);
}

/**
 * Product FAQ fast-path: routing uses the visible probe only (`capabilityProbe`), never portfolio-injected tails.
 * Meta/frustration and routing noise defer to Hermes.
 */
async function buildAgentFlowProductReply(
  capabilityProbe: string,
  capabilityThreadCtx: CapabilityThreadContext,
): Promise<string | null> {
  const trimmedProbe = capabilityProbe.trim();
  if (!trimmedProbe) return null;
  if (isVaultPositionIntent(trimmedProbe)) return null;
  if (detectPortfolioImpactIntent(trimmedProbe)) return null;
  if (isExplicitResearchRequest(trimmedProbe)) return null;
  if (looksLikePredictionMarketResearch(trimmedProbe)) return null;
  if (looksLikeSwapResearch(trimmedProbe)) return null;
  if (looksLikeBridgeResearch(trimmedProbe)) return null;
  if (isPortfolioSnapshotIntent(trimmedProbe)) return null;
  const capabilityRouting = analyzeCapabilityAwareRouting(trimmedProbe);
  if (hasClarifyCapability(capabilityRouting)) {
    logFastPathDebug({ kind: 'product_skip', reason: 'capability_route_to_clarify' });
    return null;
  }
  if (
    capabilityRouting.bridge.routeToResearch ||
    capabilityRouting.vault.routeToResearch ||
    capabilityRouting.swap.routeToResearch ||
    capabilityRouting.predmarket.routeToResearch ||
    capabilityRouting.counterpartyRisk.routeToResearch
  ) {
    logFastPathDebug({ kind: 'product_skip', reason: 'capability_route_to_research' });
    return null;
  }

  if (isNoiseOnlyChatProbe(trimmedProbe)) {
    logFastPathDebug({ kind: 'product_skip', reason: 'noise_probe' });
    return null;
  }

  const productRoutingNormalized = trimmedProbe.toLowerCase();

  if (shouldHandleAsAgentPayHistoryRequest(trimmedProbe)) {
    logFastPathDebug({ kind: 'product_skip', reason: 'agentpay_history_intent' });
    return null;
  }

  if (isPredictionMarketPositionIntent(trimmedProbe) || isPredictionMarketPositionHowToIntent(trimmedProbe)) {
    logFastPathDebug({ kind: 'product_skip', reason: 'predmarket_position_intent' });
    return null;
  }

  if (
    /\bagentflow\b/i.test(productRoutingNormalized) &&
    !isExplicitFullCapabilityRequest(trimmedProbe) &&
    /\b(?:i\s+am\s+talking\s+about|i['’]m\s+talking\s+about|about\s+agentflow\s+on\s+arc|agentflow\s+on\s+arc)\b/i.test(
      productRoutingNormalized,
    )
  ) {
    logFastPathDebug({ kind: 'product', branch: 'scope_clarification' });
    return 'Hey, how can I help with AgentFlow on Arc today?';
  }

  if (hasProductRoutingBypassSignals(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product_skip', reason: 'bypass_signals' });
    return null;
  }

  if (
    /\b(?:new here|first time|before doing anything|what should you ask|what do you need)\b/i.test(
      productRoutingNormalized,
    ) &&
    /\b(?:send|pay|transfer|money|friend|country|cross-border|international)\b/i.test(productRoutingNormalized)
  ) {
    logFastPathDebug({ kind: 'product', branch: 'cross_border_onboarding' });
    return [
      'For an AgentPay cross-border USDC send, I need:',
      '- Recipient .arc name, saved contact, or USDC address',
      '- Amount in USDC',
      '- Whether it is one-time or scheduled',
      '- Optional note or reference',
      '',
      'Before anything moves, I show a real preview and you reply YES to execute or NO to cancel.',
    ].join('\n');
  }

  if (
    /\bbridge\b/i.test(productRoutingNormalized) &&
    /\b(?:manual(?:ly)?|eoa|funding)\b/i.test(productRoutingNormalized)
  ) {
    logFastPathDebug({ kind: 'product', branch: 'bridge_manual' });
    return formatBridgeExecutionReply();
  }

  if (/\bagentflow\b/i.test(productRoutingNormalized) && isExplicitFullCapabilityRequest(trimmedProbe)) {
    logFastPathDebug({ kind: 'product', branch: 'technical_map' });
    return formatAgentFlowCapabilityReply(trimmedProbe);
  }

  const asksProductInfo =
    /(?:^|\b)(?:what|how|why|which|explain|tell\s+me\s+about)\b/i.test(productRoutingNormalized) ||
    /\bwhat\s+is\b/i.test(productRoutingNormalized) ||
    /\bhow\s+does\b/i.test(productRoutingNormalized);
  const isStandaloneCapabilityQuestion = shouldHandleAsAgentFlowCapabilityQuestion(
    trimmedProbe,
    capabilityThreadCtx,
  );

  const productRagAnswer =
    asksProductInfo || isStandaloneCapabilityQuestion ? answerProductQuestion(trimmedProbe) : null;
  if (productRagAnswer && productRagAnswer.confidence >= 0.35) {
    logFastPathDebug({
      kind: 'product',
      branch: 'product_rag',
      sources: productRagAnswer.sources,
    });
    return productRagAnswer.answer;
  }

  if (asksProductInfo && !isStandaloneCapabilityQuestion) {
    const vectorResults = await searchRag(trimmedProbe, { threshold: 0.65 });
    if (vectorResults.length > 0) {
      console.info('[RAG_VECTOR_HIT]', {
        count: vectorResults.length,
        top_similarity: vectorResults[0].similarity,
      });
      return vectorResults
        .slice(0, 3)
        .map((result) => result.content)
        .join('\n\n');
    }
  }

  if (/^what\s+is\s+agentflow\??$/i.test(trimmedProbe)) {
    logFastPathDebug({ kind: 'product', branch: 'definition' });
    return formatAgentFlowDefinitionReply();
  }

  if (/^how\s+does\s+agentflow\s+work\??$/i.test(trimmedProbe)) {
    logFastPathDebug({ kind: 'product', branch: 'how_it_works' });
    return formatAgentFlowHowItWorksReply();
  }

  if (asksProductInfo && /\bfunding\b/i.test(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'funding' });
    return [
      'Funding is the money-movement page for AgentFlow.',
      '',
      'Use it to move Arc USDC between your AgentFlow execution wallet and your Gateway reserve.',
      '- Execution wallet / DCW: the default wallet AgentFlow uses for chat actions',
      '- Gateway reserve: the x402 balance used for paid agent work',
      '',
      'Bridge is separate: it starts from your connected wallet in the web app and mints into your AgentFlow wallet on Arc.',
    ].join('\n');
  }

  if (
    asksProductInfo &&
    /\bbridge\b/i.test(productRoutingNormalized) &&
    !/\b(?:all|supported|support|chains?|technical|circle\s+stack|cctp)\b/i.test(productRoutingNormalized)
  ) {
    logFastPathDebug({ kind: 'product', branch: 'bridge_overview' });
    return formatBridgeOverviewReply();
  }

  if (asksProductInfo && /\bagentpay\b/i.test(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'agentpay' });
    return [
      'AgentPay is AgentFlow\'s payment product.',
      '',
      'It can send USDC, create requests, generate payment links and .arc receiving flows, manage invoices, save contacts, prepare batch payouts, and manage scheduled payments.',
      '',
      'From chat, AgentFlow can also help you check invoice status, payment history, pending requests, contacts, and scheduled payments.',
    ].join('\n');
  }

  if (asksProductInfo && /\btelegram\b/i.test(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'telegram' });
    return [
      'You can link AgentFlow to Telegram and keep using the same account there.',
      '',
      'Connect the same wallet on the web app first, then open AgentFlow in Telegram.',
      '',
      'Swaps, research, and AgentPay features work in Telegram.',
      '',
      'If Telegram is linked, AgentFlow can notify you there when longer research finishes.',
    ].join('\n');
  }

  if (asksProductInfo && isVoiceToTextIntent(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'voice_to_text' });
    return buildVoiceToTextGuideReply();
  }

  if (asksProductInfo && /\bportfolio\b/i.test(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'portfolio' });
    return [
      'Portfolio is the DCW-first wallet view.',
      '',
      'It shows your Agent wallet holdings, Gateway reserve, vault shares, recent activity, and wallet-level PnL. It is meant to answer what you currently hold and how recent actions changed that position.',
    ].join('\n');
  }

  if (
    asksProductInfo &&
    /\b(?:prediction|predmarket|prediction market|markets|betting)\b/i.test(productRoutingNormalized)
  ) {
    logFastPathDebug({ kind: 'product', branch: 'predmarket' });
    return [
      'Prediction markets let you browse live markets, inspect details, check your positions, and place or exit trades from chat.',
      '',
      'The normal flow is list or inspect first, then preview the action, then reply YES to execute.',
    ].join('\n');
  }

  if (asksProductInfo && /\bvault\b/i.test(productRoutingNormalized) && !isVaultApyLookup(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'vault' });
    return [
      'Vault lets AgentFlow deposit and withdraw Arc USDC from the AgentFlow vault using your Agent wallet / DCW.',
      '',
      'The normal flow is preview first, then YES to execute. Vault shares and vault exposure show up in Portfolio.',
    ].join('\n');
  }


  if (asksProductInfo && /\bresearch\b/i.test(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'research' });
    return [
      'Research is AgentFlow\'s multi-agent report pipeline.',
      '',
      'It uses Research -> Analyst -> Writer, with Firecrawl-backed retrieval for external topics. When you ask about your own portfolio, invoices, contacts, or payment counterparties, AgentFlow should use internal product context first and public research only as enrichment.',
    ].join('\n');
  }

  if (asksProductInfo && /\b(?:invoice|invoices)\b/i.test(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'invoice' });
    return [
      'AgentFlow invoices live under AgentPay.',
      '',
      'You can create invoice previews, confirm invoices, list invoices, check their status, and turn invoice flows into payment requests.',
    ].join('\n');
  }

  if (asksProductInfo && /\bcontacts?\b/i.test(productRoutingNormalized)) {
    logFastPathDebug({ kind: 'product', branch: 'contacts' });
    return [
      'Contacts let you save counterparties by name inside AgentPay.',
      '',
      'You can list, update, delete, and pay saved contacts directly from chat.',
    ].join('\n');
  }

  return null;
}

function shouldOfferPostRouterProductFallback(intent: AgentFlowIntent): boolean {
  if (intent.intent === AgentFlowIntentName.ResearchReport) {
    return false;
  }

  if (intent.intent !== AgentFlowIntentName.GeneralChat) {
    return true;
  }

  const slots =
    intent.slots && typeof intent.slots === 'object'
      ? (intent.slots as Record<string, unknown>)
      : {};
  const topicHint = typeof slots.topic_hint === 'string' ? slots.topic_hint : '';

  return [
    'capabilities',
    'transcribe_capability',
    'predmarket_redeem_help',
    'capability_ambiguity',
  ].includes(topicHint);
}

/**
 * Strictly-informational product question that should bypass the non-deterministic
 * LLM intent router and be answered from product knowledge directly.
 *
 * Intentionally narrow: only messages that OPEN with "explain ...". Users virtually
 * never use "explain" to trigger an execution, and `buildAgentFlowProductReply`
 * still self-guards against every action intent (swap/vault/portfolio/research/
 * bridge/history all return null), so a stray "explain my portfolio" simply falls
 * through to normal routing unchanged. This exists because the intent router
 * intermittently misroutes clear FAQ prompts to the brain, which then trips the
 * stale-state guard ("I can't verify live balances..."), making starter-prompt
 * answers flaky across runs.
 */
function isExplicitProductExplainQuestion(message: string): boolean {
  return /^\s*explain\b/i.test(message);
}

/**
 * Payload-free product/how-to question that should be answered from product
 * knowledge (RAG) instead of being grabbed by a pre-router action matcher
 * (schedule/split/contacts/batch) that fires on bare keyword overlap.
 *
 * Intent-first, not a canned answer: this only widens WHICH messages reach
 * `buildAgentFlowProductReply` (-> `answerProductQuestion` RAG). It stays safe in
 * a natural-language app by keying off the absence of an action payload, not
 * phrasing alone:
 *  - must OPEN as an informational question (how to / what is / explain / ...);
 *  - excludes anything carrying a payload (number/amount, .arc handle, 0x
 *    address, @handle) so a real "send 10 to jack.arc" routes to the action;
 *  - excludes possessive/live-state probes ("my", "mine") so "what is my
 *    balance" still hits the real handler, not a generic explanation.
 * Anything that slips through still falls back to normal routing because
 * `buildAgentFlowProductReply` self-guards every action intent and returns null.
 */
function isPayloadFreeProductQuestion(message: string): boolean {
  const m = message.trim();
  if (!m || m.length > 160) return false;

  const infoOpener =
    /^\s*(?:explain\b|how\s+(?:to|do\s+i|does|can\s+i)\b|what\s+(?:is|are|can|does)\b|which\b|where\s+do\s+i\b|do\s+you\s+support\b|tell\s+me\s+about\b|(?:tell|show|give)\s+me\b)/i.test(
      m,
    );
  if (!infoOpener) return false;

  const exampleLikeQuestion =
    /\b(?:csv|example|examples|sample|template|format)\b/i.test(m) &&
    /\b(?:split|batch|schedule|invoice|payment request|request|payment link|qr|contacts?|\.arc|bridge|vault|swap|portfolio|telegram|research)\b/i.test(
      m,
    );

  // Possessive / live-state queries are not product FAQs — route them normally.
  if (/\b(?:my|mine|our)\b/i.test(m)) return false;

  // Action payloads mean this is an execution, not a question.
  if (/\d/.test(m)) return false;
  if (/\b[a-z0-9_.-]+\.arc\b/i.test(m)) return false;
  if (/0x[a-fA-F0-9]{6,}/.test(m)) return false;
  if (/@[a-z0-9_]+/i.test(m)) return false;

  if (exampleLikeQuestion) return true;

  return true;
}

function isPendingActionFollowup(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /^(?:ok|okay|sure|got it|understood|alright|fine|cool|yep|yeah|yes please)$/i.test(normalized) ||
    /\bwhat(?:'s| is)\s+next\b/i.test(normalized) ||
    /\bwhat\s+now\b/i.test(normalized) ||
    /\bnext\s+step\b/i.test(normalized) ||
    /\bwhat\s+should\s+i\s+do\b/i.test(normalized) ||
    /\bhow\s+do\s+i\s+continue\b/i.test(normalized) ||
    /\bwhat\s+did\s+you\s+just\s+quote\b/i.test(normalized)
  );
}

function formatPendingActionFollowup(
  pending: NonNullable<Awaited<ReturnType<typeof loadPendingAction>>>,
): string {
  if (pending.tool === 'swap_tokens') {
    const amount = String(pending.args?.amount ?? '').trim() || 'the quoted amount';
    const tokenIn = String(pending.args?.tokenIn ?? 'USDC').trim().toUpperCase();
    const tokenOut = String(pending.args?.tokenOut ?? 'EURC').trim().toUpperCase();
    return [
      `You have a pending swap quote: ${amount} ${tokenIn} to ${tokenOut}.`,
      '',
      'Reply YES to execute or NO to cancel.',
    ].join('\n');
  }

  if (pending.tool === 'vault_action') {
    const action = String(pending.args?.action ?? 'vault action').trim().toLowerCase();
    const amount = String(pending.args?.amount ?? '').trim() || 'the quoted amount';
    return [
      `You have a pending vault ${action} for ${amount} USDC.`,
      '',
      'Reply YES to execute or NO to cancel.',
    ].join('\n');
  }

  if (pending.tool === 'predict_action') {
    const action = String(pending.payload?.action ?? 'market action').trim().toLowerCase();
    const title =
      typeof pending.payload?.marketTitle === 'string' && pending.payload.marketTitle.trim()
        ? pending.payload.marketTitle.trim()
        : 'the selected market';
    if (action === 'buy') {
      return [
        `You have a pending prediction market bet for ${title}.`,
        '',
        'Reply YES to execute or NO to cancel.',
      ].join('\n');
    }
    if (action === 'sell') {
      return [
        `You have a pending prediction market sell for ${title}.`,
        '',
        'Reply YES to execute or NO to cancel.',
      ].join('\n');
    }
    return [
      `You have a pending prediction market ${action} for ${title}.`,
      '',
      'Reply YES to execute or NO to cancel.',
    ].join('\n');
  }

  return 'You have a pending action. Reply YES to execute or NO to cancel.';
}

function isSoftContinuationReply(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return /^(?:ok|okay|sure|got it|understood|alright|fine|cool|yep|yeah|go ahead|do it|continue|carry on|sounds good|please)$/i.test(
    normalized,
  );
}

function buildBackendContinuationReply(input: {
  message: string;
  history: BrainConversationMessage[];
  pending: Awaited<ReturnType<typeof loadPendingAction>>;
}): string | null {
  const normalized = input.message.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const lastAssistant = getMostRecentAssistantMessage(input.history);
  if (!lastAssistant) {
    return null;
  }

  if (
    input.pending &&
    !/^(?:yes|no)$/i.test(normalized) &&
    (isPendingActionFollowup(input.message) ||
      isSoftContinuationReply(input.message) ||
      /^(?:what now|next|next step|how do i continue)$/i.test(normalized))
  ) {
    return formatPendingActionFollowup(input.pending);
  }

  if (
    isSoftContinuationReply(input.message) &&
    /\bHow much (USDC|EURC) do you want to swap into (USDC|EURC)\?/i.test(lastAssistant)
  ) {
    return `${lastAssistant}\n\nReply with a plain number like "1".`;
  }

  if (
    isSoftContinuationReply(input.message) &&
    /\bHow much (USDC|EURC) do you want to (deposit|withdraw)\b/i.test(lastAssistant)
  ) {
    return `${lastAssistant}\n\nReply with a plain number like "1".`;
  }

  if (
    isSoftContinuationReply(input.message) &&
    /\bTell me how much USDC you want to bridge from\b/i.test(lastAssistant)
  ) {
    return `${lastAssistant}\n\nReply with a plain number like "1".`;
  }

  if (
    /^(?:yes|y|yeah|yep|sure|ok|okay|go ahead)$/i.test(normalized) &&
    /Do you want a live swap quote, or do you want me to explain how swaps work on AgentFlow\?/i.test(
      lastAssistant,
    )
  ) {
    return [
      'I can do either one.',
      '',
      'Say "quote 1 USDC to EURC" for a live quote, or say "explain swaps" and I will walk you through it.',
    ].join('\n');
  }

  if (
    /^(?:yes|y|yeah|yep|sure|ok|okay|go ahead)$/i.test(normalized) &&
    /Do you want me to show the chains where this wallet already has USDC, or do you already have a source chain in mind\?/i.test(
      lastAssistant,
    )
  ) {
    return [
      'I can do either one.',
      '',
      'Say "show my funded chains" to see the supported chains where this wallet already has USDC, or say "bridge 1 USDC from Base Sepolia" if you already know the source chain.',
    ].join('\n');
  }

  if (
    isSoftContinuationReply(input.message) &&
    /Reply YES to execute or NO to cancel\./i.test(lastAssistant)
  ) {
    return input.pending
      ? formatPendingActionFollowup(input.pending)
      : 'That action is still waiting. Reply YES to execute or NO to cancel.';
  }

  return null;
}

const ROUTER_CONTINUATION_PREFIX = 'router:continuation:';

type RouterContinuationState = {
  intent: AgentFlowIntentName;
  rawMessage: string;
  slots: Record<string, unknown>;
  slotsMissing: string[];
  clarification: string;
  createdAt: string;
};

function buildRouterContinuationKey(sessionId: string): string {
  return `${ROUTER_CONTINUATION_PREFIX}${sessionId}`;
}

function isRouterContinuationIntent(intent: AgentFlowIntentName): boolean {
  return [
    AgentFlowIntentName.AgentpaySend,
    AgentFlowIntentName.AgentpayRequest,
    AgentFlowIntentName.AgentpayPaymentLink,
    AgentFlowIntentName.ContactsCreate,
    AgentFlowIntentName.ContactsUpdate,
    AgentFlowIntentName.ContactsDelete,
    AgentFlowIntentName.ScheduleCreate,
    AgentFlowIntentName.ScheduleCancel,
    AgentFlowIntentName.SplitExecute,
    AgentFlowIntentName.BatchExecute,
    AgentFlowIntentName.InvoiceCreate,
  ].includes(intent);
}

function parseContinuationAmount(message: string): { value: number; currency: 'USDC' | 'EURC' } | null {
  const match = message.match(/(?:^|[^\w])(\d+(?:\.\d+)?)(?:\s*(usdc|eurc|usd|dollars?))?\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const currency = /\beurc\b/i.test(match[2] || message) ? 'EURC' : 'USDC';
  return { value, currency };
}

function parseContinuationRecipient(message: string): { handle?: string; address?: string } | null {
  const address = message.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0];
  if (address) return { address };

  const handle = message.match(/\b([a-z0-9][a-z0-9-]*\.arc)\b/i)?.[1];
  if (handle) return { handle: handle.toLowerCase() };

  const bareName = message.trim().match(/^[a-z][a-z0-9_-]{1,31}$/i)?.[0];
  if (bareName) return { handle: bareName.toLowerCase() };

  return null;
}

function parseContinuationContactName(message: string): string | null {
  const normalized = message.trim();
  if (!normalized) return null;
  if (!/^[a-z][a-z0-9_-]{1,31}$/i.test(normalized)) return null;
  return normalized.toLowerCase();
}

function parseContactNameFromRawMessage(message: string): string | null {
  const normalized = message.trim();
  if (!normalized) return null;
  const match =
    normalized.match(/\bsave\s+([a-z][a-z0-9_-]{1,31})\b/i) ||
    normalized.match(/\badd\s+contact\s+([a-z][a-z0-9_-]{1,31})\b/i) ||
    normalized.match(/\bupdate\s+([a-z][a-z0-9_-]{1,31})\b/i) ||
    normalized.match(/\bdelete\s+contact\s+([a-z][a-z0-9_-]{1,31})\b/i) ||
    normalized.match(/\bremove\s+contact\s+([a-z][a-z0-9_-]{1,31})\b/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseContinuationCadence(message: string): string | null {
  const normalized = message.trim();
  if (!normalized) return null;
  if (
    /\b(?:every\s+\w+|daily|weekly|monthly|yearly|each\s+\w+|every\s+\d+\s+(?:day|days|week|weeks|month|months))\b/i.test(
      normalized,
    )
  ) {
    return normalized;
  }
  return null;
}

function getRecipientTextFromSlots(slots: Record<string, unknown>): string | null {
  const recipient = slots.recipient;
  if (!recipient || typeof recipient !== 'object') return null;
  const recipientRecord = recipient as Record<string, unknown>;
  if (typeof recipientRecord.handle === 'string' && recipientRecord.handle.trim()) {
    return recipientRecord.handle.trim();
  }
  if (typeof recipientRecord.address === 'string' && recipientRecord.address.trim()) {
    return recipientRecord.address.trim();
  }
  return null;
}

function getAmountTextFromSlots(slots: Record<string, unknown>, key: 'amount' | 'total_amount' = 'amount'): string | null {
  const amount = slots[key];
  if (!amount || typeof amount !== 'object') return null;
  const amountRecord = amount as Record<string, unknown>;
  const value =
    typeof amountRecord.value === 'number'
      ? String(amountRecord.value)
      : typeof amountRecord.value === 'string' && amountRecord.value.trim()
        ? amountRecord.value.trim()
        : '';
  if (!value) return null;
  const currency =
    typeof amountRecord.currency === 'string' && amountRecord.currency.trim()
      ? amountRecord.currency.trim().toUpperCase()
      : 'USDC';
  return `${value} ${currency}`;
}

function buildRouterContinuationReminder(state: RouterContinuationState): string {
  const clarification = state.clarification.trim();
  if (/how much/i.test(clarification)) {
    return `${clarification}\n\nReply with a plain number like "5".`;
  }
  if (/who|recipient|handle|address|contact/i.test(clarification)) {
    return `${clarification}\n\nReply with a .arc handle, saved contact name, or wallet address.`;
  }
  if (/how often|cadence/i.test(clarification)) {
    return `${clarification}\n\nReply with something like "every week" or "monthly".`;
  }
  return clarification;
}

function tryBuildRouterContinuationMessage(
  state: RouterContinuationState,
  reply: string,
): string | null {
  const trimmedReply = reply.trim();
  if (!trimmedReply) return null;

  const amount = parseContinuationAmount(trimmedReply);
  const recipient = parseContinuationRecipient(trimmedReply);
  const contactName = parseContinuationContactName(trimmedReply);
  const cadence = parseContinuationCadence(trimmedReply);
  const slots = state.slots;
  const recipientText = getRecipientTextFromSlots(slots);
  const amountText = getAmountTextFromSlots(slots);
  const totalAmountText = getAmountTextFromSlots(slots, 'total_amount');
  const schedule = slots.schedule && typeof slots.schedule === 'object' ? (slots.schedule as Record<string, unknown>) : {};
  const scheduleCadence =
    typeof schedule.cadence === 'string' && schedule.cadence.trim() ? schedule.cadence.trim() : null;
  const description =
    typeof slots.description === 'string' && slots.description.trim() ? slots.description.trim() : null;
  const remark = typeof slots.remark === 'string' && slots.remark.trim() ? slots.remark.trim() : null;

  switch (state.intent) {
    case AgentFlowIntentName.AgentpaySend:
    case AgentFlowIntentName.AgentpayRequest:
    case AgentFlowIntentName.AgentpayPaymentLink: {
      const verb =
        state.intent === AgentFlowIntentName.AgentpayRequest
          ? 'request'
          : state.intent === AgentFlowIntentName.AgentpayPaymentLink
            ? 'payment link for'
            : 'send';
      if (state.slotsMissing.includes('amount.value') && amount && recipientText) {
        const suffix = remark ? ` for ${remark}` : '';
        return `${verb} ${recipientText} ${amount.value} ${amount.currency}${suffix}`;
      }
      if (state.slotsMissing.includes('recipient') && recipient && amountText) {
        const recipientValue = recipient.handle ?? recipient.address!;
        const suffix = remark ? ` for ${remark}` : '';
        return `${verb} ${recipientValue} ${amountText}${suffix}`;
      }
      return null;
    }
    case AgentFlowIntentName.ContactsCreate: {
      const name =
        typeof slots.name === 'string' && slots.name.trim() ? slots.name.trim().toLowerCase() : null;
      const fallbackName = name ?? parseContactNameFromRawMessage(state.rawMessage);
      if (state.slotsMissing.includes('recipient') && fallbackName && recipient) {
        const recipientValue = recipient.handle ?? recipient.address!;
        return `save ${fallbackName} as ${recipientValue}`;
      }
      if (state.slotsMissing.includes('name') && contactName && recipientText) {
        return `save ${contactName} as ${recipientText}`;
      }
      return null;
    }
    case AgentFlowIntentName.ContactsUpdate: {
      const name =
        typeof slots.name === 'string' && slots.name.trim() ? slots.name.trim().toLowerCase() : null;
      const fallbackName = name ?? parseContactNameFromRawMessage(state.rawMessage);
      if (state.slotsMissing.includes('recipient') && fallbackName && recipient) {
        const recipientValue = recipient.handle ?? recipient.address!;
        return `update ${fallbackName} to ${recipientValue}`;
      }
      if (state.slotsMissing.includes('name') && contactName && recipientText) {
        return `update ${contactName} to ${recipientText}`;
      }
      return null;
    }
    case AgentFlowIntentName.ContactsDelete: {
      const fallbackName = contactName ?? parseContactNameFromRawMessage(state.rawMessage);
      if (state.slotsMissing.includes('name') && fallbackName) {
        return `delete contact ${fallbackName}`;
      }
      return null;
    }
    case AgentFlowIntentName.ScheduleCreate: {
      if (state.slotsMissing.includes('schedule.cadence') && cadence && recipientText && amountText) {
        const suffix = remark ? ` for ${remark}` : '';
        return `schedule ${amountText} to ${recipientText} ${cadence}${suffix}`;
      }
      if (state.slotsMissing.includes('amount.value') && amount && recipientText && scheduleCadence) {
        const suffix = remark ? ` for ${remark}` : '';
        return `schedule ${amount.value} ${amount.currency} to ${recipientText} ${scheduleCadence}${suffix}`;
      }
      if (state.slotsMissing.includes('recipient') && recipient && amountText && scheduleCadence) {
        const recipientValue = recipient.handle ?? recipient.address!;
        const suffix = remark ? ` for ${remark}` : '';
        return `schedule ${amountText} to ${recipientValue} ${scheduleCadence}${suffix}`;
      }
      return null;
    }
    case AgentFlowIntentName.SplitExecute: {
      const recipients = Array.isArray(slots.recipients) ? slots.recipients : [];
      const recipientParts = recipients
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const record = entry as Record<string, unknown>;
          if (typeof record.handle === 'string' && record.handle.trim()) return record.handle.trim();
          if (typeof record.address === 'string' && record.address.trim()) return record.address.trim();
          return null;
        })
        .filter((value): value is string => Boolean(value));
      if (state.slotsMissing.includes('total_amount.value') && amount && recipientParts.length >= 2) {
        const suffix = remark ? ` for ${remark}` : '';
        return `split ${amount.value} ${amount.currency} between ${recipientParts.join(', ')}${suffix}`;
      }
      return null;
    }
    case AgentFlowIntentName.InvoiceCreate: {
      if (state.slotsMissing.includes('amount.value') && amount && recipientText && description) {
        return `create invoice for ${recipientText} ${amount.value} ${amount.currency} for ${description}`;
      }
      if (state.slotsMissing.includes('recipient') && recipient && amountText && description) {
        const recipientValue = recipient.handle ?? recipient.address!;
        return `create invoice for ${recipientValue} ${amountText} for ${description}`;
      }
      if (state.slotsMissing.includes('description') && trimmedReply && recipientText && amountText) {
        return `create invoice for ${recipientText} ${amountText} for ${trimmedReply}`;
      }
      return null;
    }
    case AgentFlowIntentName.BatchExecute: {
      if (state.slotsMissing.some((slot) => slot.startsWith('payments'))) {
        return /^batch\s+pay/i.test(trimmedReply) ? trimmedReply : `batch pay\n${trimmedReply}`;
      }
      return null;
    }
    default:
      return null;
  }
}

async function loadRouterContinuationState(sessionId: string): Promise<RouterContinuationState | null> {
  const raw = await getRedis().get(buildRouterContinuationKey(sessionId)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RouterContinuationState;
  } catch {
    return null;
  }
}

async function storeRouterContinuationState(sessionId: string, state: RouterContinuationState): Promise<void> {
  await getRedis()
    .set(buildRouterContinuationKey(sessionId), JSON.stringify(state), 'EX', 900)
    .catch(() => null);
}

async function clearRouterContinuationState(sessionId: string): Promise<void> {
  await getRedis().del(buildRouterContinuationKey(sessionId)).catch(() => null);
}

function extractPredictionMarketAddress(message: string): `0x${string}` | null {
  const match = message.match(/\b0x[a-fA-F0-9]{40}\b/);
  return match?.[0] ? (match[0] as `0x${string}`) : null;
}

type PredictionOutcomeChoice = {
  index: number;
  label: string;
};

function normalizePredictionOutcomeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseOutcomeOptionsFromSummaryLine(summaryLine: string): PredictionOutcomeChoice[] {
  return summaryLine
    .split(/\s*\/\s*/)
    .map((segment, index) => {
      const label = segment
        .replace(/\s+\d+(?:\.\d+)?%.*$/i, '')
        .replace(/\s+\([^)]*\)\s*$/i, '')
        .trim();
      if (!label) {
        return null;
      }
      return {
        index,
        label,
      } satisfies PredictionOutcomeChoice;
    })
    .filter((value): value is PredictionOutcomeChoice => value !== null);
}

function parseOutcomeOptionsFromDetailResult(result: string): PredictionOutcomeChoice[] {
  const outcomesBlockMatch = result.match(/###\s+[^\n]*Outcomes\s*\n([\s\S]*?)(?:\n###\s|\n##\s|$)/i);
  if (!outcomesBlockMatch) {
    return [];
  }

  return outcomesBlockMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+/.test(line))
    .map((line, index) => {
      const label = line
        .replace(/^-\s+/, '')
        .replace(/:\s+[\s\S]*$/, '')
        .trim();
      if (!label) {
        return null;
      }
      return {
        index,
        label,
      } satisfies PredictionOutcomeChoice;
    })
    .filter((value): value is PredictionOutcomeChoice => value !== null);
}

function parseOutcomeOptionsForMarketFromListResult(
  result: string,
  marketAddress: `0x${string}`,
): PredictionOutcomeChoice[] {
  const sections = result.split(/\n(?=###\s+)/);
  for (const section of sections) {
    if (!section.includes(marketAddress)) {
      continue;
    }
    const outcomesLineMatch = section.match(/- \*\*Outcomes:\*\* ([^\n]+)/i);
    if (!outcomesLineMatch) {
      continue;
    }
    const options = parseOutcomeOptionsFromSummaryLine(outcomesLineMatch[1]);
    if (options.length) {
      return options;
    }
  }
  return [];
}

function extractPredictionOutcomeOptionsFromHistory(
  history: BrainConversationMessage[] = [],
  marketAddress: `0x${string}` | null = null,
): PredictionOutcomeChoice[] {
  for (let i = history.length - 1; i >= Math.max(0, history.length - 8); i -= 1) {
    const content = history[i]?.content;
    if (typeof content !== 'string' || !content.trim()) {
      continue;
    }
    if (marketAddress) {
      const listOptions = parseOutcomeOptionsForMarketFromListResult(content, marketAddress);
      if (listOptions.length) {
        return listOptions;
      }
    }
    const detailOptions = parseOutcomeOptionsFromDetailResult(content);
    if (detailOptions.length) {
      return detailOptions;
    }
  }
  return [];
}

function findOutcomeChoiceByLabel(
  message: string,
  options: PredictionOutcomeChoice[],
): PredictionOutcomeChoice | null {
  if (!options.length) {
    return null;
  }
  const normalizedMessage = normalizePredictionOutcomeLabel(message);
  const matches = options
    .map((option) => ({
      option,
      normalizedLabel: normalizePredictionOutcomeLabel(option.label),
    }))
    .filter(
      ({ normalizedLabel }) =>
        normalizedLabel.length > 1 &&
        normalizedMessage.includes(normalizedLabel),
    )
    .sort((left, right) => right.normalizedLabel.length - left.normalizedLabel.length);

  if (!matches.length) {
    return null;
  }
  if (
    matches.length > 1 &&
    matches[0].normalizedLabel === matches[1].normalizedLabel
  ) {
    return null;
  }
  return matches[0].option;
}

function formatPredictionOutcomePrompt(outcome: PredictionOutcomeChoice): string {
  return `outcome ${outcome.index} (${outcome.label})`;
}

function extractPredictionOutcomeChoice(
  message: string,
  history: BrainConversationMessage[] = [],
  marketAddress: `0x${string}` | null = null,
): PredictionOutcomeChoice | null {
  const outcomeIndexMatch = message.match(/\boutcome\s*(\d+)(?:\s*\(([^)]+)\))?/i);
  if (outcomeIndexMatch) {
    return {
      index: Number(outcomeIndexMatch[1]),
      label: outcomeIndexMatch[2]?.trim() || `Outcome ${outcomeIndexMatch[1]}`,
    };
  }

  if (/\byes\b/i.test(message)) {
    return { index: 0, label: 'Yes' };
  }
  if (/\bno\b/i.test(message)) {
    return { index: 1, label: 'No' };
  }

  const historyOptions = extractPredictionOutcomeOptionsFromHistory(history, marketAddress);
  return findOutcomeChoiceByLabel(message, historyOptions);
}

function extractRecentPredictionContextAddress(
  history: BrainConversationMessage[] = [],
): `0x${string}` | null {
  const seen = new Set<string>();
  for (let i = Math.max(0, history.length - 8); i < history.length; i += 1) {
    const content = history[i]?.content;
    if (typeof content !== 'string') continue;
    const matches = content.match(/\b0x[a-fA-F0-9]{40}\b/g) || [];
    for (const match of matches) {
      seen.add(match);
    }
  }
  return seen.size === 1 ? (Array.from(seen)[0] as `0x${string}`) : null;
}

function lastAssistantLooksLikePredmarketList(
  lastAssistantMessage: string | null,
): boolean {
  if (!lastAssistantMessage) {
    return false;
  }
  return /prediction markets on achmarket|show more markets|bet x usdc on/i.test(
    lastAssistantMessage,
  );
}

function buildPredictionAmountChoiceReply(
  marketAddress: `0x${string}`,
  outcome: PredictionOutcomeChoice,
): DirectAgentFlowRoute {
  const outcomePrompt = formatPredictionOutcomePrompt(outcome);
  return {
    type: 'reply',
    text: `How much do you want to bet on ${outcome.label} for this market?\n\nChoose an amount below, or type a custom amount like \`bet 3 USDC on ${outcomePrompt} for ${marketAddress}\`.`,
    quickActionGroups: [
      {
        title: outcome.label,
        actions: [
          {
            label: '1 USDC',
            prompt: `bet 1 USDC on ${outcomePrompt} for ${marketAddress}`,
          },
          {
            label: '5 USDC',
            prompt: `bet 5 USDC on ${outcomePrompt} for ${marketAddress}`,
          },
          {
            label: '10 USDC',
            prompt: `bet 10 USDC on ${outcomePrompt} for ${marketAddress}`,
          },
          {
            label: 'Details',
            prompt: `tell me about ${marketAddress}`,
            tone: 'secondary',
          },
        ],
      },
    ],
  };
}

function buildPredictionOutcomeChoiceReply(
  marketAddress: `0x${string}`,
  amount: string | null,
  outcomes: PredictionOutcomeChoice[],
): DirectAgentFlowRoute {
  const amountText = amount ? `for your ${amount} USDC bet` : 'for this market';
  return {
    type: 'reply',
    text: `Which outcome do you want ${amountText}?\n\nChoose one below.`,
    quickActionGroups: [
      {
        title: 'Pick an outcome',
        actions: [
          ...outcomes.map((outcome) => ({
            label: outcome.label,
            prompt: amount
              ? `bet ${amount} USDC on ${formatPredictionOutcomePrompt(outcome)} for ${marketAddress}`
              : `bet on ${formatPredictionOutcomePrompt(outcome)} for ${marketAddress}`,
          })),
          {
            label: 'Details',
            prompt: `tell me about ${marketAddress}`,
            tone: 'secondary' as const,
          },
        ],
      },
    ],
  };
}

function buildPredmarketCategoryActionGroups(): Array<{
  title?: string;
  actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }>;
}> {
  return [
    {
      title: 'Browse categories',
      actions: [
        { label: 'All', prompt: 'show prediction markets', tone: 'secondary' },
        { label: 'Crypto', prompt: 'show crypto markets' },
        { label: 'Sports', prompt: 'show sports markets' },
        { label: 'Politics', prompt: 'show politics markets' },
        { label: 'Entertainment', prompt: 'show entertainment markets' },
      ],
    },
  ];
}

function buildVaultListQuickActionGroups(): Array<{
  title?: string;
  actions: Array<{
    label: string;
    prompt: string;
    actionId?: string;
    tone?: 'primary' | 'secondary';
  }>;
}> {
  return [
    {
      title: 'Choose vault',
      actions: [
        { label: 'Lunex USDC Vault', prompt: 'use luneUSDC vault' },
        { label: 'Lunex EURC Vault', prompt: 'use luneEURC vault' },
        {
          label: 'My positions',
          prompt: 'show my vault positions',
          actionId: AgentFlowIntentName.VaultPosition,
          tone: 'secondary',
        },
      ],
    },
  ];
}

function buildVaultAmountChoiceReply(vaultSymbol: 'luneUSDC' | 'luneEURC'): DirectAgentFlowRoute {
  const assetSymbol = vaultSymbol === 'luneEURC' ? 'EURC' : 'USDC';
  const vaultLabel = vaultSymbol === 'luneEURC' ? 'Lunex EURC Vault' : 'Lunex USDC Vault';
  return {
    type: 'reply',
    text:
      `How much ${assetSymbol} do you want to deposit into ${vaultLabel}?\n\n` +
      `Choose an amount below or type a custom one like \`deposit 25 ${assetSymbol} to ${vaultSymbol}\`.`,
    quickActionGroups: [
      {
        title: vaultLabel,
        actions: [
          { label: `1 ${assetSymbol}`, prompt: `deposit 1 ${assetSymbol} to ${vaultSymbol}` },
          { label: `10 ${assetSymbol}`, prompt: `deposit 10 ${assetSymbol} to ${vaultSymbol}` },
          { label: `100 ${assetSymbol}`, prompt: `deposit 100 ${assetSymbol} to ${vaultSymbol}` },
        ],
      },
    ],
  };
}

function hasClarifyCapability(
  capabilityRouting: ReturnType<typeof analyzeCapabilityAwareRouting>,
): boolean {
  return (
    capabilityRouting.bridge.routeToClarify ||
    capabilityRouting.vault.routeToClarify ||
    capabilityRouting.swap.routeToClarify
  );
}

function buildBridgeClarifyReply(message: string): DirectAgentFlowRoute {
  const normalized = message.trim();
  const mentionsArbitrum = /\barbitrum\b/i.test(normalized);
  const mentionsBase = /\bbase\b/i.test(normalized);
  const researchPrompt =
    mentionsArbitrum && mentionsBase
      ? 'research Arbitrum vs Base bridge comparison'
      : 'research bridge source chain comparison';

  return {
    type: 'reply',
    text:
      mentionsArbitrum && mentionsBase
        ? 'Do you want a research comparison, or do you want to work with AgentFlow bridge sources?'
        : 'Do you want research on bridge sources, or do you want to see the AgentFlow bridge sources you can use?',
    quickActionGroups: [
      {
        title: 'Choose next step',
        actions: [
          { label: 'Research comparison', prompt: researchPrompt },
          { label: 'Show bridge sources', prompt: 'show supported bridge source chains' },
        ],
      },
    ],
  };
}

function buildVaultClarifyReply(message: string): DirectAgentFlowRoute {
  const normalized = message.trim();
  const mentionsLunex = /\b(?:lunex|luneusdc|luneeurc)\b/i.test(normalized);
  const researchPrompt = mentionsLunex
    ? 'research DeFi yield vault comparison'
    : 'research yield vault providers in DeFi';
  const featurePrompt = mentionsLunex ? 'show me Lunex vault options' : 'show me vaults';

  return {
    type: 'reply',
    text: mentionsLunex
      ? 'Do you want research on Lunex yields, or do you want to browse AgentFlow vaults?'
      : 'Do you want research comparing vault providers, or do you want to browse the vaults available in AgentFlow?',
    quickActionGroups: [
      {
        title: 'Choose next step',
        actions: [
          { label: mentionsLunex ? 'Research yields' : 'Research providers', prompt: researchPrompt },
          { label: mentionsLunex ? 'Show Lunex vaults' : 'Show vaults', prompt: featurePrompt },
          {
            label: 'My positions',
            prompt: 'show my vault positions',
            actionId: AgentFlowIntentName.VaultPosition,
            tone: 'secondary',
          },
        ],
      },
    ],
  };
}

function buildSwapClarifyReply(): DirectAgentFlowRoute {
  return {
    type: 'reply',
    text: 'Do you want a research comparison of swap fees, or do you want to get a live AgentFlow swap quote?',
    quickActionGroups: [
      {
        title: 'Choose next step',
        actions: [
          { label: 'Research fees', prompt: 'research swap fees across DEX providers' },
          { label: 'Get quote', prompt: 'swap 1 USDC to EURC' },
        ],
      },
    ],
  };
}

function buildPredmarketClarifyReply(): DirectAgentFlowRoute {
  return {
    type: 'reply',
    text: 'What would you like to do with prediction markets?',
    quickActionGroups: [
      {
        title: 'Choose next step',
        actions: [
          { label: 'Browse live markets', prompt: 'show prediction markets' },
          { label: 'My positions', prompt: 'show my prediction market positions', tone: 'secondary' },
          { label: 'How it works', prompt: 'how do prediction markets work?', tone: 'secondary' },
        ],
      },
    ],
  };
}

function buildCapabilityClarifyReply(
  message: string,
  capabilityRouting: ReturnType<typeof analyzeCapabilityAwareRouting>,
): DirectAgentFlowRoute | null {
  if (capabilityRouting.bridge.routeToClarify) {
    return buildBridgeClarifyReply(message);
  }
  if (capabilityRouting.vault.routeToClarify) {
    return buildVaultClarifyReply(message);
  }
  if (capabilityRouting.swap.routeToClarify) {
    return buildSwapClarifyReply();
  }
  return null;
}

function userExplicitlyRequestedLiveState(message: string): boolean {
  const mode = classifyAnswerMode(message);
  return (
    mode === 'balance_state' ||
    mode === 'portfolio_state' ||
    mode === 'payment_state' ||
    mode === 'financial_advice'
  );
}

function detectVaultSelectionReply(
  normalized: string,
  lastAssistantMessage: string | null,
): 'luneUSDC' | 'luneEURC' | null {
  const hasRecentVaultChooser =
    !!lastAssistantMessage &&
    /\b(yield vaults on arc testnet|choose vault|choose a vault|lunex usdc vault|lunex eurc vault)\b/i.test(
      lastAssistantMessage,
    );
  if (!hasRecentVaultChooser) {
    return null;
  }
  if (
    /\b(lune\s*usdc|luneusdc|usdc vault|usdc one|the usdc one|first vault|first one|the first one)\b/i.test(
      normalized,
    )
  ) {
    return 'luneUSDC';
  }
  if (
    /\b(lune\s*eurc|luneeurc|eurc vault|eurc one|the eurc one|second vault|second one|the second one)\b/i.test(
      normalized,
    )
  ) {
    return 'luneEURC';
  }
  return null;
}

function buildPredmarketResearchPrompt(
  title: string,
  marketAddress: `0x${string}`,
  outcomes: PredictionOutcomeChoice[] = [],
): string {
  const safeTitle = title.trim() || 'this prediction market';
  const outcomeLabels = outcomes
    .map((outcome) => outcome.label.trim())
    .filter(Boolean);

  return [
    `research the prediction market topic: ${safeTitle}`,
    outcomeLabels.length
      ? `Listed outcomes in AgentFlow: ${outcomeLabels.join(' / ')}.`
      : null,
    marketAddress ? `Market address for AgentFlow trade routing only: ${marketAddress}.` : null,
    'Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPredmarketTradeActionGroup(
  title: string,
  marketAddress: `0x${string}`,
  outcomes: PredictionOutcomeChoice[] = [],
): {
  title?: string;
  actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }>;
} {
  const outcomeActions = outcomes.map((outcome) => ({
    label: outcome.label,
    prompt: `bet on ${formatPredictionOutcomePrompt(outcome)} for ${marketAddress}`,
  }));
  return {
    title: title.length > 52 ? `${title.slice(0, 49)}...` : title,
    actions: [
      ...(outcomeActions.length
        ? outcomeActions
        : [{ label: 'Trade', prompt: `tell me about ${marketAddress}` }]),
      { label: 'Research', prompt: buildPredmarketResearchPrompt(title, marketAddress, outcomes) },
      { label: 'Details', prompt: `tell me about ${marketAddress}`, tone: 'secondary' },
    ],
  };
}

function buildPredmarketOutcomeActions(
  marketAddress: `0x${string}`,
  outcomes: PredictionOutcomeChoice[],
): Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }> {
  return outcomes.map((outcome) => ({
    label: outcome.label,
    prompt: `bet on ${formatPredictionOutcomePrompt(outcome)} for ${marketAddress}`,
  }));
}

function extractPredmarketResearchContext(
  task: string,
) : { marketAddress: `0x${string}` | null; titleHint: string | null } | null {
  const marketAddress = extractPredictionMarketAddress(task);
  const hasPredmarketCue =
    /\bprediction market\b/i.test(task) ||
    /\bListed outcomes in AgentFlow:/i.test(task) ||
    /\bMarket address for AgentFlow trade routing only:/i.test(task) ||
    /\b(outcome probabilities|listed outcomes)\b/i.test(task);
  if (!hasPredmarketCue) {
    return null;
  }
  const withoutPrefix = task
    .replace(/^research\s+(?:this\s+)?(?:prediction\s+)?market(?:\s+topic)?[:\s-]*/i, '')
    .replace(/^research\s+the\s+(?:prediction\s+)?market(?:\s+topic)?[:\s-]*/i, '')
    .replace(/\bListed outcomes in AgentFlow:[^\n]*/gi, '')
    .replace(/\bMarket address for AgentFlow trade routing only:[^\n]*/gi, '')
    .replace(/\bDo not research the contract address itself[^\n]*/gi, '')
    .replace(/\bFocus on the real-world event[^\n]*/gi, '')
    .replace(/\(\s*0x[a-fA-F0-9]{40}\s*\)/g, '')
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, '')
    .trim();

  if (!marketAddress && !withoutPrefix) {
    return null;
  }

  return {
    marketAddress: marketAddress ?? null,
    titleHint: withoutPrefix || null,
  };
}

function buildPredmarketListQuickActionGroups(
  result: string,
): Array<{
  title?: string;
  actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }>;
}> {
  const groups = buildPredmarketCategoryActionGroups();
  const marketMatches = Array.from(
    result.matchAll(
      /###\s+[^\n]*?\s(.+?)\n[\s\S]*?- \*\*Outcomes:\*\* ([^\n]+)\n[\s\S]*?- \*\*Address:\*\* `?(0x[a-fA-F0-9]{40})`?/g,
    ),
  );

  for (const match of marketMatches) {
    const title = match[1]?.trim() || 'Market';
    const outcomes = parseOutcomeOptionsFromSummaryLine(match[2] || '');
    const address = match[3] as `0x${string}`;
    groups.push(buildPredmarketTradeActionGroup(title, address, outcomes));
  }

  if (/show more markets/i.test(result) || /There are \d+ more markets/i.test(result)) {
    groups.push({
      title: 'More results',
      actions: [
        { label: 'Show more markets', prompt: 'show more markets' },
        { label: 'Show all markets', prompt: 'show all markets', tone: 'secondary' },
      ],
    });
  }

  return groups;
}

function buildPredmarketDetailQuickActionGroups(
  result: string,
  marketAddress: `0x${string}`,
): Array<{
  title?: string;
  actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }>;
}> {
  const titleMatch = result.match(/^##\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || 'Prediction market';
  const stageMatch = result.match(/- \*\*Stage:\*\*\s+([A-Za-z]+)/i);
  const stage = (stageMatch?.[1] || '').trim().toLowerCase();
  const outcomes = parseOutcomeOptionsFromDetailResult(result);
  if (outcomes.length && stage !== 'resolved' && stage !== 'cancelled' && stage !== 'expired') {
    return [
      {
        title: 'Trade this market',
        actions: [
          ...outcomes.map((outcome) => ({
            label: outcome.label,
            prompt: `bet on ${formatPredictionOutcomePrompt(outcome)} for ${marketAddress}`,
          })),
          { label: 'Research', prompt: buildPredmarketResearchPrompt(title, marketAddress) },
          { label: 'Show more markets', prompt: 'show more markets', tone: 'secondary' },
        ],
      },
    ];
  }
  if (stage === 'resolved') {
    return [
      {
        title: 'Resolved market',
        actions: [
          { label: 'Redeem', prompt: `redeem ${marketAddress}` },
          { label: 'Research', prompt: buildPredmarketResearchPrompt(title, marketAddress) },
          { label: 'Show positions', prompt: 'show my prediction market positions', tone: 'secondary' },
        ],
      },
    ];
  }
  if (stage === 'cancelled' || stage === 'expired') {
    return [
      {
        title: 'Closed market',
        actions: [
          { label: 'Refund', prompt: `refund ${marketAddress}` },
          { label: 'Research', prompt: buildPredmarketResearchPrompt(title, marketAddress) },
          { label: 'Show positions', prompt: 'show my prediction market positions', tone: 'secondary' },
        ],
      },
    ];
  }
  return [
    {
      title: 'Next step',
      actions: [
        { label: 'Research', prompt: buildPredmarketResearchPrompt(title, marketAddress) },
        { label: 'Show prediction markets', prompt: 'show prediction markets' },
        { label: 'Show more markets', prompt: 'show more markets', tone: 'secondary' },
      ],
    },
  ];
}

function buildPredmarketSellAction(
  positionStr: string,
  address: `0x${string}`,
): { label: string; prompt: string; tone: 'primary' } | null {
  // Parse the first "<shares> <label> shares" entry. The label may carry an emoji
  // prefix and/or multiple words (e.g. "🌍 Others"), so capture everything up to
  // " shares" and then strip non-word symbols to get a usable outcome token.
  const match = positionStr.match(/([0-9]+(?:\.[0-9]+)?)\s+(.+?)\s+shares?\b/u);
  if (!match) return null;
  const rawShares = Number(match[1]);
  if (!Number.isFinite(rawShares) || rawShares <= 0) return null;
  // Floor to 6 decimals so the one-tap sell never exceeds the on-chain balance.
  const shares = (Math.floor(rawShares * 1e6) / 1e6).toString();
  if (shares === '0') return null;
  const label = (match[2] || '')
    .replace(/\[\[AFMETA:[^\]]*\]\]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Prefer the explicit outcome index (from the hidden AFMETA marker) so the sell
  // resolves unambiguously for any market, incl. multi-outcome ones. Fall back to
  // the cleaned label (works for Yes/No) when no marker is present.
  const indexMatch = positionStr.match(/\[\[AFMETA:po=(\d+)\]\]/);
  const outcomeRef = indexMatch
    ? `outcome ${indexMatch[1]}${label ? ` (${label})` : ''}`
    : label;
  if (!outcomeRef) return null;
  return {
    label: 'Sell',
    prompt: `sell ${shares} shares ${outcomeRef} for ${address}`,
    tone: 'primary',
  };
}

function buildPredmarketPositionQuickActionGroups(
  result: string,
): Array<{
  title?: string;
  actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }>;
}> {
  const groups: Array<{
    title?: string;
    actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }>;
  }> = [];
  const matches = Array.from(
    result.matchAll(
      /###\s+[^\n]*?\s(.+?)\n[\s\S]*?- \*\*Position:\*\* ([^\n]+)\n[\s\S]*?- \*\*Status:\*\* ([^\n]+)\n[\s\S]*?- \*\*Address:\*\* `?(0x[a-fA-F0-9]{40})`?/g,
    ),
  );

  for (const match of matches) {
    const title = match[1]?.trim() || 'Market';
    const positionStr = (match[2] || '').trim();
    const status = (match[3] || '').trim().toLowerCase();
    const address = match[4] as `0x${string}`;
    const shortTitle = title.length > 52 ? `${title.slice(0, 49)}...` : title;

    if (status.includes('redeemable now')) {
      groups.push({
        title: shortTitle,
        actions: [
          { label: 'Redeem', prompt: `redeem ${address}` },
          { label: 'Research', prompt: buildPredmarketResearchPrompt(title, address) },
          { label: 'Details', prompt: `tell me about ${address}`, tone: 'secondary' },
        ],
      });
      continue;
    }

    if (status.includes('refundable now')) {
      groups.push({
        title: shortTitle,
        actions: [
          { label: 'Refund', prompt: `refund ${address}` },
          { label: 'Research', prompt: buildPredmarketResearchPrompt(title, address) },
          { label: 'Details', prompt: `tell me about ${address}`, tone: 'secondary' },
        ],
      });
      continue;
    }

    // Active/open position: offer a one-tap Sell to exit early.
    const sellAction = status.includes('active')
      ? buildPredmarketSellAction(positionStr, address)
      : null;
    const actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }> = [];
    if (sellAction) actions.push(sellAction);
    actions.push({ label: 'Research', prompt: buildPredmarketResearchPrompt(title, address) });
    actions.push({
      label: 'Details',
      prompt: `tell me about ${address}`,
      ...(sellAction ? { tone: 'secondary' as const } : {}),
    });
    groups.push({ title: shortTitle, actions });
  }

  const inlineMatches = Array.from(
    result.matchAll(
      /([^;\n]+?)\s+\((0x[a-fA-F0-9]{40})\):\s+[^;\n]*?\s+-\s+(Redeemable now|Refundable now|Stage:\s*[^;\n]+)/g,
    ),
  );

  for (const match of inlineMatches) {
    const title = match[1]?.replace(/^\*\*[^:]+:\*\*\s*/, '').trim() || 'Market';
    const address = match[2] as `0x${string}`;
    const status = (match[3] || '').trim().toLowerCase();
    if (groups.some((group) => group.actions.some((action) => action.prompt.includes(address)))) {
      continue;
    }

    if (status.includes('redeemable now')) {
      groups.push({
        title: title.length > 52 ? `${title.slice(0, 49)}...` : title,
        actions: [
          { label: 'Redeem', prompt: `redeem ${address}` },
          { label: 'Research', prompt: buildPredmarketResearchPrompt(title, address) },
          { label: 'Details', prompt: `tell me about ${address}`, tone: 'secondary' },
        ],
      });
      continue;
    }

    if (status.includes('refundable now')) {
      groups.push({
        title: title.length > 52 ? `${title.slice(0, 49)}...` : title,
        actions: [
          { label: 'Refund', prompt: `refund ${address}` },
          { label: 'Research', prompt: buildPredmarketResearchPrompt(title, address) },
          { label: 'Details', prompt: `tell me about ${address}`, tone: 'secondary' },
        ],
      });
      continue;
    }
  }

  return groups;
}

async function buildPredmarketResearchQuickActionGroups(
  task: string,
): Promise<
  | Array<{
  title?: string;
  actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }>;
    }>
  | undefined
> {
  const context = extractPredmarketResearchContext(task);
  if (!context) {
    return undefined;
  }

  return buildPredmarketResearchQuickActionGroupsFromContext(context);
}

async function buildPredmarketResearchQuickActionGroupsFromContext(
  context: { marketAddress: `0x${string}` | null; titleHint: string | null },
): Promise<
  Array<{
    title?: string;
    actions: Array<{ label: string; prompt: string; tone?: 'primary' | 'secondary' }>;
  }>
> {
  const resolvedMarketAddress =
    context.marketAddress ?? (await resolvePredmarketAddressFromTitle(context.titleHint));
  const tradeTitle = context.titleHint ? `Trade ${context.titleHint}` : 'Trade this market';
  if (!resolvedMarketAddress) {
    return [
      {
        title: tradeTitle,
        actions: [
          { label: 'Show prediction markets', prompt: 'show prediction markets' },
        ],
      },
    ];
  }

  try {
    const detail = await getPredmarketDetail('achmarket', resolvedMarketAddress);
    const outcomes = detail.outcomes.map((outcome, index) => ({
      index,
      label: outcome.label,
    }));
    if (outcomes.length) {
      return [
        {
          title: tradeTitle,
          actions: [
            ...buildPredmarketOutcomeActions(resolvedMarketAddress, outcomes),
            {
              label: 'Show prediction markets',
              prompt: 'show prediction markets',
              tone: 'secondary',
            },
          ],
        },
      ];
    }
  } catch (error) {
    console.warn('[predmarket] research quick actions detail lookup failed:', getErrorMessage(error));
  }

  return [
    {
      title: tradeTitle,
      actions: [
        { label: 'Trade', prompt: `tell me about ${resolvedMarketAddress}` },
        { label: 'Show prediction markets', prompt: 'show prediction markets', tone: 'secondary' },
      ],
    },
  ];
}

async function resolvePredmarketAddressFromTitle(
  titleHint: string | null,
): Promise<`0x${string}` | null> {
  const normalizedTitle = titleHint?.trim().toLowerCase();
  if (!normalizedTitle) {
    return null;
  }

  try {
    const markets = await listPredmarketMarkets();
    const exactMatch = markets.find((market) => market.title.trim().toLowerCase() === normalizedTitle);
    if (exactMatch) {
      return exactMatch.address;
    }
    const looseMatch = markets.find((market) =>
      market.title.trim().toLowerCase().includes(normalizedTitle) ||
      normalizedTitle.includes(market.title.trim().toLowerCase()),
    );
    return looseMatch?.address ?? null;
  } catch (error) {
    console.warn('[predmarket] title-to-address lookup failed:', getErrorMessage(error));
    return null;
  }
}

/**
 * Detect split-payment intent. Matches phrasings Hermes tends to hallucinate on
 * (e.g. "split 30 USDC between A and B"). When this returns true we bypass
 * Hermes entirely and call the Split Agent directly — same pattern used for
 * the schedule agent above.
 */
function shouldHandleAsSplitRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(?:yes|no|confirm|cancel|y|n|yeah|yep|nope)$/i.test(normalized)) return false;

  // "split X USDC between/among A and B..."
  if (/\bsplit\b.*\b(?:between|among|with|amongst)\b/i.test(normalized)) return true;
  // "divide X USDC between/among A and B..."
  if (/\bdivide\b.*\b(?:between|among|amongst)\b/i.test(normalized)) return true;
  // "split the bill" / "split dinner"
  if (/\bsplit\s+(?:the\s+)?(?:bill|tab|cost|check|dinner|lunch|rent)\b/i.test(normalized)) return true;
  // "pay A, B and C equally"
  if (/\bpay\b.*\bequally\b/i.test(normalized)) return true;
  // "send X each to A, B, C"
  if (/\bsend\b.*\beach\s+to\b/i.test(normalized)) return true;

  return false;
}

/**
 * Detect research-style intent so chat can bypass Hermes and run the
 * research → analyst → writer pipeline. Broader than keyword-only "research"
 * commands to catch natural market/topic questions while excluding short acks
 * and payment intents.
 */
const NON_RESEARCH_PHRASES =
  /^(good|ok|okay|thanks|thank you|got it|perfect|great|nice|cool|awesome|understood|noted|sure|yep|nope|no|yes|nice one|well done)\s*[.!]?\s*$/i;
function looksLikeComparativeResearchQuery(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (!/\b(?:vs|versus|compare|comparison)\b/i.test(normalized)) return false;
  if (/\b(?:pay|send|request|invoice|history|contact|schedule|wallet|portfolio)\b/i.test(normalized)) {
    return false;
  }
  return normalized.split(/\s+/).filter(Boolean).length >= 3;
}

function shouldHandleAsResearchRequest(
  message: string,
  history: BrainConversationMessage[] = [],
): boolean {
  if (!message.trim()) return false;
  if (buildLowConfidenceClarifyRoute(message)) return false;

  const normalized = message.trim().toLowerCase();
  const capabilityRouting = analyzeCapabilityAwareRouting(message);

  if (NON_RESEARCH_PHRASES.test(normalized)) return false;
  if (hasClarifyCapability(capabilityRouting)) return false;
  if (capabilityRouting.vault.routeToFeature && isVaultDiscoveryIntent(message)) return false;
  if (capabilityRouting.bridge.routeToFeature && (isBridgeExecutionIntent(message) || /\bbridge\b/i.test(normalized))) {
    return false;
  }
  if (capabilityRouting.swap.routeToFeature) return false;
  if (capabilityRouting.predmarket.routeToFeature && isPredictionMarketBrowseIntent(message)) return false;
  return (
    isExplicitResearchRequest(message) ||
    detectPortfolioImpactIntent(message) ||
    looksLikeComparativeResearchQuery(message)
  );
}

function shouldHandleAsPublicCurrentInfoRequest(normalizedMessage: string): boolean {
  if (!normalizedMessage.trim()) return false;
  if (NON_RESEARCH_PHRASES.test(normalizedMessage)) return false;
  if (/\b(agentflow|agentpay|my wallet|my payments|my portfolio|my balance)\b/i.test(normalizedMessage)) {
    return false;
  }

  const asksIdentityOrCurrentRole =
    /\b(who is|tell me about|what do you know about|latest|recent|current|information about)\b/i.test(
      normalizedMessage,
    ) ||
    /\b(president|prime minister|ceo|founder|senator|governor|minister|chair|chairman|candidate)\b/i.test(
      normalizedMessage,
    );

  const publicFigureOrInstitution =
    /\b(donald\s+trump|trump|joe\s+biden|biden|elon\s+musk|sam\s+altman|jerome\s+powell|president\s+of\s+(?:the\s+)?(?:usa|u\.s\.|united\s+states)|white\s+house|circle|openai|arc\s+network)\b/i.test(
      normalizedMessage,
    );

  return asksIdentityOrCurrentRole && publicFigureOrInstitution;
}

function shouldBypassToResearchPipeline(message: string): boolean {
  return shouldHandleAsResearchRequest(message);
}

function buildResearchFailureReply(details: string): string {
  const cleaned = details.trim();
  if (!cleaned) {
    return [
      'I could not complete the live research run for this request.',
      'The research pipeline failed before it returned a report.',
      '',
      'I am not substituting a portfolio summary or a memory-based answer for a failed research job.',
      'Please retry the research request in a moment.',
    ].join('\n');
  }

  const reason = /payment/i.test(cleaned)
    ? 'The x402 payment step failed before the live research run could complete.'
    : cleaned.length > 220
      ? `${cleaned.slice(0, 217)}...`
      : cleaned;

  return [
    'I could not complete the live research run for this request.',
    `Reason: ${reason}`,
    '',
    'I am not substituting a portfolio summary or a memory-based answer for a failed research job.',
    'Please retry the research request in a moment.',
  ].join('\n');
}

const RESEARCH_CONFIRM_REDIS_PREFIX = 'research:confirm:';
const RESEARCH_CONFIRM_REDIS_TTL_SECONDS = 900;

/** Assistant asked whether to run/deepen research instead of invoking the pipeline yet. */
function looksLikeAssistantResearchConfirmationOffer(text: string): boolean {
  const t = text.trim();
  if (!/\?/.test(t)) return false;
  if (/\bresearch\b/i.test(t)) {
    if (/\bshould\s+i\s+(?:run|do|start|prepare)\b/i.test(t)) return true;
    if (/\bwould\s+you\s+like\s+(?:me\s+to\s+)?(?:run|have|kick\s+off|start)/i.test(t)) return true;
    if (/\bwant\s+me\s+to\s+(?:run|do|start|kick\s+off)\b/i.test(t)) return true;
    if (/\b(?:run|generate|create|produce)\s+(?:a\s+)?(?:deep\s+)?research\s+report\b/i.test(t))
      return true;
    if (/\bresearch\s+report\s+(?:on|for|about)\b/i.test(t)) return true;
  }
  return false;
}

/** After “Should I run research…?”, YES should resume `/run` with the prior topic (not YES). */
function resolveDeferredResearchTaskFromBrainHistory(
  history: ReadonlyArray<{ role: string; content: string }>,
): string | null {
  for (let i = history.length - 1; i >= 1; i -= 1) {
    const turn = history[i];
    if (turn.role !== 'assistant' || !looksLikeAssistantResearchConfirmationOffer(turn.content)) {
      continue;
    }
    for (let j = i - 1; j >= 0; j -= 1) {
      const prior = history[j];
      if (prior.role !== 'user') continue;
      const candidate = typeof prior.content === 'string' ? prior.content.trim() : '';
      if (!candidate) continue;
      if (shouldHandleAsResearchRequest(candidate)) return candidate;
      break;
    }
  }
  return null;
}

async function persistResearchConfirmationOfferRedis(
  actionScopeKey: string | undefined,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  if (!actionScopeKey?.trim()) return;
  if (!looksLikeAssistantResearchConfirmationOffer(assistantMessage)) return;
  if (!shouldHandleAsResearchRequest(userMessage)) return;
  await getRedis().set(
    `${RESEARCH_CONFIRM_REDIS_PREFIX}${actionScopeKey.trim()}`,
    JSON.stringify({ task: userMessage.trim() }),
    'EX',
    RESEARCH_CONFIRM_REDIS_TTL_SECONDS,
  );
  if (isAgentflowChatSessionTraceDebug()) {
    console.info('[chat-session-trace]', {
      research_confirm_saved: true,
      scope: actionScopeKey.trim().slice(0, 128),
    });
  }
}

async function takeDeferredResearchConfirmTaskRedis(
  actionScopeKey: string,
): Promise<string | null> {
  const key = `${RESEARCH_CONFIRM_REDIS_PREFIX}${actionScopeKey}`;
  const raw = await getRedis().get(key).catch(() => null);
  if (!raw) return null;
  await getRedis().del(key).catch(() => null);
  try {
    const parsed = JSON.parse(String(raw)) as { task?: unknown };
    const task = parsed.task != null ? String(parsed.task).trim() : '';
    return task ? task : null;
  } catch {
    return null;
  }
}

/** Prefer thread-scoped key; fall back to wallet-only key for legacy offers. */
async function takeDeferredResearchConfirmTaskRedisDual(
  primaryScope: string,
  fallbackScope: string,
): Promise<string | null> {
  const first = await takeDeferredResearchConfirmTaskRedis(primaryScope);
  if (first) return first;
  if (fallbackScope && fallbackScope !== primaryScope) {
    return takeDeferredResearchConfirmTaskRedis(fallbackScope);
  }
  return null;
}

type BrainResearchPipelineChatOpts = {
  res: Response;
  memorySessionId: string;
  persistUserTurn: string;
  researchTask: string;
  /** The raw user message. Used for report-language detection, because
   * researchTask may be a Hermes-normalized (English) query, not what the user typed. */
  originalUserMessage?: string;
  reasoningMode?: 'fast' | 'deep';
  portfolioImpact?: boolean;
  walletAddress: string;
  brainEventId?: string;
  /** Passed to Redis research-confirmation persistence for assistant replies in this pipeline. */
  redisActionScopeKey?: string;
  predmarketResearchContext?: {
    marketAddress: `0x${string}` | null;
    titleHint: string | null;
  } | null;
};

async function executeBrainResearchPipelineForChat(opts: BrainResearchPipelineChatOpts): Promise<void> {
  const {
    res,
    memorySessionId,
    persistUserTurn,
    researchTask,
    originalUserMessage,
    reasoningMode: requestedReasoningMode,
    portfolioImpact = false,
    walletAddress,
    brainEventId,
    redisActionScopeKey,
    predmarketResearchContext = null,
  } = opts;
  const effectivePredmarketResearchContext =
    predmarketResearchContext ??
    extractPredmarketResearchContext(researchTask) ??
    (originalUserMessage && originalUserMessage !== researchTask
      ? extractPredmarketResearchContext(originalUserMessage)
      : null);

  const syncToken = `sync:${randomUUID()}`;
  let slotHeld = false;
  let keepAliveTimer: NodeJS.Timeout | null = null;
  const intermediate: string[] = [];
  const pushStatus = (status: string) => {
    intermediate.push(status);
    res.write(`data: ${JSON.stringify({ delta: status })}\n\n`);
  };
  const startKeepAlive = () => {
    if (keepAliveTimer) return;
    // Keep the browser SSE connection warm while /run is busy with long
    // retrieval windows (prediction-market / current-events research can sit
    // quiet for 30-60s before the next visible step arrives). Use a benign
    // meta event instead of an SSE comment so every client/proxy path sees
    // concrete bytes and keeps the stream alive.
    keepAliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ meta: { keepAlive: true } })}\n\n`);
      }
    }, 10_000);
  };
  const stopKeepAlive = () => {
    if (!keepAliveTimer) return;
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  };

  try {
    const reasoningMode = inferResearchReasoningMode({
      task: researchTask,
      explicitMode: requestedReasoningMode,
      defaultMode: 'fast',
    });

    const acquired = await tryAcquireResearchSlot(syncToken);
    if (!acquired) {
      const { jobId, position } = await enqueueResearch({
        sessionId: memorySessionId,
        walletAddress,
        query: researchTask,
        mode: 'fast',
        reasoningMode,
      });
      const waitMsg = [
        '📊 Our research pipeline is busy right now.',
        'Your report will be queued and ready soon.',
        '',
        `Query: "${researchTask}"`,
        `Position: #${position}`,
        `Job ID: ${jobId}`,
        '',
        "You'll get a Telegram notification when it's done (if Telegram is linked).",
        'The full report will also appear in this chat when polling completes.',
        'Reports usually take 1-2 minutes.',
      ].join('\n');
      await appendBrainConversationTurn(
        memorySessionId,
        persistUserTurn,
        waitMsg,
        redisActionScopeKey,
      );
      if (brainEventId) {
        await updateBrainEvent(brainEventId, {
          intent_label: 'research',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('research'),
          hermes_model: 'fast',
          final_response_summary: waitMsg,
          outcome: 'success',
          research_trajectory: {
            query: researchTask,
            sub_questions_generated: 0,
            sources_count: 0,
            claims_count: 0,
            deep_or_fast_mode: reasoningMode,
            queued: true,
            total_cost: null,
          },
        });
      }
      res.write(
        `data: ${JSON.stringify({
          meta: { researchQueued: { jobId, position } },
        })}\n\n`,
      );
      res.write(`data: ${JSON.stringify({ delta: waitMsg })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    slotHeld = true;

    pushStatus(
      reasoningMode === 'deep'
        ? 'Running deep research with source-registry retrieval, Firecrawl verification, analyst review, and writer synthesis. This can take a few minutes.\n\n'
        : 'Running research -> analyst -> writer with Firecrawl + SearXNG live retrieval and source checks. This usually takes 1-2 minutes.\n\n',
    );

    const pipelineRes = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: researchTask,
        userAddress: walletAddress,
        portfolioImpact,
        reasoningMode,
        deepResearch: reasoningMode === 'deep',
      }),
    });

    if (!pipelineRes.ok || !pipelineRes.body) {
      throw new Error(`Research pipeline returned ${pipelineRes.status} ${pipelineRes.statusText}`);
    }

    startKeepAlive();
    const reader = pipelineRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let report = '';
    let reportPayload: any = null;
    let pipelineErr = '';
    let eventCount = 0;
    let pipelineReceipt: any = null;

    const handlePipelineSseEvent = (ev: string) => {
      if (!ev.trim()) return;
      eventCount += 1;
      for (const line of ev.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;
        if (typeof parsed.type === 'string') {
          console.log(
            '[research-consumer] event:',
            parsed.type,
            typeof parsed.step === 'string' ? parsed.step : '',
          );
        }
        if (parsed.type === 'step_start' && typeof parsed.step === 'string') {
          pushStatus(`- ${parsed.step} agent started\n`);
        } else if (parsed.type === 'step_complete' && typeof parsed.step === 'string') {
          pushStatus(`- ${parsed.step} agent complete\n`);
        } else if (typeof parsed.delta === 'string' && parsed.delta) {
          pushStatus(parsed.delta);
        } else if (parsed.type === 'report' && typeof parsed.markdown === 'string') {
          report = parsed.markdown;
          reportPayload = parsed;
        } else if (parsed.type === 'receipt') {
          pipelineReceipt = parsed;
        } else if (parsed.type === 'error' && typeof parsed.message === 'string') {
          pipelineErr = parsed.message;
        }
      }
    };

    const drainCompleteSseBlocks = () => {
      const normalized = buffer.replace(/\r\n/g, '\n');
      const events = normalized.split('\n\n');
      buffer = events.pop() ?? '';
      for (const ev of events) {
        handlePipelineSseEvent(ev);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      drainCompleteSseBlocks();
      if (done) {
        const tail = buffer.replace(/\r\n/g, '\n').trim();
        buffer = '';
        if (tail) {
          handlePipelineSseEvent(tail);
        }
        break;
      }
    }

    console.log('[research-consumer] done,', 'got report:', !!report, 'events:', eventCount);

    if (!report && pipelineErr) {
      stopKeepAlive();
      const failureText = `Research pipeline failed: ${pipelineErr}`;
      await appendBrainConversationTurn(memorySessionId, persistUserTurn, failureText, redisActionScopeKey);
      res.write(`data: ${JSON.stringify({ delta: `\n${failureText}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (!report) {
      stopKeepAlive();
      console.error('[research] no report markdown received');
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: 'Report generation incomplete. Please try again.',
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    console.log('[research] report received, length:', report.length);

    const paymentMeta = pipelineReceipt
      ? {
          entries:
            Array.isArray(pipelineReceipt.entries) && pipelineReceipt.entries.length
              ? pipelineReceipt.entries
              : [
                  {
                    requestId: `${pipelineReceipt.pipelineRequestId ?? 'pipeline'}:research`,
                    agent: 'research',
                    price: pipelineReceipt.researchPrice ?? null,
                    transactionRef: pipelineReceipt.researchTx ?? null,
                    settlementTxHash: null,
                    mode: 'dcw',
                  },
                  {
                    requestId: `${pipelineReceipt.pipelineRequestId ?? 'pipeline'}:analyst`,
                    agent: 'analyst',
                    price: pipelineReceipt.analystPrice ?? null,
                    transactionRef: pipelineReceipt.analystTx ?? null,
                    settlementTxHash: null,
                    mode: 'dcw',
                  },
                  {
                    requestId: `${pipelineReceipt.pipelineRequestId ?? 'pipeline'}:writer`,
                    agent: 'writer',
                    price: pipelineReceipt.writerPrice ?? null,
                    transactionRef: pipelineReceipt.writerTx ?? null,
                    settlementTxHash: null,
                    mode: 'dcw',
                  },
                ],
        }
      : null;
    const liveData = reportPayload?.liveData && typeof reportPayload.liveData === 'object'
      ? (reportPayload.liveData as Record<string, any>)
      : {};
    const sourcesCount =
      Number(liveData.source_count) ||
      (Array.isArray(liveData.sources) ? liveData.sources.length : 0) ||
      0;
    const claimsCount = Array.isArray(reportPayload?.analysis?.claims)
      ? reportPayload.analysis.claims.length
      : Array.isArray(reportPayload?.research?.claims)
        ? reportPayload.research.claims.length
        : 0;
    const totalCost = pipelineReceipt?.total ? Number(pipelineReceipt.total) : null;

    // If the user wrote the request in / asked for a non-English language,
    // translate the finished report into that language. Done here (after /run
    // returns the English report) so the SSE pipeline is never blocked; uses the
    // fast model (~6s) and falls back to English on any error.
    // Detect from the raw user message (researchTask may be a Hermes-normalized
    // English query, which would hide the user's actual language).
    const reportLanguage = report
      ? resolveReportLanguage(originalUserMessage || researchTask)
      : null;
    if (reportLanguage && report) {
      try {
        console.log(`[research-chat] translating report into ${reportLanguage.name}`);
        report = await translateReportMarkdown(report, reportLanguage.name);
      } catch (translateErr) {
        console.warn(
          '[research-chat] report translation failed, keeping English:',
          getErrorMessage(translateErr),
        );
      }
    }

    const finalText = `\n\n---\n\n${report}`;
    await appendBrainConversationTurn(
      memorySessionId,
      persistUserTurn,
      `${intermediate.join('')}${finalText}`,
      redisActionScopeKey,
    );
    // Only surface "Trade / prediction market" quick actions when the research
    // was actually launched from a prediction-market context. Plain research
    // (e.g. "BTC report") should NOT auto-attach trade buttons just because it
    // mentions a tradeable asset.
    const researchQuickActionGroups = effectivePredmarketResearchContext
      ? await buildPredmarketResearchQuickActionGroupsFromContext(effectivePredmarketResearchContext)
      : undefined;
    res.write(
      `data: ${JSON.stringify({
        meta: {
          eventId: brainEventId,
          reportMeta: {
            kind: 'research',
            mode: reasoningMode,
            ...(effectivePredmarketResearchContext
              ? { contextKind: 'prediction_market' }
              : {}),
          },
          ...(researchQuickActionGroups
            ? { quickActionGroups: researchQuickActionGroups }
            : {}),
          ...(paymentMeta ? { paymentMeta } : {}),
        },
      })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({
        type: 'report',
        markdown: report,
        research: reportPayload?.research ?? null,
        analysis: reportPayload?.analysis ?? null,
        liveData: reportPayload?.liveData ?? null,
      })}\n\n`,
    );
    res.write(`data: ${JSON.stringify({ delta: finalText })}\n\n`);
    if (brainEventId) {
      await updateBrainEvent(brainEventId, {
        intent_label: 'research',
        intent_source: 'fastpath',
        ...buildFastpathBrainEventFields('research'),
        hermes_model: 'fast',
        final_response_summary: report,
        outcome: 'success',
        research_trajectory: {
          query: researchTask,
          sub_questions_generated: 0,
          sources_count: sourcesCount,
          claims_count: claimsCount,
          deep_or_fast_mode: reasoningMode,
          total_cost: Number.isFinite(totalCost) ? totalCost : null,
        },
      });
    }
    stopKeepAlive();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (researchErr) {
    stopKeepAlive();
    const msg = researchErr instanceof Error ? researchErr.message : String(researchErr);
    console.warn('[chat/respond] research fast-path failed:', msg);
    const failureReply = buildResearchFailureReply(msg);
    await appendBrainConversationTurn(memorySessionId, persistUserTurn, failureReply, redisActionScopeKey);
    res.write(`data: ${JSON.stringify({ delta: `\n${failureReply}` })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } finally {
    stopKeepAlive();
    if (slotHeld) {
      await releaseResearchSlot(syncToken);
    }
  }
}

/**
 * Detect batch/payroll intent from chat message (text-only; no file attachments needed).
 */
function shouldHandleAsBatchPayment(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(?:yes|no|confirm|cancel|y|n|yeah|yep|nope)$/i.test(normalized)) return false;
  return /\b(batch\s*pay(?:ment)?|payroll|bulk\s+pay|pay\s+multiple|pay\s+everyone)\b/i.test(normalized);
}

/**
 * Extract BatchPaymentRow[] from a chat message with inline CSV body.
 */
function parseBatchMessage(message: string) {
  return parseBatchPaymentsFromMessage(message);
}

function formatBatchParseError(error: string): string {
  const example =
    'Use this format:\nbatch pay\nalice.arc,100,salary\nbob.arc,100,salary\n\nOr say:\nbatch pay 1 USDC to alice.arc and bob.arc';
  return error.includes('Use this format:') ? error : `${error}\n\n${example}`;
}

/**
 * Parse a split-payment message into { recipients, totalAmount, remark }.
 * Returns null if we can't confidently extract both recipients and amount.
 */
function parseSplitRequest(
  message: string,
): { recipients: string[]; totalAmount: string; remark?: string } | null {
  const raw = message.trim();
  if (!raw) return null;

  // Extract total amount (first number found, optionally followed by USDC/usd/$)
  const amountMatch = raw.match(/(?:\$\s*)?(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollars?)?/i);
  if (!amountMatch) return null;
  const totalAmount = amountMatch[1];

  // Extract the recipient list — the substring after between/among/to
  const afterKeyword = raw.match(
    /\b(?:between|among|amongst|to|with)\s+(.+?)(?:\s+(?:for|on|at|remark|note)\s+.+)?$/i,
  );
  const recipientsBlob = afterKeyword?.[1] ?? '';

  // Split on commas or " and " (case-insensitive), trim each piece
  const recipients = recipientsBlob
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map((r) => r.replace(/^(?:me|myself)$/i, '').trim())
    .filter((r) => r.length > 0);

  if (recipients.length < 2) return null;
  if (recipients.length > 10) return null;

  // Extract optional remark ("for dinner", "for rent", "remark foo")
  let remark: string | undefined;
  const remarkMatch = raw.match(/\b(?:for|remark|note)\s+([^,]+?)(?:\s+between|\s+among|\s*$)/i);
  if (remarkMatch) {
    const candidate = remarkMatch[1].trim();
    // Skip remark candidates that are numeric or look like keywords
    if (candidate && !/^\d/.test(candidate) && candidate.length < 60) {
      remark = candidate;
    }
  }

  return { recipients, totalAmount, remark };
}

/**
 * Detect "share a payment link / QR for X" intent. Pure URL construction — no
 * money moves, no confirmation needed. We bypass Hermes here because the LLM
 * loves to hallucinate transaction previews when it sees payment-shaped input.
 */
function shouldHandleAsPaymentLinkRequest(message: string): boolean {
  const n = message.trim();
  if (!n) return false;
  if (/^(?:yes|no|confirm|cancel|y|n|yeah|yep|nope)$/i.test(n)) return false;
  // Must explicitly mention "payment link" / "pay link" / "share link" / "qr".
  if (/\b(?:payment\s*link|pay\s*link|share\s*link)\b/i.test(n)) return true;
  if (/\bqr(?:\s*code)?\s+(?:for|to|of)\b/i.test(n)) return true;
  if (/\b(?:generate|create|make|give\s+me|send|share)\s+(?:a\s+|an\s+|the\s+)?qr\b/i.test(n))
    return true;
  return false;
}

/**
 * Parse a payment-link request into { handle, amount?, remark? }.
 * Returns null if no recipient handle (`.arc` name or `0x…` address) is present.
 */
function parsePaymentLinkRequest(
  message: string,
): { handle: string; amount?: string; remark?: string } | null {
  const raw = message.trim();
  if (!raw) return null;

  const handleRe = /\b([a-z0-9][a-z0-9-]*\.arc|0x[a-fA-F0-9]{40})\b/i;
  const handleMatch = raw.match(handleRe);
  if (!handleMatch || handleMatch.index === undefined) return null;

  const rawHandle = handleMatch[1];
  const handle = rawHandle.toLowerCase().startsWith('0x')
    ? rawHandle // keep checksummable case; URL consumer lowercases as needed
    : rawHandle.replace(/\.arc$/i, '').toLowerCase();

  // Amount/remark live in the tail after the handle — avoids matching
  // "for jack.arc" as the remark.
  const tail = raw.slice(handleMatch.index + handleMatch[0].length);

  let amount: string | undefined;
  const amtMatch = tail.match(/(?:\$\s*)?(\d+(?:\.\d+)?)\s*(?:usdc|usd|dollars?)?/i);
  if (amtMatch) amount = amtMatch[1];

  const remark = extractAgentpayRemark(tail, { maxLength: 80 });

  return { handle, amount, remark };
}

function shouldHandleAsInvoiceRequest(message: string): boolean {
  const n = message.trim();
  if (!n) return false;
  if (/^(?:yes|no|confirm|cancel|y|n|yeah|yep|nope)$/i.test(n)) return false;
  return /\bcreate\s+invoice\b|\bsend\s+invoice\b|\binvoice\s+for\b|\bmake\s+invoice\b/i.test(n);
}

function shouldHandleAsInvoiceStatus(message: string): boolean {
  return /check\s+(my\s+)?invoices?|show\s+(my\s+)?invoices?|invoice\s+status|my\s+invoices?|list\s+invoices?|unpaid\s+invoices?/i.test(
    message.trim(),
  );
}

function shouldHandleAsContactView(message: string): boolean {
  return /show\s+(my\s+)?contacts|list\s+(my\s+)?contacts|my\s+saved\s+addresses|my\s+address\s+book/i.test(
    message.trim(),
  );
}

function shouldHandleAsContactSave(message: string): boolean {
  const t = message.trim();
  return (
    /save\s+\w+\s+as\s+/i.test(t) ||
    /^save\s+\w+$/i.test(t) ||
    /add\s+contact\s+/i.test(t) ||
    /\b\w+\s+is\s+(0x[a-fA-F0-9]{40}|[\w.-]+\.arc)\b/i.test(t)
  );
}

function shouldHandleAsContactUpdate(message: string): boolean {
  return /update\s+\w+\s+to\s+|change\s+\w+\s+address\s+to\s+/i.test(message.trim());
}

function shouldHandleAsContactDelete(message: string): boolean {
  return /remove\s+contact\s+|delete\s+contact\s+/i.test(message.trim());
}

function isBalanceIntent(message: string): boolean {
  const normalized = normalizeDirectRouteMessage(message).toLowerCase();
  if (!normalized) return false;
  if (isVaultPositionIntent(normalized)) return false;
  if (
    /\b(?:swap|trade|convert|exchange|bridge|deposit|withdraw|stake|send|pay|invoice|request|schedule)\b/i.test(
      normalized,
    )
  ) {
    return false;
  }

  return (
    /^(?:what(?:'s| is)?\s+my\s+balance|show\s+my\s+balance|balance|how\s+much\s+do\s+i\s+have|what\s+funds\s+do\s+i\s+have)$/i.test(
      normalized,
    ) ||
    /\b(?:current\s+balance|wallet\s+balance|my\s+balance|what(?:'s| is)?\s+balance|what(?:'s| is)?\s+my\s+usdc|how\s+much\s+usdc|how\s+much\s+eurc)\b/i.test(
      normalized,
    )
  );
}

function parseInvoiceRequest(
  message: string,
): { vendorHandle: string; amount: string; description: string } | null {
  const trimmed = message.trim();
  const handlePattern = String.raw`([a-z0-9][a-z0-9-]*\.arc|0x[a-fA-F0-9]{40})`;

  const descriptionFirst = trimmed.match(
    new RegExp(
      String.raw`(?:create|make|send)\s+(?:an?\s+)?invoice\s+for\s+(.+?)\s+for\s+${handlePattern}\s+for\s+(\d+(?:\.\d+)?)\s*(?:usdc|usd)?\b`,
      'i',
    ),
  );
  if (descriptionFirst) {
    return {
      vendorHandle: descriptionFirst[2].toLowerCase(),
      amount: descriptionFirst[3],
      description: descriptionFirst[1].trim() || 'Services rendered',
    };
  }

  const recipientFirst = trimmed.match(
    new RegExp(
      String.raw`(?:create|make|send)\s+(?:an?\s+)?invoice\s+for\s+${handlePattern}\s+(\d+(?:\.\d+)?)\s*(?:usdc|usd)?(?:\s+for\s+(.+))?$`,
      'i',
    ),
  );
  if (recipientFirst) {
    return {
      vendorHandle: recipientFirst[1].toLowerCase(),
      amount: recipientFirst[2],
      description: recipientFirst[3]?.trim() || 'Services rendered',
    };
  }

  return null;
}

function extractRecipientTextFromSlot(recipient: unknown): string | null {
  if (!recipient || typeof recipient !== 'object') {
    return null;
  }
  const candidate = recipient as { handle?: unknown; address?: unknown };
  if (typeof candidate.handle === 'string' && candidate.handle.trim()) {
    return candidate.handle.trim();
  }
  if (typeof candidate.address === 'string' && candidate.address.trim()) {
    return candidate.address.trim();
  }
  return null;
}

function extractAmountStringFromSlot(amount: unknown): string | null {
  if (!amount || typeof amount !== 'object') {
    return null;
  }
  const candidate = amount as { value?: unknown };
  if (typeof candidate.value === 'number' && Number.isFinite(candidate.value) && candidate.value > 0) {
    return String(candidate.value);
  }
  return null;
}

function extractBatchPaymentsFromIntent(
  intent: AgentFlowIntent | null | undefined,
  rawMessage?: string,
): BatchPaymentRow[] | null {
  const slots =
    intent?.slots && typeof intent.slots === 'object'
      ? (intent.slots as { payments?: unknown })
      : null;
  if (!Array.isArray(slots?.payments) || slots.payments.length === 0) {
    return null;
  }

  const payments: BatchPaymentRow[] = [];
  for (const payment of slots.payments) {
    if (!payment || typeof payment !== 'object') {
      return null;
    }
    const candidate = payment as { recipient?: unknown; amount?: unknown; remark?: unknown };
    const to = extractRecipientTextFromSlot(candidate.recipient);
    const amount = extractAmountStringFromSlot(candidate.amount);
    if (!to || !amount) {
      return null;
    }
    payments.push({
      to,
      amount,
      ...(typeof candidate.remark === 'string' && candidate.remark.trim()
        ? { remark: candidate.remark.trim() }
        : {}),
    });
  }

  const parsedFallback = rawMessage ? parseBatchMessage(rawMessage) : null;
  if (Array.isArray(parsedFallback) && parsedFallback.length === payments.length) {
    return payments.map((payment, index) => ({
      ...payment,
      ...(payment.remark
        ? {}
        : parsedFallback[index]?.remark
          ? { remark: parsedFallback[index].remark }
          : {}),
    }));
  }

  return payments.length > 0 ? payments : null;
}

function extractSplitRequestFromIntent(
  intent: AgentFlowIntent | null | undefined,
  rawMessage?: string,
): { recipients: string[]; totalAmount: string; remark?: string } | null {
  const slots =
    intent?.slots && typeof intent.slots === 'object'
      ? (intent.slots as { recipients?: unknown; total_amount?: unknown; remark?: unknown })
      : null;
  const totalAmount = extractAmountStringFromSlot(slots?.total_amount);
  if (!totalAmount || !Array.isArray(slots?.recipients) || slots.recipients.length < 2) {
    return null;
  }

  const recipients = slots.recipients
    .map((recipient) => extractRecipientTextFromSlot(recipient))
    .filter((recipient): recipient is string => Boolean(recipient));
  if (recipients.length < 2) {
    return null;
  }

  const fallbackRemark =
    rawMessage ? (parseSplitRequest(rawMessage)?.remark ?? undefined) : undefined;
  const slotRemark =
    typeof slots.remark === 'string' && slots.remark.trim() ? slots.remark.trim() : undefined;

  return {
    recipients,
    totalAmount,
    ...((slotRemark || fallbackRemark) ? { remark: slotRemark || fallbackRemark } : {}),
  };
}

function extractPaymentLinkRequestFromIntent(
  intent: AgentFlowIntent | null | undefined,
): { handle: string; amount?: string; remark?: string } | null {
  const slots =
    intent?.slots && typeof intent.slots === 'object'
      ? (intent.slots as { recipient?: unknown; amount?: unknown; remark?: unknown })
      : null;
  const rawHandle = extractRecipientTextFromSlot(slots?.recipient);
  if (!rawHandle) {
    return null;
  }
  const normalizedHandle = rawHandle.startsWith('0x')
    ? rawHandle
    : rawHandle.replace(/\.arc$/i, '').toLowerCase();
  const amount = extractAmountStringFromSlot(slots?.amount);
  return {
    handle: normalizedHandle,
    ...(amount ? { amount } : {}),
    ...(typeof slots?.remark === 'string' && slots.remark.trim() ? { remark: slots.remark.trim() } : {}),
  };
}

function extractInvoiceRequestFromIntent(
  intent: AgentFlowIntent | null | undefined,
): { vendorHandle: string; amount: string; description: string } | null {
  const slots =
    intent?.slots && typeof intent.slots === 'object'
      ? (intent.slots as { recipient?: unknown; amount?: unknown; description?: unknown })
      : null;
  const vendorHandle = extractRecipientTextFromSlot(slots?.recipient);
  const amount = extractAmountStringFromSlot(slots?.amount);
  const description =
    typeof slots?.description === 'string' && slots.description.trim()
      ? slots.description.trim()
      : null;
  if (!vendorHandle || !amount || !description) {
    return null;
  }
  return { vendorHandle, amount, description };
}

function isPredictionMarketLiveIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(prediction markets?|markets?)\b/.test(normalized) &&
    /\b(live|active|open|right now|at the moment|currently)\b/.test(normalized)
  );
}

function isVisionCapabilityQuestion(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(screenshot|image|photo|picture)\b/.test(normalized) &&
    /\b(read text|extract text|what does this say|ocr|analy[sz]e|upload)\b/.test(normalized)
  );
}

function isBridgeWalkthroughIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (!extractBridgeAmount(normalized) && !/\b(?:walk me through|how do i)\b/.test(normalized)) {
    return false;
  }
  if (!extractBridgeAmount(normalized) && /\bcan we\b/.test(normalized)) {
    return false;
  }
  return (
    /\b(base|base sepolia)\b/.test(normalized) &&
    /\barc\b/.test(normalized) &&
    /\b(bridge|walk me through|how do i get|get funds|move funds)\b/.test(normalized)
  );
}

function parseDirectAgentFlowRoute(
  message: string,
  history: BrainConversationMessage[] = [],
): DirectAgentFlowRoute | null {
  if (isExplicitResearchRequest(message)) {
    return null;
  }
  const normalized = normalizeDirectRouteMessage(message);
  if (!normalized) {
    return null;
  }
  if (isAmbiguousPredictionMarketIntent(normalized)) {
    return buildPredmarketClarifyReply();
  }
  const lowConfidenceClarify = buildLowConfidenceClarifyRoute(message);
  if (lowConfidenceClarify) {
    return lowConfidenceClarify;
  }
  if (isFinancialAdvisoryScopeIntent(normalized)) {
    return null;
  }
  if (/\btelegram\b/i.test(normalized) && /\b(?:what works|supported|features|can i do)\b/i.test(normalized)) {
    return {
      type: 'reply',
      text: buildTelegramCapabilitiesReply(),
    };
  }
  if (/\btelegram\b/i.test(normalized) && /\b(?:connect|link|setup|set up|start)\b/i.test(normalized)) {
    return {
      type: 'reply',
      text: buildTelegramSetupReply(),
    };
  }
  if (isTelegramProductQuestion(normalized)) {
    return buildTelegramHelpRoute();
  }
  const capabilityRouting = analyzeCapabilityAwareRouting(normalized);
  const clarifyReply = buildCapabilityClarifyReply(normalized, capabilityRouting);
  if (clarifyReply) {
    return clarifyReply;
  }
  if (looksLikePredictionMarketResearch(normalized)) {
    return null;
  }
  if (
    capabilityRouting.bridge.routeToResearch ||
    capabilityRouting.vault.routeToResearch ||
    capabilityRouting.swap.routeToResearch ||
    capabilityRouting.predmarket.routeToResearch
  ) {
    return null;
  }

  const politePrefix =
    "(?:(?:please|can you|could you|would you|help me|i want to|let's)\\s+)?";
  const wantsPortfolioFollowup = hasPortfolioFollowupIntent(normalized);
  const lastAssistantMessage = getMostRecentAssistantMessage(history);
  const recentPortfolioSnapshot = findRecentPortfolioSnapshotMessage(history);

  if (
    isShortReferentialFollowup(normalized) &&
    lastAssistantMessage &&
    isClearlyOffTopicAssistantReply(lastAssistantMessage)
  ) {
    return {
      type: 'reply',
      text: buildReferentialRecoveryReply(lastAssistantMessage),
    };
  }

  if (
    isReferentialNoAntecedentQuestion(normalized) &&
    !lastAssistantMessage
  ) {
    return {
      type: 'reply',
      text: buildMissingReferentReply(),
    };
  }

  if (
    /^(?:yes|y|yeah|yep|sure|ok|okay|go ahead|do it|run it|check it)$/i.test(normalized) &&
    /\bportfolio\b/i.test(lastAssistantMessage) &&
    /\b(?:paid|run|read|check|confirm)\b/i.test(lastAssistantMessage)
  ) {
    return {
      type: 'tool',
      tool: 'get_portfolio',
      args: {},
    };
  }

  if (
    shouldClarifyPortfolioRequest(normalized) &&
    recentPortfolioSnapshot &&
    isPortfolioReferentialFollowup(normalized)
  ) {
    return {
      type: 'reply',
      text: buildPortfolioContextualFollowupReply(normalized),
    };
  }

  if (
    /^(?:where\s+can\s+i\s+(?:see|view|find|open|check)\s+it|where\s+is\s+it|how\s+do\s+i\s+(?:see|view|find|open|check)\s+it)\??$/i.test(
      normalized,
    ) &&
    hasRecentPortfolioConversationContext(history)
  ) {
    return {
      type: 'reply',
      text: 'The portfolio report is in this chat above. Ask me to show your portfolio whenever you want a fresh live snapshot.',
    };
  }

  if (shouldClarifyPortfolioRequest(normalized)) {
    return {
      type: 'reply',
      text: buildPortfolioCheckClarificationReply(),
    };
  }

  if (isBalanceIntent(normalized)) {
    return {
      type: 'tool',
      tool: 'get_balance',
      args: {},
    };
  }

  if (isVaultPositionIntent(normalized)) {
    return {
      type: 'tool',
      tool: 'vault_action',
      args: { action: 'position' },
    };
  }

  if (isPredictionMarketPositionHowToIntent(normalized)) {
    return {
      type: 'reply',
      text: 'To check your prediction market positions, ask `show my prediction market positions`. I will read your AgentFlow wallet positions and show any active, redeemable, or refundable markets.',
      quickActionGroups: [
        {
          title: 'Prediction markets',
          actions: [
            { label: 'Show positions', prompt: 'show my prediction market positions' },
            { label: 'Browse markets', prompt: 'show prediction markets', tone: 'secondary' },
          ],
        },
      ],
    };
  }

  const contextualVaultSelection = detectVaultSelectionReply(normalized, lastAssistantMessage);
  if (contextualVaultSelection) {
    return buildVaultAmountChoiceReply(contextualVaultSelection);
  }

  if (/\b(?:use|open|show|pick)\s+luneusdc\s+vault\b/i.test(normalized)) {
    return buildVaultAmountChoiceReply('luneUSDC');
  }

  if (/\b(?:use|open|show|pick)\s+luneeurc\s+vault\b/i.test(normalized)) {
    return buildVaultAmountChoiceReply('luneEURC');
  }

  if (
    /\b(?:what|which)\b[\s\S]{0,40}\b(?:tokens?|pairs?|assets?)\b[\s\S]{0,40}\b(?:swap|swaps?)\b/i.test(normalized) ||
    /\b(?:swap|swaps?)\b[\s\S]{0,40}\b(?:supports?|available|available on agentflow|tokens?|pairs?)\b/i.test(normalized)
  ) {
    return {
      type: 'reply',
      text: formatSwapOverviewReply(),
      quickActionGroups: [
        {
          title: 'Try a swap',
          actions: [
            { label: 'Quote 1 USDC to EURC', prompt: 'swap 1 USDC to EURC' },
            { label: 'Quote 1 EURC to USDC', prompt: 'swap 1 EURC to USDC' },
          ],
        },
      ],
    };
  }

  if (
    capabilityRouting.vault.routeToFeature &&
    !/\b(?:stake|deposit|withdraw|redeem|unstake|remove|park|allocate|fund|put|move|stash)\b/i.test(normalized)
  ) {
    return {
      type: 'reply',
      text: formatVaultOverviewReply(),
      quickActionGroups: buildVaultListQuickActionGroups(),
    };
  }

  if (capabilityRouting.swap.routeToFeature && !isSwapExecutionIntent(normalized)) {
    return {
      type: 'reply',
      text: formatSwapOverviewReply(),
      quickActionGroups: [
        {
          title: 'Try a swap',
          actions: [
            { label: 'Quote 1 USDC to EURC', prompt: 'swap 1 USDC to EURC' },
            { label: 'Quote 1 EURC to USDC', prompt: 'swap 1 EURC to USDC' },
          ],
        },
      ],
    };
  }

  const requestMatch = normalized.match(
    /^(?:please\s+)?request\s+(\d+(?:\.\d+)?)\s*(?:USDC\s+)?from\s+(\S+)(.*)$/i,
  );
  if (requestMatch) {
    const remark = requestMatch[3]?.trim();
    return {
      type: 'tool',
      tool: 'agentpay_request',
      args: {
        amount: requestMatch[1],
        from: requestMatch[2],
        ...(remark ? { remark } : {}),
      },
    };
  }

  const billMatch = normalized.match(
    /^(?:please\s+)?bill\s+(\S+)\s+(\d+(?:\.\d+)?)\s*(?:USDC)?(.*)$/i,
  );
  if (billMatch) {
    const remark = billMatch[3]?.trim();
    return {
      type: 'tool',
      tool: 'agentpay_request',
      args: {
        from: billMatch[1],
        amount: billMatch[2],
        ...(remark ? { remark } : {}),
      },
    };
  }

  const askToPayMatch = normalized.match(
    /^(?:please\s+)?ask\s+(\S+)\s+to\s+pay\s+(\d+(?:\.\d+)?)\s*(?:USDC)?(.*)$/i,
  );
  if (askToPayMatch) {
    const remark = askToPayMatch[3]?.trim();
    return {
      type: 'tool',
      tool: 'agentpay_request',
      args: {
        from: askToPayMatch[1],
        amount: askToPayMatch[2],
        ...(remark ? { remark } : {}),
      },
    };
  }

  if (
    /^(?:show|list|browse)\s+(?:all\s+|the\s+all\s+)?(?:prediction\s+)?markets?$/i.test(normalized) ||
    /^all\s+(?:prediction\s+)?markets$/i.test(normalized) ||
    /^show\s+all\s+markets$/i.test(normalized) ||
    /^list\s+all\s+markets$/i.test(normalized) ||
    /^browse\s+all\s+markets$/i.test(normalized)
  ) {
    return {
      type: 'tool',
      tool: 'predict_action',
      args: { action: 'list', listMode: 'all' },
    };
  }

  if (isPredictionMarketBrowseIntent(normalized) && capabilityRouting.predmarket.routeToFeature) {
    return {
      type: 'tool',
      tool: 'predict_action',
      args: { action: 'list' },
    };
  }

  const categoryMatch = normalized.match(
    /^(?:show|browse|list)\s+(crypto|sports|politics|entertainment)\s+(?:prediction\s+)?markets$/i,
  );
  if (categoryMatch) {
    return {
      type: 'tool',
      tool: 'predict_action',
      args: {
        action: 'list',
        filter: { category: categoryMatch[1] },
      },
    };
  }

  if (
    capabilityRouting.predmarket.routeToFeature &&
    (lastAssistantLooksLikePredmarketList(lastAssistantMessage) &&
      /^(?:show\s+more|more|next|next\s+page|more\s+markets|show\s+more\s+markets|next\s+markets)$/i.test(
        normalized,
      )) ||
    /^(?:show\s+more|more|next|next\s+page|next\s+markets|show\s+more\s+markets)\s*(?:prediction\s+)?markets?$/i.test(
      normalized,
    ) ||
    /^show\s+more$/i.test(normalized)
  ) {
    return {
      type: 'tool',
      tool: 'predict_action',
      args: { action: 'list', listMode: 'next' },
    };
  }

  if (isPredictionMarketPositionIntent(normalized)) {
    return {
      type: 'tool',
      tool: 'predict_action',
      args: { action: 'position' },
    };
  }

  if (isPortfolioSnapshotIntent(normalized)) {
    return {
      type: 'tool',
      tool: 'get_portfolio',
      args: {},
    };
  }

  if (
    /\b(?:what(?:'s| is)\s+)?gateway\s+strategy\b/i.test(normalized) ||
    /\bwhat(?:'s| is)\s+the\s+gateway\b/i.test(normalized)
  ) {
    return {
      type: 'reply',
      text:
        'Gateway is not an investment strategy in AgentFlow. It is the USDC reserve used for x402 and agent-to-agent nanopayments. On your portfolio and funding pages, the Gateway position means payment liquidity parked in Circle Gateway, not a yield product.',
    };
  }

  const predictionMarketAddress =
    extractPredictionMarketAddress(message) ?? extractRecentPredictionContextAddress(history);
  const predictionOutcome = extractPredictionOutcomeChoice(
    message,
    history,
    predictionMarketAddress,
  );
  if (
    /\bhow\b[\s\S]{0,80}\bredeem\b/i.test(normalized) ||
    /\bwhen\b[\s\S]{0,80}\bredeem\b/i.test(normalized) ||
    /\bcan\b[\s\S]{0,80}\bredeem\b/i.test(normalized) ||
    /\bwhat\b[\s\S]{0,80}\bhappens?\b[\s\S]{0,80}\b(?:win|winning|won)\b[\s\S]{0,80}\bredeem\b/i.test(
      normalized,
    )
  ) {
    return {
      type: 'reply',
      text: [
        'If your outcome wins and the market is resolved, you redeem from your winning position.',
        '',
        'Use `redeem <market address>` to preview whether that market is claimable for your wallet.',
        'If the market is not resolved yet, redeem stays unavailable until the result is posted.',
        'If you do not hold the winning side, there is nothing to redeem for that wallet.',
      ].join('\n'),
    };
  }
  if (
    predictionMarketAddress &&
    /^(?:bet|buy)\s+on\b/i.test(normalized) &&
    predictionOutcome
  ) {
    return buildPredictionAmountChoiceReply(predictionMarketAddress, predictionOutcome);
  }
  if (
    predictionMarketAddress &&
    /^(?:tell me about|details? on|show details? for|show me|what is|what's)\b/i.test(normalized)
  ) {
    return {
      type: 'tool',
      tool: 'predict_action',
      args: {
        action: 'detail',
        marketAddress: predictionMarketAddress,
        provider: 'achmarket',
      },
    };
  }
  const buyMatch = normalized.match(
    new RegExp(
      `^${politePrefix}(?:bet|buy)\\s+(\\d+(?:\\.\\d+)?)\\s*USDC(?:\\s+on[\\s\\S]*)?$`,
      'i',
    ),
  );
  const flexibleBuyMatch = normalized.match(
    new RegExp(
      `^${politePrefix}(?:bet|buy)\\s+(\\d+(?:\\.\\d+)?)\\s*(?:USDC|\\$)(?:\\s+on[\\s\\S]*)?$`,
      'i',
    ),
  );
  const amountWithoutOutcomeMatch = normalized.match(
    new RegExp(
      `^${politePrefix}(?:bet|buy)\\s+(\\d+(?:\\.\\d+)?)\\s*(?:USDC|\\$)(?:[\\s\\S]*)$`,
      'i',
    ),
  );
  const resolvedBuyMatch = buyMatch || flexibleBuyMatch;
  if (resolvedBuyMatch) {
    if (!predictionOutcome) {
      if (predictionMarketAddress) {
        const knownOutcomes = extractPredictionOutcomeOptionsFromHistory(
          history,
          predictionMarketAddress,
        );
        if (knownOutcomes.length) {
          return buildPredictionOutcomeChoiceReply(
            predictionMarketAddress,
            resolvedBuyMatch[1],
            knownOutcomes,
          );
        }
        return {
          type: 'reply',
          text: 'Tell me about that market first so I can show the available outcomes.',
        };
      }
      return {
        type: 'reply',
        text: 'Which market? Share the market address, or ask me to show prediction markets first.',
      };
    }
    if (!predictionMarketAddress) {
      return {
        type: 'reply',
        text: 'Which market? Share the market address, or ask me to show prediction markets first.',
      };
    }
    return {
      type: 'tool',
      tool: 'predict_action',
      args: {
        action: 'buy',
        amount: resolvedBuyMatch[1],
        marketAddress: predictionMarketAddress,
        outcomeIdx: predictionOutcome.index,
        provider: 'achmarket',
        confirmed: false,
      },
    };
  }

  if (amountWithoutOutcomeMatch && predictionMarketAddress) {
    const knownOutcomes = extractPredictionOutcomeOptionsFromHistory(
      history,
      predictionMarketAddress,
    );
    if (knownOutcomes.length) {
      return buildPredictionOutcomeChoiceReply(
        predictionMarketAddress,
        amountWithoutOutcomeMatch[1],
        knownOutcomes,
      );
    }
    return {
      type: 'reply',
      text: 'Tell me about that market first so I can show the available outcomes.',
    };
  }

  const sellMatch = normalized.match(
    new RegExp(
      `^${politePrefix}sell\\s+(\\d+(?:\\.\\d+)?)\\s+shares?(?:\\s+of)?(?:[\\s\\S]*)$`,
      'i',
    ),
  );
  if (sellMatch) {
    if (!predictionOutcome) {
      return {
        type: 'reply',
        text: 'Which outcome shares do you want to sell?',
      };
    }
    if (!predictionMarketAddress) {
      return {
        type: 'reply',
        text: 'Which market? Share the market address, or ask me to show prediction markets first.',
      };
    }
    return {
      type: 'tool',
      tool: 'predict_action',
      args: {
        action: 'sell',
        sharesWad: sellMatch[1],
        marketAddress: predictionMarketAddress,
        outcomeIdx: predictionOutcome.index,
        provider: 'achmarket',
        confirmed: false,
      },
    };
  }

  if (/^redeem\b/i.test(normalized) && predictionMarketAddress) {
    return {
      type: 'tool',
      tool: 'predict_action',
      args: {
        action: 'redeem',
        marketAddress: predictionMarketAddress,
        provider: 'achmarket',
        confirmed: false,
      },
    };
  }

  if (/^refund\b/i.test(normalized) && predictionMarketAddress) {
    return {
      type: 'tool',
      tool: 'predict_action',
      args: {
        action: 'refund',
        marketAddress: predictionMarketAddress,
        provider: 'achmarket',
        confirmed: false,
      },
    };
  }

  if (isVisionCapabilityQuestion(normalized)) {
    return {
      type: 'reply',
      text: 'Yes. If you upload a screenshot or image, AgentFlow can analyze it and pull out visible text or key details here in chat.',
    };
  }

  if (isBridgeWalkthroughIntent(normalized)) {
    return {
      type: 'reply',
      text: [
        'To bridge funds onto Arc:',
        '1. Pick a supported source chain where your connected wallet holds USDC.',
        '2. Enter the amount you want to bridge to Arc.',
        '3. Review the preview, approve USDC if needed, and sign from the source wallet.',
        '4. After the bridge completes, the USDC lands in your AgentFlow wallet on Arc.',
        '',
        'If you want, I can show the supported source chains next or you can tell me the source chain you want to use.',
      ].join('\n'),
    };
  }

  const explicitSwapPortfolioMatch = normalized.match(
    new RegExp(
      `\\b(?:swap|trade|exchange|convert)\\s*(\\d+(?:\\.\\d+)?)\\s*(USDC|EURC)\\s*(?:to|for)?\\s*(USDC|EURC)\\b`,
      'i',
    ),
  );
  if (
    explicitSwapPortfolioMatch &&
    isSwapExecutionIntent(normalized) &&
    hasSequentialIntentCue(normalized) &&
    /\b(?:portfolio|holdings|positions|wallet|funds)\b/i.test(normalized) &&
    /\b(?:show|explain|review|summary|summar(?:y|ize)|report|analysis|analy(?:s|z)e|break\s*down|walk\s+me\s+through)\b/i.test(
      normalized,
    )
  ) {
    const [, amount, tokenIn, tokenOut] = explicitSwapPortfolioMatch;
    if (tokenIn.toUpperCase() === tokenOut.toUpperCase()) {
      return {
        type: 'reply',
        text: 'Swap needs two different tokens. Try USDC to EURC or EURC to USDC.',
      };
    }
    return {
      type: 'tool',
      tool: 'swap_tokens',
      args: {
        amount,
        tokenIn: tokenIn.toUpperCase(),
        tokenOut: tokenOut.toUpperCase(),
        confirmed: false,
      },
      postActionNote: portfolioA2aPostActionNote('swap agent'),
    };
  }


  const compoundSwapMatch = normalized.match(
    new RegExp(
      `^${politePrefix}(?:swap|trade|exchange|convert)\\s*(\\d+(?:\\.\\d+)?)\\s*(USDC|EURC)\\s*(?:to|for)?\\s*(USDC|EURC)\\b[\\s\\S]*$`,
      'i',
    ),
  );
  if (
    compoundSwapMatch &&
    isSwapExecutionIntent(normalized) &&
    wantsPortfolioFollowup
  ) {
    const [, amount, tokenIn, tokenOut] = compoundSwapMatch;
    if (tokenIn.toUpperCase() === tokenOut.toUpperCase()) {
      return {
        type: 'reply',
        text: 'Swap needs two different tokens. Try USDC to EURC or EURC to USDC.',
      };
    }
    return {
      type: 'tool',
      tool: 'swap_tokens',
      args: {
        amount,
        tokenIn: tokenIn.toUpperCase(),
        tokenOut: tokenOut.toUpperCase(),
        confirmed: false,
      },
      postActionNote: portfolioA2aPostActionNote('swap agent'),
    };
  }

  const swapMatch =
    normalized.match(
      new RegExp(
        `^${politePrefix}(?:swap|trade|exchange|convert)\\s*(\\d+(?:\\.\\d+)?)\\s*(USDC|EURC)\\s+(?:to|for)\\s+(USDC|EURC)(?:\\s+for\\s+me)?\\s*$`,
        'i',
      ),
    ) ||
    normalized.match(
      new RegExp(
        `^${politePrefix}(?:swap|trade|exchange|convert)\\s*(\\d+(?:\\.\\d+)?)\\s*(USDC|EURC)\\s+(USDC|EURC)(?:\\s+for\\s+me)?\\s*$`,
        'i',
      ),
    );
  if (swapMatch && isSwapExecutionIntent(normalized) && capabilityRouting.swap.routeToFeature) {
    const [, amount, tokenIn, tokenOut] = swapMatch;
    if (tokenIn.toUpperCase() === tokenOut.toUpperCase()) {
      return {
        type: 'reply',
        text: 'Swap needs two different tokens. Try USDC to EURC or EURC to USDC.',
      };
    }
    return {
      type: 'tool',
      tool: 'swap_tokens',
      args: {
        amount,
        tokenIn: tokenIn.toUpperCase(),
        tokenOut: tokenOut.toUpperCase(),
        confirmed: false,
      },
    };
  }

  const compoundDepositMatch = wantsPortfolioFollowup
    ? normalized.match(
        new RegExp(
          `^${politePrefix}(?:stake|deposit|vault\\s+deposit|move|put|park|allocate|stash)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:USDC|EURC)?\\b[\\s\\S]*(?:vault|yield|portfolio|report|holdings|passive income|earn)[\\s\\S]*$`,
          'i',
        ),
      )
    : null;
  if (compoundDepositMatch) {
    const tokenSym =
      /eurc/i.test(normalized) ? 'EURC' :
      /usdc/i.test(normalized) ? 'USDC' :
      null;
    const detectedVaultSymbol =
      tokenSym === 'USDC' ? 'luneUSDC' :
      tokenSym === 'EURC' ? 'luneEURC' :
      undefined;
    if (!detectedVaultSymbol) {
      return null;
    }
    return {
      type: 'tool',
      tool: 'vault_action',
      args: {
        action: 'deposit',
        amount: compoundDepositMatch[1],
        provider: /lunex/i.test(normalized) ? 'lunex' : undefined,
        vaultSymbol: detectedVaultSymbol,
        amountTokenHint: tokenSym,
        confirmed: false,
      },
      postActionNote: portfolioA2aPostActionNote('vault agent'),
    };
  }

  const depositMatch =
    normalized.match(
      new RegExp(
        `^${politePrefix}(?:stake|deposit|park|allocate|fund)\\s+(\\d+(?:\\.\\d+)?)\\s*(?:USDC|EURC)?(?:\\b[\\s\\S]*)$`,
        'i',
      ),
    ) ||
    normalized.match(
      new RegExp(
        `^${politePrefix}vault\\s+deposit\\s+(\\d+(?:\\.\\d+)?)\\s*(?:USDC|EURC)?(?:\\b[\\s\\S]*)$`,
        'i',
      ),
    ) ||
    normalized.match(
      new RegExp(
        `^${politePrefix}(?:put|move|stash)\\s+(\\d+(?:\\.\\d+)?)\\s*(?:USDC|EURC)?\\b[\\s\\S]*(?:into|to)?\\s*(?:vault|yield|earn|passive income)[\\s\\S]*$`,
        'i',
      ),
    );
  if (depositMatch && capabilityRouting.vault.routeToFeature) {
    const tokenSym =
      /eurc/i.test(normalized) ? 'EURC' :
      /usdc/i.test(normalized) ? 'USDC' :
      null;
    const detectedVaultSymbol =
      tokenSym === 'USDC' ? 'luneUSDC' :
      tokenSym === 'EURC' ? 'luneEURC' :
      undefined;
    if (!detectedVaultSymbol) {
      return null;
    }
    return {
      type: 'tool',
      tool: 'vault_action',
      args: {
        action: 'deposit',
        amount: depositMatch[1],
        provider: /lunex/i.test(normalized) ? 'lunex' : undefined,
        vaultSymbol: detectedVaultSymbol,
        amountTokenHint: tokenSym,
        confirmed: false,
      },
    };
  }

  const compoundWithdrawMatch = wantsPortfolioFollowup
    ? normalized.match(
        new RegExp(
          `^${politePrefix}(?:withdraw|unstake|remove|take\\s+out|pull\\s+out|vault\\s+withdraw)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:USDC|EURC)?\\b[\\s\\S]*(?:vault|portfolio|report|holdings|yield|earn)[\\s\\S]*$`,
          'i',
        ),
      )
    : null;
  if (compoundWithdrawMatch) {
    const tokenSym =
      /eurc/i.test(normalized) ? 'EURC' :
      /usdc/i.test(normalized) ? 'USDC' :
      null;
    const detectedVaultSymbol =
      tokenSym === 'USDC' ? 'luneUSDC' :
      tokenSym === 'EURC' ? 'luneEURC' :
      undefined;
    if (!detectedVaultSymbol && /\bfrom my vault\b/i.test(normalized)) {
      return {
        type: 'tool',
        tool: 'vault_action',
        args: {
          action: 'withdraw',
          amount: compoundWithdrawMatch[1],
          provider: /lunex/i.test(normalized) ? 'lunex' : undefined,
          confirmed: false,
        },
        postActionNote: portfolioA2aPostActionNote('vault agent'),
      };
    }
    if (!detectedVaultSymbol) {
      return null;
    }
    return {
      type: 'tool',
      tool: 'vault_action',
      args: {
        action: 'withdraw',
        amount: compoundWithdrawMatch[1],
        provider: /lunex/i.test(normalized) ? 'lunex' : undefined,
        vaultSymbol: detectedVaultSymbol,
        amountTokenHint: tokenSym,
        confirmed: false,
      },
      postActionNote: portfolioA2aPostActionNote('vault agent'),
    };
  }

  const withdrawMatch =
    normalized.match(
      new RegExp(
        `^${politePrefix}(?:withdraw|unstake|remove|take out|pull out)\\s+(\\d+(?:\\.\\d+)?)\\s*(?:USDC|EURC)?(?:\\b[\\s\\S]*)$`,
        'i',
      ),
    ) ||
    normalized.match(
      new RegExp(
        `^${politePrefix}vault\\s+withdraw\\s+(\\d+(?:\\.\\d+)?)\\s*(?:USDC|EURC)?(?:\\b[\\s\\S]*)$`,
        'i',
      ),
    );
  if (withdrawMatch && capabilityRouting.vault.routeToFeature) {
    const tokenSym =
      /eurc/i.test(normalized) ? 'EURC' :
      /usdc/i.test(normalized) ? 'USDC' :
      null;
    const detectedVaultSymbol =
      tokenSym === 'USDC' ? 'luneUSDC' :
      tokenSym === 'EURC' ? 'luneEURC' :
      undefined;
    if (!detectedVaultSymbol && /\bfrom my vault\b/i.test(normalized)) {
      return {
        type: 'tool',
        tool: 'vault_action',
        args: {
          action: 'withdraw',
          amount: withdrawMatch[1],
          provider: /lunex/i.test(normalized) ? 'lunex' : undefined,
          confirmed: false,
        },
      };
    }
    if (!detectedVaultSymbol) {
      return null;
    }
    return {
      type: 'tool',
      tool: 'vault_action',
      args: {
        action: 'withdraw',
        amount: withdrawMatch[1],
        provider: /lunex/i.test(normalized) ? 'lunex' : undefined,
        vaultSymbol: detectedVaultSymbol,
        amountTokenHint: tokenSym,
        confirmed: false,
      },
    };
  }

  const sendMatch = normalized.match(
    /^(?:please\s+)?send\s+(\d+(?:\.\d+)?)\s*(?:USDC\s+)?to\s+(\S+)$/i,
  );
  if (sendMatch) {
    return {
      type: 'tool',
      tool: 'agentpay_send',
      args: {
        amount: sendMatch[1],
        to: sendMatch[2],
      },
    };
  }

  const payMatch = normalized.match(
    /^(?:please\s+)?pay\s+(\S+)\s+(\d+(?:\.\d+)?)\s*(?:USDC)?(.*)$/i,
  );
  if (payMatch) {
    const remark = typeof payMatch[3] === 'string' ? payMatch[3].trim() : '';
    return {
      type: 'tool',
      tool: 'agentpay_send',
      args: {
        to: payMatch[1],
        amount: payMatch[2],
        ...(remark ? { remark } : {}),
      },
    };
  }

  const transferMatch = normalized.match(
    /^(?:please\s+)?transfer\s+(\d+(?:\.\d+)?)\s*(?:USDC\s+)?to\s+(\S+)$/i,
  );
  if (transferMatch) {
    return {
      type: 'tool',
      tool: 'agentpay_send',
      args: {
        amount: transferMatch[1],
        to: transferMatch[2],
      },
    };
  }

  if (/\bbridge\b/i.test(normalized) && /\bEURC\b/i.test(normalized)) {
    return {
      type: 'reply',
      text:
        'Bridging moves USDC between chains. Swapping converts USDC to EURC on Arc. Tell me the source chain if you want to bridge USDC, or ask me to swap USDC to EURC on Arc.',
    };
  }

  if (
    /\bbridge\b/i.test(normalized) &&
    /\b(?:manual(?:ly)?|eoa|funding)\b/i.test(normalized)
  ) {
    return {
      type: 'reply',
      text: formatBridgeExecutionReply(),
    };
  }

  if (isBridgeCostOrSponsorshipQuestion(normalized) && !looksLikeBridgeResearch(normalized)) {
    return {
      type: 'reply',
      text: formatBridgeCostOrSponsorshipReply(),
    };
  }

  if (capabilityRouting.bridge.routeToFeature && isBridgeSpecificChainSelectionPrompt(normalized)) {
    return {
      type: 'reply',
      text: [
        'Got it. Which source chain do you want to bridge from?',
        '',
        'You can reply with the chain name, like Base Sepolia, Ethereum Sepolia, or Arbitrum Sepolia. After that I will ask how much USDC you want to bridge.',
      ].join('\n'),
    };
  }

  if (
    capabilityRouting.bridge.routeToFeature &&
    !isBridgeExecutionIntent(normalized) &&
    !isBridgePrecheckIntent(normalized)
  ) {
    const bridgeSourcesIntent =
      /\b(?:source|sources?|chains?|supported|arbitrum|base|ethereum|optimism|polygon|avalanche|linea|unichain)\b/i.test(
        normalized,
      ) || /\b(?:compare|vs|versus|best)\b/i.test(normalized);
    return {
      type: 'reply',
      text: bridgeSourcesIntent ? formatBridgeSourcesReply() : formatBridgeOverviewReply(),
      quickActionGroups: buildBridgeChoiceQuickActionGroups(),
    };
  }

  const bridgeSourceChain = detectSupportedBridgeSourceChain(normalized);
  const bridgeAmount = extractBridgeAmount(normalized);
  if (
    bridgeSourceChain &&
    !bridgeAmount &&
    /\b(?:can we|get funds|move funds|onto arc|to arc)\b/i.test(normalized)
  ) {
    return {
      type: 'tool',
      tool: 'bridge_precheck',
      args: {
        sourceChain: bridgeSourceChain,
      },
      quickActionGroups: buildBridgeChoiceQuickActionGroups(),
    };
  }
  if (
    isBridgePrecheckIntent(normalized) ||
    (isBareSupportedBridgeChainReply(normalized) && recentBridgeContextWantsPrecheck(history))
  ) {
    return {
      type: 'tool',
      tool: 'bridge_precheck',
      args: {
        ...(bridgeSourceChain ? { sourceChain: bridgeSourceChain } : {}),
        ...(bridgeAmount ? { amount: bridgeAmount } : {}),
      },
      quickActionGroups: buildBridgeChoiceQuickActionGroups(),
    };
  }

  if (
    capabilityRouting.bridge.routeToFeature &&
    (isBridgeExecutionIntent(normalized) || isBridgePrecheckIntent(normalized))
  ) {
    if (!bridgeSourceChain) {
      return {
        type: 'tool',
        tool: 'bridge_precheck',
        args: {},
        quickActionGroups: buildBridgeChoiceQuickActionGroups(),
      };
    }

    if (!bridgeAmount) {
      return {
        type: 'tool',
        tool: 'bridge_precheck',
        args: {
          sourceChain: bridgeSourceChain,
        },
        quickActionGroups: buildBridgeChoiceQuickActionGroups(),
      };
    }
    return {
      type: 'tool',
      tool: 'bridge_precheck',
      args: {
        sourceChain: bridgeSourceChain,
        amount: bridgeAmount,
      },
      quickActionGroups: buildBridgeChoiceQuickActionGroups(),
    };
  }

  return null;
}

function buildBrainInputMessage(message: string): string {
  return message;
}

async function buildBrainWalletCtx(
  walletAddress?: Address,
  executionTarget?: 'EOA' | 'DCW',
): Promise<BrainWalletContext> {
  const walletCtx: BrainWalletContext = {
    walletAddress: walletAddress || '',
    executionWalletId: undefined,
    executionWalletAddress: undefined,
    executionTarget,
    profileContext: '',
  };

  if (!walletAddress) {
    return walletCtx;
  }

  try {
    const dcwModule: any = await import('./lib/dcw');
    const findPersistedUserAgentWallet =
      dcwModule.findPersistedUserAgentWallet ??
      dcwModule.default?.findPersistedUserAgentWallet;
    const getUserAgentWallet =
      dcwModule.getOrCreateUserAgentWallet ??
      dcwModule.default?.getOrCreateUserAgentWallet;
    if (typeof findPersistedUserAgentWallet === 'function') {
      const persistedExecutionWallet = await findPersistedUserAgentWallet(walletAddress);
      if (persistedExecutionWallet) {
        walletCtx.executionWalletId = persistedExecutionWallet.wallet_id;
        walletCtx.executionWalletAddress = getAddress(persistedExecutionWallet.address);
        return walletCtx;
      }
    }
    if (typeof getUserAgentWallet === 'function') {
      const executionWallet = await getUserAgentWallet(walletAddress);
      if (executionWallet) {
        walletCtx.executionWalletId = executionWallet.wallet_id;
        walletCtx.executionWalletAddress = executionWallet.address;
      }
    }
  } catch (error) {
    console.warn('[brain] execution wallet lookup failed:', getErrorMessage(error));
  }

  return walletCtx;
}

function numericOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function buildResearchWalletContext(params: {
  ownerWalletAddress: string;
  executionWalletAddress: string;
  executionTarget?: 'DCW' | 'EOA';
}): Promise<ResearchWalletContext | null> {
  const ownerWalletAddress = isAddress(params.ownerWalletAddress)
    ? getAddress(params.ownerWalletAddress)
    : params.ownerWalletAddress;
  const scannedWalletAddress = isAddress(params.executionWalletAddress)
    ? getAddress(params.executionWalletAddress)
    : params.executionWalletAddress;
  const base = {
    source: 'agentflow_portfolio_snapshot' as const,
    requested_for_task: true,
    owner_wallet_address: ownerWalletAddress,
    execution_target: params.executionTarget ?? 'DCW',
    scanned_wallet_address: scannedWalletAddress,
    as_of: new Date().toISOString(),
  };

  try {
    const { buildPortfolioSnapshot } = await import('./agents/portfolio/portfolio');
    const snapshot = await buildPortfolioSnapshot(scannedWalletAddress, {
      gatewayDepositors:
        params.executionTarget === 'DCW'
          ? [ownerWalletAddress, scannedWalletAddress]
          : [scannedWalletAddress],
    });
    return {
      ...base,
      scanned_wallet_address: snapshot.walletAddress,
      total_value_usd: snapshot.pnlSummary.currentValueUsd,
      cost_basis_usd: snapshot.pnlSummary.costBasisUsd,
      pnl_usd: snapshot.pnlSummary.pnlUsd,
      pnl_pct: snapshot.pnlSummary.pnlPct,
      holdings: snapshot.holdings.slice(0, 16).map((holding) => ({
        symbol: holding.symbol,
        name: holding.name,
        kind: holding.kind,
        balance: holding.balanceFormatted,
        usd_value: numericOrNull(holding.usdValue),
        notes: holding.notes.slice(0, 3),
      })),
      positions: snapshot.positions.slice(0, 12).map((position) => ({
        name: position.name,
        protocol: position.protocol,
        kind: position.kind,
        amount: position.amountFormatted,
        usd_value: numericOrNull(position.usdValue),
        pnl_usd: numericOrNull(position.pnlUsd),
        notes: position.notes.slice(0, 3),
      })),
      diagnostics: {
        gateway_balance_source: snapshot.diagnostics.gatewayBalance.source,
        gateway_balance_error: snapshot.diagnostics.gatewayBalance.error,
        arc_data_available: snapshot.diagnostics.arcData.rpcAvailable,
      },
    };
  } catch (error) {
    console.warn('[research] portfolio context unavailable:', getErrorMessage(error));
    return {
      ...base,
      total_value_usd: 0,
      cost_basis_usd: 0,
      pnl_usd: 0,
      pnl_pct: 0,
      holdings: [],
      positions: [],
      error: getErrorMessage(error),
    };
  }
}

function roundUsdLabel(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'unknown value';
  }
  if (value < 1) {
    return 'under $1';
  }
  if (value < 100) {
    return `about $${Math.round(value)}`;
  }
  return `about $${Math.round(value / 10) * 10}`;
}

const STABLECOIN_SYMBOLS = new Set(['USDC', 'EURC', 'USDT', 'DAI', 'PYUSD', 'USDS', 'FRAX']);
const MAJOR_VOLATILE_SYMBOLS = new Set(['BTC', 'WBTC', 'ETH', 'WETH', 'SOL', 'AVAX', 'MATIC', 'POL', 'LINK']);

function sumUsd(items: Array<{ usd_value: number | null }>): number {
  return items.reduce((sum, item) => sum + (item.usd_value ?? 0), 0);
}

function exposurePercent(value: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
}

function holdingLabel(symbols: string[]): string {
  if (symbols.length === 0) return '';
  if (symbols.length === 1) return symbols[0];
  if (symbols.length === 2) return `${symbols[0]} and ${symbols[1]}`;
  return `${symbols.slice(0, -1).join(', ')}, and ${symbols[symbols.length - 1]}`;
}

function buildPortfolioExposureSummary(context: ResearchWalletContext): {
  totalLabel: string;
  profile: string;
  impactLines: string[];
  notApplicableLines: string[];
} {
  const holdings = Array.isArray(context.holdings) ? context.holdings : [];
  const positions = Array.isArray(context.positions) ? context.positions : [];
  const total = typeof context.total_value_usd === 'number' ? context.total_value_usd : 0;
  const stableHoldings = holdings.filter((holding) =>
    STABLECOIN_SYMBOLS.has(holding.symbol.toUpperCase()),
  );
  const volatileHoldings = holdings.filter((holding) =>
    MAJOR_VOLATILE_SYMBOLS.has(holding.symbol.toUpperCase()),
  );
  const stablePositionValue = positions
    .filter((position) => /gateway|stable|usdc|eurc/i.test(`${position.name} ${position.protocol} ${position.amount}`))
    .reduce((sum, item) => sum + (item.usd_value ?? 0), 0);
  const stableValue = sumUsd(stableHoldings) + stablePositionValue;
  const volatileValue = sumUsd(volatileHoldings);
  const defiValue = positions
    .filter((position) => !/gateway/i.test(`${position.name} ${position.protocol}`))
    .reduce((sum, item) => sum + (item.usd_value ?? 0), 0);
  const gatewayValue = positions
    .filter((position) => /gateway/i.test(`${position.name} ${position.protocol}`))
    .reduce((sum, item) => sum + (item.usd_value ?? 0), 0);
  const stablePct = exposurePercent(stableValue, total);
  const volatilePct = exposurePercent(volatileValue, total);
  const stableSymbols = [
    ...new Set([
      ...stableHoldings.map((holding) => holding.symbol.toUpperCase()),
      ...(gatewayValue > 0 && !stableHoldings.some((holding) => holding.symbol.toUpperCase() === 'USDC')
        ? ['USDC via Gateway']
        : []),
    ]),
  ];
  const stableExposureLabel =
    gatewayValue > 0 && stableHoldings.some((holding) => holding.symbol.toUpperCase() === 'USDC')
      ? 'USDC, mostly through Gateway'
      : holdingLabel(stableSymbols);
  const volatileSymbols = [...new Set(volatileHoldings.map((holding) => holding.symbol.toUpperCase()))];

  const profile =
    stablePct >= 80
      ? `stablecoin-heavy portfolio (about ${stablePct}% in ${stableExposureLabel || 'stablecoin rails'})`
      : volatilePct >= 50
        ? `volatile crypto-heavy portfolio (${holdingLabel(volatileSymbols) || 'major crypto assets'})`
        : defiValue > 0
          ? 'DeFi-position-heavy portfolio'
          : stablePct > 0
            ? `mixed portfolio with meaningful stablecoin exposure (${stablePct}% in stablecoin-like assets)`
            : 'mixed portfolio';

  const impactLines: string[] = [];
  const notApplicableLines: string[] = [];

  if (stablePct >= 80) {
    impactLines.push(
      'Direct token-price volatility should be limited because the detected exposure is mostly stablecoins, not BTC/ETH-style risk assets.',
      'The relevant risks are peg quality, issuer and reserve confidence, redemption/liquidity conditions, regulatory announcements, dollar funding stress, and Gateway settlement/liquidity availability.',
      'If the researched event affects rates, Treasuries, banking stability, stablecoin regulation, sanctions, or payment rails, it matters more through stablecoin liquidity and redemption channels than through spot-price upside or downside.',
    );
    notApplicableLines.push(
      'Generic BTC or ETH crash/rally analysis is not the main lens for this wallet unless those assets are later added.',
    );
  } else if (volatilePct >= 50) {
    impactLines.push(
      `The detected exposure includes major volatile crypto assets (${holdingLabel(volatileSymbols)}), so macro, regulatory, liquidity, and geopolitical shocks can affect mark-to-market value more directly.`,
      'The key channels are risk-on/risk-off flows, crypto liquidity, ETF or institutional flows where relevant, leverage unwinds, and changes in dollar rates.',
    );
  } else if (defiValue > 0) {
    impactLines.push(
      'The detected exposure includes DeFi positions, so smart-contract, liquidity, withdrawal, yield-compression, and pool-imbalance risks matter alongside token prices.',
      'Events that affect stablecoin liquidity, rates, or onchain activity can change yield and exit conditions even when token prices look stable.',
    );
  } else {
    impactLines.push(
      'The detected portfolio does not show a single dominant volatile token exposure, so the report should focus on liquidity, regulation, and asset-class channels rather than a generic crypto-market move.',
    );
  }

  if (gatewayValue > 0) {
    impactLines.push(
      'Because a meaningful share sits in Circle Gateway, cross-chain liquidity, instant settlement reliability, and Gateway redemption/deposit conditions are part of the practical risk picture.',
    );
  }

  return {
    totalLabel: roundUsdLabel(total),
    profile,
    impactLines,
    notApplicableLines,
  };
}

function formatWalletContextReportSection(
  liveData: Record<string, unknown> | null,
  portfolioImpact = false,
): string {
  if (!portfolioImpact) {
    return '';
  }
  const walletContext = liveData?.wallet_context;
  if (!walletContext || typeof walletContext !== 'object') {
    return [
      '## Your Portfolio Impact',
      '',
      'AgentFlow could not load your portfolio snapshot for this run, so I am avoiding personalized holdings or exposure claims instead of guessing.',
    ].join('\n');
  }

  const context = walletContext as ResearchWalletContext;
  if (context.error) {
    return [
      '## Your Portfolio Impact',
      '',
      'AgentFlow tried to read your portfolio context for this report, but the wallet snapshot was unavailable. I will avoid making personalized balance or exposure claims instead of guessing.',
    ].join('\n');
  }

  const exposure = buildPortfolioExposureSummary(context);

  return [
    '## Your Portfolio Impact',
    '',
    `Your current AgentFlow portfolio context looks like a ${exposure.profile}, with ${exposure.totalLabel} in marked value. I am using that exposure privately to personalize the analysis, not to turn this into a balance statement.`,
    '',
    ...exposure.impactLines.map((line) => `- ${line}`),
    ...(exposure.notApplicableLines.length
      ? ['', '**What this does not mean**', '', ...exposure.notApplicableLines.map((line) => `- ${line}`)]
      : []),
    '',
    'If you want exact balances, wallet address, or performance accounting shown in the report, ask for a portfolio breakdown explicitly.',
  ].join('\n');
}

function stripExistingPortfolioImpactSection(markdown: string): string {
  let normalized = markdown.replace(/\r\n/g, '\n');

  const headingPattern =
    /^#{2,3}\s+(?:Your Portfolio Impact|Personalized Portfolio Impact|Portfolio Impact|Portfolio Implications)\b.*$/im;
  while (true) {
    const match = headingPattern.exec(normalized);
    if (!match || match.index === undefined) break;

    const start = match.index;
    const rest = normalized.slice(start + match[0].length);
    const nextHeading = rest.search(/\n#{2,3}\s+\S/gm);
    if (nextHeading < 0) {
      normalized = normalized.slice(0, start).trimEnd();
      break;
    }
    const end = start + match[0].length + nextHeading;
    normalized = `${normalized.slice(0, start).trimEnd()}\n\n${normalized.slice(end).trimStart()}`.trim();
  }

  const inlinePattern =
    /(?:^|\n)(?:\*\*)?(?:Portfolio Impact|Implications for Your Portfolio|Current Economic Situation impacts for your portfolio)(?:\*\*)?:\s*[\s\S]*?(?=\n\s*\n|\n#{2,3}\s+\S|$)/im;
  while (true) {
    const match = inlinePattern.exec(normalized);
    if (!match || match.index === undefined) break;
    const start = match.index;
    const end = start + match[0].length;
    const prefix = normalized.slice(0, start).trimEnd();
    const suffix = normalized.slice(end).trimStart();
    normalized = prefix && suffix ? `${prefix}\n\n${suffix}` : `${prefix}${suffix}`.trim();
  }

  return normalized.trim();
}

function ensureWalletContextInReport(
  markdown: string,
  liveData: Record<string, unknown> | null,
  portfolioImpact = false,
): string {
  if (!portfolioImpact) {
    return stripExistingPortfolioImpactSection(markdown);
  }
  const section = formatWalletContextReportSection(liveData, portfolioImpact);
  if (!section) {
    return markdown;
  }
  const cleanedMarkdown = stripExistingPortfolioImpactSection(markdown);

  const sourcesIndex = cleanedMarkdown.search(/^##\s+Sources\b/im);
  if (sourcesIndex >= 0) {
    return `${cleanedMarkdown.slice(0, sourcesIndex).trim()}\n\n${section}\n\n${cleanedMarkdown.slice(sourcesIndex).trim()}`;
  }

  return `${cleanedMarkdown.trim()}\n\n${section}`;
}

function streamStaticSseReply(
  res: Response,
  text: string,
  meta?: Record<string, unknown>,
): void {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // @ts-ignore
    res.flushHeaders?.();
  }

  if (meta) {
    res.write(`data: ${JSON.stringify({ meta })}\n\n`);
  }
  for (const chunk of text.match(/[\s\S]{1,120}/g) ?? [text]) {
    res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

function truncateIntentDispatchMessage(message: string, maxLength = 200): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function isReportRenderingComplaint(message: string): boolean {
  return /\b(half|partial|incomplete|broken|missing|cut off|truncated)\b.*\breport\b|\breport\b.*\b(half|partial|incomplete|broken|missing|cut off|truncated)\b/i.test(
    message,
  );
}

function extractStoredResearchReport(content: string): string | null {
  const normalized = content.replace(/\r\n/g, '\n');
  const divider = /\n\s*---\s*\n/.exec(normalized);
  if (!divider) return null;

  const report = normalized.slice(divider.index + divider[0].length).trim();
  if (!report) return null;
  if (!/^#{1,3}\s+\S/m.test(report) && !/^##\s+(?:Summary|Overview|Executive Summary|Current Situation|Takeaway)\b/im.test(report)) {
    return null;
  }
  return report;
}

function findLatestStoredResearchReport(history: BrainConversationMessage[]): string | null {
  for (const item of [...history].reverse()) {
    if (item.role !== 'assistant') continue;
    const report = extractStoredResearchReport(item.content);
    if (report) return report;
  }
  return null;
}

function hasRecentStoredResearchReport(history: BrainConversationMessage[]): boolean {
  return Boolean(findLatestStoredResearchReport(history));
}

function looksLikeReportMetaFollowup(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  return (
    /\b(?:is this|is that|was this|was that|this is|that is)\s+report\b/i.test(normalized) ||
    /\b(?:already|just)\s+(?:generated|made|gave|sent|showed)\s+(?:a\s+)?report\b/i.test(
      normalized,
    ) ||
    /\byou already\b[\s\S]{0,40}\breport\b/i.test(normalized) ||
    /\breport\b[\s\S]{0,40}\b(?:unfinished|incomplete|cut off|truncated|partial|broken)\b/i.test(
      normalized,
    ) ||
    /\b(?:unfinished|incomplete|cut off|truncated|partial|broken)\b[\s\S]{0,40}\breport\b/i.test(
      normalized,
    ) ||
    /\b(?:looks|looked)\s+(?:unfinished|incomplete|cut off|truncated|partial|broken)\b/i.test(
      normalized,
    ) ||
    /\bwhat are you talking\b/i.test(normalized) ||
    /\bare you crazy\b/i.test(normalized) ||
    /\bwhy (?:are|did)\s+you\b[\s\S]{0,60}\breport\b/i.test(normalized)
  );
}

function looksLikeReportFollowupQuestion(
  message: string,
  history: BrainConversationMessage[],
): boolean {
  if (!hasRecentStoredResearchReport(history)) {
    return false;
  }

  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (looksLikeReportMetaFollowup(message)) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 18) {
    return false;
  }

  const explicitNewResearch =
    /\b(?:new|another|fresh|rerun|regenerate|generate|create|make)\b[\s\S]{0,30}\breport\b/i.test(
      normalized,
    ) ||
    /\b(?:research|analy[sz]e|look into|investigate|deep dive)\b/i.test(normalized);
  if (explicitNewResearch) {
    return false;
  }

  return /\b(?:this|that|it|they|them|those|these|why|how|what about|so|then|does that|is that|from that|on that|in that)\b/i.test(
    normalized,
  );
}

function buildReportFollowupGuardReply(previousReportExists: boolean): string {
  return previousReportExists
    ? "You're right — the previous completed assistant message was already the report. I shouldn't start a new research run from that kind of follow-up. Ask me a specific follow-up about that report and I'll answer from it instead of regenerating."
    : "You're right to call that out. That follow-up should stay attached to the report context, not trigger a fresh research run.";
}

function buildReportFollowupGroundedReply(
  message: string,
  previousReportExists: boolean,
): string {
  const normalized = message.trim().toLowerCase();
  const asksAboutCompletion =
    /\b(?:is|was)\s+(?:this|that)\s+report\b/i.test(normalized) ||
    /\b(?:looks|looked)\s+(?:unfinished|incomplete|cut off|truncated|partial|broken)\b/i.test(
      normalized,
    ) ||
    /\b(?:unfinished|incomplete|cut off|truncated|partial|broken)\s+report\b/i.test(normalized);

  if (asksAboutCompletion) {
    return previousReportExists
      ? "The safe answer is: the previous completed assistant message was already the report. I should not have started a new research run from that follow-up, and I should not claim a specific pipeline stop-point unless the recorded step events actually prove it."
      : "The safe answer is: I can't verify a specific pipeline stop-point from that follow-up alone. I should not invent a story about the writer or analyst stage without explicit step-state evidence.";
  }

  return previousReportExists
    ? "You're right - the previous completed assistant message was already the report. I shouldn't start a new research run from that kind of follow-up. Ask me a specific follow-up about that report and I'll answer from it instead of regenerating."
    : "You're right to call that out. That follow-up should stay attached to the report context, not trigger a fresh research run.";
}

const REPORT_FOLLOWUP_SYSTEM_PROMPT = `You are answering a follow-up to an already generated research report.

Rules:
- Treat the provided report as the active conversation context.
- Answer from the report only. Do not invent new facts, new sources, or internal pipeline state.
- Do not start or suggest a new research run unless the user explicitly asks to rerun, regenerate, refresh, or update the report.
- If the user is giving positive feedback or acknowledgment, respond naturally and briefly.
- If the user asks "which source says that?" or a similar referential question and the referenced claim is ambiguous, ask one short clarification question instead of guessing.
- If the answer is not supported by the report, say that plainly.
- Never narrate hidden agent/pipeline internals unless they are explicitly present in the report text.
- Keep the answer concise and conversational.`;

function extractMarkdownSection(markdown: string, headings: string[]): string | null {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const headingSet = new Set(headings.map((heading) => heading.trim().toLowerCase()));
  let startIndex = -1;
  let headingLevel = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    const title = match[2].trim().toLowerCase();
    if (headingSet.has(title)) {
      startIndex = index + 1;
      headingLevel = match[1].length;
      break;
    }
  }

  if (startIndex < 0) return null;

  const collected: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match && match[1].length <= headingLevel) break;
    collected.push(line);
  }

  const section = collected.join('\n').trim();
  return section || null;
}

function extractReportSourceBullets(report: string): string[] {
  const section = extractMarkdownSection(report, ['Sources']);
  if (!section) return [];
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*•⠂]/.test(line))
    .map((line) => line.replace(/^[-*•⠂]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function matchReportSourceByMessage(report: string, message: string): string | null {
  const sources = extractReportSourceBullets(report);
  const normalized = message.trim().toLowerCase();
  if (!sources.length || !normalized) return null;

  const findSource = (pattern: RegExp) => sources.find((source) => pattern.test(source));

  if (/\b(?:price|market cap|trading volume|coin gecko|coingecko)\b/i.test(normalized)) {
    return findSource(/\bcoingecko\b/i) ?? null;
  }
  if (/\b(?:tvl|defillama)\b/i.test(normalized)) {
    return findSource(/\bdefillama\b/i) ?? null;
  }
  if (/\b(?:bottom|60k|k33|bear market|coindesk)\b/i.test(normalized)) {
    return findSource(/\bcoindesk\b/i) ?? null;
  }
  if (/\b(?:quantum|computing risk|vulnerab|ccn)\b/i.test(normalized)) {
    return findSource(/\bccn\b/i) ?? null;
  }

  return null;
}

function isExplicitReportRerunRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(?:rerun|regenerate|regenerate it|run again|refresh|update)\b/i.test(normalized) ||
    /\b(?:new|another|fresh)\s+(?:report|research)\b/i.test(normalized) ||
    /\b(?:do|make|generate)\b[\s\S]{0,30}\b(?:new|fresh)\b[\s\S]{0,20}\b(?:report|research)\b/i.test(
      normalized,
    )
  );
}

function shouldUseReportContextTurn(
  message: string,
  previousReport: string | null,
): boolean {
  if (!previousReport) return false;
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (isExplicitReportRerunRequest(normalized)) return false;
  if (/\b(?:research|deep research|analy[sz]e|investigate|look into|generate report|make a report)\b/i.test(normalized)) {
    return false;
  }
  if (normalized.length > 280) return false;

  if (NON_RESEARCH_PHRASES.test(normalized)) return true;
  if (/\?$/.test(normalized)) return true;
  const referential =
    /\b(?:that|this|it|these|those|report|claim|claims|sentence|line|point)\b/i.test(normalized);
  if (/\b(?:report|citation|citations|claim|claims|mean|means|bearish|bullish|why|how|what|which|unfinished|incomplete|cut off|truncated|good|great|nice|helpful|thanks|thank you)\b/i.test(normalized) && referential) {
    return true;
  }
  if (/\b(?:source|sources)\b/i.test(normalized) && referential) {
    return true;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 8;
}

function buildReportFollowupModelInput(report: string, userMessage: string): string {
  const summary =
    extractMarkdownSection(report, ['Summary', 'Overview', 'Executive Summary']) ??
    report.slice(0, 1200);
  const takeaway = extractMarkdownSection(report, ['Takeaway']);
  const sources = extractReportSourceBullets(report);

  return [
    'ACTIVE REPORT:',
    report,
    '',
    'REPORT SUMMARY:',
    summary,
    '',
    takeaway ? `REPORT TAKEAWAY:\n${takeaway}\n` : '',
    sources.length ? `REPORT SOURCES:\n- ${sources.join('\n- ')}\n` : '',
    `USER FOLLOW-UP:\n${userMessage}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function extractReportClaimCandidates(report: string): string[] {
  const sections = [
    extractMarkdownSection(report, ['Summary', 'Overview', 'Executive Summary']),
    extractMarkdownSection(report, ['Takeaway']),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  const normalized = sections.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20)
    .slice(0, 4);

  return sentences.map((sentence) =>
    sentence.length > 120 ? `${sentence.slice(0, 117).trimEnd()}...` : sentence,
  );
}

function classifyReportContextTurn(
  message: string,
): 'ack' | 'source_lookup' | 'explanation' | 'general' {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return 'general';

  if (
    /\b(?:good|great|nice|helpful|useful|solid|perfect|awesome)\b/i.test(normalized) ||
    /\b(?:thanks|thank you)\b/i.test(normalized)
  ) {
    return 'ack';
  }

  if (
    /\b(?:which source|what source|source says|where (?:does|did) that come from|citation|cite|cites|cited|source)\b/i.test(
      normalized,
    )
  ) {
    return 'source_lookup';
  }

  if (/\b(?:why|how|what does|what did|what about|is that|does that|bearish|bullish|mean|means)\b/i.test(normalized)) {
    return 'explanation';
  }

  return 'general';
}

function buildReportAcknowledgementReply(): string {
  return "Glad it helped. Ask me about any claim, implication, or source in that report and I'll stay grounded in the report itself.";
}

function buildReportSourceLookupReply(report: string): string {
  const sources = extractReportSourceBullets(report);
  if (sources.length === 0) {
    return "I can only ground that in the report itself, and this report doesn't expose a clean source list. Point me to the exact claim you want sourced and I'll tell you whether the report actually supports it.";
  }

  const preview = sources.slice(0, 4).map((source) => `- ${source}`).join('\n');
  return `Which claim do you want sourced specifically? This report's listed sources are:\n${preview}\n\nIf you point to the exact sentence or claim, I'll map it to the closest source in the report instead of guessing.`;
}

function buildMatchedReportSourceReply(report: string, message: string): string | null {
  const matched = matchReportSourceByMessage(report, message);
  if (!matched) return null;
  return `Based on the report's own source list, the closest supporting source for that claim is: ${matched}`;
}

function buildReportExplanationClarifier(report: string): string | null {
  const claims = extractReportClaimCandidates(report);
  if (claims.length < 2) return null;
  const preview = claims.slice(0, 3).map((claim) => `- ${claim}`).join('\n');
  return `I can explain it, but there are a few plausible claims in that report. Which one do you mean?\n${preview}`;
}

function buildMatchedReportExplanationReply(message: string): string | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;

  if (/\b(?:quantum|computing risk|vulnerab)\b/i.test(normalized)) {
    return "Within the report's framing, that reads as bearish because it points to a potential security risk for Bitcoin holders. The report is saying that even with strong current price and market-cap numbers, a material technology risk could weigh on confidence.";
  }
  if (/\b(?:bottom|60k|bear market|k33)\b/i.test(normalized)) {
    return "Within the report's framing, the $60k bottom thesis is only partially bearish. It implies Bitcoin may already have gone through significant downside, but it also frames that weakness as possibly stabilizing rather than accelerating.";
  }
  if (/\b(?:narrow current snapshot|snapshot|not a full long-form|not a full thesis)\b/i.test(normalized)) {
    return "It means the report should be read as a limited current snapshot, not a comprehensive Bitcoin thesis. In other words, it covers a few current signals and sources, but not the full macro, regulatory, on-chain, or long-term adoption picture.";
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function getAgentResultText(data: { result?: string } | undefined | null): string {
  if (typeof data?.result === 'string' && data.result.trim()) {
    return data.result;
  }
  return JSON.stringify(data ?? {});
}

function createRunId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Extra origins (VPS, prod domain) — must match `Origin` header exactly. */
const CORS_EXTRA_ALLOWED_ORIGINS = new Set([
  'http://178.104.240.191',
  'https://agentflow.one',
  'http://agentflow.one',
]);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (CORS_EXTRA_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.endsWith('.vercel.app')) return true;
    if (url.protocol === 'https:') return true;
    return false;
  } catch {
    return false;
  }
}

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const allowed = isAllowedOrigin(typeof origin === 'string' ? origin : undefined);

  if (typeof origin === 'string' && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  const requestedHeaders = req.headers['access-control-request-headers'];
  if (typeof requestedHeaders === 'string' && requestedHeaders.trim()) {
    res.setHeader('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Payment-Signature, Authorization',
    );
  }
  res.setHeader(
    'Access-Control-Expose-Headers',
    'PAYMENT-REQUIRED, PAYMENT-RESPONSE, Content-Type',
  );

  if (req.method === 'OPTIONS') {
    if (origin && !allowed) {
      res.status(403).json({ error: 'Origin not allowed by CORS policy.' });
      return;
    }
    res.sendStatus(204);
    return;
  }

  next();
}

function parseStep(input: string | undefined): OrchestratorStep | null {
  if (input === 'research' || input === 'analyst' || input === 'writer') {
    return input;
  }
  return null;
}

function decodeTransactionFromPaymentResponse(
  paymentResponseHeader: string | null,
): string | undefined {
  if (!paymentResponseHeader) return undefined;
  try {
    const decoded = Buffer.from(paymentResponseHeader, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded) as { transaction?: string };
    return typeof payload.transaction === 'string' ? payload.transaction : undefined;
  } catch {
    return undefined;
  }
}

function getAgentUrl(step: OrchestratorStep): string {
  switch (step) {
    case 'research':
      return RESEARCH_URL;
    case 'analyst':
      return ANALYST_URL;
    case 'writer':
      return WRITER_URL;
  }
}

function parseDcwPaidAgentSlug(value: string): DcwPaidAgentSlug | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'swap' ||
    normalized === 'vault' ||
    normalized === 'portfolio' ||
    normalized === 'vision' ||
    normalized === 'transcribe'
  ) {
    return normalized;
  }
  return null;
}

function getDcwPaidAgentUrl(slug: DcwPaidAgentSlug): string {
  switch (slug) {
    case 'swap':
      return SWAP_URL;
    case 'vault':
      return VAULT_URL;
    case 'portfolio':
      return PORTFOLIO_URL;
    case 'vision':
      return VISION_URL;
    case 'transcribe':
      return TRANSCRIBE_URL;
  }
}

function getDcwPaidAgentPrice(slug: DcwPaidAgentSlug): string {
  switch (slug) {
    case 'swap':
      return `${swapPrice} USDC`;
    case 'vault':
      return `${vaultPrice} USDC`;
    case 'portfolio':
      return `${portfolioPrice} USDC`;
    case 'vision':
      return `${parsePrice(process.env.VISION_AGENT_PRICE, '0.004')} USDC`;
    case 'transcribe':
      return '0 USDC';
  }
}

function getPaidAgentUrlBySlug(slug: string): string | null {
  switch (slug.toLowerCase()) {
    case 'research':
      return RESEARCH_URL;
    case 'analyst':
      return ANALYST_URL;
    case 'writer':
      return WRITER_URL;
    case 'swap':
      return SWAP_URL;
    case 'vault':
      return VAULT_URL;
    case 'bridge':
      return BRIDGE_URL;
    case 'portfolio':
      return PORTFOLIO_URL;
    case 'vision':
      return VISION_URL;
    case 'transcribe':
      return TRANSCRIBE_URL;
    default:
      return null;
  }
}

const X402_TERMINAL_STAGES = new Set<X402AttemptStage>([
  'failed',
  'preflight_failed',
  'succeeded',
]);

type X402AttemptMutationInput = {
  requestId: string;
  idempotencyKey: string;
  route: string;
  method: 'GET' | 'POST';
  payer: string;
  chainId: number;
  stage: X402AttemptStage;
  httpStatus?: number;
  error?: string;
  transaction?: string;
  slug?: string;
  mode?: X402AttemptMode;
};

function isX402AttemptStage(value: unknown): value is X402AttemptStage {
  switch (value) {
    case 'started':
    case 'preflight_ok':
    case 'preflight_failed':
    case 'payment_required':
    case 'payload_created':
    case 'paid_request_sent':
    case 'succeeded':
    case 'failed':
      return true;
    default:
      return false;
  }
}

function isX402AttemptMode(value: unknown): value is X402AttemptMode {
  return value === 'eoa' || value === 'dcw';
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseX402AttemptMutationInput(
  body: unknown,
  forcedStage?: X402AttemptStage,
): { value?: X402AttemptMutationInput; error?: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'JSON body is required.' };
  }

  const record = body as Record<string, unknown>;
  const requestId = String(record.requestId || '').trim();
  const idempotencyKey = String(record.idempotencyKey || '').trim();
  const route = String(record.route || '').trim();
  const method = String(record.method || 'POST').trim().toUpperCase();
  const payer = String(record.payer || '').trim();
  const chainId = Number(record.chainId);
  const stageValue = forcedStage || String(record.stage || '').trim();

  if (!requestId) {
    return { error: 'requestId is required.' };
  }
  if (!idempotencyKey) {
    return { error: 'idempotencyKey is required.' };
  }
  if (!route) {
    return { error: 'route is required.' };
  }
  if (method !== 'GET' && method !== 'POST') {
    return { error: 'method must be GET or POST.' };
  }
  if (!isAddress(payer)) {
    return { error: 'payer must be a valid wallet address.' };
  }
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return { error: 'chainId must be a positive number.' };
  }
  if (!isX402AttemptStage(stageValue)) {
    return { error: 'stage is invalid.' };
  }

  const mode = isX402AttemptMode(record.mode) ? record.mode : undefined;
  const slug =
    typeof record.slug === 'string' && record.slug.trim()
      ? record.slug.trim().toLowerCase()
      : undefined;
  const error =
    typeof record.error === 'string' && record.error.trim()
      ? record.error.trim()
      : undefined;
  const transaction =
    typeof record.transaction === 'string' && record.transaction.trim()
      ? record.transaction.trim()
      : undefined;

  return {
    value: {
      requestId,
      idempotencyKey,
      route,
      method,
      payer: getAddress(payer),
      chainId,
      stage: stageValue,
      httpStatus: parseOptionalNumber(record.httpStatus),
      error,
      transaction,
      slug,
      mode,
    },
  };
}

async function proxyAgentRun(params: {
  step: OrchestratorStep;
  method: 'GET' | 'POST';
  body?: unknown;
  paymentSignature?: string;
}): Promise<{
  status: number;
  data: unknown;
  contentType: string | null;
  paymentRequiredHeader: string | null;
  paymentResponseHeader: string | null;
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.paymentSignature) {
    headers['Payment-Signature'] = params.paymentSignature;
  }

  const response = await fetch(getAgentUrl(params.step), {
    method: params.method,
    headers,
    body: params.method === 'POST' ? JSON.stringify(params.body ?? {}) : undefined,
  });

  const contentType = response.headers.get('content-type');
  const rawBody = await response.text();
  let data: unknown = rawBody;

  if (rawBody && contentType?.includes('application/json')) {
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = rawBody;
    }
  }

  return {
    status: response.status,
    data,
    contentType,
    paymentRequiredHeader: response.headers.get('PAYMENT-REQUIRED'),
    paymentResponseHeader: response.headers.get('PAYMENT-RESPONSE'),
  };
}

async function fetchGatewayBalanceForAddress(address: Address): Promise<{
  available: string;
  total: string;
}> {
  const response = await fetch(`${GATEWAY_API_BASE_URL}/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: [{ depositor: address, domain: ARC_TESTNET_DOMAIN }],
    }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    balances?: Array<{ balance?: string; withdrawing?: string }>;
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    const details = json.message || json.error || `HTTP ${response.status}`;
    throw new Error(`Gateway API balance fetch failed: ${details}`);
  }

  const first = Array.isArray(json.balances) ? json.balances[0] : undefined;
  const available = first?.balance ?? '0';
  const withdrawing = first?.withdrawing ?? '0';
  const total = (Number(available) + Number(withdrawing)).toString();

  return { available, total };
}

function createFacilitatorApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: AGENT_JSON_LIMIT }));
  const gatewayClient = new BatchFacilitatorClient();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/v1/x402/supported', async (_req, res) => {
    const rid = createRunId('supported');
    try {
      const result = await gatewayClient.getSupported();
      console.log(`[Facilitator ${rid}] supported ok`);
      res.json(result);
    } catch (err) {
      const details = getErrorMessage(err);
      console.error(`[Facilitator ${rid}] /supported failed`, err);
      res
        .status(500)
        .json({ error: 'Internal error during getSupported', details, requestId: rid });
    }
  });

  app.post('/v1/x402/verify', async (req, res) => {
    const rid = createRunId('verify');
    try {
      const { paymentPayload, paymentRequirements } = req.body || {};
      if (!paymentPayload || !paymentRequirements) {
        return res.status(400).json({ error: 'Missing payment data', requestId: rid });
      }
      if (!isBatchPayment(paymentRequirements)) {
        return res.status(400).json({
          error: 'Only Gateway batched payments are supported',
          requestId: rid,
        });
      }
      const result = await gatewayClient.verify(paymentPayload, paymentRequirements);
      if ('isValid' in result && result.isValid === false) {
        console.error(`[Facilitator ${rid}] verify failed`, result.invalidReason ?? result);
      }
      return res.json(result);
    } catch (err) {
      const details = getErrorMessage(err);
      console.error(`[Facilitator ${rid}] /verify failed`, err);
      return res
        .status(500)
        .json({ error: 'Internal error during verify', details, requestId: rid });
    }
  });

  app.post('/v1/x402/settle', async (req, res) => {
    const rid = createRunId('settle');
    try {
      const { paymentPayload, paymentRequirements } = req.body || {};
      if (!paymentPayload || !paymentRequirements) {
        return res.status(400).json({ error: 'Missing payment data', requestId: rid });
      }
      if (!isBatchPayment(paymentRequirements)) {
        return res.status(400).json({
          error: 'Only Gateway batched payments are supported',
          requestId: rid,
        });
      }
      const result = await gatewayClient.settle(paymentPayload, paymentRequirements);
      if (!result.success) {
        console.error(`[Facilitator ${rid}] settle failed`, result.errorReason ?? result);
      }
      return res.json(result);
    } catch (err) {
      const details = getErrorMessage(err);
      console.error(`[Facilitator ${rid}] /settle failed`, err);
      return res
        .status(500)
        .json({ error: 'Internal error during settle', details, requestId: rid });
    }
  });

  return app;
}

function createAgentApp(
  name: OrchestratorStep,
  price: string,
  timeoutMs: number,
  run: (req: Request) => Promise<Record<string, unknown>>,
  options: { internalOnly?: boolean } = {},
): express.Express {
  const app = express();
  app.use(express.json());
  const gateway = createGatewayMiddleware({
    sellerAddress,
    facilitatorUrl: FACILITATOR_URL,
  });

  const handler = async (req: Request, res: Response) => {
    const requestId = createRunId(name);
    const start = Date.now();
    try {
      const payload = await withTimeout(run(req), timeoutMs, `${name} agent`);
      console.log(`[Agent ${name} ${requestId}] done in ${Date.now() - start}ms`);
      void incrementTxCount(name).catch((err) =>
        console.warn(`[tx-counter] increment failed for ${name}:`, err),
      );
      res.json(payload);
    } catch (err) {
      const details = getErrorMessage(err);
      const status = details.includes('timed out') ? 504 : 500;
      console.error(`[Agent ${name} ${requestId}] failed`, err);
      res.status(status).json({
        error: `${name} agent failed`,
        details,
        requestId,
      });
    }
  };

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', agent: name });
  });

  const requireInternalKey = (req: Request, res: Response, next: NextFunction) => {
    if (!options.internalOnly) {
      next();
      return;
    }
    const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
    const reqKey = (req.headers['x-agentflow-brain-internal'] as string | undefined)?.trim();
    if (internalKey && reqKey === internalKey) {
      next();
      return;
    }
    res.status(404).json({ error: 'Not found' });
  };

  app.get('/run', requireInternalKey, gateway.require(price), handler);
  app.post('/run', requireInternalKey, gateway.require(price), handler);

  return app;
}

function createPublicApp(): express.Express {
  const app = express();
  // Inbound email webhooks need raw body for Svix signature verification (before express.json).
  app.use('/api/webhooks/email', emailWebhookRouter);
  app.use(express.json({ limit: AGENT_JSON_LIMIT }));
  app.use(corsMiddleware);
  app.use('/api/auth', authApiRouter);
  app.use('/api/wallet', walletApiRouter);
  app.use('/api/telegram', telegramApiRouter);
  app.use('/api/settings', settingsApiRouter);
  app.use('/api/extension', extensionApiRouter);
  app.use('/api/business', businessApiRouter);
  app.use('/api/pay', payApiRouter);
  // Agent Store API
  app.use('/api/agent-store', agentStoreApiRouter);
  app.use('/api/agent-ratings', agentRatingsApiRouter);
  app.use('/api/agent-economy-ledger', agentEconomyLedgerApiRouter);
  app.use('/api/portfolio', portfolioApiRouter);

  app.get('/api/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await getTxStats();

      // Only count rows that carry an Arc on-chain tx id — the strip labels these
      // "Onchain transactions" with "a real on-chain trace, settled in USDC", so
      // completed-but-unsettled rows (no arc_tx_id) must be excluded.
      const { count, error } = await adminDb
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'complete')
        .not('arc_tx_id', 'is', null);

      if (error) {
        throw new Error(error.message);
      }

      const { count: a2aCount, error: a2aErr } = await adminDb
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('action_type', 'agent_to_agent_payment')
        .eq('status', 'complete')
        .not('arc_tx_id', 'is', null);

      if (a2aErr) {
        throw new Error(a2aErr.message);
      }

      return res.json({
        total_transactions: count ?? 0,
        onchain_transactions: count ?? 0,
        agent_to_agent_payments: a2aCount ?? 0,
        core_agents: CORE_AGENT_SPECS.length,
        tracked_task_runs: stats.total,
        by_agent: stats.byAgent,
        powered_by: 'Arc Network + Circle Nanopayments',
        settlement: 'USDC on Arc Testnet',
      });
    } catch (e: unknown) {
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Public docs content — the same product knowledge the in-chat assistant
  // answers from, so the marketing /docs page stays in sync automatically.
  app.get('/api/docs', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.json({
      topics: PRODUCT_KNOWLEDGE.map((doc) => ({
        id: doc.id,
        title: doc.title,
        summary: doc.summary,
        facts: doc.facts,
      })),
    });
  });


  const paidAgentGateway = createGatewayMiddleware({
    sellerAddress,
    facilitatorUrl: FACILITATOR_URL,
  });

  app.get('/api/research/status/:jobId', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const auth = (req as any).auth as JWTPayload;
      const job = await getJobStatus(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      if (getAddress(job.walletAddress as `0x${string}`) !== getAddress(auth.walletAddress as `0x${string}`)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.json(job);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? 'status failed' });
    }
  });

  app.get('/api/research/queue', authMiddleware, async (_req: Request, res: Response) => {
    try {
      const stats = await getQueueStats();
      return res.json(stats);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? 'queue stats failed' });
    }
  });

  // Invoice status — callable by Hermes (internal key) or authenticated user
  app.get('/api/invoice/status', internalOrAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const walletAddress = String(
        req.query.walletAddress ?? (req as any).auth?.walletAddress ?? '',
      ).trim();
      const invoiceId = String(req.query.invoiceId ?? '').trim();

      if (!walletAddress) {
        return res.status(400).json({ error: 'walletAddress is required' });
      }

      let query = adminDb
        .from('invoices')
        .select('id, invoice_number, vendor_name, amount, status, arc_tx_id, created_at, settled_at')
        .eq('business_wallet', walletAddress)
        .order('created_at', { ascending: false })
        .limit(10);

      if (invoiceId) {
        query = query.eq('id', invoiceId);
      }

      const { data: invoices, error } = await query;
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      return res.json({ invoices: invoices ?? [] });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? 'invoice status failed' });
    }
  });

  // Schedule agent proxy routes
  app.post('/api/schedule/run', internalOrAuthMiddleware, async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    const task = String(req.body?.task ?? '').trim();
    const walletAddress = auth.walletAddress;
    const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
    try {
      const agentRes = await fetch(`${SCHEDULE_AGENT_BASE_URL}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
          ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
        },
        body: JSON.stringify({ task, walletAddress }),
      });
      const data = await agentRes.json().catch(() => ({ action: 'error', message: 'Invalid response from schedule agent' }));
      res.status(agentRes.ok ? 200 : agentRes.status).json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({ action: 'error', message: `Schedule agent unavailable: ${msg}` });
    }
  });

  app.post('/api/schedule/confirm/:confirmId', internalOrAuthMiddleware, async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    const { confirmId } = req.params;
    const walletAddress = auth.walletAddress;
    try {
      const result = await executeDcwPaidAgentViaX402<{ success: boolean; message: string }>({
        userWalletAddress: walletAddress,
        agent: 'schedule',
        price: schedulePrice,
        url: `${SCHEDULE_AGENT_BASE_URL}/confirm/${encodeURIComponent(confirmId)}`,
        requestId: `schedule_confirm_${confirmId}_${Date.now()}`,
      });
      res.status(result.status).json({
        ...result.data,
        payment: {
          mode: result.payment.mode,
          payer: result.payment.payer,
          agent: result.payment.agent,
          price: result.payment.price,
          requestId: result.payment.requestId,
          transaction: result.payment.transaction,
          settlement: result.payment.settlement,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({ success: false, message: `Schedule agent unavailable: ${msg}` });
    }
  });

  // Split agent proxy routes
  app.post('/api/split/run', internalOrAuthMiddleware, async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    const walletAddress = auth.walletAddress;
    const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';

    try {
      const agentRes = await fetch(`${SPLIT_AGENT_BASE_URL}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
          ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
        },
        body: JSON.stringify({ ...req.body, walletAddress }),
      });
      const data = await agentRes.json().catch(() => ({ action: 'error', message: 'Invalid response from split agent' }));
      res.status(agentRes.ok ? 200 : agentRes.status).json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({ action: 'error', message: `Split agent unavailable: ${msg}` });
    }
  });

  app.post('/api/split/confirm/:confirmId', internalOrAuthMiddleware, async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    const { confirmId } = req.params;
    const walletAddress = auth.walletAddress;
    try {
      const requestedPortfolioA2a = await takeRequestedPortfolioA2a(confirmId);
      const result = await executeDcwPaidAgentViaX402<{
        action?: string;
        message?: string;
        results?: unknown;
      }>({
        userWalletAddress: walletAddress,
        agent: 'split',
        price: splitPrice,
        url: `${SPLIT_AGENT_BASE_URL}/confirm/${encodeURIComponent(confirmId)}`,
        requestId: `split_confirm_${confirmId}_${Date.now()}`,
        body: { suppressPortfolioFollowup: Boolean(requestedPortfolioA2a) },
      });
      const data = result.data as {
        action?: string;
        message?: string;
        results?: unknown;
      };
      if (result.status >= 200 && result.status < 300 && data.action === 'success' && typeof data.message === 'string' && requestedPortfolioA2a) {
        data.message = await appendRequestedPortfolioA2aReport({
          baseMessage: data.message,
          requested: requestedPortfolioA2a,
          userWalletAddress: walletAddress,
          details: { confirmId, results: data.results },
          sessionId: confirmId,
        });
      }
      res.status(result.status).json({
        ...data,
        payment: {
          mode: result.payment.mode,
          payer: result.payment.payer,
          agent: result.payment.agent,
          price: result.payment.price,
          requestId: result.payment.requestId,
          transaction: result.payment.transaction,
          settlement: result.payment.settlement,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({ action: 'error', message: `Split agent unavailable: ${msg}` });
    }
  });

  // Batch agent proxy routes
  app.post('/api/batch/preview', internalOrAuthMiddleware, async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    const walletAddress = auth.walletAddress;
    const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';

    // Accept { csvText } or { payments }
    let payments = Array.isArray(req.body?.payments) ? req.body.payments : null;
    if (!payments && typeof req.body?.csvText === 'string') {
      const parsed = parseCSVBatch(req.body.csvText);
      if ('error' in parsed) {
        return res.status(400).json({ action: 'error', message: parsed.error });
      }
      payments = parsed;
    }
    if (!payments?.length) {
      return res.status(400).json({ action: 'error', message: 'Provide either payments array or csvText' });
    }

    const sessionId = `wallet-${walletAddress.toLowerCase()}`;
    try {
      const agentRes = await fetch(`${BATCH_AGENT_BASE_URL}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
          ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
        },
        body: JSON.stringify({ sessionId, walletAddress, payments }),
      });
      const data = await agentRes.json().catch(() => ({ action: 'error', message: 'Invalid response from batch agent' }));
      res.status(agentRes.ok ? 200 : agentRes.status).json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({ action: 'error', message: `Batch agent unavailable: ${msg}` });
    }
  });

  app.post('/api/batch/confirm/:confirmId', internalOrAuthMiddleware, async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    const { confirmId } = req.params;
    const walletAddress = auth.walletAddress;
    try {
      const requestedPortfolioA2a = await takeRequestedPortfolioA2a(confirmId);
      const result = await executeDcwPaidAgentViaX402<Record<string, unknown>>({
        userWalletAddress: walletAddress,
        agent: 'batch',
        price: batchPrice,
        url: `${BATCH_AGENT_BASE_URL}/confirm/${encodeURIComponent(confirmId)}`,
        requestId: `batch_confirm_${confirmId}_${Date.now()}`,
        body: { suppressPortfolioFollowup: Boolean(requestedPortfolioA2a) },
      });
      const data = result.data as {
        action?: string;
        message?: string;
        results?: unknown;
      };
      if (result.status >= 200 && result.status < 300 && data.action === 'success' && typeof data.message === 'string' && requestedPortfolioA2a) {
        data.message = await appendRequestedPortfolioA2aReport({
          baseMessage: data.message,
          requested: requestedPortfolioA2a,
          userWalletAddress: walletAddress,
          details: { confirmId, results: data.results },
          sessionId: confirmId,
        });
      }
      res.status(result.status).json({
        ...data,
        payment: {
          mode: result.payment.mode,
          payer: result.payment.payer,
          agent: result.payment.agent,
          price: result.payment.price,
          requestId: result.payment.requestId,
          transaction: result.payment.transaction,
          settlement: result.payment.settlement,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(503).json({ action: 'error', message: `Batch agent unavailable: ${msg}` });
    }
  });

  // Invoice confirm route — reads Redis pending payload, creates invoice row + payment request.
  app.post('/api/invoice/confirm/:confirmId', internalOrAuthMiddleware, async (req: Request, res: Response) => {
    const { confirmId } = req.params;
    // confirmId is "invoice-<sessionId>", strip the prefix to recover sessionId
    const sessionId = confirmId.startsWith('invoice-') ? confirmId.slice('invoice-'.length) : confirmId;
    try {
      const pendingRaw = await getRedis().get(`invoice:pending:${sessionId}`);
      if (!pendingRaw) {
        res.status(404).json({ success: false, message: 'Invoice preview expired or not found.' });
        return;
      }

      const pending = JSON.parse(pendingRaw) as {
        walletAddress: string;
        vendorHandle: string;
        amount: string;
        description: string;
        invoiceNumber: string;
      };

      const result = await executeDcwPaidAgentViaX402<{
        invoiceId?: string;
        error?: string;
      }>({
        userWalletAddress: pending.walletAddress,
        agent: 'invoice',
        price: invoicePrice,
        url: `${INVOICE_AGENT_BASE_URL}/run`,
        requestId: `invoice_confirm_${confirmId}_${Date.now()}`,
        body: {
          channel: 'json',
          invoice: {
            vendor: pending.vendorHandle,
            vendorEmail: '',
            amount: parseFloat(pending.amount),
            currency: 'USDC',
            invoiceNumber: pending.invoiceNumber,
            lineItems: [{ description: pending.description, amount: parseFloat(pending.amount) }],
          },
          executePayment: false,
        },
      });
      if (!(result.status >= 200 && result.status < 300)) {
        throw new Error(
          (result.data as { error?: string })?.error || 'Invoice agent request failed',
        );
      }

      const requestedInvoiceResearch = await takeRequestedInvoiceResearchA2a(sessionId);
      if (!requestedInvoiceResearch) {
        scheduleChatInvoiceResearchFollowup({
          vendorHandle: pending.vendorHandle,
          amount: pending.amount,
          issuerWalletAddress: pending.walletAddress,
        });
      }

      await getRedis().del(`invoice:pending:${sessionId}`);

      let message = `Invoice ${pending.invoiceNumber} created and payment request sent to ${pending.vendorHandle}.`;

      if (requestedInvoiceResearch) {
        try {
          const researchPayload = await runInvoiceVendorResearchFollowup({
            vendor: pending.vendorHandle,
            amount: parseFloat(pending.amount),
            issuerWalletAddress: pending.walletAddress,
            researchRunUrl: RESEARCH_URL,
            researchPriceLabel: researchPrice,
          });
          message = `${message}\n\n---\n\n${formatResearchA2aReport(researchPayload, 'invoice')}`;
        } catch (a2aErr) {
          const msg = a2aErr instanceof Error ? a2aErr.message : String(a2aErr);
          console.warn('[a2a] requested invoice research follow-up failed:', msg);
          message = `${message}\n\nA2A vendor research failed: ${msg}`;
        }
      }

      res.json({
        success: true,
        invoiceId: result.data.invoiceId ?? null,
        invoiceNumber: pending.invoiceNumber,
        paymentRequestId: result.data.invoiceId ?? null,
        message,
        payment: {
          mode: result.payment.mode,
          payer: result.payment.payer,
          agent: result.payment.agent,
          price: result.payment.price,
          requestId: result.payment.requestId,
          transaction: result.payment.transaction,
          settlement: result.payment.settlement,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await getRedis().del(`invoice:pending:${sessionId}`).catch(() => null);
      res.status(500).json({ success: false, message: `Invoice creation failed: ${msg}` });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      agents: ['research', 'analyst', 'writer', 'vision', 'transcribe'],
      network: NETWORK_NAME,
      chainId: CHAIN_ID,
    });
  });

  app.get('/health/stack', async (_req, res) => {
    const [facilitator, research, analyst, writer, bridge, vision, transcribe] = await Promise.all([
      checkHttpHealth(resolveFacilitatorHealthUrl()),
      isAgentHealthy('research'),
      isAgentHealthy('analyst'),
      isAgentHealthy('writer'),
      isAgentHealthy('bridge'),
      isAgentHealthy('vision'),
      isAgentHealthy('transcribe'),
    ]);

    res.json({
      ok: facilitator.ok && research && analyst && writer && bridge && vision && transcribe,
      facilitator: facilitator.ok,
      research,
      analyst,
      writer,
      bridge,
      vision,
      transcribe,
    });
  });

  app.get('/api/x402/preflight', async (req: Request, res: Response) => {
    const slug = String(req.query.slug || '').trim().toLowerCase();
    const mode = String(req.query.mode || 'eoa').trim().toLowerCase();
    if (!slug) {
      return res.status(400).json({ error: 'slug is required' });
    }

    const targetUrl =
      mode === 'dcw'
        ? (['swap', 'vault', 'portfolio', 'vision'].includes(slug)
            ? getDcwPaidAgentUrl(slug as DcwPaidAgentSlug)
            : null)
        : getPaidAgentUrlBySlug(slug);

    if (!targetUrl) {
      return res.status(404).json({ error: `Unknown x402 target: ${slug}` });
    }

    const facilitatorUrl = resolveFacilitatorHealthUrl();
    const targetHealthUrl = deriveHealthUrlFromRunUrl(targetUrl);
    const [facilitator, target] = await Promise.all([
      checkHttpHealth(facilitatorUrl),
      checkHttpHealth(targetHealthUrl),
    ]);
    const ok = facilitator.ok && target.ok;

    return res.status(ok ? 200 : 503).json({
      ok,
      slug,
      mode,
      facilitator,
      target,
    });
  });

  app.post('/api/x402/attempts/start', async (req: Request, res: Response) => {
    const parsed = parseX402AttemptMutationInput(req.body, 'started');
    if (!parsed.value) {
      return res.status(400).json({ error: parsed.error || 'Invalid attempt payload.' });
    }

    try {
      await acquireX402InflightLock(
        parsed.value.requestId,
        parsed.value.idempotencyKey,
      );
      const record = await writeX402AttemptRecord(parsed.value);
      return res.status(201).json({ ok: true, record });
    } catch (error) {
      if (error instanceof X402InflightConflictError) {
        return res.status(409).json({
          error: error.message,
          requestId: parsed.value.requestId,
          existingRequestId: error.existingRequestId || null,
        });
      }
      return res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/x402/attempts/stage', async (req: Request, res: Response) => {
    const parsed = parseX402AttemptMutationInput(req.body);
    if (!parsed.value) {
      return res.status(400).json({ error: parsed.error || 'Invalid attempt payload.' });
    }

    try {
      const record = await writeX402AttemptRecord(parsed.value);
      if (X402_TERMINAL_STAGES.has(parsed.value.stage)) {
        await releaseX402InflightLock(
          parsed.value.requestId,
          parsed.value.idempotencyKey,
        );
      }
      return res.json({ ok: true, record });
    } catch (error) {
      return res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  app.get('/api/x402/attempts/:requestId', async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required.' });
    }

    try {
      const record = await readX402AttemptRecord(requestId);
      if (!record) {
        return res.status(404).json({ error: 'Attempt not found.' });
      }
      return res.json({ ok: true, record });
    } catch (error) {
      return res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  app.get('/api/media/quota', authMiddleware, async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress || !isAddress(auth.walletAddress)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const walletAddress = getAddress(auth.walletAddress);
      const visionLimit = Number(process.env.VISION_DAILY_LIMIT || VISION_DAILY_LIMIT_DEFAULT);
      const transcribeLimit = Number(process.env.TRANSCRIBE_DAILY_LIMIT || TRANSCRIBE_DAILY_LIMIT_DEFAULT);

      const [vision, transcribe] = await Promise.all([
        readDailyUsageCap({
          scope: 'vision',
          walletAddress,
          limit: visionLimit,
        }),
        readDailyUsageCap({
          scope: 'transcribe',
          walletAddress,
          limit: transcribeLimit,
        }),
      ]);

      return res.json({
        walletAddress,
        vision,
        transcribe,
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/internal/access/memory', adminAuthMiddleware, async (req: Request, res: Response) => {
    return res.json({
      ok: true,
      walletAddress: ((req as any).auth as JWTPayload | undefined)?.walletAddress ?? null,
    });
  });

  app.get('/api/memory/metrics', adminAuthMiddleware, async (_req: Request, res: Response) => {
    try {
      const report = await buildSemanticMemoryMetricsReport();
      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/internal/memory/metrics', adminAuthMiddleware, async (_req: Request, res: Response) => {
    try {
      const report = await buildSemanticMemoryMetricsReport();
      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/memory/review-cases', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
      const cases = await buildSemanticMemoryReviewCases(limit);
      return res.json({ cases });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/internal/memory/review-cases', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
      const cases = await buildSemanticMemoryReviewCases(limit);
      return res.json({ cases });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.patch('/api/memory/review-cases/:caseId', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const caseId = String(req.params.caseId ?? '').trim();
      const label = String(req.body?.label ?? '').trim();
      const note = typeof req.body?.note === 'string' ? req.body.note : null;
      if (!caseId) {
        return res.status(400).json({ error: 'caseId is required.' });
      }
      if (!/^(correct|needs_profile|needs_episodic|needs_routing|needs_clarification|ignore)$/.test(label)) {
        return res.status(400).json({ error: 'Valid review label is required.' });
      }
      await saveSemanticMemoryReviewLabel(caseId, label as any, note);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.patch('/api/internal/memory/review-cases/:caseId', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const caseId = String(req.params.caseId ?? '').trim();
      const label = String(req.body?.label ?? '').trim();
      const note = typeof req.body?.note === 'string' ? req.body.note : null;
      if (!caseId) {
        return res.status(400).json({ error: 'caseId is required.' });
      }
      if (!/^(correct|needs_profile|needs_episodic|needs_routing|needs_clarification|ignore)$/.test(label)) {
        return res.status(400).json({ error: 'Valid review label is required.' });
      }
      await saveSemanticMemoryReviewLabel(caseId, label as any, note);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/memory/review-cases/export', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const labeledOnly = String(req.query.labeledOnly ?? '1').trim() !== '0';
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 200;
      const dataset = await buildSemanticMemoryReviewDataset({ labeledOnly, limit });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="semantic-memory-review-dataset-${labeledOnly ? 'labeled' : 'all'}.json"`,
      );
      return res.status(200).send(JSON.stringify(dataset, null, 2));
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/internal/memory/review-cases/export', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const labeledOnly = String(req.query.labeledOnly ?? '1').trim() !== '0';
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 200;
      const dataset = await buildSemanticMemoryReviewDataset({ labeledOnly, limit });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="semantic-memory-review-dataset-${labeledOnly ? 'labeled' : 'all'}.json"`,
      );
      return res.status(200).send(JSON.stringify(dataset, null, 2));
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/internal/review/cases', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 24;
      const cases = await buildConversationReviewCases(limit);
      return res.json({ cases });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.patch('/api/internal/review/cases/:caseId', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const caseId = String(req.params.caseId ?? '').trim();
      const label = String(req.body?.label ?? '').trim();
      const note = typeof req.body?.note === 'string' ? req.body.note : null;
      if (!caseId) {
        return res.status(400).json({ error: 'caseId is required.' });
      }
      if (!/^(correct|wrong_intent|needs_clarification|should_use_tool|bad_fallback|infra_failure|ignore)$/.test(label)) {
        return res.status(400).json({ error: 'Valid review label is required.' });
      }
      await saveConversationReviewLabel(caseId, label as any, note);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/internal/review/cases/export', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const labeledOnly = String(req.query.labeledOnly ?? '1').trim() !== '0';
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 200;
      const dataset = await buildConversationReviewDataset({ labeledOnly, limit });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="conversation-review-dataset-${labeledOnly ? 'labeled' : 'all'}.json"`,
      );
      return res.status(200).send(JSON.stringify(dataset, null, 2));
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/internal/feedback/messages', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 80;
      const entries = await loadChatFeedbackEntries(limit);
      return res.json({ entries });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/internal/feedback/messages/export', adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
      const limit = Number.isFinite(rawLimit) ? rawLimit : 400;
      const entries = await loadChatFeedbackEntries(limit);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="chat-feedback-events.json"',
      );
      return res.status(200).send(JSON.stringify(entries, null, 2));
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/brain/balance', async (req: Request, res: Response) => {
    try {
      const walletAddress = resolveBrainWalletAddress(
        req.query.walletAddress,
        req.query.sessionId,
      );
      if (!walletAddress) {
        return res.status(400).json({ error: 'Valid walletAddress or sessionId is required.' });
      }

      const sessionId =
        typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
          ? req.query.sessionId.trim()
          : walletAddress;
      const walletCtx = await buildBrainWalletCtx(walletAddress, 'DCW');
      const result = await executeTool('get_balance', {}, walletCtx, sessionId);
      return res.json({ result });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/brain/portfolio', async (req: Request, res: Response) => {
    try {
      const walletAddress = resolveBrainWalletAddress(
        req.query.walletAddress,
        req.query.sessionId,
      );
      if (!walletAddress) {
        return res.status(400).json({ error: 'Valid walletAddress or sessionId is required.' });
      }

      const sessionId =
        typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
          ? req.query.sessionId.trim()
          : walletAddress;
      const walletCtx = await buildBrainWalletCtx(walletAddress, 'DCW');
      const result = await executeTool('get_portfolio', {}, walletCtx, sessionId);
      return res.json({ result });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/brain/circle-stack', async (_req: Request, res: Response) => {
    try {
      return res.json({
        result: getAgentFlowCircleStackSummary(),
        supportedBridgeSources: listSupportedBridgeSourcesDetailed(),
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/api/brain/agentpay-history', async (req: Request, res: Response) => {
    try {
      const walletAddress = resolveBrainWalletAddress(
        req.query.walletAddress,
        req.query.sessionId,
      );
      if (!walletAddress) {
        return res.status(400).json({ error: 'Valid walletAddress or sessionId is required.' });
      }
      const rawLimit = Number(req.query.limit);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, Math.floor(rawLimit)) : 100;
      const rows = await fetchPayHistoryForBrain(walletAddress, limit);
      return res.json({ transactions: rows });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/brain/swap', async (req: Request, res: Response) => {
    try {
      const walletAddress = resolveBrainWalletAddress(
        req.body?.walletAddress,
        req.body?.sessionId,
      );
      if (!walletAddress) {
        return res.status(400).json({ error: 'Valid walletAddress or sessionId is required.' });
      }

      const sessionId =
        typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
          ? req.body.sessionId.trim()
          : walletAddress;
      const walletCtx = await buildBrainWalletCtx(walletAddress);
      if (Boolean(req.body?.confirmed)) {
        return res.json({
          result:
            'Execution is blocked until the user explicitly replies YES in chat. Show the simulation first, then wait for YES.',
        });
      }
      const result = await executeTool(
        'swap_tokens',
        {
          amount: req.body?.amount,
          tokenIn: req.body?.tokenIn,
          tokenOut: req.body?.tokenOut,
          confirmed: Boolean(req.body?.confirmed),
        },
        walletCtx,
        sessionId,
      );
      return res.json({ result });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/brain/vault', async (req: Request, res: Response) => {
    try {
      const { confirmed } = req.body ?? {};
      const walletAddress = resolveBrainWalletAddress(
        req.body?.walletAddress,
        req.body?.sessionId,
      );
      if (!walletAddress) {
        return res.status(400).json({ error: 'Valid walletAddress or sessionId is required.' });
      }

      const sessionId =
        typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
          ? req.body.sessionId.trim()
          : walletAddress;
      const walletCtx = await buildBrainWalletCtx(walletAddress);
      if (confirmed === true) {
        return res.json({
          result: 'Vault execution blocked. Use chat YES to confirm.',
        });
      }
      const result = await executeTool(
        'vault_action',
        {
          action: req.body?.action,
          amount: req.body?.amount,
          confirmed: Boolean(req.body?.confirmed),
        },
        walletCtx,
        sessionId,
      );
      return res.json({ result });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/brain/bridge', async (_req: Request, res: Response) => {
    try {
      return res.status(410).json({
        result:
          'The legacy backend bridge endpoint has been removed. Use the web app native Circle BridgeKit flow to bridge USDC to Arc.',
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/brain/bridge-precheck', async (req: Request, res: Response) => {
    try {
      const walletAddress = resolveBrainWalletAddress(
        req.body?.walletAddress,
        req.body?.sessionId,
      );
      if (!walletAddress) {
        return res.status(400).json({ error: 'Valid walletAddress or sessionId is required.' });
      }

      const sessionId =
        typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
          ? req.body.sessionId.trim()
          : walletAddress;
      const walletCtx = await buildBrainWalletCtx(walletAddress, 'EOA');
      const result = await executeTool(
        'bridge_precheck',
        {
          amount: req.body?.amount,
          sourceChain: req.body?.sourceChain,
        },
        walletCtx,
        sessionId,
      );
      return res.json({ result });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/profile/remember', authMiddleware, async (req: Request, res: Response) => {
    try {
      const auth = (req as any).auth as JWTPayload | undefined;
      const walletAddress =
        auth?.walletAddress && isAddress(auth.walletAddress)
          ? getAddress(auth.walletAddress)
          : undefined;
      if (!walletAddress) {
        return res.status(401).json({ error: 'Authenticated wallet is required.' });
      }

      const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
      const value = typeof req.body?.value === 'string' ? req.body.value.trim() : '';

      if (!key || !value) {
        return res.status(400).json({ error: 'key and value are required.' });
      }

      await rememberUserProfileFact(walletAddress, key, value);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/chat/respond', async (req: Request, res: Response) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const quickActionIntent = parseQuickActionIntent(
      req.body?.quickActionContext?.actionId,
      message,
    );
    console.log('[route] message:', message);
    if (quickActionIntent) {
      console.info('[QUICK_ACTION_CONTEXT]', {
        action_id: quickActionIntent.intent,
        routed_as: quickActionIntent.intent,
      });
    }
    console.log('[route] shouldResearch:', shouldBypassToResearchPipeline(message));
    console.log('[route] shouldResearch after fix:', shouldHandleAsResearchRequest(message));
    const walletAddress =
      typeof req.body?.walletAddress === 'string' && isAddress(req.body.walletAddress)
        ? getAddress(req.body.walletAddress)
        : undefined;
    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages
          .filter(
            (
              item: unknown,
            ): item is {
              role: 'user' | 'assistant';
              content: string;
            } =>
              Boolean(
                item &&
                  typeof item === 'object' &&
                  (((item as any).role === 'user') || (item as any).role === 'assistant') &&
                  typeof (item as any).content === 'string',
              ),
          )
          .slice(-15)
      : [];

    const requestSessionId =
      typeof req.headers['x-session-id'] === 'string'
        ? req.headers['x-session-id'].trim()
        : '';
    const sessionId = requestSessionId || walletAddress || `anon-${Date.now()}`;
    // Keep action/pending state scoped to the active chat thread when the client provides
    // x-session-id. This avoids one vague follow-up inheriting a stale pending action from
    // another chat thread on the same wallet.
    const actionSessionId =
      requestSessionId || (walletAddress ? `wallet-${walletAddress.toLowerCase()}` : sessionId);
    const memorySessionId = deriveBrainMemorySessionId(walletAddress, requestSessionId, actionSessionId);
    // True only when the caller supplied a per-thread session id (web always does:
    // `wallet-<addr>-chat-<uuid>`). When false, `memorySessionId` collapses to the
    // wallet-global key, whose persisted history mixes every prior thread for this
    // wallet. We still store under that key, but we must NOT merge it into the
    // routing/referential history — otherwise an old portfolio/research report from
    // another thread leaks in and the brain answers "you already checked it above".
    // Persisted long-term memory remains available to the brain as enrichment only.
    const hasThreadScopedSession =
      requestSessionId.length > 0 &&
      (!walletAddress ||
        requestSessionId.toLowerCase().startsWith(`wallet-${walletAddress.toLowerCase()}-`));
    const responseStartedAt = Date.now();
    let brainEventId = '';
    const brainToolsTelemetry: BrainToolTelemetry[] = [];
    let brainTelemetryFinalized = false;

    maybeLogInputFilterDebug(message);
    const earlyRouterContinuationState = await loadRouterContinuationState(actionSessionId).catch(() => null);
    const inputValidation = validateChatInputForBrain(message);
    const allowShortRouterContinuationReply =
      !inputValidation.ok &&
      inputValidation.reason === 'too_short' &&
      Boolean(earlyRouterContinuationState) &&
      /^\d+(?:\.\d+)?$/.test(message.trim());
    if (!inputValidation.ok && !allowShortRouterContinuationReply) {
      console.warn('[INPUT_REJECTED]', { reason: inputValidation.reason });
      brainEventId = await logBrainEvent({
        session_id: memorySessionId,
        wallet_address: walletAddress || 'anonymous',
        user_input: message,
        intent_source: 'unclear',
        outcome: 'gibberish_rejected',
        failure_reason: inputValidation.reason,
        total_latency_ms: Date.now() - responseStartedAt,
        final_response_summary: "I didn't catch that, could you rephrase?",
      });
      streamStaticSseReply(res, "I didn't catch that, could you rephrase?", {
        eventId: brainEventId,
      });
      return;
    }

    await markPossibleBrainCorrection(memorySessionId, message).catch((error) => {
      console.warn('[brain-telemetry] correction capture failed:', getErrorMessage(error));
    });
    await maybeCaptureSemanticCorrection(walletAddress, memorySessionId, message).catch((error) => {
      console.warn('[semantic-memory] correction capture failed:', getErrorMessage(error));
    });
    brainEventId = await logBrainEvent({
      session_id: memorySessionId,
      wallet_address: walletAddress || 'anonymous',
      user_input: message,
      intent_source: 'unclear',
      tools_called: brainToolsTelemetry,
    });
    res.on('finish', () => {
      if (!brainEventId || brainTelemetryFinalized) {
        return;
      }
      void updateBrainEvent(brainEventId, {
        outcome: 'success',
        total_latency_ms: Date.now() - responseStartedAt,
      });
    });

    const browserTimeZone = normalizeBrowserTimeZone(req.body?.browserTimeZone);
    const browserLocale = normalizeBrowserLocale(req.body?.browserLocale);

    const lastAssistantMessage = [...messages]
      .reverse()
      .find((item) => item.role === 'assistant')?.content ?? '';
    const confirmsAgentPayHistoryScan =
      /^(?:yes|y|yeah|yep|sure|ok|okay|go ahead|do it)$/i.test(message.trim()) &&
      /payment history requires manual address lookups|scan your wallet for transactions/i.test(
        lastAssistantMessage,
      );
    if (confirmsAgentPayHistoryScan && walletAddress) {
      try {
        const rows = await fetchPayHistoryForBrain(walletAddress, 10);
        const responseText = formatAgentPayHistoryForChat(rows as Array<Record<string, any>>, {
          requestedLimit: 10,
          browserTimeZone,
          browserLocale,
        });
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        await updateBrainEvent(brainEventId, {
          intent_label: 'agentpay.history',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('agentpay.history'),
          final_response_summary: responseText,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        streamStaticSseReply(res, responseText, { eventId: brainEventId });
        return;
      } catch (historyErr) {
        const msg = historyErr instanceof Error ? historyErr.message : String(historyErr);
        const responseText = `I tried to check AgentPay payment history, but the history read failed: ${msg}`;
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        await updateBrainEvent(brainEventId, {
          intent_label: 'agentpay.history',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('agentpay.history'),
          final_response_summary: responseText,
          outcome: 'tool_error',
          failure_reason: responseText,
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        streamStaticSseReply(res, responseText, { eventId: brainEventId });
        return;
      }
    }

    const rawUserBodyField =
      typeof req.body?.rawUserMessage === 'string' ? req.body.rawUserMessage : undefined;
    const capabilityProbe = resolveCapabilityRoutingProbe(rawUserBodyField, message);

    /*
     * Fast-path routing intent (payments & confirmations are handled elsewhere in this route):
     * 1) Hard confirmations / pending executions (invoice, YES, Redis) — unchanged order below
     * 2) Scripted product actions / wallet intents — try blocks below
     * 3) Standalone product FAQ — routing probe only, shallow conversation (no portfolio tails)
     * 4) Hermes brain fallback via SSE streaming
     */
    const capabilityThreadCtx = buildCapabilityThreadContext(messages);
    const earlyPreviousReport = findLatestStoredResearchReport(
      messages as BrainConversationMessage[],
    );
    const reserveForReportContext = shouldUseReportContextTurn(message, earlyPreviousReport);
    const earlyPortfolioHistory = messages as BrainConversationMessage[];
    const earlyPortfolioSnapshot = findRecentPortfolioSnapshotMessage(earlyPortfolioHistory);
    const earlyPortfolioClarificationReply =
      shouldClarifyPortfolioRequest(message)
        ? earlyPortfolioSnapshot && isPortfolioReferentialFollowup(message)
          ? buildPortfolioContextualFollowupReply(message)
          : buildPortfolioCheckClarificationReply()
        : /^(?:where\s+can\s+i\s+(?:see|view|find|open|check)\s+it|where\s+is\s+it|how\s+do\s+i\s+(?:see|view|find|open|check)\s+it)\??$/i.test(
              message,
            ) && hasRecentPortfolioConversationContext(earlyPortfolioHistory)
          ? 'The portfolio report is in this chat above. Ask me to show your portfolio whenever you want a fresh live snapshot.'
          : null;

    if (earlyPortfolioClarificationReply) {
      await appendBrainConversationTurn(memorySessionId, message, earlyPortfolioClarificationReply);
      await updateBrainEvent(brainEventId, {
        intent_label: 'general.chat',
        intent_source: 'fastpath',
        ...buildFastpathBrainEventFields('general.chat'),
        final_response_summary: earlyPortfolioClarificationReply,
        outcome: 'success',
        total_latency_ms: Date.now() - responseStartedAt,
      });
      brainTelemetryFinalized = true;
      recentBrainEventsBySession.set(memorySessionId, {
        eventId: brainEventId,
        assistantAt: Date.now(),
      });
      streamStaticSseReply(res, earlyPortfolioClarificationReply, { eventId: brainEventId });
      return;
    }

    if (
      walletAddress &&
      shouldHandleAsBatchPayment(message) &&
      !shouldHandleAsSplitRequest(message)
    ) {
      const parsedBatch = parseBatchMessage(message);
      if ('error' in parsedBatch) {
        const responseText =
          `I see you want to run a batch payment, but I could not parse the recipients.\n` +
          formatBatchParseError(parsedBatch.error);
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        await updateBrainEvent(brainEventId, {
          intent_label: 'deterministic_batch_agent',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('deterministic_batch_agent'),
          final_response_summary: responseText,
          outcome: 'validation_error',
          failure_reason: responseText,
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        streamStaticSseReply(res, responseText, { eventId: brainEventId });
        return;
      }

      const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
      try {
        const batchAgentRes = await fetch(`${BATCH_AGENT_BASE_URL}/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
          },
          body: JSON.stringify({
            sessionId: actionSessionId,
            walletAddress,
            payments: parsedBatch,
          }),
        });

        const batchData = (await batchAgentRes.json().catch(() => ({
          action: 'error',
          message: 'Batch agent error',
        }))) as {
          action?: string;
          message?: string;
          confirmId?: string;
          confirmLabel?: string;
        };

        const responseText =
          typeof batchData.message === 'string' ? batchData.message : 'Batch agent error';
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        await updateBrainEvent(brainEventId, {
          intent_label: 'deterministic_batch_agent',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('deterministic_batch_agent'),
          final_response_summary: responseText,
          outcome: batchData.action === 'error' ? 'tool_error' : 'success',
          failure_reason: batchData.action === 'error' ? responseText : undefined,
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        res.write(`data: ${JSON.stringify({ meta: { eventId: brainEventId } })}\n\n`);
        if (batchData.action === 'preview' && batchData.confirmId) {
          res.write(
            `data: ${JSON.stringify({
              meta: {
                confirmation: {
                  required: true,
                  action: 'batch',
                  confirmId: batchData.confirmId,
                  confirmLabel: batchData.confirmLabel || 'Send batch',
                },
              },
            })}\n\n`,
          );
        }
        res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      } catch (batchErr) {
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
        const responseText = `Batch agent unavailable: ${msg}`;
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        await updateBrainEvent(brainEventId, {
          intent_label: 'deterministic_batch_agent',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('deterministic_batch_agent'),
          final_response_summary: responseText,
          outcome: 'tool_error',
          failure_reason: responseText,
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        streamStaticSseReply(res, responseText, { eventId: brainEventId });
        return;
      }
    }

    const externalPersonUnknownReply = buildExternalPersonUnknownReply(capabilityProbe);
    if (externalPersonUnknownReply) {
      await appendBrainConversationTurn(memorySessionId, message, externalPersonUnknownReply);
      await updateBrainEvent(brainEventId, {
        intent_label: 'general.chat',
        intent_source: 'fastpath',
        ...buildFastpathBrainEventFields('general.chat'),
        final_response_summary: externalPersonUnknownReply,
        outcome: 'success',
        total_latency_ms: Date.now() - responseStartedAt,
      });
      brainTelemetryFinalized = true;
      recentBrainEventsBySession.set(memorySessionId, {
        eventId: brainEventId,
        assistantAt: Date.now(),
      });
      streamStaticSseReply(res, externalPersonUnknownReply, { eventId: brainEventId });
      return;
    }

    if (
      isBridgeWordingFollowup(capabilityProbe) &&
      isBridgeOverviewReply(getMostRecentAssistantMessage(messages))
    ) {
      const responseText = buildBridgeWordingFollowupReply();
      await appendBrainConversationTurn(memorySessionId, message, responseText);
      await updateBrainEvent(brainEventId, {
        intent_label: 'bridge.wording_followup',
        intent_source: 'fastpath',
        ...buildFastpathBrainEventFields('bridge.wording_followup'),
        final_response_summary: responseText,
        outcome: 'success',
        total_latency_ms: Date.now() - responseStartedAt,
      });
      brainTelemetryFinalized = true;
      recentBrainEventsBySession.set(memorySessionId, {
        eventId: brainEventId,
        assistantAt: Date.now(),
      });
      streamStaticSseReply(res, responseText, { eventId: brainEventId });
      return;
    }

    try {
      const pending = await loadPendingAction(actionSessionId);
      if (pending && isPendingActionFollowup(message)) {
        const responseText = formatPendingActionFollowup(pending);
        await updateBrainEvent(brainEventId, {
          intent_label: pending.tool,
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields(pending.tool),
          final_response_summary: responseText,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        streamStaticSseReply(res, responseText, { eventId: brainEventId });
        return;
      }
    } catch (error) {
      console.warn('[chat/respond] early pending follow-up check failed:', getErrorMessage(error));
    }

    // Pre-router product FAQ fast-path. Explicit "Explain ..." product questions are
    // informational and must not depend on the non-deterministic intent router (which
    // intermittently sends them to the brain, tripping the stale-state guard). Runs
    // AFTER the pending-action guard so it never hijacks a confirm flow, and reuses
    // buildAgentFlowProductReply's self-guards — so it only ever serves a genuine
    // product answer; anything action-shaped returns null and falls through unchanged.
    if (
      !reserveForReportContext &&
      (isExplicitProductExplainQuestion(message) || isPayloadFreeProductQuestion(message))
    ) {
      const earlyProductReply = await buildAgentFlowProductReply(
        capabilityProbe,
        capabilityThreadCtx,
      );
      if (earlyProductReply) {
        await appendBrainConversationTurn(memorySessionId, message, earlyProductReply);
        await updateBrainEvent(brainEventId, {
          intent_label: 'product_reply',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('product_reply'),
          final_response_summary: earlyProductReply,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        streamStaticSseReply(res, earlyProductReply, { eventId: brainEventId });
        return;
      }
    }

    const walletIntentReply = await tryBuildWalletIntentReply({
      message,
      walletAddress,
      signature:
        typeof req.body?.signature === 'string' ? req.body.signature : undefined,
      signatureMessage:
        typeof req.body?.signatureMessage === 'string'
          ? req.body.signatureMessage
          : undefined,
    });
    if (walletIntentReply) {
      streamStaticSseReply(res, walletIntentReply);
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // @ts-ignore
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ meta: { eventId: brainEventId } })}\n\n`);

    try {
      if (isAgentflowChatSseDebug()) {
        logChatSseDebug({ chat_stream_start: true });
      }
      const executionTarget = 'DCW' as const;
      const walletCtx = await buildBrainWalletCtx(walletAddress, executionTarget);
      try {
        await extractProfileFact(message, walletAddress);
      } catch (error) {
        console.error('[memory] profile extraction failed:', error);
      }

      const preferenceAck = buildPreferenceMemoryAck(message, walletAddress);
      if (preferenceAck) {
        await appendBrainConversationTurn(memorySessionId, message, preferenceAck);
        res.write(`data: ${JSON.stringify({ delta: preferenceAck })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const profile = await loadBrainUserProfile(walletAddress);
      walletCtx.profileContext = shouldAttachBrainProfileContext(message)
        ? buildBrainProfileContext(profile)
        : '';
      const semanticMemoryContext = shouldAttachBrainSemanticMemoryContext(message)
        ? await buildBrainSemanticMemoryContext(walletAddress, memorySessionId, message)
        : '';
      if (semanticMemoryContext) {
        walletCtx.profileContext = [walletCtx.profileContext, semanticMemoryContext]
          .filter(Boolean)
          .join('\n\n');
      }
      try {
        const financialContextNote = await buildFinancialContextNote(
          message,
          walletCtx,
          actionSessionId,
        );
        if (financialContextNote) {
          walletCtx.profileContext = [walletCtx.profileContext, financialContextNote]
            .filter(Boolean)
            .join('\n\n');
        }
      } catch (error) {
        console.warn('[brain] financial context preload failed:', getErrorMessage(error));
      }
      const persistedHistory =
        !hasThreadScopedSession ||
        (isCasualSmallTalkTurn(message) && !shouldKeepPersistentConversationContext(message))
          ? []
          : await loadBrainConversationHistory(memorySessionId);
      // Always merge the client-sent recent thread into persisted history. For connected
      // wallet chats, dropping req.body.messages caused referential follow-ups like
      // "yeah make that" and "set up that payment every month" to lose the immediate
      // context that the frontend already had.
      const mergedMessages = mergeBrainConversationHistory(
        persistedHistory,
        messages,
      );
      const historyForBrain =
        mergedMessages.length > 0 &&
        mergedMessages.at(-1)?.role === 'user' &&
        mergedMessages.at(-1)?.content.trim() === message
          ? mergedMessages.slice(0, -1)
          : mergedMessages;
      if (
        shouldGroundPortfolioAdviceContinuation(message, historyForBrain) &&
        !/\bCurrent wallet context for this request:/i.test(walletCtx.profileContext || '')
      ) {
        try {
          const continuationFinancialContext = await buildFinancialContextNote(
            'do you think my portfolio is good?',
            walletCtx,
            actionSessionId,
          );
          if (continuationFinancialContext) {
            walletCtx.profileContext = [walletCtx.profileContext, continuationFinancialContext]
              .filter(Boolean)
              .join('\n\n');
          }
        } catch (error) {
          console.warn(
            '[brain] portfolio advice continuation context preload failed:',
            getErrorMessage(error),
          );
        }
      }

      const backendPendingAction = await loadPendingAction(actionSessionId).catch((error) => {
        console.warn('[chat/respond] backend continuation pending load failed:', getErrorMessage(error));
        return null;
      });
      const routerContinuationState = await loadRouterContinuationState(actionSessionId).catch((error) => {
        console.warn('[chat/respond] router continuation load failed:', getErrorMessage(error));
        return null;
      });
      let routerOverrideMessage: string | null = null;

      if (isAgentflowChatSessionTraceDebug()) {
        console.info('[chat-session-trace]', {
          session_trace_user_message: message.slice(0, 120),
          memorySessionId: memorySessionId.slice(0, 128),
          actionSessionId: actionSessionId.slice(0, 128),
          requestSessionId: requestSessionId.slice(0, 128),
          session_trace_history_count: {
            persistedHistory: persistedHistory.length,
            reqBodyMessages: messages.length,
            mergedMessages: mergedMessages.length,
            historyForBrain: historyForBrain.length,
          },
          session_trace_last_assistant: lastAssistantContentPreview(mergedMessages),
        });
      }

      if (routerContinuationState) {
        if (/^(?:no|cancel|never mind|nevermind|stop)$/i.test(message.trim())) {
          await clearRouterContinuationState(actionSessionId);
          const responseText = 'Okay, cancelled that pending follow-up.';
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        routerOverrideMessage = tryBuildRouterContinuationMessage(routerContinuationState, message);
        if (
          !routerOverrideMessage &&
          (isSoftContinuationReply(message) ||
            /^(?:yes|y|yeah|yep|sure|ok|okay|go ahead)$/i.test(message.trim()) ||
            message.trim().length <= 3)
        ) {
          const responseText = buildRouterContinuationReminder(routerContinuationState);
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      const nameAddressingPreferenceFollowupReply =
        await buildNameAddressingPreferenceFollowupReply(
          message,
          historyForBrain,
          walletAddress,
        );
      if (nameAddressingPreferenceFollowupReply) {
        await appendBrainConversationTurn(
          memorySessionId,
          message,
          nameAddressingPreferenceFollowupReply,
        );
        await updateBrainEvent(brainEventId, {
          intent_label: 'general.chat',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('general.chat'),
          final_response_summary: nameAddressingPreferenceFollowupReply,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        res.write(
          `data: ${JSON.stringify({ delta: nameAddressingPreferenceFollowupReply })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const backendContinuationReply = buildBackendContinuationReply({
        message,
        history: historyForBrain,
        pending: backendPendingAction,
      });
      if (backendContinuationReply) {
        await appendBrainConversationTurn(memorySessionId, message, backendContinuationReply);
        await updateBrainEvent(brainEventId, {
          intent_label: backendPendingAction?.tool ?? 'general.chat',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields(backendPendingAction?.tool ?? 'general.chat'),
          final_response_summary: backendContinuationReply,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        res.write(`data: ${JSON.stringify({ delta: backendContinuationReply })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const semanticContinuationContext = buildSemanticContinuationContext(message, historyForBrain);
      if (semanticContinuationContext) {
        walletCtx.profileContext = [walletCtx.profileContext, semanticContinuationContext]
          .filter(Boolean)
          .join('\n\n');
      }

      const conversationRecallReply = buildConversationRecallReply(message, historyForBrain, profile);
      if (conversationRecallReply) {
        await appendBrainConversationTurn(memorySessionId, message, conversationRecallReply);
        await updateBrainEvent(brainEventId, {
          intent_label: 'general.chat',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('general.chat'),
          final_response_summary: conversationRecallReply,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        res.write(`data: ${JSON.stringify({ delta: conversationRecallReply })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const referentialWorkflowClarification = buildReferentialWorkflowClarification(
        message,
        historyForBrain,
      );
      if (referentialWorkflowClarification) {
        await appendBrainConversationTurn(memorySessionId, message, referentialWorkflowClarification);
        await updateBrainEvent(brainEventId, {
          intent_label: 'general.chat',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('general.chat'),
          final_response_summary: referentialWorkflowClarification,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        res.write(`data: ${JSON.stringify({ delta: referentialWorkflowClarification })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const contextualGreetingReply = buildContextualGreetingReply(message, historyForBrain);
      if (contextualGreetingReply) {
        await appendBrainConversationTurn(memorySessionId, message, contextualGreetingReply);
        await updateBrainEvent(brainEventId, {
          intent_label: 'general.chat',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('general.chat'),
          final_response_summary: contextualGreetingReply,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        res.write(`data: ${JSON.stringify({ delta: contextualGreetingReply })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const upperMsg = message.trim().toUpperCase();
      const lowerMsg = message.trim().toLowerCase();

      if (
        /^(?:YES|YEAH|YEP|OK|OKAY|SURE|SHOW ME|GUIDE ME)$/i.test(message.trim()) &&
        isVoiceToTextAssistantReply(getMostRecentAssistantMessage(historyForBrain))
      ) {
        const responseText = buildVoiceToTextGuideReply();
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        await updateBrainEvent(brainEventId, {
          intent_label: 'voice_to_text.guide_followup',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields('voice_to_text.guide_followup'),
          final_response_summary: responseText,
          outcome: 'success',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (upperMsg === 'YES' || upperMsg === 'CONFIRM') {
        try {
          // Check for invoice:pending first (before split / agentpay)
          const invoicePendingRaw = await getRedis().get(`invoice:pending:${actionSessionId}`).catch(() => null);
          if (invoicePendingRaw) {
            const authHeader =
              typeof req.headers.authorization === 'string'
                ? req.headers.authorization
                : '';
            try {
              const confirmRes = await fetch(
                `http://127.0.0.1:${PUBLIC_PORT}/api/invoice/confirm/${encodeURIComponent(`invoice-${actionSessionId}`)}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authHeader ? { Authorization: authHeader } : {}),
                  },
                  body: JSON.stringify({ walletAddress: walletCtx.walletAddress }),
                },
              );
              const invoiceData = (await confirmRes.json().catch(() => ({
                success: false,
                message: 'Invoice confirmation failed.',
              }))) as {
                success?: boolean;
                message?: string;
                payment?: BrainMessageMeta['paymentMeta'];
              };
              const responseText =
                typeof invoiceData.message === 'string'
                  ? invoiceData.message
                  : 'Invoice confirmation failed.';
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              if (invoiceData.payment) {
                res.write(
                  `data: ${JSON.stringify({
                    meta: {
                      paymentMeta: invoiceData.payment,
                      activityMeta: {
                        mode: 'brain',
                        clusters: ['Invoice Agent'],
                        stageBars: [26, 44, 70, 92, 26, 14],
                      },
                    } satisfies BrainMessageMeta,
                  })}\n\n`,
                );
              }
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            } catch (invoiceConfirmErr) {
              const errMsg =
                invoiceConfirmErr instanceof Error ? invoiceConfirmErr.message : String(invoiceConfirmErr);
              const responseText = `Invoice creation failed: ${errMsg}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            try {
              const pending = JSON.parse(String(invoicePendingRaw)) as {
                walletAddress: string;
                vendorHandle: string;
                amount: string;
                description: string;
                invoiceNumber: string;
              };

              const { data: invoice, error: invErr } = await adminDb
                .from('invoices')
                .insert({
                  business_wallet: pending.walletAddress,
                  vendor_name: pending.vendorHandle,
                  vendor_email: '',
                  vendor_handle: pending.vendorHandle,
                  amount: parseFloat(pending.amount),
                  currency: 'USDC',
                  invoice_number: pending.invoiceNumber,
                  line_items: [{ description: pending.description, amount: parseFloat(pending.amount) }],
                  status: 'pending',
                })
                .select('id')
                .single();

              if (invErr || !invoice?.id) {
                throw new Error(invErr?.message ?? 'Failed to create invoice');
              }

              const { createPaymentRequestFromInvoice } = await import('./lib/invoice-agentpay');
              const payReq = await createPaymentRequestFromInvoice(String(invoice?.id));

              const requestedInvoiceResearch = await takeRequestedInvoiceResearchA2a(actionSessionId);
              if (!requestedInvoiceResearch) {
                scheduleChatInvoiceResearchFollowup({
                  vendorHandle: pending.vendorHandle,
                  amount: pending.amount,
                  issuerWalletAddress: pending.walletAddress,
                });
              }

              await getRedis().del(`invoice:pending:${actionSessionId}`);

              let receipt = [
                'Invoice created!',
                '',
                `Invoice #: ${pending.invoiceNumber}`,
                `To: ${pending.vendorHandle}`,
                `Amount: ${pending.amount} USDC`,
                `For: ${pending.description}`,
                '',
                payReq
                  ? `Payment request sent — ${pending.vendorHandle} will see it in their AgentPay Requests tab.`
                  : 'Invoice saved. Vendor will be notified when they join AgentPay.',
              ].join('\n');

              if (requestedInvoiceResearch) {
                try {
                  const researchPayload = await runInvoiceVendorResearchFollowup({
                    vendor: pending.vendorHandle,
                    amount: parseFloat(pending.amount),
                    issuerWalletAddress: pending.walletAddress,
                    researchRunUrl: RESEARCH_URL,
                    researchPriceLabel: researchPrice,
                  });
                  receipt = `${receipt}\n\n---\n\n${formatResearchA2aReport(researchPayload, 'invoice')}`;
                } catch (a2aErr: any) {
                  const msg = a2aErr instanceof Error ? a2aErr.message : String(a2aErr);
                  console.warn('[a2a] requested invoice research follow-up failed:', msg);
                  receipt = `${receipt}\n\nA2A vendor research failed: ${msg}`;
                }
              }

              await appendBrainConversationTurn(memorySessionId, message, receipt);
              res.write(`data: ${JSON.stringify({ delta: receipt })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            } catch (invErr: any) {
              await getRedis().del(`invoice:pending:${actionSessionId}`).catch(() => null);
              const errMsg = invErr instanceof Error ? invErr.message : String(invErr);
              const responseText = `Invoice creation failed: ${errMsg}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
          }

          const contactUpdateKey = `contact:update:${canonicalRedisSessionId(actionSessionId)}`;
          const rawContactUpdate = await getRedis().get(contactUpdateKey).catch(() => null);
          if (rawContactUpdate) {
            try {
              const pending = JSON.parse(rawContactUpdate) as {
                name: string;
                newAddress: string;
                oldAddress: string;
              };
              const w = getAddress(walletCtx.walletAddress);
              let resolvedNew: `0x${string}`;
              try {
                resolvedNew = getAddress(await resolvePayee(pending.newAddress, w));
              } catch (e: any) {
                const msg = e instanceof Error ? e.message : String(e);
                const responseText = `Could not resolve new address: ${msg}`;
                await appendBrainConversationTurn(memorySessionId, message, responseText);
                res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
              const { error: upErr } = await adminDb
                .from('contacts')
                .update({
                  address: resolvedNew,
                  updated_at: new Date().toISOString(),
                })
                .eq('wallet_address', w)
                .ilike('name', pending.name);
              if (upErr) {
                const responseText = `Failed to update contact: ${upErr.message}`;
                await appendBrainConversationTurn(memorySessionId, message, responseText);
                res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
              await getRedis().del(contactUpdateKey);
              const responseText = [
                'Contact updated!',
                '',
                `${pending.name} → ${resolvedNew}`,
              ].join('\n');
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            } catch (cuErr) {
              await getRedis().del(contactUpdateKey).catch(() => null);
              const errMsg = cuErr instanceof Error ? cuErr.message : String(cuErr);
              const responseText = `Contact update failed: ${errMsg}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
          }

          // Check for batch:pending before split:pending
          const batchPendingRaw = await getRedis().get(`batch:pending:${actionSessionId}`).catch(() => null);
          if (batchPendingRaw) {
            const authHeader =
              typeof req.headers.authorization === 'string'
                ? req.headers.authorization
                : '';
            try {
              const requestedPortfolioA2a = await takeRequestedPortfolioA2a(actionSessionId);
              const confirmRes = await fetch(
                `http://127.0.0.1:${PUBLIC_PORT}/api/batch/confirm/${encodeURIComponent(actionSessionId)}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authHeader ? { Authorization: authHeader } : {}),
                  },
                  body: JSON.stringify({
                    walletAddress: walletCtx.walletAddress,
                    suppressPortfolioFollowup: Boolean(requestedPortfolioA2a),
                  }),
                },
              );
              const batchData = await confirmRes.json().catch(() => ({ action: 'error', message: 'Batch agent error' })) as {
                action: string;
                message: string;
                results?: Array<{ to: string; amount: string; status: string; txHash?: string; error?: string }>;
                payment?: BrainMessageMeta['paymentMeta'];
              };
              const responseText =
                batchData.action === 'success'
                  ? await appendRequestedPortfolioA2aReport({
                      baseMessage: batchData.message,
                      requested: requestedPortfolioA2a,
                      userWalletAddress: walletCtx.walletAddress,
                      details: { confirmId: actionSessionId, results: batchData.results },
                      sessionId: actionSessionId,
                    })
                  : batchData.message;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              if (batchData.payment) {
                res.write(
                  `data: ${JSON.stringify({
                    meta: {
                      paymentMeta: batchData.payment,
                      activityMeta: {
                        mode: 'brain',
                        clusters: ['Batch Agent'],
                        stageBars: [28, 50, 74, 94, 30, 18],
                      },
                    } satisfies BrainMessageMeta,
                  })}\n\n`,
                );
              }
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            } catch (batchErr: any) {
              const errMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
              const responseText = `Batch payment failed: ${errMsg}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            try {
              const requestedPortfolioA2a = await takeRequestedPortfolioA2a(actionSessionId);
              const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
              const confirmRes = await fetch(
                `${BATCH_AGENT_BASE_URL}/confirm/${encodeURIComponent(actionSessionId)}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authHeader ? { Authorization: authHeader } : {}),
                    ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
                  },
                  body: JSON.stringify({
                    walletAddress: walletCtx.walletAddress,
                    suppressPortfolioFollowup: Boolean(requestedPortfolioA2a),
                  }),
                },
              );
              const batchData = await confirmRes.json().catch(() => ({ action: 'error', message: 'Batch agent error' })) as {
                action: string;
                message: string;
                results?: Array<{ to: string; amount: string; status: string; txHash?: string; error?: string }>;
              };
              const responseText =
                batchData.action === 'success'
                  ? await appendRequestedPortfolioA2aReport({
                      baseMessage: batchData.message,
                      requested: requestedPortfolioA2a,
                      userWalletAddress: walletCtx.walletAddress,
                      details: { confirmId: actionSessionId, results: batchData.results },
                      sessionId: actionSessionId,
                    })
                  : batchData.message;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            } catch (batchErr: any) {
              const errMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
              const responseText = `Batch payment failed: ${errMsg}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
          }

          // Check for split:pending before agentpay:pending
          const splitPendingRaw = await getRedis().get(`split:pending:${actionSessionId}`).catch(() => null);
          if (splitPendingRaw) {
            const authHeader =
              typeof req.headers.authorization === 'string'
                ? req.headers.authorization
                : '';
            try {
              const requestedPortfolioA2a = await takeRequestedPortfolioA2a(actionSessionId);
              const confirmRes = await fetch(
                `http://127.0.0.1:${PUBLIC_PORT}/api/split/confirm/${encodeURIComponent(actionSessionId)}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authHeader ? { Authorization: authHeader } : {}),
                  },
                  body: JSON.stringify({
                    walletAddress: walletCtx.walletAddress,
                    suppressPortfolioFollowup: Boolean(requestedPortfolioA2a),
                  }),
                },
              );
              const splitData = await confirmRes.json().catch(() => ({ action: 'error', message: 'Split agent error' })) as {
                action: string;
                message: string;
                results?: Array<{ recipient: string; amount: string; status: string; txHash?: string; error?: string }>;
                payment?: BrainMessageMeta['paymentMeta'];
              };
              const responseText =
                splitData.action === 'success'
                  ? await appendRequestedPortfolioA2aReport({
                      baseMessage: splitData.message,
                      requested: requestedPortfolioA2a,
                      userWalletAddress: walletCtx.walletAddress,
                      details: { confirmId: actionSessionId, results: splitData.results },
                      sessionId: actionSessionId,
                    })
                  : splitData.message;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              if (splitData.payment) {
                res.write(
                  `data: ${JSON.stringify({
                    meta: {
                      paymentMeta: splitData.payment,
                      activityMeta: {
                        mode: 'brain',
                        clusters: ['Split Agent'],
                        stageBars: [28, 50, 74, 94, 30, 18],
                      },
                    } satisfies BrainMessageMeta,
                  })}\n\n`,
                );
              }
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            } catch (splitErr: any) {
              const errMsg = splitErr instanceof Error ? splitErr.message : String(splitErr);
              const responseText = `Split payment failed: ${errMsg}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            try {
              const requestedPortfolioA2a = await takeRequestedPortfolioA2a(actionSessionId);
              const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
              const confirmRes = await fetch(
                `${SPLIT_AGENT_BASE_URL}/confirm/${encodeURIComponent(actionSessionId)}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authHeader ? { Authorization: authHeader } : {}),
                    ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
                  },
                  body: JSON.stringify({
                    walletAddress: walletCtx.walletAddress,
                    suppressPortfolioFollowup: Boolean(requestedPortfolioA2a),
                  }),
                },
              );
              const splitData = await confirmRes.json().catch(() => ({ action: 'error', message: 'Split agent error' })) as {
                action: string;
                message: string;
                results?: Array<{ recipient: string; amount: string; status: string; txHash?: string; error?: string }>;
              };
              const responseText =
                splitData.action === 'success'
                  ? await appendRequestedPortfolioA2aReport({
                      baseMessage: splitData.message,
                      requested: requestedPortfolioA2a,
                      userWalletAddress: walletCtx.walletAddress,
                      details: { confirmId: actionSessionId, results: splitData.results },
                      sessionId: actionSessionId,
                    })
                  : splitData.message;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            } catch (splitErr: any) {
              const errMsg = splitErr instanceof Error ? splitErr.message : String(splitErr);
              const responseText = `Split payment failed: ${errMsg}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
          }

          const agentPayPendingRaw = await getFirstPendingRedisValue(
            (key) => getRedis().get(key),
            'agentpay:pending:',
            actionSessionId,
          );
          if (agentPayPendingRaw) {
            const authHeader =
              typeof req.headers.authorization === 'string'
                ? req.headers.authorization
                : '';
            if (!authHeader) {
              const responseText =
                'Payment confirmation failed: missing auth token. Reconnect your wallet and try again.';
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            const pendingSend = await loadPendingAction(actionSessionId).catch(() => null);
            const executeResp = await fetch('http://localhost:4000/api/pay/brain/execute', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader,
              },
              body: JSON.stringify({ sessionId: actionSessionId }),
            });
            const executeJson = (await executeResp.json().catch(() => ({}))) as {
              ok?: boolean;
              txHash?: string;
              explorerLink?: string;
              error?: string;
              to?: string;
              amount?: string;
              remark?: string;
            };
            if (!executeResp.ok || !executeJson.ok || !executeJson.txHash) {
              const responseText = `Payment failed: ${executeJson.error || 'unknown error'}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            const txHash = executeJson.txHash;
            const txShort = txHash.length > 12 ? `${txHash.slice(0, 10)}...` : txHash;
            const explorerUrl = executeJson.explorerLink || `https://testnet.arcscan.app/tx/${txHash}`;
            const pendingSendPayload =
              pendingSend && typeof pendingSend === 'object'
                ? (pendingSend as { tool?: string; args?: unknown })
                : null;
            const pendingArgs =
              pendingSendPayload?.tool === 'agentpay_send' &&
              pendingSendPayload.args &&
              typeof pendingSendPayload.args === 'object'
                ? (pendingSendPayload.args as Record<string, unknown>)
                : null;
            const recipient =
              (typeof pendingArgs?.to === 'string' && pendingArgs.to.trim()
                ? pendingArgs.to.trim()
                : typeof executeJson.to === 'string' && executeJson.to.trim()
                  ? executeJson.to.trim()
                  : null);
            const amount =
              (typeof pendingArgs?.amount === 'string' && pendingArgs.amount.trim()
                ? pendingArgs.amount.trim()
                : typeof executeJson.amount === 'string' && executeJson.amount.trim()
                  ? executeJson.amount.trim()
                  : null);
            const remark =
              (typeof pendingArgs?.remark === 'string' && pendingArgs.remark.trim()
                ? pendingArgs.remark.trim()
                : typeof executeJson.remark === 'string' && executeJson.remark.trim()
                  ? executeJson.remark.trim()
                  : null);
            const receiptLines = [
              'Sent payment successfully on Arc.',
              recipient ? `Recipient: ${recipient}` : null,
              amount ? `Amount: ${amount} USDC` : null,
              remark ? `Note: ${remark}` : null,
              `Tx: \`${txShort}\``,
              `[View on Arc Explorer](${explorerUrl})`,
            ].filter(Boolean);
            const responseText = receiptLines.join('\n\n');
            const paymentMeta = takeRecentExecutionMeta(actionSessionId);
            if (brainEventId) {
              await adminDb
                .from('brain_events')
                .update({
                  layer_used: 'fastpath',
                  final_intent: 'agentpay_send',
                })
                .eq('id', brainEventId);
            }
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            if (paymentMeta) {
              res.write(
                `data: ${JSON.stringify({
                  meta: {
                    paymentMeta,
                  } satisfies BrainMessageMeta,
                })}\n\n`,
              );
            }
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }

          const pending = await loadPendingAction(actionSessionId);
          if (pending) {
            const pendingTool = pending.tool;
            const requestedPortfolioA2a = await takeRequestedPortfolioA2a(actionSessionId);
            const result = await executeTool(
              pending.tool,
              { ...pending.args, confirmed: true },
              walletCtx,
              actionSessionId,
            );
            const pendingResult = classifyBrainToolResult(result);
            const pendingProvider =
              (pending.tool === 'swap_tokens' ||
                pending.tool === 'vault_action' ||
                pending.tool === 'predict_action') &&
              pending.payload &&
              typeof pending.payload === 'object' &&
              typeof (pending.payload as { provider?: unknown }).provider === 'string'
                ? (pending.payload as { provider: string }).provider
                : null;
            await appendBrainToolTelemetry(brainEventId, brainToolsTelemetry, {
              name: pending.tool,
              provider:
                pending.tool === 'swap_tokens' ||
                pending.tool === 'vault_action' ||
                pending.tool === 'predict_action'
                  ? pendingProvider
                  : null,
              params_summary: summarizeToolParams({ ...pending.args, confirmed: true }),
              result_summary: summarizeTelemetryValue(result),
              latency_ms: null,
              success: pendingResult.success,
            });
            let resultForUser = result;
            if (requestedPortfolioA2a && walletCtx.walletAddress && typeof result === 'string') {
              resultForUser = await appendRequestedPortfolioA2aReport({
                baseMessage: result,
                requested: requestedPortfolioA2a,
                userWalletAddress: walletCtx.walletAddress,
                details: result,
                sessionId: actionSessionId,
              });
            } else if (typeof result === 'string' && walletCtx.walletAddress) {
              scheduleChatToolPostA2a({
                pendingTool,
                result,
                userWalletAddress: walletCtx.walletAddress,
                portfolioRunUrl: PORTFOLIO_URL,
                portfolioPriceLabel: portfolioPrice,
              });
            }
            const meta = buildBrainMetaFromToolResults([{ name: pending.tool, result: resultForUser }]);
            const paymentMeta = takeRecentExecutionMeta(actionSessionId);
            if (paymentMeta) {
              meta.paymentMeta = paymentMeta;
            }
            await appendBrainConversationTurn(memorySessionId, message, resultForUser);
            await updateBrainEvent(brainEventId, {
              intent_label: pending.tool,
              intent_source: 'fastpath',
              ...buildFastpathBrainEventFields(pending.tool),
              final_response_summary: resultForUser,
              outcome: pendingResult.outcome,
              failure_reason: pendingResult.failureReason,
              total_latency_ms: Date.now() - responseStartedAt,
            });
            brainTelemetryFinalized = true;
            res.write(`data: ${JSON.stringify({ meta })}\n\n`);
            res.write(`data: ${JSON.stringify({ delta: resultForUser })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } else {
            if (isAgentflowChatSessionTraceDebug()) {
              console.info('[chat-session-trace]', {
                research_confirm_yes_received: true,
                memorySessionId: memorySessionId.slice(0, 128),
                actionSessionId: actionSessionId.slice(0, 128),
              });
            }

            const deferredResearchTask =
              (await takeDeferredResearchConfirmTaskRedisDual(memorySessionId, actionSessionId)) ??
              resolveDeferredResearchTaskFromBrainHistory(historyForBrain);

            if (isAgentflowChatSessionTraceDebug()) {
              if (deferredResearchTask) {
                console.info('[chat-session-trace]', {
                  research_confirm_history_found: true,
                  deferredTaskLen: deferredResearchTask.length,
                });
              } else {
                const tail = historyForBrain[historyForBrain.length - 1];
                let research_confirm_miss_reason = 'assistant_tail_not_research_offer';
                if (!walletCtx.walletAddress) research_confirm_miss_reason = 'no_wallet';
                else if (!historyForBrain.length) research_confirm_miss_reason = 'empty_history';
                else if (tail?.role === 'assistant' && looksLikeAssistantResearchConfirmationOffer(tail.content)) {
                  research_confirm_miss_reason = 'offer_regex_but_no_matching_user_topic';
                }
                console.info('[chat-session-trace]', { research_confirm_miss_reason });
              }
            }

            if (deferredResearchTask && walletCtx.walletAddress) {
              await executeBrainResearchPipelineForChat({
                res,
                memorySessionId,
                persistUserTurn: message,
                researchTask: deferredResearchTask,
                originalUserMessage: message,
                walletAddress: walletCtx.walletAddress,
                brainEventId,
                redisActionScopeKey: memorySessionId,
              });
              return;
            }

            if (isAgentflowChatSessionTraceDebug()) {
              console.info('[chat-session-trace]', {
                yes_confirm_no_pending_fallthrough: true,
                memorySessionId: memorySessionId.slice(0, 128),
                actionSessionId: actionSessionId.slice(0, 128),
              });
            }
            // No invoice/contact/batch/split/agentpay/tool pending nor deferred research topic — fall through to Hermes.
          }
        } catch (error) {
          console.warn('[chat/respond] pending confirm failed:', getErrorMessage(error));
        }
      }

      if (upperMsg === 'NO' || upperMsg === 'CANCEL') {
        let responseText = 'Cancelled. What else can I help you with?';
        try {
          const agentPayPendingExists = await redisPendingExists(
            (key) => getRedis().get(key),
            'agentpay:pending:',
            actionSessionId,
          );
          const toolPending = await loadPendingAction(actionSessionId);

          await clearPendingAction(actionSessionId);
          await clearPendingRedisKeys(
            (key) => getRedis().del(key),
            'agentpay:pending:',
            actionSessionId,
          );
          await getRedis()
            .del(`contact:update:${canonicalRedisSessionId(actionSessionId)}`)
            .catch(() => null);

          await getRedis()
            .del(`${RESEARCH_CONFIRM_REDIS_PREFIX}${memorySessionId}`)
            .catch(() => null);

          await getRedis()
            .del(`${RESEARCH_CONFIRM_REDIS_PREFIX}${actionSessionId}`)
            .catch(() => null);
          await clearRouterContinuationState(actionSessionId);

          if (agentPayPendingExists) {
            responseText = "Okay, I didn't send the payment.";
          } else if (toolPending?.tool === 'swap_tokens') {
            responseText = "Okay, I didn't execute the swap.";
          } else if (toolPending?.tool === 'vault_action') {
            responseText = "Okay, I didn't execute the vault action.";
          } else if (toolPending?.tool === 'predict_action') {
            responseText = "Okay, I didn't execute the prediction market action.";
          }
        } catch (error) {
          console.warn('[chat/respond] pending cancel failed:', getErrorMessage(error));
        }
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        res.write(
          `data: ${JSON.stringify({ delta: responseText })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      let routerValidationResult: ValidationResult | null = null;

      const hasStrictRouterApproval = (validation: ValidationResult | null): boolean => {
        if (!validation) {
          return false;
        }
        const threshold = getFastpathExecutionConfidenceThreshold(validation.intent.intent);
        return (
          validation.severity === 'pass' &&
          validation.intent.confidence >= threshold &&
          STRICT_ROUTER_APPROVAL_INTENTS.has(validation.intent.intent)
        );
      };

      const canUseFastPathForIntents = (...expectedIntents: AgentFlowIntentName[]): boolean => {
        if (!routerValidationResult) {
          return false;
        }
        return (
          hasStrictRouterApproval(routerValidationResult) &&
          expectedIntents.includes(routerValidationResult.intent.intent)
        );
      };

      async function tryHandleIntentRouterLayer(): Promise<boolean> {
        if (!INTENT_ROUTER_ENABLED) {
          return false;
        }
        if (
          walletCtx.walletAddress &&
          shouldHandleAsBatchPayment(message) &&
          !shouldHandleAsSplitRequest(message)
        ) {
          return false;
        }
        if (
          walletCtx.walletAddress &&
          shouldHandleAsSplitRequest(message) &&
          !shouldHandleAsBatchPayment(message)
        ) {
          return false;
        }

        const tier2StartedAt = Date.now();
        try {
          const routingMessage = routerOverrideMessage ?? message;
    const classifiedByRouter =
      quickActionIntent ??
      await classifyIntent(
        routingMessage,
        buildClassifierHistory(historyForBrain),
      );
    const fastpathFallback =
      classifiedByRouter.intent === AgentFlowIntentName.GeneralChat
        ? buildAgentPayHistoryFastpathIntent(routingMessage)
        : null;
    const classified = fastpathFallback ?? classifiedByRouter;
          const validation = validateIntent(classified);
          routerValidationResult = validation;

          if (validation.severity === 'hard' && validation.clarification) {
            // Predmarket buy/sell explicit commands and quick-action prompts (e.g.
            // "sell 5 shares outcome 3 (Others) for 0x..." or "bet on Yes for 0x...")
            // are parsed reliably by the direct-route layer. When the LLM router can't
            // fill the slots, defer to the direct route instead of asking for
            // clarification (otherwise the Sell/outcome buttons appear to "forget"
            // the context).
            if (
              (validation.intent.intent === AgentFlowIntentName.PredmarketBuy ||
                validation.intent.intent === AgentFlowIntentName.PredmarketSell) &&
              parseDirectAgentFlowRoute(message, messages)
            ) {
              return false;
            }
            if (
              validation.intent.intent === AgentFlowIntentName.SplitExecute &&
              shouldHandleAsBatchPayment(message)
            ) {
              return false;
            }
            if (
              validation.intent.intent === AgentFlowIntentName.BatchExecute &&
              shouldHandleAsSplitRequest(message)
            ) {
              return false;
            }
            const vaultSelectionReply =
              validation.intent.intent === AgentFlowIntentName.VaultDeposit
                ? parseDirectAgentFlowRoute(message, messages)
                : null;
            if (
              vaultSelectionReply?.type === 'reply' &&
              vaultSelectionReply.quickActionGroups?.length
            ) {
              const responseText = vaultSelectionReply.text;
              await updateBrainEvent(brainEventId, {
                intent_label: validation.intent.intent,
                intent_source: 'fastpath',
                ...buildFastpathBrainEventFields('product_reply'),
                final_response_summary: responseText,
                outcome: 'success',
                total_latency_ms: Date.now() - responseStartedAt,
              });
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(
                `data: ${JSON.stringify({
                  meta: { quickActionGroups: vaultSelectionReply.quickActionGroups },
                })}\n\n`,
              );
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return true;
            }
            if (isRouterContinuationIntent(validation.intent.intent)) {
              await storeRouterContinuationState(actionSessionId, {
                intent: validation.intent.intent,
                rawMessage: routingMessage,
                slots:
                  validation.intent.slots && typeof validation.intent.slots === 'object'
                    ? (validation.intent.slots as Record<string, unknown>)
                    : {},
                slotsMissing: validation.slots_missing ?? [],
                clarification: validation.clarification,
                createdAt: new Date().toISOString(),
              });
            }
            const responseText = validation.clarification;
            await updateBrainEvent(brainEventId, {
              intent_label: validation.intent.intent,
              ...buildIntentRouterBrainEventFields(validation.intent, validation.ok),
              final_response_summary: responseText,
              outcome: 'validation_error',
              total_latency_ms: Date.now() - responseStartedAt,
            });
            console.info('[INTENT_DISPATCH]', {
              raw_message: truncateIntentDispatchMessage(message),
              layer_used: 'intent_router',
              intent: validation.intent.intent,
              validator_severity: validation.severity,
              tool_called: null,
              confidence: validation.intent.confidence,
              latency_ms: Date.now() - tier2StartedAt,
            });
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return true;
          }

          const shouldDispatchFromRouter =
            validation.intent.intent !== AgentFlowIntentName.GeneralChat &&
            (hasStrictRouterApproval(validation) ||
              (
                validation.intent.intent === AgentFlowIntentName.AgentpayPaymentLink &&
                validation.severity === 'soft'
              ) || (
              !STRICT_ROUTER_APPROVAL_INTENTS.has(validation.intent.intent) &&
              validation.intent.confidence >= 0.7
            ));

          if (shouldDispatchFromRouter) {
            await clearRouterContinuationState(actionSessionId);
            const routed = await dispatchIntent({
              intent: validation.intent,
              walletCtx,
              sessionId: actionSessionId,
              deps: {
                executeTool: async (toolName, args, toolWalletCtx, sessionId) => {
                  if (toolName === 'get_portfolio' && toolWalletCtx.walletAddress?.trim()) {
                    return executePortfolioAgentForChat({
                      userWalletAddress: toolWalletCtx.walletAddress,
                      sessionId,
                      fallback: () =>
                        executeTool(toolName, args, toolWalletCtx, sessionId, {
                          rawUserMessage: message,
                        }),
                    });
                  }
                  return executeTool(toolName, args, toolWalletCtx, sessionId, {
                    rawUserMessage: message,
                  });
                },
                runResearchReport: async (researchTask, options) => {
                  const portfolioImpact = options?.portfolioImpact === true;
                  await executeBrainResearchPipelineForChat({
                    res,
                    memorySessionId,
                    persistUserTurn: message,
                    researchTask,
                    originalUserMessage: message,
                    reasoningMode: options?.reasoningMode,
                    portfolioImpact,
                    walletAddress: walletCtx.walletAddress,
                    brainEventId,
                    redisActionScopeKey: memorySessionId,
                  });
                  return {
                    handled: true,
                    responseText: '',
                    toolCalled: null,
                    responseAlreadyStreamed: true,
                  };
                },
                runSchedule: async (intentValue, walletAddress) => {
                  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
                  const scheduleSlots = (intentValue.slots ?? {}) as Record<string, any>;
                  const recipientHandle =
                    typeof scheduleSlots.recipient?.handle === 'string' && scheduleSlots.recipient.handle.trim()
                      ? scheduleSlots.recipient.handle.trim()
                      : typeof scheduleSlots.recipient?.address === 'string' && scheduleSlots.recipient.address.trim()
                        ? scheduleSlots.recipient.address.trim()
                        : '';
                  const amountValue =
                    typeof scheduleSlots.amount?.value === 'number'
                      ? String(scheduleSlots.amount.value)
                      : typeof scheduleSlots.amount?.value === 'string' && scheduleSlots.amount.value.trim()
                        ? scheduleSlots.amount.value.trim()
                        : '';
                  const amountCurrency =
                    typeof scheduleSlots.amount?.currency === 'string' && scheduleSlots.amount.currency.trim()
                      ? scheduleSlots.amount.currency.trim()
                      : 'USDC';
                  const cadence =
                    typeof scheduleSlots.schedule?.cadence === 'string' && scheduleSlots.schedule.cadence.trim()
                      ? scheduleSlots.schedule.cadence.trim()
                      : '';
                  const remark =
                    typeof scheduleSlots.remark === 'string' && scheduleSlots.remark.trim()
                      ? scheduleSlots.remark.trim()
                      : extractAgentpayRemark(intentValue.raw_message) || '';
                  const synthesizedTask =
                    recipientHandle && amountValue && cadence
                      ? [
                          'pay',
                          amountValue,
                          amountCurrency,
                          'to',
                          recipientHandle,
                          cadence,
                          ...(remark ? ['for', remark] : []),
                        ].join(' ')
                      : intentValue.raw_message;
                  const scheduleAgentRes = await fetch(`${SCHEDULE_AGENT_BASE_URL}/run`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
                    },
                    body: JSON.stringify({ task: synthesizedTask, walletAddress }),
                  });
                  const scheduleData = await scheduleAgentRes.json().catch(() => ({
                    action: 'error',
                    message: 'Schedule agent error',
                  })) as {
                    message?: string;
                    confirmId?: string;
                    confirmLabel?: string;
                    choices?: Array<{ id: string; label: string; confirmId: string }>;
                  };
                  return {
                    handled: true,
                    responseText:
                      typeof scheduleData.message === 'string' ? scheduleData.message : 'Schedule agent error',
                    toolCalled: null,
                    meta:
                      scheduleData.confirmId || scheduleData.choices?.length
                        ? {
                            confirmation: {
                              required: true,
                              action: 'schedule',
                              confirmId: scheduleData.confirmId,
                              confirmLabel: scheduleData.confirmLabel || 'Confirm',
                              choices: scheduleData.choices,
                            },
                          }
                        : undefined,
                  };
                },
                listContacts: async (walletAddress) => {
                  const w = getAddress(walletAddress);
                  const { data: contacts, error } = await adminDb
                    .from('contacts')
                    .select('*')
                    .eq('wallet_address', w)
                    .order('name', { ascending: true });
                  if (error) {
                    return {
                      handled: true,
                      responseText: `Could not load contacts: ${error.message}`,
                      toolCalled: null,
                    };
                  }
                  const rows = Array.isArray(contacts) ? contacts : [];
                  const responseText = rows.length
                    ? `Saved contacts:\n\n${rows
                        .map((contact) => `- ${String(contact.name)} -> ${String(contact.address)}`)
                        .join('\n')}`
                    : 'No saved contacts yet.';
                  return { handled: true, responseText, toolCalled: null };
                },
                createContact: async (walletAddress, name, recipient) => {
                  const addressText =
                    typeof recipient.handle === 'string' && recipient.handle.trim()
                      ? recipient.handle.trim()
                      : typeof recipient.address === 'string'
                        ? recipient.address.trim()
                        : '';
                  if (!name || !addressText) {
                    return {
                      handled: true,
                      responseText: 'Tell me the contact name and address or .arc handle to save.',
                      toolCalled: null,
                    };
                  }
                  const w = getAddress(walletAddress);
                  const resolved = getAddress(await resolvePayee(addressText, w));
                  const { error } = await adminDb.from('contacts').insert({
                    wallet_address: w,
                    name,
                    address: resolved,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  });
                  if (error) {
                    return {
                      handled: true,
                      responseText: `Failed to save contact: ${error.message}`,
                      toolCalled: null,
                    };
                  }
                  return {
                    handled: true,
                    responseText: `Saved contact "${name}" -> ${resolved}.`,
                    toolCalled: null,
                  };
                },
                updateContact: async (walletAddress, name, recipient) => {
                  const addressText =
                    typeof recipient.handle === 'string' && recipient.handle.trim()
                      ? recipient.handle.trim()
                      : typeof recipient.address === 'string'
                        ? recipient.address.trim()
                        : '';
                  if (!name || !addressText) {
                    return {
                      handled: true,
                      responseText: 'Tell me which contact to update and the new address or .arc handle.',
                      toolCalled: null,
                    };
                  }
                  const w = getAddress(walletAddress);
                  const { data: existing } = await adminDb
                    .from('contacts')
                    .select('address')
                    .eq('wallet_address', w)
                    .ilike('name', name)
                    .maybeSingle();
                  if (!existing?.address) {
                    return {
                      handled: true,
                      responseText: `Contact "${name}" not found.`,
                      toolCalled: null,
                    };
                  }
                  await getRedis().set(
                    `contact:update:${canonicalRedisSessionId(actionSessionId)}`,
                    JSON.stringify({
                      name,
                      newAddress: addressText,
                      oldAddress: String(existing.address),
                    }),
                    'EX',
                    300,
                  );
                  return {
                    handled: true,
                    responseText: [
                      `Update contact "${name}"?`,
                      '',
                      `From: ${String(existing.address)}`,
                      `To: ${addressText}`,
                      '',
                      'Reply YES to confirm.',
                    ].join('\n'),
                    toolCalled: null,
                  };
                },
                deleteContact: async (walletAddress, name) => {
                  const w = getAddress(walletAddress);
                  const { data: deletedRows, error } = await adminDb
                    .from('contacts')
                    .delete()
                    .eq('wallet_address', w)
                    .ilike('name', name)
                    .select('id');
                  if (error) {
                    return {
                      handled: true,
                      responseText: `Failed to remove contact: ${error.message}`,
                      toolCalled: null,
                    };
                  }
                  if (!deletedRows?.length) {
                    return {
                      handled: true,
                      responseText: `No contact named "${name}" found.`,
                      toolCalled: null,
                    };
                  }
                  return {
                    handled: true,
                    responseText: `Contact "${name}" removed.`,
                    toolCalled: null,
                  };
                },
                getAgentPayHistory: async (walletAddress) => {
                  const rows = await fetchPayHistoryForBrain(walletAddress, 10);
                  return {
                    handled: true,
                    responseText: formatAgentPayHistoryForChat(rows as Array<Record<string, any>>, {
                      requestedLimit: 10,
                      allRequested: isAllAgentPayHistoryRequest(validation.intent.raw_message),
                      browserTimeZone,
                      browserLocale,
                    }),
                    toolCalled: null,
                  };
                },
                buildPaymentLink: async (recipient, amount, remark) => {
                  let rawHandle =
                    typeof recipient.handle === 'string' && recipient.handle.trim()
                      ? recipient.handle.trim()
                      : typeof recipient.address === 'string'
                        ? recipient.address.trim()
                        : '';
                  if (recipient.registeredNameOwner && typeof recipient.address === 'string') {
                    rawHandle = await getPreferredAgentpayPaymentLinkHandle(
                      recipient.address,
                      recipient.registeredNameOwner,
                    );
                  }
                  if (!rawHandle) {
                    return {
                      handled: true,
                      responseText: [
                        'I can build a payment link, but I need a recipient.',
                        '',
                        'Try: "payment link for jack.arc 5 USDC for coffee"',
                      ].join('\n'),
                      toolCalled: null,
                    };
                  }
                  const handle =
                    rawHandle.endsWith('.arc') || rawHandle.startsWith('0x')
                      ? rawHandle
                      : `${rawHandle}.arc`;
                  const params = new URLSearchParams();
                  if (amount != null) params.set('amount', String(amount));
                  if (typeof remark === 'string' && remark.trim()) {
                    params.set('remark', remark.trim());
                  }
                  const query = params.toString();
                  const path = `/pay/${encodeURIComponent(handle)}${query ? `?${query}` : ''}`;
                  const displayHandle = handle.startsWith('0x')
                    ? `${handle.slice(0, 6)}...${handle.slice(-4)}`
                    : handle;
                  const responseLines = [`Here's your payment link for **${displayHandle}**.`];
                  if (amount != null) responseLines.push(`Pre-filled amount: **${amount} USDC**.`);
                  if (typeof remark === 'string' && remark.trim()) {
                    responseLines.push(`Remark: _${remark.trim()}_.`);
                  }
                  responseLines.push('');
                  responseLines.push(
                    'Anyone can open it - AgentFlow users pay automatically from their DCW, others can connect any wallet on Arc Testnet.',
                  );
                  return {
                    handled: true,
                    responseText: responseLines.join('\n'),
                    toolCalled: null,
                    meta: {
                      paymentLink: {
                        handle,
                        displayHandle,
                        amount: amount != null ? String(amount) : null,
                        remark: typeof remark === 'string' && remark.trim() ? remark.trim() : null,
                        path,
                      },
                    },
                  };
                },
                runBatch: async (intentValue: AgentFlowIntent, walletAddress, sessionId) => {
                  const parsedBatch =
                    extractBatchPaymentsFromIntent(intentValue, intentValue.raw_message) ??
                    parseBatchMessage(intentValue.raw_message);
                  if ('error' in parsedBatch) {
                    return {
                      handled: true,
                      responseText:
                        `I see you want to run a batch payment, but I could not parse the recipients.\n` +
                        formatBatchParseError(parsedBatch.error),
                      toolCalled: null,
                    };
                  }
                  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
                  const batchAgentRes = await fetch(`${BATCH_AGENT_BASE_URL}/run`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
                    },
                    body: JSON.stringify({
                      sessionId,
                      walletAddress,
                      payments: parsedBatch,
                    }),
                  });
                  const batchData = (await batchAgentRes.json().catch(() => ({
                    action: 'error',
                    message: 'Batch agent error',
                  }))) as { message?: string; confirmId?: string; confirmLabel?: string; action?: string };
                  return {
                    handled: true,
                    responseText: typeof batchData.message === 'string' ? batchData.message : 'Batch agent error',
                    toolCalled: null,
                    meta:
                      batchData.action === 'preview' && batchData.confirmId
                        ? {
                            confirmation: {
                              required: true,
                              action: 'batch',
                              confirmId: batchData.confirmId,
                              confirmLabel: batchData.confirmLabel || 'Send batch',
                            },
                          }
                        : undefined,
                  };
                },
                runSplit: async (intentValue: AgentFlowIntent, walletAddress, sessionId) => {
                  const parsed =
                    extractSplitRequestFromIntent(intentValue, intentValue.raw_message) ??
                    parseSplitRequest(intentValue.raw_message);
                  if (!parsed) {
                    return {
                      handled: true,
                      responseText:
                        'I see you want to split a payment, but I could not extract the amount and recipients. Try: "split 30 USDC between alice.arc, bob.arc and charlie.arc".',
                      toolCalled: null,
                    };
                  }
                  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
                  const splitAgentRes = await fetch(`${SPLIT_AGENT_BASE_URL}/run`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
                    },
                    body: JSON.stringify({
                      sessionId,
                      walletAddress,
                      recipients: parsed.recipients,
                      totalAmount: parsed.totalAmount,
                      remark: parsed.remark || '',
                    }),
                  });
                  const splitData = (await splitAgentRes.json().catch(() => ({
                    action: 'error',
                    message: 'Split agent error',
                  }))) as { message?: string; confirmId?: string; confirmLabel?: string; action?: string };
                  return {
                    handled: true,
                    responseText: typeof splitData.message === 'string' ? splitData.message : 'Split agent error',
                    toolCalled: null,
                    meta:
                      splitData.action === 'preview' && splitData.confirmId
                        ? {
                            confirmation: {
                              required: true,
                              action: 'split',
                              confirmId: splitData.confirmId,
                              confirmLabel: splitData.confirmLabel || 'Confirm split',
                            },
                          }
                        : undefined,
                  };
                },
                createInvoice: async (intentValue: AgentFlowIntent, walletAddress, sessionId) => {
                  const parsed =
                    extractInvoiceRequestFromIntent(intentValue) ?? parseInvoiceRequest(intentValue.raw_message);
                  if (!parsed) {
                    return {
                      handled: true,
                      responseText: [
                        'Could not parse invoice details.',
                        '',
                        'Try: "create invoice for alice.arc 50 USDC for website work"',
                      ].join('\n'),
                      toolCalled: null,
                    };
                  }
                  const invoiceNumber = generateInvoiceNumber();
                  const pendingPayload = {
                    tool: 'create_invoice',
                    walletAddress,
                    vendorHandle: parsed.vendorHandle,
                    amount: parsed.amount,
                    description: parsed.description,
                    invoiceNumber,
                    createdAt: new Date().toISOString(),
                  };
                  await getRedis().set(`invoice:pending:${sessionId}`, JSON.stringify(pendingPayload), 'EX', 900);
                  return {
                    handled: true,
                    responseText: [
                      `Create invoice ${invoiceNumber}?`,
                      '',
                      `To: ${parsed.vendorHandle}`,
                      `Amount: ${parsed.amount} USDC`,
                      `For: ${parsed.description}`,
                      '',
                      'Reply YES to confirm.',
                    ].join('\n'),
                    toolCalled: null,
                    meta: {
                      confirmation: {
                        required: true,
                        action: 'invoice',
                        confirmId: `invoice-${sessionId}`,
                        confirmLabel: `Create Invoice - ${parsed.amount} USDC`,
                      },
                    },
                  };
                },
                getInvoiceStatus: async (walletAddress) => {
                  const authHeader =
                    typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
                  const url = new URL('http://127.0.0.1:4000/api/invoice/status');
                  url.searchParams.set('walletAddress', walletAddress);
                  const response = await fetch(url.toString(), {
                    headers: authHeader ? { Authorization: authHeader } : {},
                  });
                  const data = (await response.json().catch(() => ({}))) as {
                    invoices?: Array<Record<string, unknown>>;
                    error?: string;
                  };
                  if (!response.ok) {
                    return {
                      handled: true,
                      responseText: `Failed to fetch invoices: ${data.error || `HTTP ${response.status}`}`,
                      toolCalled: null,
                    };
                  }
                  const invoices = Array.isArray(data.invoices) ? data.invoices : [];
                  if (!invoices.length) {
                    return {
                      handled: true,
                      responseText: 'No invoices found.',
                      toolCalled: null,
                    };
                  }
                  const lines = ['Invoices:', ''];
                  for (const invoice of invoices.slice(0, 10)) {
                    lines.push(
                      `- ${String(invoice.invoice_number || invoice.id || 'invoice')} | ${String(invoice.status || 'unknown')} | ${String(invoice.amount || '?')} USDC`,
                    );
                  }
                  return { handled: true, responseText: lines.join('\n'), toolCalled: null };
                },
              },
            });

            if (routed.handled) {
              if (routed.toolCalled === 'get_portfolio') {
                const routedMeta = buildBrainMetaFromToolResults([
                  { name: 'agentflow_portfolio', result: routed.responseText },
                ]);
                const paymentMeta = takeRecentExecutionMeta(actionSessionId);
                if (paymentMeta) {
                  routedMeta.paymentMeta = paymentMeta;
                }
                routed.meta = {
                  ...(routed.meta ?? {}),
                  ...routedMeta,
                } as typeof routed.meta;
              }
              if (routed.toolCalled === 'predict_action') {
                const routedMeta = routed.meta ?? {};
                if (validation.intent.intent === AgentFlowIntentName.PredmarketList) {
                  routedMeta.quickActionGroups = buildPredmarketListQuickActionGroups(
                    routed.responseText,
                  );
                } else if (validation.intent.intent === AgentFlowIntentName.PredmarketDetail) {
                  const marketAddress =
                    typeof validation.intent.slots?.market?.address === 'string' &&
                    isAddress(validation.intent.slots.market.address)
                      ? (getAddress(validation.intent.slots.market.address) as `0x${string}`)
                      : null;
                  if (marketAddress) {
                    routedMeta.quickActionGroups = buildPredmarketDetailQuickActionGroups(
                      routed.responseText,
                      marketAddress,
                    );
                  }
                } else if (validation.intent.intent === AgentFlowIntentName.PredmarketPosition) {
                  routedMeta.quickActionGroups = buildPredmarketPositionQuickActionGroups(
                    routed.responseText,
                  );
                }
                routed.meta = routedMeta;
              } else if (routed.toolCalled === 'bridge_precheck') {
                const routedMeta = routed.meta ?? {};
                routedMeta.quickActionGroups = buildBridgeChoiceQuickActionGroups();
                routed.meta = routedMeta;
              } else if (
                routed.toolCalled === 'vault_action' &&
                validation.intent.intent === AgentFlowIntentName.VaultList
              ) {
                const routedMeta = routed.meta ?? {};
                routedMeta.quickActionGroups = buildVaultListQuickActionGroups();
                routed.meta = routedMeta;
              }
              if (routed.responseAlreadyStreamed) {
                await updateBrainEvent(brainEventId, {
                  intent_label: validation.intent.intent,
                  ...buildIntentRouterBrainEventFields(validation.intent, validation.ok),
                });
              } else {
                const routedResult = classifyBrainToolResult(routed.responseText);
                await updateBrainEvent(brainEventId, {
                  intent_label: validation.intent.intent,
                  ...buildIntentRouterBrainEventFields(validation.intent, validation.ok),
                  final_response_summary: routed.responseText,
                  outcome: routedResult.outcome,
                  failure_reason: routedResult.failureReason,
                  total_latency_ms: Date.now() - responseStartedAt,
                });
              }
              console.info('[INTENT_DISPATCH]', {
                raw_message: truncateIntentDispatchMessage(message),
                layer_used: 'intent_router',
                intent: validation.intent.intent,
                validator_severity: validation.severity,
                tool_called: routed.toolCalled,
                confidence: validation.intent.confidence,
                latency_ms: Date.now() - tier2StartedAt,
              });
              if (routed.responseAlreadyStreamed) {
                return true;
              }
              await appendBrainConversationTurn(memorySessionId, message, routed.responseText);
              if (routed.meta) {
                res.write(`data: ${JSON.stringify({ meta: routed.meta })}\n\n`);
              }
              res.write(`data: ${JSON.stringify({ delta: routed.responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return true;
            }
          }

          const postRouterDirectRoute = parseDirectAgentFlowRoute(message, messages);
          if (postRouterDirectRoute?.type === 'reply') {
            const responseText = postRouterDirectRoute.text;
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            await updateBrainEvent(brainEventId, {
              intent_label: validation.intent.intent,
              intent_source: 'fastpath',
              ...buildFastpathBrainEventFields('product_reply'),
              final_response_summary: responseText,
              outcome: 'success',
              total_latency_ms: Date.now() - responseStartedAt,
            });
            brainTelemetryFinalized = true;
            recentBrainEventsBySession.set(memorySessionId, {
              eventId: brainEventId,
              assistantAt: Date.now(),
            });
            if (postRouterDirectRoute.quickActionGroups) {
              res.write(
                `data: ${JSON.stringify({
                  meta: { quickActionGroups: postRouterDirectRoute.quickActionGroups },
                })}\n\n`,
              );
            }
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return true;
          }

          const productReply =
            reserveForReportContext || !shouldOfferPostRouterProductFallback(validation.intent)
              ? null
              : await buildAgentFlowProductReply(capabilityProbe, capabilityThreadCtx);
          if (productReply) {
            await appendBrainConversationTurn(memorySessionId, message, productReply);
            await updateBrainEvent(brainEventId, {
              intent_label: 'product_reply',
              intent_source: 'fastpath',
              ...buildFastpathBrainEventFields('product_reply'),
              final_response_summary: productReply,
              outcome: 'success',
              total_latency_ms: Date.now() - responseStartedAt,
            });
            brainTelemetryFinalized = true;
            recentBrainEventsBySession.set(memorySessionId, {
              eventId: brainEventId,
              assistantAt: Date.now(),
            });
            streamStaticSseReply(res, productReply);
            return true;
          }

          console.info('[INTENT_DISPATCH]', {
            raw_message: truncateIntentDispatchMessage(message),
            layer_used: 'hermes',
            intent: validation.intent.intent,
            validator_severity: validation.severity,
            tool_called: null,
            confidence: validation.intent.confidence,
            latency_ms: Date.now() - tier2StartedAt,
          });
          return false;
        } catch (error) {
          if (
            error instanceof IntentRouterTimeoutError ||
            error instanceof IntentRouterRequestError ||
            error instanceof IntentRouterParseError ||
            error instanceof IntentRouterSchemaError
          ) {
            console.warn('[INTENT_DISPATCH]', {
              raw_message: truncateIntentDispatchMessage(message),
              layer_used: 'hermes',
              intent: null,
              validator_severity: null,
              tool_called: null,
              confidence: null,
              latency_ms: Date.now() - tier2StartedAt,
              error: error.name,
            });
            return false;
          }
          throw error;
        }
      }

      if (await tryHandleIntentRouterLayer()) {
        return;
      }

      const routerResolvedIntent =
        ((routerValidationResult as ValidationResult | null)?.intent as AgentFlowIntent | null | undefined) ?? null;

      if (
        canUseFastPathForIntents(AgentFlowIntentName.ContactsList) &&
        shouldHandleAsContactView(message) &&
        walletCtx.walletAddress
      ) {
        try {
          const w = getAddress(walletCtx.walletAddress);
          const { data: contacts, error } = await adminDb
            .from('contacts')
            .select('*')
            .eq('wallet_address', w)
            .order('name', { ascending: true });
          if (error) {
            const responseText = `Could not load contacts: ${error.message}`;
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            await updateBrainEvent(brainEventId, {
              intent_label: 'deterministic_contact_handler',
              intent_source: 'fastpath',
              ...buildFastpathBrainEventFields('deterministic_contact_handler'),
              final_response_summary: responseText,
              outcome: 'tool_error',
              failure_reason: responseText,
              total_latency_ms: Date.now() - responseStartedAt,
            });
            brainTelemetryFinalized = true;
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          let responseText: string;
          if (!contacts?.length) {
            responseText = [
              'No contacts saved yet.',
              '',
              'Save one:',
              '"save vendor as 0x1234..." or "save alice as alice.arc"',
            ].join('\n');
          } else {
            const lines: string[] = ['Your contacts:\n'];
            for (const c of contacts as Array<Record<string, unknown>>) {
              const name = String(c.name ?? '');
              const addr = String(c.address ?? '');
              const label = c.label != null ? String(c.label) : '';
              const notes = c.notes != null ? String(c.notes) : '';
              lines.push(
                `• ${name}${label ? ` (${label})` : ''}`,
                `  ${addr}`,
                ...(notes ? [`  Note: ${notes}`] : []),
                '',
              );
            }
            responseText = lines.join('\n');
          }
          await updateBrainEvent(brainEventId, {
            intent_label: 'deterministic_contact_handler',
            intent_source: 'fastpath',
            ...buildFastpathBrainEventFields('deterministic_contact_handler'),
            final_response_summary: responseText,
            outcome: 'success',
            failure_reason: null,
            total_latency_ms: Date.now() - responseStartedAt,
          });
          brainTelemetryFinalized = true;
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const responseText = `Contacts error: ${msg}`;
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      if (
        canUseFastPathForIntents(AgentFlowIntentName.ContactsCreate) &&
        shouldHandleAsContactSave(message) &&
        walletCtx.walletAddress
      ) {
        const contactCreateSlots =
          routerResolvedIntent?.intent === AgentFlowIntentName.ContactsCreate &&
          routerResolvedIntent.slots &&
          typeof routerResolvedIntent.slots === 'object'
            ? (routerResolvedIntent.slots as { name?: unknown; recipient?: unknown })
            : null;
        const patterns: RegExp[] = [
          /save\s+(\w+)\s+as\s+(0x[a-fA-F0-9]{40}|[\w.-]+\.arc)/i,
          /add\s+contact\s+(\w+)\s+(0x[a-fA-F0-9]{40}|[\w.-]+\.arc)/i,
          /(\w+)\s+is\s+(0x[a-fA-F0-9]{40}|[\w.-]+\.arc)/i,
        ];
        let contactName =
          typeof contactCreateSlots?.name === 'string' && contactCreateSlots.name.trim()
            ? contactCreateSlots.name.trim().toLowerCase()
            : '';
        let contactAddress = extractRecipientTextFromSlot(contactCreateSlots?.recipient) ?? '';
        for (const pattern of patterns) {
          const match = message.match(pattern);
          if (match) {
            contactName = match[1].toLowerCase();
            contactAddress = match[2].trim();
            break;
          }
        }
        if (!contactName) {
          const nameOnlyMatch = message.match(/^save\s+(\w+)$/i);
          if (nameOnlyMatch) {
            contactName = nameOnlyMatch[1].toLowerCase();
          }
        }
        if (contactName && !contactAddress) {
          const responseText = `What handle or wallet address should I save for ${contactName}?`;
          await storeRouterContinuationState(actionSessionId, {
            intent: AgentFlowIntentName.ContactsCreate,
            rawMessage: message,
            slots: { name: contactName },
            slotsMissing: ['recipient'],
            clarification: responseText,
            createdAt: new Date().toISOString(),
          });
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (contactName && contactAddress) {
          try {
            const w = getAddress(walletCtx.walletAddress);
            let resolved: `0x${string}`;
            try {
              resolved = getAddress(await resolvePayee(contactAddress, w));
            } catch (e: any) {
              const responseText = `Invalid address: ${e instanceof Error ? e.message : String(e)}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            const { error } = await adminDb.from('contacts').insert({
              wallet_address: w,
              name: contactName,
              address: resolved,
            });
            if (error) {
              if (/duplicate|unique/i.test(error.message)) {
                const responseText = `A contact named "${contactName}" already exists. Use Update or delete it first.`;
                await appendBrainConversationTurn(memorySessionId, message, responseText);
                res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
              const responseText = `Failed to save contact: ${error.message}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            const responseText = [
              '✅ Contact saved!',
              '',
              `${contactName} → ${resolved}`,
              '',
              `You can say: "pay ${contactName} 10 USDC"`,
            ].join('\n');
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const responseText = `Save contact failed: ${msg}`;
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        }
      }

      if (
        canUseFastPathForIntents(AgentFlowIntentName.ContactsUpdate) &&
        shouldHandleAsContactUpdate(message) &&
        walletCtx.walletAddress
      ) {
        const contactUpdateSlots =
          routerResolvedIntent?.intent === AgentFlowIntentName.ContactsUpdate &&
          routerResolvedIntent.slots &&
          typeof routerResolvedIntent.slots === 'object'
            ? (routerResolvedIntent.slots as { name?: unknown; recipient?: unknown })
            : null;
        const slotName =
          typeof contactUpdateSlots?.name === 'string' && contactUpdateSlots.name.trim()
            ? contactUpdateSlots.name.trim().toLowerCase()
            : '';
        const slotAddress = extractRecipientTextFromSlot(contactUpdateSlots?.recipient) ?? '';
        const match =
          message.match(/update\s+(\w+)\s+to\s+(0x[a-fA-F0-9]{40}|[\w.-]+\.arc)/i) ||
          message.match(/change\s+(\w+)\s+address\s+to\s+(0x[a-fA-F0-9]{40}|[\w.-]+\.arc)/i);
        const name = slotName || (match ? match[1].toLowerCase() : '');
        const newAddress = slotAddress || (match ? match[2].trim() : '');
        if (name && newAddress) {
          try {
            const w = getAddress(walletCtx.walletAddress);
            const { data: existing } = await adminDb
              .from('contacts')
              .select('address')
              .eq('wallet_address', w)
              .ilike('name', name)
              .maybeSingle();
            if (!existing?.address) {
              const responseText = [
                `Contact "${name}" not found.`,
                'Use "show my contacts" to see saved contacts.',
              ].join('\n');
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            await getRedis().set(
              `contact:update:${canonicalRedisSessionId(actionSessionId)}`,
              JSON.stringify({
                name,
                newAddress,
                oldAddress: String(existing.address),
              }),
              'EX',
              300,
            );
            const responseText = [
              `Update contact "${name}"?`,
              '',
              `From: ${String(existing.address)}`,
              `To: ${newAddress}`,
              '',
              'Reply YES to confirm.',
            ].join('\n');
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const responseText = `Contact update preview failed: ${msg}`;
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        }
      }

      if (
        canUseFastPathForIntents(AgentFlowIntentName.ContactsDelete) &&
        shouldHandleAsContactDelete(message) &&
        walletCtx.walletAddress
      ) {
        const contactDeleteSlots =
          routerResolvedIntent?.intent === AgentFlowIntentName.ContactsDelete &&
          routerResolvedIntent.slots &&
          typeof routerResolvedIntent.slots === 'object'
            ? (routerResolvedIntent.slots as { name?: unknown })
            : null;
        const slotName =
          typeof contactDeleteSlots?.name === 'string' && contactDeleteSlots.name.trim()
            ? contactDeleteSlots.name.trim().toLowerCase()
            : '';
        const match = message.match(/(?:remove|delete)\s+contact\s+(\w+)/i);
        const name = slotName || (match ? match[1].toLowerCase() : '');
        if (name) {
          try {
            const w = getAddress(walletCtx.walletAddress);
            const { data: deletedRows, error } = await adminDb
              .from('contacts')
              .delete()
              .eq('wallet_address', w)
              .ilike('name', name)
              .select('id');
            if (error) {
              const responseText = `Failed to remove contact: ${error.message}`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            if (!deletedRows?.length) {
              const responseText = `No contact named "${name}" found.`;
              await appendBrainConversationTurn(memorySessionId, message, responseText);
              res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            const responseText = `Contact "${name}" removed.`;
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const responseText = `Delete contact failed: ${msg}`;
            await appendBrainConversationTurn(memorySessionId, message, responseText);
            res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        }
      }

      const shouldDeferScheduleFastPathToIntentRouter =
        /\b(?:that|this|it)\s+payment\b/i.test(message) ||
        /^(?:yeah go|go ahead|continue|do it|yeah make that)$/i.test(message.trim());
      const scheduleRoutingMessage =
        routerOverrideMessage && routerContinuationState?.intent === AgentFlowIntentName.ScheduleCreate
          ? routerOverrideMessage
          : message;

      // Schedule intents are now handled by the dedicated schedule agent on port 3018,
      // but referential follow-ups need the newer intent router because they depend on
      // current-session context rather than message-only parsing.
      if (
        canUseFastPathForIntents(
          AgentFlowIntentName.ScheduleCreate,
          AgentFlowIntentName.ScheduleCancel,
          AgentFlowIntentName.ScheduleList,
        ) &&
        shouldHandleAsScheduleRequest(scheduleRoutingMessage) &&
        walletCtx.walletAddress &&
        !shouldDeferScheduleFastPathToIntentRouter
      ) {
        const scheduleRecipient = parseContinuationRecipient(scheduleRoutingMessage);
        const scheduleAmount = parseContinuationAmount(scheduleRoutingMessage);
        const scheduleCadence = parseContinuationCadence(scheduleRoutingMessage);
        if (scheduleRecipient && scheduleAmount && !scheduleCadence) {
          const responseText = 'How often should I send it?';
          await storeRouterContinuationState(actionSessionId, {
            intent: AgentFlowIntentName.ScheduleCreate,
            rawMessage: scheduleRoutingMessage,
            slots: {
              recipient: scheduleRecipient,
              amount: { value: scheduleAmount.value, currency: scheduleAmount.currency },
            },
            slotsMissing: ['schedule.cadence'],
            clarification: responseText,
            createdAt: new Date().toISOString(),
          });
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
        try {
          const scheduleAgentRes = await fetch(`${SCHEDULE_AGENT_BASE_URL}/run`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
            },
            body: JSON.stringify({ task: scheduleRoutingMessage, walletAddress: walletCtx.walletAddress }),
          });
          const scheduleData = await scheduleAgentRes.json().catch(() => ({ action: 'error', message: 'Schedule agent error' })) as {
            action?: string;
            message?: string;
            confirmId?: string;
            confirmLabel?: string;
            choices?: Array<{ id: string; label: string; confirmId: string }>;
          };
          const responseText = typeof scheduleData.message === 'string' ? scheduleData.message : 'Schedule agent error';
          await clearRouterContinuationState(actionSessionId);
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          await updateBrainEvent(brainEventId, {
            intent_label: 'deterministic_schedule_agent',
            intent_source: 'fastpath',
            ...buildFastpathBrainEventFields('deterministic_schedule_agent'),
            final_response_summary: responseText,
            outcome: scheduleAgentRes.ok ? 'success' : 'tool_error',
            failure_reason: scheduleAgentRes.ok ? null : responseText,
            total_latency_ms: Date.now() - responseStartedAt,
          });
          brainTelemetryFinalized = true;
          if (scheduleData.confirmId || scheduleData.choices?.length) {
            res.write(`data: ${JSON.stringify({ meta: { confirmation: { required: true, action: 'schedule', confirmId: scheduleData.confirmId, confirmLabel: scheduleData.confirmLabel || 'Confirm', choices: scheduleData.choices } } })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (scheduleErr) {
          const msg = scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr);
          const responseText = `Schedule agent unavailable: ${msg}`;
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          await updateBrainEvent(brainEventId, {
            intent_label: 'deterministic_schedule_agent',
            intent_source: 'fastpath',
            ...buildFastpathBrainEventFields('deterministic_schedule_agent'),
            final_response_summary: responseText,
            outcome: 'tool_error',
            failure_reason: responseText,
            total_latency_ms: Date.now() - responseStartedAt,
          });
          brainTelemetryFinalized = true;
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      // Batch/payroll payment intents — dedicated agent on port 3020. Text-only fast-path.
      if (
        walletCtx.walletAddress &&
        (routerResolvedIntent?.intent === AgentFlowIntentName.BatchExecute ||
          shouldHandleAsBatchPayment(message)) &&
        routerResolvedIntent?.intent !== AgentFlowIntentName.SplitExecute
      ) {
        const parsedBatch =
          extractBatchPaymentsFromIntent(routerResolvedIntent, message) ?? parseBatchMessage(message);
        if ('error' in parsedBatch) {
          const responseText =
            `I see you want to run a batch payment, but I could not parse the recipients.\n` +
            formatBatchParseError(parsedBatch.error);
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
        try {
          const batchAgentRes = await fetch(`${BATCH_AGENT_BASE_URL}/run`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
            },
            body: JSON.stringify({
              sessionId: actionSessionId,
              walletAddress: walletCtx.walletAddress,
              payments: parsedBatch,
            }),
          });

          const batchData = (await batchAgentRes.json().catch(() => ({
            action: 'error',
            message: 'Batch agent error',
          }))) as {
            action?: string;
            message?: string;
            confirmId?: string;
            confirmLabel?: string;
          };

          let responseText =
            typeof batchData.message === 'string' ? batchData.message : 'Batch agent error';
          if (batchData.action === 'preview' && hasPortfolioFollowupIntent(message)) {
            responseText = `${responseText}\n\n${portfolioA2aPostActionNote('batch agent')}`;
            await storeRequestedPortfolioA2a(batchData.confirmId || actionSessionId, {
              buyerAgentSlug: 'batch',
              trigger: 'post_batch_requested_report',
            });
          }
          await appendBrainConversationTurn(memorySessionId, message, responseText);

          if (batchData.action === 'preview' && batchData.confirmId) {
            res.write(
              `data: ${JSON.stringify({
                meta: {
                  confirmation: {
                    required: true,
                    action: 'batch',
                    confirmId: batchData.confirmId,
                    confirmLabel: batchData.confirmLabel || 'Send batch',
                  },
                },
              })}\n\n`,
            );
          }

          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (batchErr) {
          const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
          const responseText = `Batch agent unavailable: ${msg}`;
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      // Split-payment intents are handled by the dedicated split agent on port 3019.
      // Bypass Hermes entirely to prevent hallucinated previews / fake tx hashes.
      if (
        walletCtx.walletAddress &&
        (routerResolvedIntent?.intent === AgentFlowIntentName.SplitExecute ||
          shouldHandleAsSplitRequest(message)) &&
        routerResolvedIntent?.intent !== AgentFlowIntentName.BatchExecute
      ) {
        const parsed =
          extractSplitRequestFromIntent(routerResolvedIntent, message) ?? parseSplitRequest(message);
        if (!parsed) {
          const responseText =
            'I see you want to split a payment, but I could not extract the amount and recipients. ' +
            'Try: "split 30 USDC between alice.arc, bob.arc and charlie.arc".';
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
        try {
          const splitAgentRes = await fetch(`${SPLIT_AGENT_BASE_URL}/run`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(internalKey ? { 'X-Agentflow-Brain-Internal': internalKey } : {}),
            },
            body: JSON.stringify({
              sessionId: actionSessionId,
              walletAddress: walletCtx.walletAddress,
              recipients: parsed.recipients,
              totalAmount: parsed.totalAmount,
              remark: parsed.remark || '',
            }),
          });

          const splitData = (await splitAgentRes.json().catch(() => ({
            action: 'error',
            message: 'Split agent error',
          }))) as {
            action?: string;
            message?: string;
            confirmId?: string;
            confirmLabel?: string;
          };

          let responseText =
            typeof splitData.message === 'string' ? splitData.message : 'Split agent error';
          if (splitData.action === 'preview' && hasPortfolioFollowupIntent(message)) {
            responseText = `${responseText}\n\n${portfolioA2aPostActionNote('split agent')}`;
            await storeRequestedPortfolioA2a(splitData.confirmId || actionSessionId, {
              buyerAgentSlug: 'split',
              trigger: 'post_split_requested_report',
            });
          }
          await appendBrainConversationTurn(memorySessionId, message, responseText);

          if (splitData.action === 'preview' && splitData.confirmId) {
            res.write(
              `data: ${JSON.stringify({
                meta: {
                  confirmation: {
                    required: true,
                    action: 'split',
                    confirmId: splitData.confirmId,
                    confirmLabel: splitData.confirmLabel || 'Confirm split',
                  },
                },
              })}\n\n`,
            );
          }

          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (splitErr) {
          const msg = splitErr instanceof Error ? splitErr.message : String(splitErr);
          const responseText = `Split agent unavailable: ${msg}`;
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      // Payment-link fast-path — pure URL construction, no money moves, no
      // confirmation needed. Emits a `meta.paymentLink` event so the frontend
      // can render a QR code + Copy/Share buttons.
      if (
        canUseFastPathForIntents(AgentFlowIntentName.AgentpayPaymentLink) &&
        shouldHandleAsPaymentLinkRequest(message)
      ) {
        const parsed =
          extractPaymentLinkRequestFromIntent(routerResolvedIntent) ?? parsePaymentLinkRequest(message);
        if (!parsed) {
          const responseText = [
            'I can build a payment link, but I need a recipient.',
            '',
            'Try: "payment link for jack.arc 5 USDC for coffee"',
            '  or: "qr code for 0x…address 10 USDC".',
          ].join('\n');
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        if (!parsed.amount) {
          const responseText = 'How much USDC should the payment link request?';
          await storeRouterContinuationState(actionSessionId, {
            intent: AgentFlowIntentName.AgentpayPaymentLink,
            rawMessage: message,
            slots: {
              recipient: parsed.handle.startsWith('0x')
                ? { address: parsed.handle }
                : { handle: `${parsed.handle}.arc` },
              ...(parsed.remark ? { remark: parsed.remark } : {}),
            },
            slotsMissing: ['amount.value'],
            clarification: responseText,
            createdAt: new Date().toISOString(),
          });
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // Build the relative path+query. The frontend prepends
        // `window.location.origin` so the link always matches the current host
        // (localhost in dev, production domain in prod).
        const params = new URLSearchParams();
        if (parsed.amount) params.set('amount', parsed.amount);
        if (parsed.remark) params.set('remark', parsed.remark);
        const query = params.toString();
        const path = `/pay/${encodeURIComponent(parsed.handle)}${query ? `?${query}` : ''}`;

        const displayHandle = parsed.handle.startsWith('0x')
          ? `${parsed.handle.slice(0, 6)}…${parsed.handle.slice(-4)}`
          : `${parsed.handle}.arc`;

        const lines = [`Here's your payment link for **${displayHandle}**.`];
        if (parsed.amount) lines.push(`Pre-filled amount: **${parsed.amount} USDC**.`);
        if (parsed.remark) lines.push(`Remark: _${parsed.remark}_.`);
        lines.push('');
        lines.push(
          'Anyone can open it — AgentFlow users pay automatically from their DCW, ' +
            'others can connect any wallet on Arc Testnet. Scan the QR or tap Copy / Share below.',
        );
        const responseText = lines.join('\n');
        await appendBrainConversationTurn(memorySessionId, message, responseText);

        res.write(
          `data: ${JSON.stringify({
            meta: {
              paymentLink: {
                handle: parsed.handle,
                displayHandle,
                amount: parsed.amount || null,
                remark: parsed.remark || null,
                path,
              },
            },
          })}\n\n`,
        );
        res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // Invoice creation fast-path — bypass Hermes entirely, no LLM call.
      if (
        canUseFastPathForIntents(AgentFlowIntentName.InvoiceCreate) &&
        shouldHandleAsInvoiceRequest(message) &&
        walletCtx.walletAddress
      ) {
        const parsed =
          extractInvoiceRequestFromIntent(routerResolvedIntent) ?? parseInvoiceRequest(message);
        if (!parsed) {
          const responseText = [
            'Could not parse invoice details.',
            '',
            'Try: "create invoice for alice.arc 50 USDC for website work"',
          ].join('\n');
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const invoiceNumber = generateInvoiceNumber();
        const pendingPayload = {
          tool: 'create_invoice',
          walletAddress: walletCtx.walletAddress,
          vendorHandle: parsed.vendorHandle,
          amount: parsed.amount,
          description: parsed.description,
          invoiceNumber,
        };
        await getRedis().set(
          `invoice:pending:${actionSessionId}`,
          JSON.stringify(pendingPayload),
          'EX',
          300,
        );

        const preview = [
          'Invoice Preview',
          '',
          `To: ${parsed.vendorHandle}`,
          `Amount: ${parsed.amount} USDC`,
          `For: ${parsed.description}`,
          `Invoice #: ${invoiceNumber}`,
          '',
          'On confirm:',
          `  Invoice saved to your records`,
          `  Payment request sent to ${parsed.vendorHandle}`,
          `  They get a Telegram notification if linked`,
        ].join('\n');
        const responseText = hasResearchFollowupIntent(message)
          ? `${preview}\n\n${researchA2aPostActionNote('invoice agent')}`
          : preview;
        if (hasResearchFollowupIntent(message)) {
          await storeRequestedInvoiceResearchA2a(actionSessionId);
        }

        await appendBrainConversationTurn(memorySessionId, message, responseText);

        res.write(
          `data: ${JSON.stringify({
            meta: {
              confirmation: {
                required: true,
                action: 'invoice',
                confirmId: `invoice-${actionSessionId}`,
                confirmLabel: `Create Invoice \u2013 ${parsed.amount} USDC`,
              },
            },
          })}\n\n`,
        );
        res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // Invoice status fast-path — bypass Hermes to avoid hallucination.
      if (
        canUseFastPathForIntents(AgentFlowIntentName.InvoiceStatus) &&
        shouldHandleAsInvoiceStatus(message) &&
        walletAddress
      ) {
        try {
          const { data: invoices } = await adminDb
            .from('invoices')
            .select('invoice_number, vendor_name, amount, status, arc_tx_id, created_at')
            .eq('business_wallet', walletAddress)
            .order('created_at', { ascending: false })
            .limit(10);

          let responseText: string;
          if (!invoices?.length) {
            responseText = [
              'No invoices found.',
              '',
              'Create one via chat:',
              '"create invoice for alice.arc 50 USDC for design work"',
            ].join('\n');
          } else {
            const lines: string[] = ['📄 Your Invoices:\n'];
            for (const inv of invoices) {
              const statusEmoji = inv.status === 'paid' ? '✅' : '⏳';
              lines.push(
                `${statusEmoji} ${inv.invoice_number}`,
                `   To: ${inv.vendor_name}`,
                `   Amount: ${inv.amount} USDC`,
                `   Status: ${inv.status}`,
                ...(inv.arc_tx_id ? [`   Tx: ${String(inv.arc_tx_id).slice(0, 10)}...`] : []),
                '',
              );
            }
            responseText = lines.join('\n');
          }

          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (e) {
          const errText = `Failed to fetch invoices: ${e instanceof Error ? e.message : 'unknown'}`;
          res.write(`data: ${JSON.stringify({ delta: errText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      // Research fast-path — Hermes 405B sometimes ignores agentflow_research
      // and answers research/report queries from training-data alone, producing
      // generic boilerplate with fake "explorer links" and zero real citations.
      // For any explicit research/report/news request we bypass Hermes and call
      // the same /run pipeline (research → analyst → writer) the tool would use.
      // Internal counterparty risk fast-path. Uses AgentFlow contacts, invoices,
      // payment requests, transactions, and reputation cache only; no web search.
      const capabilityRouting = analyzeCapabilityAwareRouting(message);
      if (
        shouldHandleCounterpartyRiskRequest(message) &&
        capabilityRouting.counterpartyRisk.routeToFeature &&
        walletCtx.walletAddress
      ) {
        const parsed = parseCounterpartyRiskRequest(message);
        if (!parsed) {
          const responseText = 'I can check internal AgentFlow counterparty risk, but I need a contact name, .arc handle, or wallet address.';
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        try {
          const assessment = await assessCounterpartyRisk({
            counterparty: parsed.counterparty,
            ownerWalletAddress: walletCtx.walletAddress,
            amountUsdc: parsed.amountUsdc,
            purpose: parsed.purpose,
          });
          const responseText = formatCounterpartyRiskReport(assessment);
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (riskErr) {
          const responseText = `Counterparty risk check failed: ${riskErr instanceof Error ? riskErr.message : String(riskErr)}`;
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      const previousReport = findLatestStoredResearchReport(historyForBrain);
      console.log('[report-context] previousReport:', Boolean(previousReport));
      console.log(
        '[report-context] shouldUse:',
        shouldUseReportContextTurn(message, previousReport),
      );

      if (isReportRenderingComplaint(message)) {
        if (previousReport) {
          const responseText = `Re-rendering the latest full research report.\n\n---\n\n${previousReport}`;
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(
            `data: ${JSON.stringify({
              meta: {
                reportMeta: {
                  kind: 'research',
                  diagnostics: ['Recovered the most recent completed research report from session history.'],
                },
              },
            })}\n\n`,
          );
          res.write(
            `data: ${JSON.stringify({
              type: 'report',
              markdown: previousReport,
              research: null,
              analysis: null,
              liveData: null,
            })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      if (shouldUseReportContextTurn(message, previousReport)) {
        console.log('[report-context] handling post-report follow-up');
        const reportTurnKind = classifyReportContextTurn(message);
        let responseText: string;
        if (reportTurnKind === 'ack') {
          responseText = buildReportAcknowledgementReply();
        } else if (reportTurnKind === 'source_lookup') {
          responseText =
            buildMatchedReportSourceReply(previousReport!, message) ??
            buildReportSourceLookupReply(previousReport!);
        } else {
          const matchedExplanation = buildMatchedReportExplanationReply(message);
          if (matchedExplanation) {
            responseText = matchedExplanation;
          } else {
          const explanationClarifier = buildReportExplanationClarifier(previousReport!);
          if (explanationClarifier && /\b(?:that|this|it|these|those)\b/i.test(message)) {
            responseText = explanationClarifier;
          } else {
            const reportFollowupInput = buildReportFollowupModelInput(previousReport!, message);
            responseText = await withTimeout(
              callHermesFast(REPORT_FOLLOWUP_SYSTEM_PROMPT, reportFollowupInput),
              20000,
              'Report follow-up timed out after 20s',
            );
          }
          }
        }
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        res.write(
          `data: ${JSON.stringify({
            meta: {
              reportMeta: {
                kind: 'research_followup',
                diagnostics: ['Answered from the latest completed research report in session history.'],
              },
            },
          })}\n\n`,
        );
        for (const chunk of responseText.match(/[\s\S]{1,120}/g) ?? [responseText]) {
          res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // Referential routing ("is that my portfolio?", "yeah run it") must resolve
      // against the visible thread only. Falling back to merged/persisted history
      // let an old report from another thread drive a "report above" reply or a
      // fresh paid portfolio check. The client always sends the visible thread; when
      // it is empty there is no antecedent, so we pass an empty history rather than
      // persisted memory.
      const directRouteHistory = messages as BrainConversationMessage[];
      const preResearchDirectRoute = parseDirectAgentFlowRoute(message, directRouteHistory);

      if (
        shouldHandleAsResearchRequest(message, historyForBrain) &&
        walletCtx.walletAddress &&
        !preResearchDirectRoute
      ) {
        await executeBrainResearchPipelineForChat({
          res,
          memorySessionId,
          persistUserTurn: message,
          researchTask: message,
          originalUserMessage: message,
          portfolioImpact: detectPortfolioImpactIntent(message),
          walletAddress: walletCtx.walletAddress,
          brainEventId,
          redisActionScopeKey: memorySessionId,
        });
        return;
      }

      const capabilityRoutingForChat = analyzeCapabilityAwareRouting(message);
      if (
        !capabilityRoutingForChat.bridge.routeToResearch &&
        !capabilityRoutingForChat.vault.routeToResearch &&
        !capabilityRoutingForChat.swap.routeToResearch &&
        !capabilityRoutingForChat.predmarket.routeToResearch &&
        !capabilityRoutingForChat.counterpartyRisk.routeToResearch &&
        !isVaultPositionIntent(capabilityProbe) &&
        shouldHandleAsAgentFlowCapabilityQuestion(capabilityProbe, capabilityThreadCtx)
      ) {
        logFastPathDebug({
          kind: 'capability_sse',
          branch: 'capability_faq',
          messageCount: capabilityThreadCtx.messageCount,
        });
        const responseText = formatAgentFlowCapabilityReply(capabilityProbe);
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      try {
        const pending = await loadPendingAction(actionSessionId);
        if (pending && isPendingActionFollowup(message)) {
          const responseText = formatPendingActionFollowup(pending);
          await appendBrainConversationTurn(memorySessionId, message, responseText);
          res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      } catch (error) {
        console.warn('[chat/respond] pending follow-up check failed:', getErrorMessage(error));
      }

      if (
        lowerMsg.includes('bridge') &&
        ((lowerMsg.includes('manual') || lowerMsg.includes('manually')) ||
          lowerMsg.includes('eoa') ||
          lowerMsg.includes('funding'))
      ) {
        const responseText = formatBridgeExecutionReply();
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const lowConfidenceClarification = maybeLowConfidenceClarify(message);
      if (lowConfidenceClarification) {
        console.warn('[LOW_CONFIDENCE_CLARIFY]', {
          session_id: actionSessionId,
          reason: 'swap_missing_source_token',
        });
        await appendBrainConversationTurn(memorySessionId, message, lowConfidenceClarification);
        await updateBrainEvent(brainEventId, {
          intent_label: 'swap',
          intent_source: 'unclear',
          final_response_summary: lowConfidenceClarification,
          outcome: 'low_confidence_clarify',
          failure_reason: 'swap_missing_source_token',
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        res.write(`data: ${JSON.stringify({ delta: lowConfidenceClarification })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const directRoute = preResearchDirectRoute;
      if (directRoute) {
        let responseText = '';
        let meta:
          | ReturnType<typeof buildBrainMetaFromToolResults>
          | undefined;

        if (directRoute.type === 'reply') {
          responseText = directRoute.text;
          if (directRoute.quickActionGroups?.length) {
            meta = { quickActionGroups: directRoute.quickActionGroups };
          }
        } else {
          if (
            directRoute.tool === 'get_portfolio' &&
            walletCtx.walletAddress?.trim()
          ) {
            responseText = await executePortfolioAgentForChat({
              userWalletAddress: walletCtx.walletAddress,
              sessionId: actionSessionId,
              fallback: () =>
                executeTool(
                  directRoute.tool,
                  directRoute.args,
                  walletCtx,
                  actionSessionId,
                  { rawUserMessage: message },
                ),
            });
            meta = buildBrainMetaFromToolResults([
              { name: 'agentflow_portfolio', result: responseText },
            ]);
            const paymentMeta = takeRecentExecutionMeta(actionSessionId);
            if (paymentMeta) {
              meta.paymentMeta = paymentMeta;
            }
          } else {
            responseText = await executeTool(
              directRoute.tool,
              directRoute.args,
              walletCtx,
              actionSessionId,
              { rawUserMessage: message },
            );
            if (directRoute.postActionNote && /Reply YES to execute or NO to cancel\./i.test(responseText)) {
              responseText = `${responseText}\n\n${directRoute.postActionNote}`;
              if (directRoute.tool === 'swap_tokens') {
                await storeRequestedPortfolioA2a(actionSessionId, {
                  buyerAgentSlug: 'swap',
                  trigger: 'post_swap_requested_report',
                });
              } else if (directRoute.tool === 'vault_action') {
                await storeRequestedPortfolioA2a(actionSessionId, {
                  buyerAgentSlug: 'vault',
                  trigger: 'post_vault_requested_report',
                });
              }
            }
        meta = buildBrainMetaFromToolResults([
          { name: directRoute.tool, result: responseText },
        ]);
        if (directRoute.quickActionGroups?.length) {
          meta.quickActionGroups = directRoute.quickActionGroups;
        }
        if (
          directRoute.tool === 'predict_action' &&
          directRoute.args.action === 'list'
        ) {
          meta.quickActionGroups = buildPredmarketListQuickActionGroups(responseText);
        } else if (
          directRoute.tool === 'predict_action' &&
          directRoute.args.action === 'detail'
        ) {
              const marketAddress =
                typeof directRoute.args.marketAddress === 'string' && isAddress(directRoute.args.marketAddress)
                  ? (getAddress(directRoute.args.marketAddress) as `0x${string}`)
                  : null;
              if (marketAddress) {
            meta.quickActionGroups = buildPredmarketDetailQuickActionGroups(
              responseText,
              marketAddress,
            );
          }
        } else if (
          directRoute.tool === 'predict_action' &&
          directRoute.args.action === 'position'
        ) {
          meta.quickActionGroups = buildPredmarketPositionQuickActionGroups(responseText);
        }
      }
        }

        if (
          directRoute.type === 'tool' &&
          directRoute.tool === 'predict_action' &&
          meta
        ) {
        if (directRoute.args.action === 'list') {
          meta.quickActionGroups = buildPredmarketListQuickActionGroups(responseText);
        } else if (directRoute.args.action === 'detail') {
            const marketAddress =
              typeof directRoute.args.marketAddress === 'string' && isAddress(directRoute.args.marketAddress)
                ? (getAddress(directRoute.args.marketAddress) as `0x${string}`)
                : null;
            if (marketAddress) {
            meta.quickActionGroups = buildPredmarketDetailQuickActionGroups(
              responseText,
              marketAddress,
            );
          }
        } else if (directRoute.args.action === 'position') {
          meta.quickActionGroups = buildPredmarketPositionQuickActionGroups(responseText);
        }
      }

        if (directRoute.type === 'tool') {
          if (directRoute.tool === 'get_portfolio' && meta) {
            const predmarketGroups = buildPredmarketPositionQuickActionGroups(responseText);
            if (predmarketGroups.length) {
              meta.quickActionGroups = [
                ...(meta.quickActionGroups ?? []),
                ...predmarketGroups,
              ];
            }
          }

          const previewPending =
            directRoute.tool === 'swap_tokens' ||
            directRoute.tool === 'vault_action' ||
            directRoute.tool === 'predict_action'
              ? await loadPendingAction(actionSessionId)
              : null;
          const previewProvider =
            (previewPending?.tool === 'swap_tokens' ||
              previewPending?.tool === 'vault_action' ||
              previewPending?.tool === 'predict_action') &&
            previewPending.payload &&
            typeof previewPending.payload === 'object' &&
            typeof (previewPending.payload as { provider?: unknown }).provider === 'string'
              ? (previewPending.payload as { provider: string }).provider
              : null;
          const toolResult = classifyBrainToolResult(responseText);
          await appendBrainToolTelemetry(brainEventId, brainToolsTelemetry, {
            name: directRoute.tool,
            provider:
              directRoute.tool === 'swap_tokens' ||
              directRoute.tool === 'vault_action' ||
              directRoute.tool === 'predict_action'
                ? previewProvider
                : null,
            params_summary: summarizeToolParams(directRoute.args),
            result_summary: summarizeTelemetryValue(responseText),
            latency_ms: null,
            success: toolResult.success,
          });
        }
        const directRouteResult =
          directRoute.type === 'tool'
            ? classifyBrainToolResult(responseText)
            : { outcome: 'success' as const, failureReason: null };
        await updateBrainEvent(brainEventId, {
          intent_label: directRoute.type === 'tool' ? directRoute.tool : 'direct_reply',
          intent_source: 'fastpath',
          ...buildFastpathBrainEventFields(
            directRoute.type === 'tool' ? directRoute.tool : 'direct_reply',
          ),
          final_response_summary: responseText,
          outcome: directRouteResult.outcome,
          failure_reason: directRouteResult.failureReason,
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
        recentBrainEventsBySession.set(memorySessionId, {
          eventId: brainEventId,
          assistantAt: Date.now(),
        });
        await appendBrainConversationTurn(memorySessionId, message, responseText);
        if (meta) {
          res.write(`data: ${JSON.stringify({ meta })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ delta: responseText })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      let pendingBefore: string | null = null;
      let agentPayPendingBefore = false;
      let agentPayPendingAfter = false;
      try {
        const pending = await loadPendingAction(actionSessionId);
        pendingBefore = pending ? JSON.stringify(pending) : null;
        agentPayPendingBefore = await redisPendingExists(
          (key) => getRedis().get(key),
          'agentpay:pending:',
          actionSessionId,
        );
      } catch (error) {
        console.warn('[chat/respond] pending preflight failed:', getErrorMessage(error));
      }

      const brainMessage = buildBrainInputMessage(message);
      let fullResponse = '';
      let guardedOutcome: BrainEventOutcome | null = null;

      let chatSseHermesChunkWritten = false;
      let chatSseHermesAnyWriteCounted = false;
      const writeHermesSsePayload = (payload: Record<string, unknown>) => {
        if (isAgentflowChatSseDebug() && !chatSseHermesAnyWriteCounted) {
          chatSseHermesAnyWriteCounted = true;
          logChatSseDebug({ chat_stream_first_event_written: true, keys: Object.keys(payload) });
        }
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      if (isAgentflowChatSseDebug()) {
        logChatSseDebug({
          chat_stream_backend_received: true,
          messagePreview: message.slice(0, 100),
          memorySessionId: memorySessionId.slice(0, 120),
          actionSessionId: actionSessionId.slice(0, 120),
          hasWallet: Boolean(walletCtx.walletAddress),
          brainHistoryTurns: historyForBrain.length,
          route: 'hermes_runAgentBrain',
        });
      }
      logChatSseDebug({ chat_stream_hermes_call_start: true });

      try {
        // Run agent brain (Hermes)
        for await (const chunk of runAgentBrain(
          brainMessage,
          historyForBrain,
          walletCtx,
          actionSessionId,
        )) {
          if (chunk.type === 'meta') {
            writeHermesSsePayload({ meta: chunk.meta });
            continue;
          }
          if (chunk.type === 'guard') {
            if (chunk.guard === 'stale_state_blocked' && chunk.requiredTool) {
              const pendingForGuard = await loadPendingAction(actionSessionId).catch(() => null);
              const shouldGroundState = userExplicitlyRequestedLiveState(message);
              let guardText: string;
              let guardMeta: BrainMessageMeta | undefined;

              if (pendingForGuard && !shouldGroundState) {
                guardText = formatPendingActionFollowup(pendingForGuard);
              } else if (shouldGroundState) {
                const toolName = chunk.requiredTool === 'get_portfolio' ? 'get_portfolio' : 'get_balance';
                const groundedResult = await executeTool(toolName, {}, walletCtx, actionSessionId);
                const groundedToolResult = classifyBrainToolResult(groundedResult);
                await appendBrainToolTelemetry(brainEventId, brainToolsTelemetry, {
                  name: toolName,
                  provider: null,
                  params_summary: '{}',
                  result_summary: summarizeTelemetryValue(groundedResult),
                  latency_ms: null,
                  success: groundedToolResult.success,
                });
                guardText = `\n\nI refreshed the live state for this turn:\n${groundedResult}`;
                guardMeta = buildBrainMetaFromToolResults([{ name: toolName, result: groundedResult }]);
              } else {
                guardText =
                  "I can't verify live balances or market state from that reply alone. Ask me to refresh your balances or portfolio, and I will continue from the live result.";
              }

              await updateBrainEvent(brainEventId, {
                outcome: 'stale_state_blocked',
                failure_reason: chunk.assertedState
                  ? `${chunk.reason} Asserted text: ${chunk.assertedState}`
                  : chunk.reason,
                total_latency_ms: Date.now() - responseStartedAt,
              });
              brainTelemetryFinalized = true;
              guardedOutcome = 'stale_state_blocked';
              fullResponse += guardText;
              chatSseHermesChunkWritten = true;
              if (guardMeta) {
                writeHermesSsePayload({ meta: guardMeta });
              }
              writeHermesSsePayload({ delta: guardText });
              continue;
            }
            if (chunk.guard === 'turn_cap_hit') {
              const capText =
                fullResponse.trim() ||
                "I hit my tool-call limit for that turn, so I'm stopping here with the work completed so far.";
              if (!fullResponse.trim()) {
                fullResponse = capText;
                chatSseHermesChunkWritten = true;
                writeHermesSsePayload({ delta: capText });
              }
              await updateBrainEvent(brainEventId, {
                outcome: 'turn_cap_hit',
                failure_reason: chunk.toolsStarted?.length
                  ? `${chunk.reason}. tools_called=[${chunk.toolsStarted.join(', ')}]`
                  : chunk.reason,
                total_latency_ms: Date.now() - responseStartedAt,
              });
              brainTelemetryFinalized = true;
              guardedOutcome = 'turn_cap_hit';
              continue;
            }
            if (chunk.guard === 'unexpected_tool_blocked') {
              const blockedText =
                fullResponse.trim() ||
                'AgentFlow could not complete that response safely. Please retry or rephrase your request.';
              if (!fullResponse.trim()) {
                fullResponse = blockedText;
                chatSseHermesChunkWritten = true;
                writeHermesSsePayload({ delta: blockedText });
              }
              await updateBrainEvent(brainEventId, {
                outcome: 'unexpected_tool_blocked',
                failure_reason: chunk.toolsStarted?.length
                  ? `${chunk.reason}. tools_called=[${chunk.toolsStarted.join(', ')}]`
                  : chunk.reason,
                total_latency_ms: Date.now() - responseStartedAt,
              });
              brainTelemetryFinalized = true;
              guardedOutcome = 'unexpected_tool_blocked';
              continue;
            }
            continue;
          }
          fullResponse += chunk.delta;
          chatSseHermesChunkWritten = true;
          writeHermesSsePayload({ delta: chunk.delta });
        }
      } catch (brainStreamErr: unknown) {
        logChatSseDebug({
          chat_stream_hermes_error: getErrorMessage(brainStreamErr),
        });
        throw brainStreamErr;
      }

      if (!chatSseHermesChunkWritten) {
        logChatSseDebug({
          chat_stream_closed_without_reply: true,
          fullResponseChars: fullResponse.length,
          hadMetaChunksOnly: chatSseHermesAnyWriteCounted,
        });
        const fallback = CHAT_SSE_EMPTY_REPLY_FALLBACK;
        fullResponse = fallback;
        writeHermesSsePayload({ delta: fallback });
      }

      try {
        const pending = await loadPendingAction(actionSessionId);
        const pendingAfter = pending ? JSON.stringify(pending) : null;
        if (pending && pendingAfter !== pendingBefore) {
          if (typeof pending.tool === 'string' && pending.tool) {
            res.write(
              `data: ${JSON.stringify({ meta: buildBrainConfirmationMeta(pending.tool) })}\n\n`,
            );
          }
        }
        agentPayPendingAfter = await redisPendingExists(
          (key) => getRedis().get(key),
          'agentpay:pending:',
          actionSessionId,
        );
        // Detect payment preview: any response with both To: <address> and Amount: X USDC
        const toMatch = fullResponse.match(
          /[-–•*]\s*To:\s*(0x[a-fA-F0-9]{40}|[\w.]+\.arc|[a-z0-9][a-z0-9_-]{0,63})/i,
        );
        const amountMatch = fullResponse.match(/[-–•*]\s*Amount:\s*([\d.]+)\s*USDC/i);
        const responseHasPayConfirm = Boolean(toMatch) && Boolean(amountMatch);
        // AI generated payment preview without calling the tool — create the pending entry
        if (responseHasPayConfirm && !agentPayPendingAfter && toMatch && amountMatch && walletCtx?.walletAddress) {
          // Extract remark from original user message: "pay <addr> <amount> USDC for <remark>"
          const remarkMatch = message.match(/\bfor\s+(.+)$/i);
          const remark = remarkMatch ? remarkMatch[1].trim() : '';
          try {
            const rawTo = toMatch[1];
            let resolvedAddress: string | null = null;
            if (rawTo.startsWith('0x')) {
              resolvedAddress = getAddress(rawTo as `0x${string}`);
            } else {
              resolvedAddress = await resolvePayee(rawTo, getAddress(walletCtx.walletAddress));
            }
            await fetch(`http://localhost:4000/api/pay/brain/preview`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: actionSessionId,
                walletAddress: walletCtx.walletAddress,
                to: rawTo,
                resolvedAddress,
                amount: amountMatch[1],
                remark,
              }),
            });
            console.log(
              `[chat/respond] auto-created agentpay pending for session ${actionSessionId}`,
            );
          } catch (e) {
            console.warn('[chat/respond] auto-preview failed:', getErrorMessage(e));
          }
        }
        if (
          (agentPayPendingAfter && agentPayPendingAfter !== agentPayPendingBefore) ||
          (responseHasPayConfirm && !agentPayPendingBefore)
        ) {
          res.write(
            `data: ${JSON.stringify({ meta: buildBrainConfirmationMeta('agentpay_send') })}\n\n`,
          );
        }

        // Split payment postflight: if Hermes called agentpay_split, the split agent stored
        // split:pending:{sessionId} in Redis. Detect it here and inject confirmation meta.
        const splitPendingRaw = await getRedis()
          .get(`split:pending:${actionSessionId}`)
          .catch(() => null);
        if (splitPendingRaw) {
          let confirmLabel = 'Confirm split';
          try {
            const sp = JSON.parse(splitPendingRaw) as { perPerson?: string; recipients?: Array<{ name: string }> };
            if (sp.recipients?.length && sp.perPerson) {
              confirmLabel = `Confirm split (${sp.recipients.length} × ${sp.perPerson} USDC)`;
            }
          } catch { /* use default label */ }
          res.write(
            `data: ${JSON.stringify({
              meta: {
                confirmation: {
                  required: true,
                  action: 'split',
                  confirmId: actionSessionId,
                  confirmLabel,
                },
              },
            })}\n\n`,
          );
        }
      } catch (error) {
        console.warn('[chat/respond] pending postflight failed:', getErrorMessage(error));
      }

      const hermesResult = classifyBrainToolResult(fullResponse);
      const existingOutcome: BrainEventOutcome = guardedOutcome ?? hermesResult.outcome;
      const hermesEventUpdate: Parameters<typeof updateBrainEvent>[1] = {
        intent_source: 'hermes',
        ...buildHermesBrainEventFields(),
        hermes_model: 'fast',
        final_response_summary: fullResponse,
        outcome: existingOutcome,
        total_latency_ms: Date.now() - responseStartedAt,
      };
      if (!guardedOutcome) {
        hermesEventUpdate.failure_reason = hermesResult.failureReason;
      }
      await updateBrainEvent(brainEventId, hermesEventUpdate);
      brainTelemetryFinalized = true;
      recentBrainEventsBySession.set(memorySessionId, {
        eventId: brainEventId,
        assistantAt: Date.now(),
      });
      await appendBrainConversationTurn(memorySessionId, message, fullResponse, memorySessionId);
      res.write('data: [DONE]\n\n')
      res.end()
    } catch (err) {
      if (brainEventId && !brainTelemetryFinalized) {
        await updateBrainEvent(brainEventId, {
          outcome: 'tool_error',
          failure_reason: getErrorMessage(err),
          final_response_summary: getErrorMessage(err),
          total_latency_ms: Date.now() - responseStartedAt,
        });
        brainTelemetryFinalized = true;
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: getErrorMessage(err) })}\n\n`)
        res.end()
      }
    }
  });

  app.post('/api/chat/feedback', async (req: Request, res: Response) => {
    try {
      const eventId = typeof req.body?.event_id === 'string' ? req.body.event_id.trim() : '';
      const feedback = req.body?.feedback === 'positive' || req.body?.feedback === 'negative'
        ? req.body.feedback
        : null;
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      if (!eventId || !feedback) {
        return res.status(400).json({ error: 'event_id and feedback are required.' });
      }
      await updateBrainEvent(eventId, {
        user_feedback: feedback,
        ...(note ? { feedback_note: note } : {}),
      });
      console.info('[BRAIN_FEEDBACK_RECEIVED]', { event_id: eventId, feedback });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  const getBalanceHandler = async (req: Request, res: Response) => {
    try {
      const addressQuery = req.query.address as string | undefined;
      if (!addressQuery || !isAddress(addressQuery)) {
        return res.status(400).json({ error: 'Valid address query parameter is required.' });
      }

      const address = getAddress(addressQuery);
      const balance = await fetchGatewayBalanceForAddress(address);
      return res.json({
        address,
        balance: balance.available,
        formatted: balance.available,
        total: balance.total,
        network: NETWORK_NAME,
        chainId: CHAIN_ID,
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  };

  app.get('/balance', getBalanceHandler);
  app.get('/gateway-balance', getBalanceHandler);

  app.post('/wallet/create', async (req: Request, res: Response) => {
    try {
      const userAddress = (req.body?.userAddress as string | undefined) ?? '';
      if (!userAddress || !isAddress(userAddress)) {
        return res.status(400).json({ error: 'Valid userAddress is required.' });
      }
      const normalized = getAddress(userAddress);

      const existing = await findCircleWalletForUser(normalized);
      if (existing) {
        return res.json({
          userAddress: normalized,
          circleWalletId: existing.walletId,
          circleWalletAddress: existing.address,
        });
      }

      await getOrCreateWalletSetId();
      const created = await createUserWallet(normalized);

      setWalletForUser(normalized, {
        circleWalletId: created.id,
        circleWalletAddress: created.address,
      });

      return res.json({
        userAddress: normalized,
        circleWalletId: created.id,
        circleWalletAddress: created.address,
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/wallet/:address', async (req: Request, res: Response) => {
    try {
      const addressParam = req.params.address;
      if (!addressParam || !isAddress(addressParam)) {
        return res.status(400).json({ error: 'Valid address parameter is required.' });
      }

      const normalized = getAddress(addressParam);
      const existing = await findCircleWalletForUser(normalized);
      if (!existing) {
        return res.status(404).json({ error: 'Wallet not found' });
      }

      return res.json({
        userAddress: normalized,
        circleWalletId: existing.walletId,
        circleWalletAddress: existing.address,
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/wallet/fund-gateway', async (req: Request, res: Response) => {
    try {
      const userAddress = (req.body?.userAddress as string | undefined) ?? '';
      if (!userAddress || !isAddress(userAddress)) {
        return res.status(400).json({ error: 'Valid userAddress is required.' });
      }
      const normalized = getAddress(userAddress);

      let existing: { walletId: string; address: string };
      try {
        existing = await getCircleWalletForUser(normalized);
      } catch {
        return res
          .status(404)
          .json({ error: 'Circle wallet not found for user', userAddress: normalized });
      }

      // eslint-disable-next-line no-console
      console.log(
        `[WalletFund] User ${normalized} Circle wallet: ${existing.address} (id=${existing.walletId})`,
      );

      const gatewayBalance = await fetchGatewayBalanceForAddress(getAddress(existing.address));
      const current = Number(gatewayBalance.available || '0');

      // eslint-disable-next-line no-console
      console.log('[WalletFund] Circle wallet Gateway balance:', current);

      if (Number.isNaN(current)) {
        return res
          .status(500)
          .json({ error: 'Invalid Gateway balance response', balance: gatewayBalance });
      }

      const { transferToGateway } = await import('./lib/circleWallet');

      // eslint-disable-next-line no-console
      console.log('[WalletFund] Calling transferToGateway for wallet:', existing.address);

      const transferResult = await transferToGateway({
        walletId: existing.walletId,
        walletAddress: existing.address,
      });

      const refreshed = await fetchGatewayBalanceForAddress(getAddress(existing.address));
      const newBalance = Number(refreshed.available || '0');
      const funded = transferResult.status === 'COMPLETE';

      if (!funded) {
        return res.json({
          funded: false,
          amount: transferResult.amount ?? 0,
          transferId: transferResult.transferId,
          transferStatus: transferResult.status,
          approvalId: transferResult.approvalId,
          approvalState: transferResult.approvalState,
          approvalTxHash: transferResult.approvalTxHash,
          depositId: transferResult.depositId,
          depositState: transferResult.depositState,
          depositTxHash: transferResult.depositTxHash,
          errorReason: transferResult.errorReason,
          errorDetails: transferResult.errorDetails,
          newBalance,
          message:
            transferResult.errorDetails ??
            transferResult.errorReason ??
            'Gateway deposit did not complete.',
        });
      }

      return res.json({
        funded,
        amount: transferResult.amount ?? 0,
        transferId: transferResult.transferId,
        transferStatus: transferResult.status,
        approvalId: transferResult.approvalId,
        approvalState: transferResult.approvalState,
        approvalTxHash: transferResult.approvalTxHash,
        depositId: transferResult.depositId,
        depositState: transferResult.depositState,
        depositTxHash: transferResult.depositTxHash,
        errorReason: transferResult.errorReason,
        errorDetails: transferResult.errorDetails,
        newBalance,
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.get('/circle-wallet/:userAddress', async (req: Request, res: Response) => {
    try {
      const userAddress = req.params.userAddress ?? '';
      if (!userAddress || !isAddress(userAddress)) {
        return res.status(400).json({ error: 'Valid userAddress is required.' });
      }
      const normalized = getAddress(userAddress);

      const existing = await findCircleWalletForUser(normalized);
      if (!existing) {
        return res
          .status(404)
          .json({ error: 'Circle wallet not found for user', userAddress: normalized });
      }

      const gatewayBalance = await fetchGatewayBalanceForAddress(getAddress(existing.address));
      const balance = Number(gatewayBalance.available || '0');

      return res.json({
        userAddress: normalized,
        circleWalletId: existing.walletId,
        circleWalletAddress: existing.address,
        gatewayBalance: balance,
        rawGatewayBalance: gatewayBalance,
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/api/dcw/agents/:slug/run', authMiddleware, async (req: Request, res: Response) => {
    const slug = parseDcwPaidAgentSlug(req.params.slug || '');
    if (!slug) {
      return res.status(404).json({ error: 'Unsupported DCW paid agent slug' });
    }

    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth?.walletAddress || !isAddress(auth.walletAddress)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const normalizedWallet = getAddress(auth.walletAddress);
      const upstreamBody =
        req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : undefined;
      const requestId = req.header('x-agentflow-request-id')?.trim() || createRunId(`dcw_${slug}`);

      if (slug === 'transcribe') {
        const upstreamHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-agentflow-request-id': requestId,
        };
        const authorization = req.header('authorization')?.trim();
        if (authorization) {
          upstreamHeaders.authorization = authorization;
        }

        const upstreamResponse = await fetch(getDcwPaidAgentUrl(slug), {
          method: 'POST',
          headers: upstreamHeaders,
          body: JSON.stringify(upstreamBody ?? {}),
        });

        const upstreamJson = await upstreamResponse.json().catch(() => ({}));
        return res.status(upstreamResponse.status).json(upstreamJson);
      }

      const result = await executeDcwPaidAgentViaX402<Record<string, unknown>>({
        userWalletAddress: normalizedWallet,
        agent: slug,
        price: getDcwPaidAgentPrice(slug),
        url: getDcwPaidAgentUrl(slug),
        body: upstreamBody,
        requestId,
      });

      if (result.status >= 200 && result.status < 300) {
        void incrementTxCount(slug).catch((err) =>
          console.warn(`[tx-counter] increment failed for dcw ${slug}:`, err),
        );
      }

      return res.status(result.status).json({
        ...(typeof result.data === 'object' && result.data ? result.data : { result: result.data }),
        payment: {
          mode: result.payment.mode,
          payer: result.payment.payer,
          agent: result.payment.agent,
          price: result.payment.price,
          requestId: result.payment.requestId,
          transaction: result.payment.transaction,
          transactionRef: result.payment.transactionRef,
          settlement: result.payment.settlement,
          settlementTxHash: result.payment.settlementTxHash,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  app.post('/deposit', (_req, res) => {
    res.status(410).json({
      success: false,
      error:
        'Deposit is now client-side. Use the browser wallet flow (MetaMask approve + depositFor) instead of backend /deposit.',
    });
  });

  const proxyHandler = async (req: Request, res: Response) => {
    const step = parseStep(req.params.step);
    if (!step) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (step === 'analyst' || step === 'writer') {
      const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
      const reqKey = (req.headers['x-agentflow-brain-internal'] as string | undefined)?.trim();
      if (!internalKey || reqKey !== internalKey) {
        return res.status(404).json({ error: 'Not found' });
      }
    }

    const paymentSignature = req.header('Payment-Signature') || undefined;
    try {
      const result = await proxyAgentRun({
        step,
        method: req.method === 'GET' ? 'GET' : 'POST',
        body: req.method === 'GET' ? req.query : req.body,
        paymentSignature,
      });

      if (result.paymentRequiredHeader) {
        res.setHeader('PAYMENT-REQUIRED', result.paymentRequiredHeader);
      }
      if (result.paymentResponseHeader) {
        res.setHeader('PAYMENT-RESPONSE', result.paymentResponseHeader);
      }
      if (result.contentType) {
        res.setHeader('Content-Type', result.contentType);
      }

      if (result.status >= 200 && result.status < 300) {
        void incrementTxCount(step).catch((err) =>
          console.warn(`[tx-counter] increment failed for proxy ${step}:`, err),
        );
      }

      if (typeof result.data === 'string') {
        return res.status(result.status).send(result.data);
      }
      return res.status(result.status).json(result.data);
    } catch (err) {
      return res.status(500).json({
        error: `${step} proxy failed`,
        details: getErrorMessage(err),
      });
    }
  };

  app.get('/agent/:step/run', proxyHandler);
  app.post('/agent/:step/run', proxyHandler);

  app.post('/run', async (req, res) => {
    let activePipelineRunCounted = false;
    const timingTraceStart = Date.now();
    const pipelineTimingTrace: PipelineTimingTracePoint[] = [];
    const rawTask = (req.body?.task as string | undefined) ?? '';
    const portfolioImpact =
      req.body?.portfolioImpact === true || detectPortfolioImpactIntent(rawTask);
    const task = portfolioImpact ? stripPortfolioImpactPhrasing(rawTask) : rawTask;
    const timingTraceId = RESEARCH_TIMING_TRACE ? `openai-trace-${Date.now()}` : '';
    const userAddressInput = (req.body?.userAddress as string | undefined) ?? '';
    const reasoningMode = inferResearchReasoningMode({
      task,
      explicitMode: req.body?.reasoningMode,
      deepResearch: req.body?.deepResearch,
      defaultMode: 'fast',
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // @ts-ignore
    res.flushHeaders?.();

    let clientClosed = false;
    const clearHeartbeat = () => {
      clearInterval(heartbeat);
    };
    const handleStreamClosed = () => {
      clientClosed = true;
      clearHeartbeat();
    };
    req.on('aborted', handleStreamClosed);
    res.on('close', handleStreamClosed);

    const sendEvent = (event: Record<string, unknown>) => {
      if (clientClosed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      if (clientClosed || res.writableEnded) {
        clearHeartbeat();
        return;
      }
      res.write(`: keep-alive ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS);

    if (!task.trim()) {
      sendEvent({
        type: 'error',
        message: 'Task is required',
      });
      res.end();
      return;
    }

    if (!userAddressInput || !isAddress(userAddressInput)) {
      sendEvent({
        type: 'error',
        message: 'Valid userAddress is required for payment orchestration.',
      });
      res.end();
      return;
    }

    let circleWalletId: string;
    let payerAddress: Address;
    let normalizedUserAddress: Address;
    try {
      const normalized = getAddress(userAddressInput);
      normalizedUserAddress = normalized;
      const executionWallet = await getOrCreateUserAgentWallet(normalized);
      circleWalletId = executionWallet.wallet_id;
      // Use the user's Agent Wallet/DCW as payer, not the user's EOA or legacy Gateway funding wallet.
      payerAddress = executionWallet.address as Address;
    } catch (err) {
      sendEvent({
        type: 'error',
        message: getErrorMessage(err),
      });
      res.end();
      return;
    }

    try {
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'public_run_start', {
        task,
        reasoningMode,
      });
      await beginResearchPipelineRun();
      activePipelineRunCounted = true;
      const walletContext =
        req.body?.walletContext && typeof req.body.walletContext === 'object'
          ? (req.body.walletContext as ResearchWalletContext)
          : portfolioImpact
            ? await buildResearchWalletContext({
                ownerWalletAddress: normalizedUserAddress,
                executionWalletAddress: payerAddress,
                executionTarget: 'DCW',
              })
            : null;

      await sendGAEvent('pipeline_started', {
        wallet_address: payerAddress,
        timestamp: Date.now(),
      });

      const [researchOwnerWallet, analystOwnerWallet, writerOwnerWallet] = await Promise.all([
        loadAgentOwnerWallet('research'),
        loadAgentOwnerWallet('analyst'),
        loadAgentOwnerWallet('writer'),
      ]);
      const pipelineRequestId = `pipeline_${randomUUID()}`;

      // Research step
      sendEvent({
        type: 'step_start',
        step: 'research',
        price: researchPrice,
        mode: reasoningMode,
      });
      sendEvent({
        delta: 'Research Agent is running Firecrawl + SearXNG live retrieval.\n',
      });
      if (walletContext && portfolioImpact) {
        sendEvent({
          delta: walletContext.error
            ? 'Portfolio snapshot was requested, but the DCW scan was unavailable; the report will say so instead of guessing.\n'
            : 'Using your DCW portfolio snapshot for personalized impact analysis.\n',
        });
      }

      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_research_agent_call', {
        pipelineRequestId,
      });
      const researchResult = await payProtectedResourceServer<
        {
          task?: string;
          result?: string;
          structuredResearch?: Record<string, unknown> | null;
          liveData?: Record<string, unknown> | null;
        },
        {
          task: string;
          reasoningMode: 'fast' | 'deep';
          deepResearch?: boolean;
          portfolioImpact?: boolean;
          walletContext?: ResearchWalletContext;
        }
      >({
        url: RESEARCH_URL,
        method: 'POST',
        body: {
          task,
          reasoningMode,
          deepResearch: reasoningMode === 'deep',
          portfolioImpact,
          ...(walletContext && portfolioImpact ? { walletContext } : {}),
          ...(timingTraceId ? { timingTraceId } : {}),
        },
        circleWalletId,
        payer: payerAddress,
        chainId: CHAIN_ID,
        requestId: `${pipelineRequestId}:research`,
        idempotencyKey: `${pipelineRequestId}:research`,
      });
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_research_agent_response', {
        status: researchResult.status,
      });

      if (researchResult.status >= 200 && researchResult.status < 300) {
        pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_research_ledger_write');
        void ensureUserPaidAgentLedger({
          payer: payerAddress,
          agent: 'research',
          price: researchPrice,
          requestId: researchResult.requestId,
          settlement: researchResult.transaction,
          remark: 'User DCW -> Research Agent (pipeline)',
          context: 'user_dcw->research pipeline',
        })
          .then(() => {
            pushPipelineTimingTrace(
              pipelineTimingTrace,
              timingTraceStart,
              'after_research_ledger_write',
            );
          })
          .catch((ledgerErr) => {
            pushPipelineTimingTrace(
              pipelineTimingTrace,
              timingTraceStart,
              'research_ledger_write_failed',
              {
                error: getErrorMessage(ledgerErr),
              },
            );
            console.error('[ledger] research ledger write failed', ledgerErr);
          });
      }

      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_research_result_handling');
      const researchTx = researchResult.transactionRef ?? null;
      const researchText = getAgentResultText(researchResult.data);
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_research_result_handling', {
        researchTextChars: researchText.length,
      });

      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_research_step_complete_event');
      sendEvent({
        type: 'step_complete',
        step: 'research',
        tx: researchTx,
        amount: researchPrice,
      });
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_research_step_complete_event', {
        researchTx,
        researchTextChars: researchText.length,
      });

      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_research_ga_event');
      void sendGAEvent('research_complete', {
        wallet_address: payerAddress,
        tx: researchTx,
        timestamp: Date.now(),
      })
        .then(() => {
          pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_research_ga_event');
        })
        .catch((gaErr) => {
          pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'research_ga_event_failed', {
            error: getErrorMessage(gaErr),
          });
          console.error('[ga] research_complete event failed', gaErr);
        });

      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_direct_structured_research_extract');
      const directStructuredResearch = recordValue(researchResult.data.structuredResearch);
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_direct_structured_research_extract', {
        hasStructuredResearch: !!directStructuredResearch,
      });
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_research_parse_object');
      const researchParse = directStructuredResearch
        ? { parsed: directStructuredResearch, outcome: 'success_without_unwrapping' as const }
        : parseObjectWithDiagnostics(researchText);
      const parsedResearch = researchParse.parsed;
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_research_parse_object', {
        parserOutcome: researchParse.outcome,
      });
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_research_parsing', {
        parserOutcome: researchParse.outcome,
        hasStructuredResearch: !!directStructuredResearch,
      });
      if (directStructuredResearch) {
        console.log('[parser] research_result supplied as structured object');
      } else if (researchParse.outcome === 'success_without_unwrapping') {
        console.log('[parser] research_result parsed without unwrapping');
      } else if (researchParse.outcome === 'success_after_unwrapping') {
        console.log('[parser] research_result parsed after unwrapping');
      } else {
        console.log('[parser] research_result parse failed');
      }
      void writeResearchOutputDebug({
        query: task,
        mode: reasoningMode,
        rawResearchText: researchText,
        parserOutcome: researchParse.outcome,
        parsedValue: parsedResearch,
      }).catch((error) => {
        console.warn('[parser] failed to write research output debug file:', getErrorMessage(error));
      });
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_research_debug_write_kicked_off');
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_live_data_source_summary');
      const parsedLiveData = researchResult.data.liveData ?? null;
      const actualSources = summarizeLiveDataSourceNames(parsedLiveData);
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'after_live_data_source_summary', {
        actualSourcesCount: actualSources.length,
      });
      pushPipelineTimingTrace(pipelineTimingTrace, timingTraceStart, 'before_analyst_step_start', {
        actualSourcesCount: actualSources.length,
      });
      sendEvent({
        delta: actualSources.length
          ? `\nRead live sources: ${formatLiveDataSourceSummary(actualSources)}\n`
          : '\nLive retrieval found limited directly relevant sources; the report will avoid unrelated citations.\n',
      });

      // Analyst step
      sendEvent({
        type: 'step_start',
        step: 'analyst',
        price: analystPrice,
        mode: reasoningMode,
      });
      sendEvent({
        delta: 'Research Agent is paying Analyst Agent for evidence review.\n',
      });

      const analystResult = await payProtectedResourceServer<
        { research?: string; result?: string },
        {
          research: string;
          researchJson: Record<string, unknown> | null;
          liveData: Record<string, unknown> | null;
          task: string;
          portfolioImpact?: boolean;
          reasoningMode: 'fast' | 'deep';
        }
      >({
        url: ANALYST_URL,
        method: 'POST',
        headers: {
          'x-agentflow-brain-internal': process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '',
        },
        body: {
          research: researchText,
          researchJson: parsedResearch,
          liveData: parsedLiveData,
          task,
          portfolioImpact,
          reasoningMode,
        },
        circleWalletId: researchOwnerWallet.walletId,
        payer: researchOwnerWallet.address,
        chainId: CHAIN_ID,
        requestId: `${pipelineRequestId}:analyst`,
        idempotencyKey: `${pipelineRequestId}:analyst`,
      });

      console.log('[pipeline] analyst complete, starting writer');

      const analystTx = analystResult.transactionRef ?? null;
      const analysisText = getAgentResultText(analystResult.data);

      const analystLedger = await insertAgentToAgentLedger({
        fromWallet: researchOwnerWallet.address,
        toWallet: analystOwnerWallet.address,
        amount: usdAmountFromPriceLabel(analystPrice),
        settlement: analystResult.transaction,
        remark: 'Research Agent -> Analyst Agent',
        agentSlug: 'research',
        buyerAgent: 'research',
        sellerAgent: 'analyst',
        requestId: `${pipelineRequestId}:analyst`,
        context: 'agent_to_agent ledger (research->analyst)',
      });
      if (!analystLedger.ok) {
        console.warn('[a2a] research→analyst ledger insert failed:', analystLedger.error);
      }

      sendEvent({
        delta: `\nResearch Agent paid Analyst Agent ${analystPrice} USDC via x402/Gateway\n`,
      });

      sendEvent({
        type: 'step_complete',
        step: 'analyst',
        tx: analystTx,
        amount: analystPrice,
      });

      await sendGAEvent('analyst_complete', {
        wallet_address: payerAddress,
        tx: analystTx,
        timestamp: Date.now(),
      });

      const analysisParse = parseObjectWithDiagnostics(analysisText);
      const parsedAnalysis = analysisParse.parsed;
      if (analysisParse.outcome === 'success_without_unwrapping') {
        console.log('[parser] analysis_result parsed without unwrapping');
      } else if (analysisParse.outcome === 'success_after_unwrapping') {
        console.log('[parser] analysis_result parsed after unwrapping');
      } else {
        console.log('[parser] analysis_result parse failed');
      }

      // Writer step
      sendEvent({
        type: 'step_start',
        step: 'writer',
        price: writerPrice,
        mode: reasoningMode,
      });
      sendEvent({
        delta: 'Analyst Agent is paying Writer Agent to produce the final report.\n',
      });

      console.log('[pipeline] calling writer agent');

      const writerResult = await payProtectedResourceServer<
        { research?: string; analysis?: string; result?: string },
        {
          research: string;
          analysis: string;
          researchJson: Record<string, unknown> | null;
          analysisJson: Record<string, unknown> | null;
          liveData: Record<string, unknown> | null;
          task: string;
          portfolioImpact?: boolean;
          reasoningMode: 'fast' | 'deep';
        }
      >({
        url: WRITER_URL,
        method: 'POST',
        headers: {
          'x-agentflow-brain-internal': process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '',
        },
        body: {
          research: researchText,
          analysis: analysisText,
          researchJson: parsedResearch,
          analysisJson: parsedAnalysis,
          liveData: parsedLiveData,
          task,
          portfolioImpact,
          reasoningMode,
        },
        circleWalletId: analystOwnerWallet.walletId,
        payer: analystOwnerWallet.address,
        chainId: CHAIN_ID,
        requestId: `${pipelineRequestId}:writer`,
        idempotencyKey: `${pipelineRequestId}:writer`,
      });

      console.log('[pipeline] writer complete');

      const writerTx = writerResult.transactionRef ?? null;

      const writerLedger = await insertAgentToAgentLedger({
        fromWallet: analystOwnerWallet.address,
        toWallet: writerOwnerWallet.address,
        amount: usdAmountFromPriceLabel(writerPrice),
        settlement: writerResult.transaction,
        remark: 'Analyst Agent -> Writer Agent',
        agentSlug: 'analyst',
        buyerAgent: 'analyst',
        sellerAgent: 'writer',
        requestId: `${pipelineRequestId}:writer`,
        context: 'agent_to_agent ledger (analyst->writer)',
      });
      if (!writerLedger.ok) {
        console.warn('[a2a] analyst→writer ledger insert failed:', writerLedger.error);
      }

      sendEvent({
        delta: `Analyst Agent paid Writer Agent ${writerPrice} USDC via x402/Gateway\n\n`,
      });

      sendEvent({
        type: 'step_complete',
        step: 'writer',
        tx: writerTx,
        amount: writerPrice,
      });

      await sendGAEvent('writer_complete', {
        wallet_address: payerAddress,
        tx: writerTx,
        timestamp: Date.now(),
      });

      const total =
        Number(researchPrice.replace('$', '')) +
        Number(analystPrice.replace('$', '')) +
        Number(writerPrice.replace('$', ''));

      sendEvent({
        type: 'receipt',
        pipelineRequestId,
        total: total.toFixed(3),
        entries: [
          {
            requestId: `${pipelineRequestId}:research`,
            agent: 'research',
            price: researchPrice,
            payer: payerAddress,
            mode: 'dcw',
            transactionRef: researchResult.transactionRef ?? null,
            settlementTxHash: researchResult.transaction?.txHash ?? null,
          },
          {
            requestId: `${pipelineRequestId}:analyst`,
            agent: 'analyst',
            price: analystPrice,
            payer: researchOwnerWallet.address,
            mode: 'dcw',
            transactionRef: analystResult.transactionRef ?? null,
            settlementTxHash: analystResult.transaction?.txHash ?? null,
          },
          {
            requestId: `${pipelineRequestId}:writer`,
            agent: 'writer',
            price: writerPrice,
            payer: analystOwnerWallet.address,
            mode: 'dcw',
            transactionRef: writerResult.transactionRef ?? null,
            settlementTxHash: writerResult.transaction?.txHash ?? null,
          },
        ],
        researchPrice,
        analystPrice,
        writerPrice,
        researchTx,
        analystTx,
        writerTx,
      });

      const finalizedReport = finalizeReportMarkdown({
        task,
        writerMarkdown: writerResult.data.result || 'Writer agent returned no markdown output.',
        research: parsedResearch,
        analysis: parsedAnalysis,
        liveData: parsedLiveData,
      });
      const finalMarkdown = ensureWalletContextInReport(
        finalizedReport.markdown,
        parsedLiveData,
        portfolioImpact,
      );

      if (finalizedReport.validationIssues.length > 0) {
        console.warn(
          '[Research pipeline] Final report validation issues after repair:',
          finalizedReport.validationIssues,
        );
      }

      sendEvent({
        type: 'report',
        markdown: finalMarkdown,
        research: parsedResearch,
        analysis: parsedAnalysis,
        liveData: parsedLiveData,
      });

      await sendGAEvent('pipeline_complete', {
        wallet_address: payerAddress,
        total: total.toFixed(3),
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error('[pipeline] pipeline error:', e);
      sendEvent({
        type: 'error',
        message: getErrorMessage(e),
      });
    } finally {
      if (RESEARCH_TIMING_TRACE && timingTraceId) {
        try {
          const outDir = path.join(process.cwd(), 'tmp', 'latency-fast-research-diagnostic');
          await fs.mkdir(outDir, { recursive: true });
          await fs.writeFile(
            path.join(outDir, `${timingTraceId}.public.json`),
            `${JSON.stringify(
              {
                timingTraceId,
                task,
                reasoningMode,
                trace: pipelineTimingTrace,
              },
              null,
              2,
            )}\n`,
            'utf8',
          );
        } catch (traceError) {
          console.warn('[timing-trace] failed to write public trace:', getErrorMessage(traceError));
        }
      }
      if (activePipelineRunCounted) {
        await endResearchPipelineRun();
      }
      clearHeartbeat();
      if (!res.writableEnded) res.end();
    }
  });

  return app;
}

async function start(): Promise<void> {
  const facilitatorApp = createFacilitatorApp();
  const researchApp = createAgentApp(
    'research',
    researchPrice,
    RESEARCH_AGENT_TIMEOUT_MS,
    async (req) => {
    const rawTask = (req.body?.task as string) ?? (req.query.task as string) ?? '';
    const portfolioImpact =
      req.body?.portfolioImpact === true ||
      req.query.portfolioImpact === 'true' ||
      detectPortfolioImpactIntent(rawTask);
    const task = portfolioImpact ? stripPortfolioImpactPhrasing(rawTask) : rawTask;
    const researchContext =
      typeof req.body?.researchContext === 'string' && req.body.researchContext.trim()
        ? req.body.researchContext.trim()
        : '';
    const counterpartyRisk =
      req.body?.counterpartyRisk && typeof req.body.counterpartyRisk === 'object'
        ? (req.body.counterpartyRisk as CounterpartyRiskAssessment)
        : null;
    const walletContext =
      req.body?.walletContext && typeof req.body.walletContext === 'object'
        ? (req.body.walletContext as Record<string, unknown>)
        : null;
    if (counterpartyRisk && typeof counterpartyRisk.counterparty === 'string' && typeof counterpartyRisk.score === 'number') {
      return {
        task,
        liveData: { internal_context: counterpartyRisk, public_web_used: false },
        reasoningMode: 'fast',
        result: formatCounterpartyRiskReport(counterpartyRisk),
      };
    }
    const reasoningMode = inferResearchReasoningMode({
      task,
      explicitMode: req.body?.reasoningMode ?? req.query.reasoningMode,
      deepResearch: req.body?.deepResearch ?? req.query.deepResearch,
      defaultMode: 'fast',
    });
    let liveData = '';
    const liveDataTimeout = classifyLiveDataTimeout(task);
    try {
      liveData = await withTimeout(
        fetchLiveData(task),
        liveDataTimeout.timeoutMs,
        `Live data timed out after ${liveDataTimeout.timeoutMs / 1000}s`,
      );
    } catch (liveDataError) {
      console.warn('[Research] Live data enrichment skipped:', getErrorMessage(liveDataError));
    }
    const asOf = new Date().toISOString();
    if (!liveData.trim() && requiresLiveEvidence(task)) {
      return {
        task,
        liveData: {
          ...(walletContext && portfolioImpact ? { wallet_context: walletContext } : {}),
          portfolio_impact: portfolioImpact,
        },
        reasoningMode,
        result: buildSparseEvidenceResearch(task, asOf),
      };
    }
    const contextBlock = researchContext
      ? `\n\nINTERNAL AGENTFLOW CONTEXT JSON:\n${researchContext}\n\nUse this internal context as primary evidence for private AgentFlow handles, wallets, invoices, payment requests, transactions, contacts, and reputation cache. Public web evidence is enrichment only. If public web evidence is limited, say so and still produce a risk assessment from internal evidence.`
      : '';
    const walletContextBlock = walletContext && portfolioImpact
      ? `\n\nPORTFOLIO_CONTEXT JSON:\n${JSON.stringify(walletContext, null, 2)}\n\nThe user asked about their portfolio. Use this AgentFlow DCW snapshot as private first-party exposure context. Classify what the user holds (stablecoins, volatile crypto, DeFi, Gateway, mixed) and explain impact through those asset classes. Do not expose full wallet addresses, raw balances, or PnL unless the user explicitly asks for a balance/portfolio breakdown. If the snapshot has an error or empty holdings, say that the DCW scan was unavailable or empty instead of inventing holdings.`
      : '';
    const liveDataPayload = parseLiveDataPayload(liveData);
    const currentEventsPayload =
      liveDataPayload?.current_events &&
      typeof liveDataPayload.current_events === 'object'
        ? liveDataPayload.current_events as Record<string, unknown>
        : null;
    const hasCurrentEventEvidence = Boolean(
      currentEventsPayload &&
        (Array.isArray(currentEventsPayload.articles) ||
          Array.isArray(currentEventsPayload.article_snapshots) ||
          currentEventsPayload.framing_signals),
    );
    const geopoliticalEvidenceInstruction = hasCurrentEventEvidence
      ? ' Verify the user\'s premise before accepting it. If the evidence supports only tensions, reported planning, isolated strikes, or older background context, say that plainly instead of repeating the user\'s framing. If LIVE DATA current_events framing_signals are present, follow them exactly for broader conflict status, Strait of Hormuz route status, and Red Sea route status.'
      : '';
    const userMessage = liveData
      ? `AS OF ${asOf}\nCURRENT DATE: ${asOf.slice(0, 10)}\n\nLIVE DATA JSON:\n${liveData}${contextBlock}${walletContextBlock}\n\nUSER TASK:\n${task}\n\nUse the LIVE DATA JSON above for current figures and dated evidence. Do not cite or mention any date after CURRENT DATE as if it has happened. When present, cite concrete titles and URLs from current_events.articles, current_events.article_snapshots, dynamic_sources.articles, wikipedia.pages, coingecko, defillama, and bitcoin_onchain; do not invent outlets. Retrieval layers are not evidence and must not be cited as sources.${geopoliticalEvidenceInstruction} When creator_audience_metrics is present, treat current_subscribers/current_subscribers_display and observed_at as direct evidence for the latest available audience count and mention that figure explicitly in the answer. When bitcoin_onchain is present, treat it as primary evidence for Bitcoin network transaction counts, block counts, fees, and on-chain activity windows; do not substitute market trading volume for on-chain transaction volume. When PORTFOLIO_CONTEXT is present, classify the user's exposure and explain impact through that exposure profile without revealing raw balances, full addresses, or PnL unless explicitly requested. Prefer official APIs, reputable publishers, Mempool.space for Bitcoin block/on-chain metrics, CoinGecko for token market data, DefiLlama for chain TVL and stablecoin liquidity, current-event article snapshots for recent developments, and Wikipedia for factual background.`
      : `${task}${contextBlock}${walletContextBlock}`;
    return {
      task,
      liveData: researchContext
        ? {
            ...(liveDataPayload ?? {}),
            internal_context: safeParseObject(researchContext),
            portfolio_impact: portfolioImpact,
            ...(walletContext && portfolioImpact ? { wallet_context: walletContext } : {}),
          }
        : {
            ...(liveDataPayload ?? {}),
            portfolio_impact: portfolioImpact,
            ...(walletContext && portfolioImpact ? { wallet_context: walletContext } : {}),
          },
      reasoningMode,
      result: await callHermesFast(RESEARCH_SYSTEM_PROMPT, userMessage),
    };
  },
  );
  const analystApp = createAgentApp(
    'analyst',
    analystPrice,
    ANALYST_AGENT_TIMEOUT_MS,
    async (req) => {
    const research =
      (req.body?.research as string) ?? (req.query.research as string) ?? '';
    const task = (req.body?.task as string) ?? (req.query.task as string) ?? '';
    const reasoningMode = inferResearchReasoningMode({
      task,
      explicitMode: req.body?.reasoningMode ?? req.query.reasoningMode,
      deepResearch: req.body?.deepResearch ?? req.query.deepResearch,
      defaultMode: 'fast',
    });
    const researchJson =
      (req.body?.researchJson as Record<string, unknown> | undefined) ??
      safeParseObject(research);
    const liveData =
      (req.body?.liveData as Record<string, unknown> | undefined) ?? null;
    const portfolioImpact =
      req.body?.portfolioImpact === true ||
      req.query.portfolioImpact === 'true' ||
      liveData?.portfolio_impact === true;
    const analystInput = buildAnalystModelInput({
      task,
      researchText: research,
      research: researchJson,
      liveData,
      portfolioImpact,
    });
    return {
      research,
      reasoningMode,
      result: await callHermesFast(ANALYST_SYSTEM_PROMPT, analystInput),
    };
  },
  { internalOnly: true },
  );
  const writerApp = createAgentApp(
    'writer',
    writerPrice,
    WRITER_AGENT_TIMEOUT_MS,
    async (req) => {
    const research =
      (req.body?.research as string) ?? (req.query.research as string) ?? '';
    const analysis =
      (req.body?.analysis as string) ?? (req.query.analysis as string) ?? '';
    const task = (req.body?.task as string) ?? (req.query.task as string) ?? '';
    const researchJson =
      (req.body?.researchJson as Record<string, unknown> | undefined) ??
      safeParseObject(research);
    const analysisJson =
      (req.body?.analysisJson as Record<string, unknown> | undefined) ??
      safeParseObject(analysis);
    const liveData =
      (req.body?.liveData as Record<string, unknown> | undefined) ?? null;
    const portfolioImpact =
      req.body?.portfolioImpact === true ||
      req.query.portfolioImpact === 'true' ||
      liveData?.portfolio_impact === true;
    const reasoningMode = inferResearchReasoningMode({
      task,
      explicitMode: req.body?.reasoningMode ?? req.query.reasoningMode,
      deepResearch: req.body?.deepResearch ?? req.query.deepResearch,
      defaultMode: 'fast',
    });
    console.log('[writer] using Hermes fast model');
    return {
      research,
      analysis,
      result: await callHermesFast(
        WRITER_SYSTEM_PROMPT,
        buildWriterModelInput({
          task,
          researchText: research,
          analysisText: analysis,
          research: researchJson,
          analysis: analysisJson,
          liveData,
          portfolioImpact,
        }),
      ),
    };
  },
  { internalOnly: true },
  );
  const publicApp = createPublicApp();

  const embeddedAgents =
    String(process.env.EMBEDDED_AGENT_SERVERS ?? 'true').toLowerCase() !== 'false';

  if (embeddedAgents) {
    console.log('[Boot] EMBEDDED_AGENT_SERVERS=true (facilitator + V2 agents in-process)');
    facilitatorApp.listen(FACILITATOR_PORT, () => {
      console.log(`[Boot] Facilitator listening on :${FACILITATOR_PORT}`);
    });
    researchApp.listen(RESEARCH_PORT, () => {
      console.log(`[Boot] Research agent listening on :${RESEARCH_PORT}`);
    });
    analystApp.listen(ANALYST_PORT, () => {
      console.log(`[Boot] Analyst agent listening on :${ANALYST_PORT}`);
    });
    writerApp.listen(WRITER_PORT, () => {
      console.log(`[Boot] Writer agent listening on :${WRITER_PORT}`);
    });
  } else {
    console.log(
      '[Boot] EMBEDDED_AGENT_SERVERS=false (public API only; run facilitator + agents separately, e.g. npm run dev:stack)',
    );
  }

  publicApp.listen(PUBLIC_PORT, () => {
    console.log(`[Boot] Public API listening on :${PUBLIC_PORT}`);
    console.log(`[Boot] Seller address for x402 payouts: ${sellerAddress}`);
    setInterval(() => {
      void processResearchQueue().catch((e) =>
        console.error('[research-queue] processor error:', e),
      );
    }, 5000);
  });
}

start().catch((err) => {
  console.error('[Boot] Failed to start unified backend', err);
  process.exit(1);
});
