import { hermes } from '../hermes';
import {
  detectPortfolioImpactIntent,
  stripPortfolioImpactPhrasing,
} from '../portfolio-impact-intent';
import {
  classifyPortfolioRequestMode,
  isVaultPositionRequest,
} from '../portfolio-request-intent';
import {
  isAmbiguousPredictionMarketIntent,
  isPredictionMarketBrowseIntent,
  looksLikePredictionMarketResearch,
} from '../prediction-market-intent';
import { isSwapExecutionIntent, looksLikeSwapResearch } from '../swap-intent';
import { isVaultDiscoveryIntent, looksLikeGeneralYieldResearch } from '../vault-discovery-intent';
import { isBridgeExecutionIntent, looksLikeBridgeResearch } from '../bridge-intent';
import { analyzeCapabilityAwareRouting } from '../capability-aware-routing';
import { isExplicitResearchRequest } from '../research-request-intent';
import {
  AGENTPAY_SELF_RECIPIENT_HANDLE,
  extractAgentpayRemark,
  isOwnAgentpayAddressRequest,
} from '../agentpay-remark';
import {
  AGENTFLOW_DOMAIN_VALUES,
  AGENTFLOW_INTENT_VALUES,
  AgentFlowDomain,
  AgentFlowIntent,
  AgentFlowIntentName,
} from './types';

const ROUTER_MODEL = 'nousresearch/hermes-4-70b';
const ROUTER_TOTAL_TIMEOUT_MS = 12_000;
const ROUTER_PRIMARY_TIMEOUT_MS = 7_000;
const ROUTER_MAX_TOKENS = 300;
const ROUTER_TEMPERATURE = 0.1;
const HISTORY_WINDOW_MESSAGES = 6;

type IntentRouterHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type IntentRouterPayload = {
  domain: string;
  intent: string;
  slots: Record<string, unknown>;
  confidence: number;
};

type HeuristicIntentResult = AgentFlowIntent | null;

const INTENT_DOMAIN_MAP: Record<AgentFlowIntentName, AgentFlowDomain> = {
  [AgentFlowIntentName.BalanceGet]: AgentFlowDomain.Balance,
  [AgentFlowIntentName.PortfolioReport]: AgentFlowDomain.Portfolio,
  [AgentFlowIntentName.SwapExecute]: AgentFlowDomain.Swap,
  [AgentFlowIntentName.VaultList]: AgentFlowDomain.Vault,
  [AgentFlowIntentName.VaultPosition]: AgentFlowDomain.Vault,
  [AgentFlowIntentName.VaultDeposit]: AgentFlowDomain.Vault,
  [AgentFlowIntentName.VaultWithdraw]: AgentFlowDomain.Vault,
  [AgentFlowIntentName.BridgePrecheck]: AgentFlowDomain.Bridge,
  [AgentFlowIntentName.BridgeExecute]: AgentFlowDomain.Bridge,
  [AgentFlowIntentName.PredmarketList]: AgentFlowDomain.Predmarket,
  [AgentFlowIntentName.PredmarketDetail]: AgentFlowDomain.Predmarket,
  [AgentFlowIntentName.PredmarketPosition]: AgentFlowDomain.Predmarket,
  [AgentFlowIntentName.PredmarketBuy]: AgentFlowDomain.Predmarket,
  [AgentFlowIntentName.PredmarketSell]: AgentFlowDomain.Predmarket,
  [AgentFlowIntentName.PredmarketRedeem]: AgentFlowDomain.Predmarket,
  [AgentFlowIntentName.PredmarketRefund]: AgentFlowDomain.Predmarket,
  [AgentFlowIntentName.ResearchReport]: AgentFlowDomain.Research,
  [AgentFlowIntentName.AgentpaySend]: AgentFlowDomain.AgentPay,
  [AgentFlowIntentName.AgentpayRequest]: AgentFlowDomain.AgentPay,
  [AgentFlowIntentName.AgentpayHistory]: AgentFlowDomain.AgentPay,
  [AgentFlowIntentName.AgentpayPaymentLink]: AgentFlowDomain.AgentPay,
  [AgentFlowIntentName.ContactsList]: AgentFlowDomain.Contacts,
  [AgentFlowIntentName.ContactsCreate]: AgentFlowDomain.Contacts,
  [AgentFlowIntentName.ContactsUpdate]: AgentFlowDomain.Contacts,
  [AgentFlowIntentName.ContactsDelete]: AgentFlowDomain.Contacts,
  [AgentFlowIntentName.ScheduleCreate]: AgentFlowDomain.Schedule,
  [AgentFlowIntentName.ScheduleCancel]: AgentFlowDomain.Schedule,
  [AgentFlowIntentName.ScheduleList]: AgentFlowDomain.Schedule,
  [AgentFlowIntentName.SplitExecute]: AgentFlowDomain.Split,
  [AgentFlowIntentName.BatchExecute]: AgentFlowDomain.Batch,
  [AgentFlowIntentName.InvoiceCreate]: AgentFlowDomain.Invoice,
  [AgentFlowIntentName.InvoiceStatus]: AgentFlowDomain.Invoice,
  [AgentFlowIntentName.VisionAnalyze]: AgentFlowDomain.Vision,
  [AgentFlowIntentName.TranscribeTranscribe]: AgentFlowDomain.Transcribe,
  [AgentFlowIntentName.TreasuryStatus]: AgentFlowDomain.Treasury,
  [AgentFlowIntentName.TreasuryTopup]: AgentFlowDomain.Treasury,
  [AgentFlowIntentName.GeneralChat]: AgentFlowDomain.General,
};

export const INTENT_RESPONSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'agentflow_intent',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: [...AGENTFLOW_DOMAIN_VALUES],
        },
        intent: {
          type: 'string',
          enum: [...AGENTFLOW_INTENT_VALUES],
        },
        slots: {
          type: 'object',
          additionalProperties: true,
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['domain', 'intent', 'slots', 'confidence'],
      additionalProperties: false,
    },
  },
} as const;

export const INTENT_ROUTER_SYSTEM_PROMPT = `You are AgentFlow's intent classifier.

Your job is to classify each user message into exactly one allowed AgentFlow intent and extract any useful slots.
Always return valid JSON that matches the provided schema.
Never invent domains or intents that are not in the allowed enum.
If the message is off-topic, purely conversational, unclear, ambiguous, empty, gibberish, or does not clearly map to an AgentFlow surface, classify it as general.chat with low confidence.
Use the user's wording as evidence. Do not hallucinate addresses, handles, amounts, markets, or confirmations.
Use empty slots {} when no slots are present.
Only use vision.analyze or transcribe.transcribe when the user clearly refers to an attached image or attached audio.
Treasury intents are valid to classify, even though execution may be admin-gated later.
Personal memory/profile statements like "remember my name is ...", "my name is ...", or "call me ..." are general.chat, not contacts.create.
Simple external-person questions like "who is Tim Baker from Circle" are general.chat unless the user explicitly asks to research, investigate, look up current/latest info, or produce a report.

Allowed intents:
balance.get - Read the user's balance or balances.
portfolio.report - Summarize the user's portfolio or holdings.
swap.execute - Swap one token to another; use confirmed=false for preview or unspecified execution, confirmed=true only when the user clearly wants to proceed now.
vault.list - List available vaults or vault opportunities.
vault.position - Show the user's vault positions.
vault.deposit - Deposit into an integrated provider vault.
vault.withdraw - Withdraw from an integrated provider vault.
bridge.precheck - Check bridge readiness, gas, supported chain state, or prerequisites.
bridge.execute - Prepare a bridge flow to move funds across chains.
predmarket.list - List prediction markets.
predmarket.detail - Show details for one prediction market.
predmarket.position - Show the user's prediction market positions.
predmarket.buy - Buy shares in a prediction market.
predmarket.sell - Sell shares in a prediction market.
predmarket.redeem - Redeem a resolved prediction market position.
predmarket.refund - Refund a canceled or invalid prediction market position.
research.report - Research a topic and produce a report.
agentpay.send - Send funds to a person or address.
agentpay.request - Request funds from a person or address.
agentpay.history - Show payment history or recent transfers.
agentpay.payment_link - Create or show a payment link or QR-style payment target.
contacts.list - List saved contacts.
contacts.create - Save a new contact.
contacts.update - Update an existing contact.
contacts.delete - Delete a saved contact.
schedule.create - Create a recurring or scheduled payment.
schedule.cancel - Cancel a scheduled payment.
schedule.list - List scheduled payments.
split.execute - Split one amount across multiple recipients.
batch.execute - Execute a batch payment set or payroll-style list.
invoice.create - Create an invoice.
invoice.status - Show invoice status or list invoices.
vision.analyze - Analyze an attached image.
transcribe.transcribe - Transcribe attached audio.
treasury.status - Show treasury or agent funding status.
treasury.topup - Top up treasury or agent funding.
general.chat - Social chat, meta questions, unclear requests, off-topic requests, empty input, or anything that does not cleanly match an AgentFlow surface.

Slot conventions:
amount: { value: number, currency?: 'USDC' | 'EURC' }
recipient: { handle?: string, address?: '0x...', resolved?: '0x...' }
token_in / token_out: { symbol: string, address?: '0x...' }
market: { address?: '0x...', title_hint?: string }
outcome: { index?: number, label?: 'yes' | 'no' | string }
filter: { category?: string, stage?: string, search?: string, time_window?: string, limit?: number }
pagination: { mode: 'first' | 'next' | 'all', cursor?: string }
chain: { source?: string, target?: string }
attachment: { id?: string, kind: 'image' | 'audio' }
schedule: { cadence: string, first_run?: string }
confirmed: boolean
topic_hint?: string

Classification rules:
Use confirmed=false when the user appears to want a preview, quote, lookup, or unspecified execution.
Use confirmed=true only when the user clearly says to execute now, send now, buy now, sell now, bridge now, or otherwise commits to action.
For meta-capability questions like "what can you do", use general.chat, not any product intent.
For broad unclear requests like "show stuff", prefer general.chat unless there is strong evidence for a specific surface.
For social greetings like "hi", "hello", or "thanks", use general.chat.
For profile memory messages like "remember my name is Snehal", use general.chat with topic_hint "profile_memory".
For simple "who is [person] from [company]" questions, use general.chat unless the user explicitly asks for research/current/latest/web lookup/report.
For financial advisory scope questions like "can you be my fund manager", "can you manage my money", "can you invest for me", or "will you rebalance my portfolio", use general.chat with topic_hint "financial_advisory_scope" unless the user gives a concrete AgentFlow action such as a swap, vault deposit, bridge, or payment.
Use topic_hint for general.chat when helpful: greeting, capabilities, thanks, unclear, offtopic, financial_advisory_scope.
For payment messages, prefer agentpay.send when the user wants to send money now, agentpay.request when they want to collect money, and schedule.create when there is recurring cadence.
For swap messages, always use swap.execute and encode preview intent via confirmed=false.
For bridge messages, always use bridge.execute and encode preview intent via confirmed=false.
For treasury or operations messages about agent wallets, funding pools, top-ups, gas sponsorship, reserve health, or "how are the agent wallets funded", prefer treasury.status or treasury.topup instead of general.chat.
When the user asks about their current holdings in prediction markets, prefer predmarket.position.
When the user asks to cash out or redeem a resolved prediction market position now, prefer predmarket.redeem.
When the user asks to investigate, look into, dig into, or put together findings on a topic, prefer research.report.
When recent conversation history makes a short follow-up actionable, use that history instead of defaulting to general.chat. Examples include "yeah go", "do it", "continue", "that one", "show me that", and "what about the other one".
For pronoun-heavy follow-ups like "what about the other one", "what about the rest", or "and the rest?", do not guess a broader list or repeat the last intent unless the antecedent is clear from recent history. If unclear, prefer general.chat. If the recent history is specifically balance first and then broader holdings, "the rest" can map to portfolio.report.
Bridge source chains come from AgentFlow's bridge source registry. Do not hardcode a short chain list from memory.
Bridge requests may mention Arc as the destination. Preserve the source chain in slots.chain.source when provided.
For prediction market browsing like "what gambling stuff is live", use predmarket.list.
For informational questions about prediction-market actions, such as "how do I redeem after winning", "when can I redeem", or "why can't I redeem yet", prefer general.chat unless the user is explicitly asking you to perform the redeem or refund action now.
For portfolio turns, distinguish a live snapshot request from a question about the portfolio feature, a referential question about prior output, and a discussion or assessment question. Use portfolio.report only when the user is asking to read or summarize current holdings. Use general.chat with topic_hint "portfolio_help" when the user is asking how the feature works, where to find it, whether prior output was their portfolio, or when the request is ambiguous. Use general.chat with topic_hint "portfolio_discussion" when the user asks for an opinion or assessment of their portfolio; answer from grounded wallet context and recent conversation instead of running another paid portfolio report.
If a market address is present, preserve it exactly.
If a recipient handle is present, preserve it exactly.
If a hex address is present, preserve it exactly.

Few-shot examples:

Input: "show all markets"
Output: {"domain":"predmarket","intent":"predmarket.list","slots":{"pagination":{"mode":"all"}},"confidence":0.97}

Input: "swap 10 USDC to EURC"
Output: {"domain":"swap","intent":"swap.execute","slots":{"amount":{"value":10,"currency":"USDC"},"token_in":{"symbol":"USDC"},"token_out":{"symbol":"EURC"},"confirmed":false},"confidence":0.98}

Input: "send 5 USDC to jack.arc"
Output: {"domain":"agentpay","intent":"agentpay.send","slots":{"recipient":{"handle":"jack.arc"},"amount":{"value":5,"currency":"USDC"}},"confidence":0.98}

Input: "send 5 to 0x79FD75a3fC633259aDD60885f927d973d3A3642b"
Output: {"domain":"agentpay","intent":"agentpay.send","slots":{"recipient":{"address":"0x79FD75a3fC633259aDD60885f927d973d3A3642b"},"amount":{"value":5}},"confidence":0.97}

Input: "what's my balance"
Output: {"domain":"balance","intent":"balance.get","slots":{},"confidence":0.99}

Input: "deposit 1 USDC in vault"
Output: {"domain":"vault","intent":"vault.deposit","slots":{"amount":{"value":1,"currency":"USDC"},"confirmed":false},"confidence":0.96}

Input: "bridge 5 USDC from base sepolia to arc"
Output: {"domain":"bridge","intent":"bridge.execute","slots":{"amount":{"value":5,"currency":"USDC"},"chain":{"source":"base sepolia","target":"arc"},"confirmed":false},"confidence":0.96}

Input: "bet 1 USDC on yes for 0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96"
Output: {"domain":"predmarket","intent":"predmarket.buy","slots":{"market":{"address":"0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96"},"outcome":{"label":"yes"},"amount":{"value":1,"currency":"USDC"},"confirmed":false},"confidence":0.98}

Input: "show vaults"
Output: {"domain":"vault","intent":"vault.list","slots":{},"confidence":0.98}

Input: "research arc mainnet launch"
Output: {"domain":"research","intent":"research.report","slots":{"task":"arc mainnet launch"},"confidence":0.96}

Input: "split 30 USDC between jack.arc and snehal.arc"
Output: {"domain":"split","intent":"split.execute","slots":{"total_amount":{"value":30,"currency":"USDC"},"recipients":[{"handle":"jack.arc"},{"handle":"snehal.arc"}],"confirmed":false},"confidence":0.97}

Input: "create invoice for jack.arc 50 USDC for design work"
Output: {"domain":"invoice","intent":"invoice.create","slots":{"recipient":{"handle":"jack.arc"},"amount":{"value":50,"currency":"USDC"},"description":"design work"},"confidence":0.95}

Input: "batch pay jack.arc 10 and snehal.arc 20"
Output: {"domain":"batch","intent":"batch.execute","slots":{"payments":[{"recipient":{"handle":"jack.arc"},"amount":{"value":10}},{"recipient":{"handle":"snehal.arc"},"amount":{"value":20}}],"confirmed":false},"confidence":0.95}

Input: "hi"
Output: {"domain":"general","intent":"general.chat","slots":{"topic_hint":"greeting"},"confidence":0.18}

Input: "remember my name is Snehal"
Output: {"domain":"general","intent":"general.chat","slots":{"topic_hint":"profile_memory"},"confidence":0.32}

Input: "who is tim baker from circle"
Output: {"domain":"general","intent":"general.chat","slots":{"topic_hint":"external_person_unknown"},"confidence":0.36}

Input: "what can you do"
Output: {"domain":"general","intent":"general.chat","slots":{"topic_hint":"capabilities"},"confidence":0.22}

Input: "Can you be my personal fund manager?"
Output: {"domain":"general","intent":"general.chat","slots":{"topic_hint":"financial_advisory_scope"},"confidence":0.38}

Input: "what gambling stuff is live"
Output: {"domain":"predmarket","intent":"predmarket.list","slots":{"filter":{"stage":"active"}},"confidence":0.93}

Input: "how can we redeem it after winning?"
Output: {"domain":"general","intent":"general.chat","slots":{"topic_hint":"predmarket_redeem_help"},"confidence":0.41}

Input: "pay alice 10 every monday"
Output: {"domain":"schedule","intent":"schedule.create","slots":{"recipient":{"handle":"alice"},"amount":{"value":10},"schedule":{"cadence":"every monday"}},"confidence":0.95}

Input: "show my contacts"
Output: {"domain":"contacts","intent":"contacts.list","slots":{},"confidence":0.98}`;

export class IntentRouterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly latency_ms?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class IntentRouterTimeoutError extends IntentRouterError {
  constructor(latency_ms: number) {
    super(`Intent router timed out after ${latency_ms}ms`, 'timeout', latency_ms);
  }
}

export class IntentRouterRequestError extends IntentRouterError {
  constructor(message: string, latency_ms: number, cause?: unknown) {
    super(message, 'request_failed', latency_ms, cause);
  }
}

export class IntentRouterParseError extends IntentRouterError {
  constructor(message: string, latency_ms: number, cause?: unknown) {
    super(message, 'parse_failed', latency_ms, cause);
  }
}

export class IntentRouterSchemaError extends IntentRouterError {
  constructor(message: string, latency_ms: number, cause?: unknown) {
    super(message, 'schema_failed', latency_ms, cause);
  }
}

function truncateForLog(value: string, maxLength = 200): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRouterPayload(
  payload: unknown,
  latency_ms: number,
): asserts payload is IntentRouterPayload {
  if (!isPlainObject(payload)) {
    throw new IntentRouterSchemaError('Router payload must be a JSON object', latency_ms);
  }

  const { domain, intent, slots, confidence } = payload;

  if (typeof domain !== 'string' || !AGENTFLOW_DOMAIN_VALUES.includes(domain as AgentFlowDomain)) {
    throw new IntentRouterSchemaError(`Invalid domain: ${String(domain)}`, latency_ms);
  }

  if (
    typeof intent !== 'string' ||
    !AGENTFLOW_INTENT_VALUES.includes(intent as AgentFlowIntentName)
  ) {
    throw new IntentRouterSchemaError(`Invalid intent: ${String(intent)}`, latency_ms);
  }

  if (!isPlainObject(slots)) {
    throw new IntentRouterSchemaError('slots must be an object', latency_ms);
  }

  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    throw new IntentRouterSchemaError(`Invalid confidence: ${String(confidence)}`, latency_ms);
  }

  const expectedDomain = INTENT_DOMAIN_MAP[intent as AgentFlowIntentName];
  if (domain !== expectedDomain) {
    throw new IntentRouterSchemaError(
      `Intent/domain mismatch: ${intent} must use domain ${expectedDomain}`,
      latency_ms,
    );
  }
}

function buildMessages(
  message: string,
  conversationHistory?: IntentRouterHistoryMessage[],
  systemPrompt = INTENT_ROUTER_SYSTEM_PROMPT,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const recentHistory = (conversationHistory ?? [])
    .filter(
      (entry): entry is IntentRouterHistoryMessage =>
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.content === 'string' &&
        entry.content.trim().length > 0,
    )
    .slice(-HISTORY_WINDOW_MESSAGES);

  return [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: message },
  ];
}

function looksLikeStoredResearchReport(content: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n');
  return (
    /^#{1,3}\s+\S/m.test(normalized) &&
    /^##\s+(?:Summary|Overview|Executive Summary|Current Situation|Key Evidence|Sources|Takeaway)\b/im.test(
      normalized,
    )
  );
}

function hasRecentResearchReportInHistory(
  conversationHistory?: IntentRouterHistoryMessage[],
): boolean {
  return (conversationHistory ?? []).some(
    (entry) => entry.role === 'assistant' && looksLikeStoredResearchReport(entry.content),
  );
}

function looksLikeReportMetaFollowup(
  message: string,
  conversationHistory?: IntentRouterHistoryMessage[],
): boolean {
  if (!hasRecentResearchReportInHistory(conversationHistory)) {
    return false;
  }

  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  if (
    /\b(?:is this|is that|this is|that is)\s+report\b/i.test(normalized) ||
    /\b(?:already|just)\s+(?:generated|made|gave|sent|showed)\s+(?:a\s+)?report\b/i.test(
      normalized,
    ) ||
    /\byou already\b[\s\S]{0,40}\breport\b/i.test(normalized) ||
    /\bwhat are you talking\b/i.test(normalized) ||
    /\bare you crazy\b/i.test(normalized) ||
    /\bwhy (?:are|did)\s+you\b[\s\S]{0,60}\breport\b/i.test(normalized)
  ) {
    return true;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 18) {
    return false;
  }

  const explicitNewResearch =
    /\b(?:new|another|fresh|rerun|regenerate|generate|create|make)\b[\s\S]{0,30}\breport\b/i.test(
      normalized,
    ) ||
    /\b(?:research|investigate|look into|dig into|deep dive)\b/i.test(normalized);
  if (explicitNewResearch) {
    return false;
  }

  return /\b(?:this|that|it|they|them|those|these|why|how|what about|so|then|does that|is that|from that|on that|in that)\b/i.test(
    normalized,
  );
}

async function attemptClassify(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await hermes.chat.completions.create(
      {
        model: ROUTER_MODEL,
        messages,
        response_format: INTENT_RESPONSE_SCHEMA,
        max_tokens: ROUTER_MAX_TOKENS,
        temperature: ROUTER_TEMPERATURE,
      },
      {
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new IntentRouterTimeoutError(timeoutMs);
    }

    throw new IntentRouterRequestError('Intent router request failed', timeoutMs, error);
  } finally {
    clearTimeout(timeout);
  }
}

function buildRetryPrompt(): string {
  return `${INTENT_ROUTER_SYSTEM_PROMPT}

IMPORTANT RETRY RULES:
- Be decisive for operational finance/product requests.
- Only use general.chat for truly social, meta-capability, off-topic, or genuinely unclear messages.
- If the message mentions agent wallets, treasury, funding pool, or top-up, classify treasury.
- If the message asks about user positions/holdings in markets, classify predmarket.position.
- If the message asks to redeem/cash out a resolved market now, classify predmarket.redeem.
- If the message asks to research/investigate/look into a topic, classify research.report.
- Respond with ONLY a JSON object. No prose. No explanation. No markdown. Just JSON.`;
}

function parseFirstAmount(message: string): number | undefined {
  const match = message.match(/(?:^|[^\w])(\d+(?:\.\d+)?)(?:\s*(?:usdc|eurc|usd|dollars?))?\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseCurrencyHint(message: string): 'USDC' | 'EURC' | undefined {
  if (/\beurc\b/i.test(message)) return 'EURC';
  if (/\busdc\b|\busd\b|\bbucks?\b|\bbuckz\b|\bdollars?\b/i.test(message)) return 'USDC';
  return undefined;
}

function parseSwapTokenPair(message: string): { token_in?: string; token_out?: string } | null {
  const tokenPattern = '(usdc|eurc)';
  const direct = message.match(
    new RegExp(
      `\\b(?:swap|convert|turn|flip|exchange|trade)\\b[\\s\\S]{0,80}?\\b${tokenPattern}\\b[\\s\\S]{0,40}?\\b(?:to|into|for)\\b[\\s\\S]{0,40}?\\b${tokenPattern}\\b`,
      'i',
    ),
  );
  if (direct) {
    return { token_in: direct[1].toUpperCase(), token_out: direct[2].toUpperCase() };
  }

  const reverse = message.match(
    new RegExp(
      `\\b(?:from)\\b[\\s\\S]{0,40}?\\b${tokenPattern}\\b[\\s\\S]{0,40}?\\b(?:to|into)\\b[\\s\\S]{0,40}?\\b${tokenPattern}\\b`,
      'i',
    ),
  );
  if (reverse) {
    return { token_in: reverse[1].toUpperCase(), token_out: reverse[2].toUpperCase() };
  }

  if (/\b(?:swap|convert|turn|flip|exchange|trade)\b/i.test(message)) {
    return {
      ...(message.match(/\b(usdc|eurc)\b/i)?.[1]
        ? { token_in: message.match(/\b(usdc|eurc)\b/i)?.[1].toUpperCase() }
        : {}),
    };
  }

  return null;
}

const RESERVED_BARE_RECIPIENT_WORDS = new Set([
  'agentflow',
  'amount',
  'arc',
  'bill',
  'bridge',
  'dollars',
  'eurc',
  'for',
  'from',
  'funds',
  'invoice',
  'me',
  'money',
  'pay',
  'payment',
  'request',
  'send',
  'snd',
  'to',
  'transfer',
  'usd',
  'usdc',
]);

function sanitizeBareRecipientHandle(candidate: string | undefined): string | undefined {
  const normalized = String(candidate ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (RESERVED_BARE_RECIPIENT_WORDS.has(normalized)) return undefined;
  return normalized;
}

function parseRecipient(message: string): Record<string, unknown> | undefined {
  const address = message.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0];
  if (address) return { address };

  const handle = message.match(/\b([a-z0-9][a-z0-9-]*\.arc)\b/i)?.[1];
  if (handle) return { handle };

  if (/\bhow\s+(?:do\s+i|to|can\s+i|should\s+i)\s+(?:send|pay|transfer|request)\b/i.test(message)) {
    return undefined;
  }

  const namedTarget = sanitizeBareRecipientHandle(
    message.match(/\b(?:to|from|for|pay|request|ask|invoice|bill)\s+([a-z][a-z0-9_-]{1,31})\b/i)?.[1],
  );
  if (namedTarget) return { handle: namedTarget.toLowerCase() };

  return undefined;
}

function parseEvmAddress(message: string): string | undefined {
  return message.match(/\b0x[a-fA-F0-9]{40}\b/)?.[0];
}

function parsePredictionOutcome(message: string): 'yes' | 'no' | undefined {
  if (/\byes\b/i.test(message)) return 'yes';
  if (/\bno\b/i.test(message)) return 'no';
  return undefined;
}

function parseSourceChain(message: string): string | undefined {
  const aliases: Array<[RegExp, string]> = [
    [/\bbase[-\s]?sep(?:olia)?\b/i, 'base sepolia'],
    [/\beth(?:ereum)?[-\s]?sep(?:olia)?\b/i, 'ethereum sepolia'],
    [/\barb(?:itrum)?[-\s]?sep(?:olia)?\b/i, 'arbitrum sepolia'],
    [/\bop[-\s]?sep(?:olia)?\b|\boptimism[-\s]?sep(?:olia)?\b/i, 'op sepolia'],
    [/\bpoly(?:gon)?[-\s]?amoy\b/i, 'polygon amoy'],
    [/\bavax[-\s]?fuji\b|\bavalanche[-\s]?fuji\b/i, 'avalanche fuji'],
  ];
  for (const [pattern, canonical] of aliases) {
    if (pattern.test(message)) return canonical;
  }

  const chains = [
    'base sepolia',
    'ethereum sepolia',
    'eth sepolia',
    'arbitrum sepolia',
    'avalanche fuji',
    'polygon amoy',
    'optimism sepolia',
    'op sepolia',
    'unichain sepolia',
    'linea sepolia',
    'codex testnet',
    'sonic testnet',
    'world chain sepolia',
    'monad testnet',
    'sei testnet',
    'xdc apothem',
    'hyperevm testnet',
    'ink testnet',
    'plume testnet',
    'edge testnet',
    'injective testnet',
    'morph testnet',
    'pharos atlantic',
    'base',
    'ethereum',
    'arbitrum',
    'fuji',
    'amoy',
  ];
  const lowered = message.toLowerCase();
  return chains.find((chain) => lowered.includes(chain));
}

function looksLikeBridgeToArcRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  const hasBridgeVerb =
    /\b(?:bridge|bridg|move|mv|send|transfer|xfer|port|bring)\b/i.test(normalized) ||
    /\b(?:get|put)\b[\s\S]{0,40}\b(?:funds?|money|usdc|usd|bucks?|buckz)\b[\s\S]{0,40}\b(?:to|onto|on|into)\s+arc\b/i.test(
      normalized,
    );
  const hasArcTarget = /\b(?:to|onto|into|over\s+to|on)\s+arc\b|\barc\b/i.test(normalized);
  const hasSourceLanguage =
    /\b(?:from|frm|fr)\b/i.test(normalized) ||
    Boolean(parseSourceChain(message));
  const hasMoneyLanguage = Boolean(parseFirstAmount(message)) || /\busdc\b|\busd\b|\bbucks?\b|\bbuckz\b/i.test(normalized);

  return hasBridgeVerb && hasArcTarget && (hasSourceLanguage || hasMoneyLanguage);
}

function looksLikeComparativeResearchQuery(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (!/\b(?:vs|versus|compare|comparison)\b/i.test(normalized)) return false;
  if (/\b(?:pay|send|request|invoice|history|contact|schedule|wallet|portfolio)\b/i.test(normalized)) {
    return false;
  }
  return normalized.split(/\s+/).filter(Boolean).length >= 3;
}

function looksLikeTranscribeCapabilityQuestion(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!/\b(voice note|voice memo|audio|transcrib|speech[- ]to[- ]text|turn .* into text)\b/.test(normalized)) {
    return false;
  }
  return /\b(can you|could you|do you|if i send|if i upload|when i send|when i upload|will you)\b/.test(
    normalized,
  );
}

function looksLikeProfileMemoryStatement(message: string): boolean {
  return /\b(?:remember\s+)?my name is\b|\bcall me\b|\bremember me as\b/i.test(message);
}

function looksLikeProfileMemoryRecallQuestion(message: string): boolean {
  return /\b(?:what|which)\s+(?:is\s+)?(?:my\s+)?name\b|\bwhat\s+name\s+did\s+i\s+(?:tell|give)\s+you\b|\bdo\s+you\s+remember\s+my\s+name\b/i.test(
    message,
  );
}

function looksLikeGreeting(message: string): boolean {
  return /^(?:hi|hey|hello|yo|gm|good\s+(?:morning|afternoon|evening))[\s!.]*$/i.test(
    message.trim(),
  );
}

function looksLikeThanks(message: string): boolean {
  return /^(?:thanks?|thank\s+you|ty|appreciate\s+it|nice|cool|great|ok(?:ay)?|got\s+it)[\s!.]*$/i.test(
    message.trim(),
  );
}

function looksLikeCapabilitiesQuestion(message: string): boolean {
  return /\b(?:what\s+(?:all\s+)?can\s+(?:you|i)\s+do|what\s+do\s+you\s+do|how\s+does\s+(?:this|agentflow)\s+work|capabilities|what\s+are\s+you|agentflow\s+on\s+arc|help\s+(?:with|using)\s+agentflow)\b/i.test(
    message,
  );
}

function looksLikeFinancialAdvisoryScopeQuestion(message: string): boolean {
  return (
    /\b(?:can you|could you|will you|would you|are you able to|do you)\b[\s\S]{0,80}\b(?:personal\s+)?(?:fund|funds|portfolio|wealth|money|financial)\s+(?:manager|advisor|adviser|operator|assistant|coach)\b/i.test(
      message,
    ) ||
    /\b(?:manage|run|handle|look after|take care of|be in charge of|invest|allocate|rebalance|optimi[sz]e)\b[\s\S]{0,80}\b(?:my\s+)?(?:funds|portfolio|money|wealth|assets|finances)\b/i.test(
      message,
    ) ||
    /\b(?:make|take)\b[\s\S]{0,50}\b(?:investment|portfolio|money|fund)\s+decisions?\b/i.test(
      message,
    )
  );
}

function looksLikePredictionMarketHelpQuestion(message: string): boolean {
  if (!/\b(?:redeem|refund|cash\s*out|claim|winning|won|market|prediction)\b/i.test(message)) {
    return false;
  }
  if (parseEvmAddress(message)) {
    return false;
  }
  return /\b(?:how|when|why|what\s+happens|can\s+i|could\s+i)\b/i.test(message);
}

function looksLikeClearlyUnclearChat(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (/^[a-z]{6,}$/i.test(trimmed) && !/[aeiou]/i.test(trimmed)) return true;
  return /^(?:show\s+stuff|do\s+the\s+thing|do\s+the\s+thing\s+with\s+the\s+money|stuff|not\s+sure|idk|whatever)$/i.test(
    trimmed,
  );
}

function looksLikeSimpleExternalPersonQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (/\b(?:research|investigate|look up|look into|latest|recent|current|report|deep dive)\b/i.test(trimmed)) {
    return false;
  }
  return /\bwho\s+is\s+[a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,3}\s+from\s+[a-z][a-z0-9&.\s-]{1,60}\??$/i.test(
    trimmed,
  );
}

function hasExplicitResearchRequest(message: string): boolean {
  return isExplicitResearchRequest(message);
}

function buildHeuristicIntent(
  domain: AgentFlowDomain,
  intent: AgentFlowIntentName,
  rawMessage: string,
  confidence: number,
  slots: Record<string, unknown> = {},
): AgentFlowIntent {
  return {
    domain,
    intent,
    slots,
    confidence,
    source: 'fastpath',
    raw_message: rawMessage,
  } as AgentFlowIntent;
}

function hasExplicitNumericAmount(message: string): boolean {
  return parseFirstAmount(message) !== undefined;
}

function stripHallucinatedAmountSlot(intent: AgentFlowIntent): AgentFlowIntent {
  if (!intent.slots || typeof intent.slots !== 'object' || !('amount' in intent.slots)) {
    return intent;
  }

  const { amount: _amount, ...restSlots } = intent.slots as Record<string, unknown>;
  return {
    ...intent,
    slots: restSlots as AgentFlowIntent['slots'],
  } as AgentFlowIntent;
}

function getIntentSlots(intent: AgentFlowIntent): Record<string, unknown> {
  return intent.slots && typeof intent.slots === 'object'
    ? (intent.slots as Record<string, unknown>)
    : {};
}

function hasPlainObjectSlot(slots: Record<string, unknown>, key: string): boolean {
  return typeof slots[key] === 'object' && slots[key] !== null && !Array.isArray(slots[key]);
}

function hasConcreteHeuristicAnchor(intent: AgentFlowIntent): boolean {
  const slots = getIntentSlots(intent);

  switch (intent.intent) {
    case AgentFlowIntentName.SwapExecute:
      return hasPlainObjectSlot(slots, 'token_in') && hasPlainObjectSlot(slots, 'token_out');
    case AgentFlowIntentName.AgentpaySend:
    case AgentFlowIntentName.AgentpayRequest:
      return hasPlainObjectSlot(slots, 'recipient') || hasPlainObjectSlot(slots, 'amount');
    case AgentFlowIntentName.AgentpayPaymentLink:
      return hasPlainObjectSlot(slots, 'recipient') || hasPlainObjectSlot(slots, 'amount');
    case AgentFlowIntentName.AgentpayHistory:
    case AgentFlowIntentName.BalanceGet:
    case AgentFlowIntentName.PortfolioReport:
    case AgentFlowIntentName.ContactsList:
    case AgentFlowIntentName.ScheduleList:
    case AgentFlowIntentName.VaultList:
    case AgentFlowIntentName.VaultPosition:
    case AgentFlowIntentName.PredmarketList:
    case AgentFlowIntentName.PredmarketPosition:
    case AgentFlowIntentName.TreasuryStatus:
    case AgentFlowIntentName.TreasuryTopup:
      return intent.confidence >= 0.82;
    case AgentFlowIntentName.ScheduleCreate:
      return hasPlainObjectSlot(slots, 'schedule');
    case AgentFlowIntentName.ResearchReport:
      return typeof slots.task === 'string' && slots.task.trim().length > 0;
    case AgentFlowIntentName.PredmarketDetail:
    case AgentFlowIntentName.PredmarketBuy:
    case AgentFlowIntentName.PredmarketSell:
    case AgentFlowIntentName.PredmarketRedeem:
    case AgentFlowIntentName.PredmarketRefund:
      return hasPlainObjectSlot(slots, 'market');
    case AgentFlowIntentName.BridgePrecheck:
    case AgentFlowIntentName.BridgeExecute:
      return hasPlainObjectSlot(slots, 'chain') || hasPlainObjectSlot(slots, 'amount');
    case AgentFlowIntentName.SplitExecute:
      return hasPlainObjectSlot(slots, 'total_amount') || Array.isArray(slots.recipients);
    case AgentFlowIntentName.BatchExecute:
      return Array.isArray(slots.payments) || intent.confidence >= 0.86;
    case AgentFlowIntentName.InvoiceCreate:
      return hasPlainObjectSlot(slots, 'recipient') || hasPlainObjectSlot(slots, 'amount');
    case AgentFlowIntentName.InvoiceStatus:
      return intent.confidence >= 0.82;
    case AgentFlowIntentName.VaultDeposit:
    case AgentFlowIntentName.VaultWithdraw:
      return hasPlainObjectSlot(slots, 'amount');
    case AgentFlowIntentName.VisionAnalyze:
    case AgentFlowIntentName.TranscribeTranscribe:
      return hasPlainObjectSlot(slots, 'attachment');
    default:
      return false;
  }
}

function hasHardEvidenceAnchor(message: string): boolean {
  if (parseEvmAddress(message)) return true;
  if (/\b[a-z0-9][a-z0-9-]*\.arc\b/i.test(message)) return true;
  const amount = parseFirstAmount(message);
  if (amount !== undefined && /\b(?:usdc|eurc)\b/i.test(message)) return true;
  return false;
}

function canUseActionHeuristic(intent: AgentFlowIntent | null): intent is AgentFlowIntent {
  return Boolean(
    intent &&
      intent.intent !== AgentFlowIntentName.GeneralChat &&
      intent.confidence >= 0.78 &&
      hasConcreteHeuristicAnchor(intent),
  );
}

function classifyNonExecutableChatHeuristically(message: string): HeuristicIntentResult {
  const trimmed = message.trim();

  if (looksLikeGreeting(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.22,
      { topic_hint: 'greeting' },
    );
  }

  if (looksLikeThanks(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.22,
      { topic_hint: 'thanks' },
    );
  }

  if (looksLikeCapabilitiesQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.28,
      { topic_hint: 'capabilities' },
    );
  }

  if (looksLikeFinancialAdvisoryScopeQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.38,
      { topic_hint: 'financial_advisory_scope' },
    );
  }

  if (looksLikeProfileMemoryStatement(trimmed) || looksLikeProfileMemoryRecallQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.34,
      { topic_hint: 'profile_memory' },
    );
  }

  if (looksLikeSimpleExternalPersonQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.36,
      { topic_hint: 'external_person_unknown' },
    );
  }

  if (looksLikeTranscribeCapabilityQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.76,
      { topic_hint: 'transcribe_capability' },
    );
  }

  if (looksLikePredictionMarketHelpQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.42,
      { topic_hint: 'predmarket_redeem_help' },
    );
  }

  if (looksLikeClearlyUnclearChat(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.2,
      { topic_hint: 'unclear' },
    );
  }

  return null;
}

function reconcileRouterResult(
  intent: AgentFlowIntent,
  message: string,
  conversationHistory?: IntentRouterHistoryMessage[],
): AgentFlowIntent {
  if (
    intent.intent === AgentFlowIntentName.AgentpayPaymentLink &&
    isOwnAgentpayAddressRequest(message)
  ) {
    intent = {
      ...intent,
      slots: {
        ...(intent.slots as unknown as Record<string, unknown>),
        recipient: { handle: AGENTPAY_SELF_RECIPIENT_HANDLE },
      },
    } as AgentFlowIntent;
  }

  const capabilityRouting = analyzeCapabilityAwareRouting(message);
  const explicitResearchRequest = hasExplicitResearchRequest(message);
  if (
    capabilityRouting.bridge.routeToClarify ||
    capabilityRouting.vault.routeToClarify ||
    capabilityRouting.swap.routeToClarify
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.42,
      { topic_hint: 'capability_ambiguity' },
    );
  }
  if (
    explicitResearchRequest &&
    looksLikePredictionMarketResearch(message) &&
    intent.intent !== AgentFlowIntentName.ResearchReport
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: message.trim() },
    );
  }

  if (
    explicitResearchRequest &&
    looksLikeSwapResearch(message) &&
    capabilityRouting.swap.routeToResearch &&
    intent.intent !== AgentFlowIntentName.ResearchReport
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: message.trim() },
    );
  }

  if (
    explicitResearchRequest &&
    looksLikeBridgeResearch(message) &&
    capabilityRouting.bridge.routeToResearch &&
    intent.intent !== AgentFlowIntentName.ResearchReport
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: message.trim() },
    );
  }

  if (
    explicitResearchRequest &&
    intent.intent !== AgentFlowIntentName.ResearchReport &&
    (
      capabilityRouting.bridge.routeToResearch ||
      capabilityRouting.vault.routeToResearch ||
      capabilityRouting.swap.routeToResearch ||
      capabilityRouting.predmarket.routeToResearch ||
      capabilityRouting.counterpartyRisk.routeToResearch
    )
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: message.trim() },
    );
  }

  if (
    explicitResearchRequest &&
    intent.intent === AgentFlowIntentName.VaultList &&
    !isVaultDiscoveryIntent(message) &&
    looksLikeGeneralYieldResearch(message)
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: message.trim() },
    );
  }

  if (
    isVaultPositionRequest(message) &&
    intent.intent !== AgentFlowIntentName.VaultPosition
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Vault,
      AgentFlowIntentName.VaultPosition,
      message,
      0.92,
      {},
    );
  }

  const portfolioRequestMode = classifyPortfolioRequestMode(message);
  if (portfolioRequestMode === 'snapshot' && intent.intent !== AgentFlowIntentName.PortfolioReport) {
    return buildHeuristicIntent(
      AgentFlowDomain.Portfolio,
      AgentFlowIntentName.PortfolioReport,
      message,
      0.9,
      {},
    );
  }
  if (portfolioRequestMode === 'clarify' && intent.intent === AgentFlowIntentName.PortfolioReport) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.82,
      { topic_hint: 'portfolio_help' },
    );
  }
  if (portfolioRequestMode === 'discussion' && intent.intent === AgentFlowIntentName.PortfolioReport) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.82,
      { topic_hint: 'portfolio_discussion' },
    );
  }

  if (detectPortfolioImpactIntent(message) && intent.intent !== AgentFlowIntentName.ResearchReport) {
    const task = stripPortfolioImpactPhrasing(message);
    console.warn('[INTENT_ROUTER_PORTFOLIO_IMPACT_OVERRIDE]', {
      raw_message: truncateForLog(message),
      original_intent: intent.intent,
      recovered_intent: AgentFlowIntentName.ResearchReport,
    });
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.9,
      { task, topic_hint: task, portfolio_impact: true },
    );
  }

  if (
    looksLikeProfileMemoryStatement(message) &&
    intent.intent !== AgentFlowIntentName.GeneralChat
  ) {
    console.warn('[INTENT_ROUTER_PROFILE_MEMORY_OVERRIDE]', {
      raw_message: truncateForLog(message),
      original_intent: intent.intent,
    });
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.34,
      { topic_hint: 'profile_memory' },
    );
  }

  if (
    looksLikeSimpleExternalPersonQuestion(message) &&
    intent.intent !== AgentFlowIntentName.GeneralChat
  ) {
    console.warn('[INTENT_ROUTER_EXTERNAL_PERSON_OVERRIDE]', {
      raw_message: truncateForLog(message),
      original_intent: intent.intent,
    });
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.36,
      { topic_hint: 'external_person_unknown' },
    );
  }

  if (
    looksLikeTranscribeCapabilityQuestion(message) &&
    (intent.intent === AgentFlowIntentName.AgentpaySend ||
      intent.intent === AgentFlowIntentName.AgentpayRequest)
  ) {
    console.warn('[INTENT_ROUTER_TRANSCRIBE_CAPABILITY_OVERRIDE]', {
      raw_message: truncateForLog(message),
      original_intent: intent.intent,
    });
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.72,
      { topic_hint: 'transcribe_capability' },
    );
  }

  const heuristic = classifyIntentHeuristically(message, conversationHistory);

  if (
    intent.intent === AgentFlowIntentName.GeneralChat &&
    canUseActionHeuristic(heuristic) &&
    hasHardEvidenceAnchor(message)
  ) {
    console.warn('[INTENT_ROUTER_HEURISTIC_OVERRIDE]', {
      raw_message: truncateForLog(message),
      original_intent: intent.intent,
      recovered_intent: heuristic.intent,
    });
    return heuristic;
  }

  const amountSensitiveIntents = new Set<AgentFlowIntentName>([
    AgentFlowIntentName.AgentpaySend,
    AgentFlowIntentName.AgentpayRequest,
    AgentFlowIntentName.AgentpayPaymentLink,
    AgentFlowIntentName.ScheduleCreate,
    AgentFlowIntentName.SwapExecute,
    AgentFlowIntentName.BridgeExecute,
    AgentFlowIntentName.SplitExecute,
  ]);

  if (!hasExplicitNumericAmount(message) && amountSensitiveIntents.has(intent.intent)) {
    const maybeAmount = (intent.slots as Record<string, unknown> | undefined)?.amount;
    if (maybeAmount && typeof maybeAmount === 'object') {
      console.warn('[INTENT_ROUTER_STRIP_HALLUCINATED_AMOUNT]', {
        raw_message: truncateForLog(message),
        intent: intent.intent,
      });
      return stripHallucinatedAmountSlot(intent);
    }
  }

  return intent;
}

function classifyIntentHeuristically(
  message: string,
  conversationHistory?: IntentRouterHistoryMessage[],
): HeuristicIntentResult {
  const trimmed = message.trim();
  const capabilityRouting = analyzeCapabilityAwareRouting(trimmed);
  const explicitResearchRequest = hasExplicitResearchRequest(trimmed);
  const amount = parseFirstAmount(trimmed);
  const currency = parseCurrencyHint(trimmed);
  const recipient = parseRecipient(trimmed);
  const swapTokens = parseSwapTokenPair(trimmed);
  const bridgeSource = parseSourceChain(trimmed);

  if (!trimmed) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.2,
      { topic_hint: 'unclear' },
    );
  }

  if (isAmbiguousPredictionMarketIntent(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.9,
      { topic_hint: 'predmarket_ambiguity' },
    );
  }

  if (isVaultPositionRequest(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.Vault,
      AgentFlowIntentName.VaultPosition,
      message,
      0.92,
      {},
    );
  }

  const portfolioRequestMode = classifyPortfolioRequestMode(trimmed);
  if (portfolioRequestMode === 'clarify') {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.82,
      { topic_hint: 'portfolio_help' },
    );
  }
  if (portfolioRequestMode === 'discussion') {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.82,
      { topic_hint: 'portfolio_discussion' },
    );
  }

  const nonExecutableChat = classifyNonExecutableChatHeuristically(message);
  if (nonExecutableChat) {
    return nonExecutableChat;
  }

  if (looksLikeProfileMemoryStatement(trimmed) || looksLikeProfileMemoryRecallQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.34,
      { topic_hint: 'profile_memory' },
    );
  }

  if (looksLikeSimpleExternalPersonQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.36,
      { topic_hint: 'external_person_unknown' },
    );
  }

  if (
    capabilityRouting.bridge.routeToClarify ||
    capabilityRouting.vault.routeToClarify ||
    capabilityRouting.swap.routeToClarify
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.42,
      { topic_hint: 'capability_ambiguity' },
    );
  }

  if (looksLikeTranscribeCapabilityQuestion(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.76,
      { topic_hint: 'transcribe_capability' },
    );
  }

  if (
    (explicitResearchRequest && looksLikePredictionMarketResearch(trimmed)) ||
    (explicitResearchRequest && looksLikeSwapResearch(trimmed) && capabilityRouting.swap.routeToResearch) ||
    (explicitResearchRequest && looksLikeBridgeResearch(trimmed) && capabilityRouting.bridge.routeToResearch) ||
    (explicitResearchRequest && looksLikeComparativeResearchQuery(trimmed))
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      looksLikePredictionMarketResearch(trimmed) ? 0.96 : 0.88,
      { task: trimmed },
    );
  }

  if (explicitResearchRequest && capabilityRouting.predmarket.routeToResearch) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: trimmed },
    );
  }

  if (
    explicitResearchRequest &&
    !/\b(?:image|screenshot|photo|audio|voice\s+note|attached|attachment)\b/i.test(trimmed)
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: trimmed },
    );
  }

  if (isPredictionMarketBrowseIntent(trimmed) && capabilityRouting.predmarket.routeToFeature) {
    return buildHeuristicIntent(
      AgentFlowDomain.Predmarket,
      AgentFlowIntentName.PredmarketList,
      message,
      0.88,
      {},
    );
  }

  const evmAddress = parseEvmAddress(trimmed);
  if (
    evmAddress &&
    /\b(?:prediction\s+market|predmarket|market|bet)\b/i.test(trimmed) &&
    /\b(?:tell\s+me\s+about|details?|info|show|open|view|what\s+is|about)\b/i.test(trimmed)
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Predmarket,
      AgentFlowIntentName.PredmarketDetail,
      message,
      0.9,
      { market: { address: evmAddress }, provider: 'achmarket' },
    );
  }

  if (evmAddress && /\b(?:bet|buy|long)\b/i.test(trimmed) && /\b(?:yes|no)\b/i.test(trimmed)) {
    const outcome = parsePredictionOutcome(trimmed);
    return buildHeuristicIntent(
      AgentFlowDomain.Predmarket,
      AgentFlowIntentName.PredmarketBuy,
      message,
      0.86,
      {
        market: { address: evmAddress },
        provider: 'achmarket',
        confirmed: false,
        ...(outcome ? { outcome: { label: outcome } } : {}),
        ...(amount ? { amount: { value: amount, ...(currency ? { currency } : { currency: 'USDC' }) } } : {}),
      },
    );
  }

  if (evmAddress && /\b(?:sell|dump|unload|exit)\b/i.test(trimmed) && /\b(?:yes|no|share|shares)\b/i.test(trimmed)) {
    const outcome = parsePredictionOutcome(trimmed);
    return buildHeuristicIntent(
      AgentFlowDomain.Predmarket,
      AgentFlowIntentName.PredmarketSell,
      message,
      0.86,
      {
        market: { address: evmAddress },
        provider: 'achmarket',
        confirmed: false,
        ...(outcome ? { outcome: { label: outcome } } : {}),
        ...(amount ? { shares: { value: String(amount) } } : {}),
      },
    );
  }

  if (evmAddress && /\b(?:redeem|cash\s*out|claim|collect)\b/i.test(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.Predmarket,
      AgentFlowIntentName.PredmarketRedeem,
      message,
      0.86,
      { market: { address: evmAddress }, confirmed: false },
    );
  }

  if (evmAddress && /\b(?:refund|canceled|cancelled|money\s+back)\b/i.test(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.Predmarket,
      AgentFlowIntentName.PredmarketRefund,
      message,
      0.86,
      { market: { address: evmAddress }, confirmed: false },
    );
  }

  if (/\b(set up|make|do)\b.*\b(payment)\b.*\b(every|weekly|monthly|daily)\b/i.test(trimmed)) {
    const cadence = trimmed.match(/\b(every [a-z]+(?: [a-z]+)?|weekly|monthly|daily|every month|every week)\b/i)?.[1] ?? trimmed;
    return buildHeuristicIntent(
      AgentFlowDomain.Schedule,
      AgentFlowIntentName.ScheduleCreate,
      message,
      0.84,
      {
        ...(recipient ? { recipient } : {}),
        ...(amount ? { amount: { value: amount, ...(currency ? { currency } : {}) } } : {}),
        schedule: { cadence: cadence.toLowerCase() },
      },
    );
  }

  if (/^(?:what(?:'s| is)(?:\s+in)?\s+my\s+wallet)$/i.test(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.Portfolio,
      AgentFlowIntentName.PortfolioReport,
      message,
      0.9,
      {},
    );
  }

  if (/\b(balance|wallet balance|how much money|how much do i got|how much do i have)\b/i.test(trimmed)) {
    return buildHeuristicIntent(AgentFlowDomain.Balance, AgentFlowIntentName.BalanceGet, message, 0.82, {});
  }

  if (detectPortfolioImpactIntent(trimmed)) {
    const task = stripPortfolioImpactPhrasing(trimmed);
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.9,
      { task, topic_hint: task, portfolio_impact: true },
    );
  }

  if (portfolioRequestMode === 'snapshot') {
    return buildHeuristicIntent(
      AgentFlowDomain.Portfolio,
      AgentFlowIntentName.PortfolioReport,
      message,
      0.82,
      {},
    );
  }

  if (explicitResearchRequest && capabilityRouting.vault.routeToResearch) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: trimmed },
    );
  }

  if (isVaultDiscoveryIntent(trimmed) && capabilityRouting.vault.routeToFeature) {
    return buildHeuristicIntent(
      AgentFlowDomain.Vault,
      AgentFlowIntentName.VaultList,
      message,
      0.86,
      {},
    );
  }

  if (explicitResearchRequest && capabilityRouting.swap.routeToResearch) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: trimmed },
    );
  }

  if (swapTokens && isSwapExecutionIntent(trimmed) && capabilityRouting.swap.routeToFeature) {
    return buildHeuristicIntent(
      AgentFlowDomain.Swap,
      AgentFlowIntentName.SwapExecute,
      message,
      amount ? 0.86 : 0.78,
      {
        confirmed: false,
        ...(amount ? { amount: { value: amount, ...(currency ? { currency } : {}) } } : {}),
        ...(swapTokens.token_in ? { token_in: { symbol: swapTokens.token_in } } : {}),
        ...(swapTokens.token_out ? { token_out: { symbol: swapTokens.token_out } } : {}),
      },
    );
  }

  if (explicitResearchRequest && capabilityRouting.bridge.routeToResearch) {
    return buildHeuristicIntent(
      AgentFlowDomain.Research,
      AgentFlowIntentName.ResearchReport,
      message,
      0.88,
      { task: trimmed },
    );
  }

  if (
    capabilityRouting.bridge.routeToFeature &&
    (isBridgeExecutionIntent(trimmed) || (looksLikeBridgeToArcRequest(trimmed) && !looksLikeBridgeResearch(trimmed)))
  ) {
    const isPrecheck =
      /\b(?:can|could|check|ready|possible|supported|support|which|where|what\s+chain|balance|balances)\b/i.test(
        trimmed,
      ) || !amount;
    return buildHeuristicIntent(
      AgentFlowDomain.Bridge,
      isPrecheck ? AgentFlowIntentName.BridgePrecheck : AgentFlowIntentName.BridgeExecute,
      message,
      amount || bridgeSource ? 0.82 : 0.78,
      {
        confirmed: false,
        ...(amount ? { amount: { value: amount, ...(currency ? { currency } : { currency: 'USDC' }) } } : {}),
        ...(bridgeSource ? { chain: { source: bridgeSource, target: 'arc' } } : {}),
      },
    );
  }

  if (
    /\b(?:show|list|view|check|pull|get|see|display|what|which)\b[\s\S]{0,80}\b(?:market|markets|prediction\s+bets?|bets?)\b[\s\S]{0,80}\b(?:position|positions|holding|holdings|own|owned)\b/i.test(trimmed) ||
    /\b(?:market|markets|prediction\s+bets?|bets?)\b[\s\S]{0,80}\b(?:position|positions|holding|holdings|own|owned)\b/i.test(trimmed)
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.Predmarket,
      AgentFlowIntentName.PredmarketPosition,
      message,
      0.86,
      {},
    );
  }

  if (
    !(
      /\b(?:how|explain|about|format|example|examples)\b/i.test(trimmed) &&
      /\b(?:split|batch|scheduled?|recurring|payment\s+link|pay\s+link|invoice|request)\b/i.test(trimmed) &&
      !/\b(?:history|recent|latest|last|previous|earlier|records?|activity|transactions?)\b/i.test(trimmed)
    ) &&
    (
    /\b(?:show|list|view|check|pull|get|see|display)\b[\s\S]{0,80}\b(?:agentpay|payment|payments|pay|paid|sent|received|transfer|transfers|transaction|transactions|activity|records?)\b/i.test(trimmed) ||
    /\b(?:agentpay|payment|payments|pay|paid|sent|received|transfer|transfers|transaction|transactions|activity|records?)\b[\s\S]{0,80}\b(?:show|list|view|check|pull|get|see|display|history|records?|activity)\b/i.test(trimmed) ||
    /\b(recent payments|payment history|transfers have i sent|payment activity)\b/i.test(trimmed) ||
    /\bwhat\s+(?:payments|transfers|transactions)\s+have\s+i\s+(?:sent|made|received)\b/i.test(trimmed) ||
    /\b(?:payments|transfers|transactions)\s+(?:i\s+)?(?:sent|made|received)\b/i.test(trimmed) ||
    /\bwhat\s+have\s+i\s+(?:sent|paid|received)\b/i.test(trimmed)
    )
  ) {
    return buildHeuristicIntent(
      AgentFlowDomain.AgentPay,
      AgentFlowIntentName.AgentpayHistory,
      message,
      0.84,
      {},
    );
  }

  if (/\b(payment link|pay link|qr|scan to pay)\b/i.test(trimmed)) {
    const remark = extractAgentpayRemark(trimmed);
    const paymentLinkRecipient = isOwnAgentpayAddressRequest(trimmed)
      ? { handle: AGENTPAY_SELF_RECIPIENT_HANDLE }
      : recipient;
    return buildHeuristicIntent(
      AgentFlowDomain.AgentPay,
      AgentFlowIntentName.AgentpayPaymentLink,
      message,
      0.82,
      {
        ...(paymentLinkRecipient ? { recipient: paymentLinkRecipient } : {}),
        ...(amount ? { amount: { value: amount, ...(currency ? { currency } : {}) } } : {}),
        ...(remark ? { remark } : {}),
      },
    );
  }

  if (/\bhow\s+(?:do\s+i|to|can\s+i|should\s+i)\s+(?:send|pay|transfer|request)\b/i.test(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.General,
      AgentFlowIntentName.GeneralChat,
      message,
      0.84,
      { topic_hint: 'agentpay_howto' },
    );
  }

  if (/\b(request|ask)\b.*\b(pay|usdc|eurc|usd)\b/i.test(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.AgentPay,
      AgentFlowIntentName.AgentpayRequest,
      message,
      0.82,
      {
        ...(recipient ? { recipient } : {}),
        ...(amount ? { amount: { value: amount, ...(currency ? { currency } : {}) } } : {}),
      },
    );
  }

  if (/\b(pay|send|snd|transfer)\b/i.test(trimmed) && !/\bevery\b|\bweekly\b|\bmonthly\b|\bfriday\b|\bmonday\b/i.test(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.AgentPay,
      AgentFlowIntentName.AgentpaySend,
      message,
      0.8,
      {
        ...(recipient ? { recipient } : {}),
        ...(amount ? { amount: { value: amount, ...(currency ? { currency } : {}) } } : {}),
      },
    );
  }

  if (/\b(every|weekly|monthly|daily|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/i.test(trimmed) && /\bpay\b|\bsend\b|\bsnd\b/.test(trimmed)) {
    const cadence = trimmed.match(/\b(every [a-z]+|weekly|monthly|daily|every month|every week|every friday morning)\b/i)?.[1] ?? trimmed;
    const remark = extractAgentpayRemark(trimmed);
    return buildHeuristicIntent(
      AgentFlowDomain.Schedule,
      AgentFlowIntentName.ScheduleCreate,
      message,
      0.82,
      {
        ...(recipient ? { recipient } : {}),
        ...(amount ? { amount: { value: amount, ...(currency ? { currency } : {}) } } : {}),
        schedule: { cadence: cadence.toLowerCase() },
        ...(remark ? { remark } : {}),
      },
    );
  }

  if (/\b(split|divide)\b/i.test(trimmed)) {
    const remark = extractAgentpayRemark(trimmed);
    return buildHeuristicIntent(
      AgentFlowDomain.Split,
      AgentFlowIntentName.SplitExecute,
      message,
      0.78,
      {
        ...(amount ? { total_amount: { value: amount, ...(currency ? { currency } : {}) } } : {}),
        ...(remark ? { remark } : {}),
      },
    );
  }

  if (/\b(batch|payroll)\b/i.test(trimmed)) {
    return buildHeuristicIntent(
      AgentFlowDomain.Batch,
      AgentFlowIntentName.BatchExecute,
      message,
      0.8,
      {},
    );
  }

  return null;
}

export async function classifyIntent(
  message: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<AgentFlowIntent> {
  const startedAt = Date.now();
  const raw_message = message;
  const messages = buildMessages(message, conversationHistory);
  const history_length = Math.max(0, messages.length - 2);

  console.info('[INTENT_ROUTER_REQUEST]', {
    raw_message: truncateForLog(raw_message),
    history_length,
  });

  const earlyHeuristic = classifyIntentHeuristically(message, conversationHistory);
  const earlySlots =
    earlyHeuristic?.slots && typeof earlyHeuristic.slots === 'object'
      ? (earlyHeuristic.slots as Record<string, unknown>)
      : null;
  const earlyTopicHint = typeof earlySlots?.topic_hint === 'string' ? earlySlots.topic_hint : null;
  const TRIVIAL_CHAT_FASTPATH_HINTS = new Set(['greeting', 'thanks', 'unclear', 'profile_memory']);
  if (
    earlyHeuristic?.intent === AgentFlowIntentName.PredmarketDetail ||
    (earlyHeuristic?.intent === AgentFlowIntentName.GeneralChat &&
      earlyTopicHint !== null &&
      TRIVIAL_CHAT_FASTPATH_HINTS.has(earlyTopicHint))
  ) {
    const latency_ms = Date.now() - startedAt;
    console.info('[INTENT_ROUTER_FASTPATH]', {
      raw_message: truncateForLog(raw_message),
      intent: earlyHeuristic.intent,
      ...(earlyTopicHint ? { topic_hint: earlyTopicHint } : {}),
      latency_ms,
    });
    return earlyHeuristic;
  }

  const parseResponse = (
    response: Awaited<ReturnType<typeof attemptClassify>>,
    latency_ms: number,
  ): IntentRouterPayload => {
    const content = response.choices[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new IntentRouterParseError('Router returned empty content', latency_ms, response);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new IntentRouterParseError('Router returned invalid JSON', latency_ms, error);
    }

    validateRouterPayload(parsed, latency_ms);
    return parsed;
  };

  const buildResult = (parsed: IntentRouterPayload, latency_ms: number): AgentFlowIntent => {
    const rawResult = {
      ...parsed,
      source: 'llm_router',
      raw_message,
    } as AgentFlowIntent;
    const result = reconcileRouterResult(rawResult, message, conversationHistory);

    console.info('[INTENT_ROUTER_RESPONSE]', {
      domain: result.domain,
      intent: result.intent,
      confidence: result.confidence,
      latency_ms,
      success: true,
    });

    return result;
  };

  try {
    try {
      const response = await attemptClassify(messages, ROUTER_PRIMARY_TIMEOUT_MS);
      const latency_ms = Date.now() - startedAt;
      const parsed = parseResponse(response, latency_ms);
      return buildResult(parsed, latency_ms);
    } catch (error) {
      if (
        !(
          error instanceof IntentRouterParseError ||
          error instanceof IntentRouterTimeoutError ||
          error instanceof IntentRouterRequestError ||
          error instanceof IntentRouterSchemaError
        )
      ) {
        throw error;
      }

      const elapsed = Date.now() - startedAt;
      const remaining = ROUTER_TOTAL_TIMEOUT_MS - elapsed;
      if (remaining < 1500) {
        throw error;
      }

      console.warn('[INTENT_ROUTER_RETRY]', {
        raw_message: truncateForLog(raw_message),
        first_latency_ms: elapsed,
        error_class: error.name,
      });

      const retryMessages = buildMessages(
        message,
        conversationHistory,
        buildRetryPrompt(),
      );
      const retryResponse = await attemptClassify(retryMessages, remaining);
      const retryLatency = Date.now() - startedAt;
      const retryParsed = parseResponse(retryResponse, retryLatency);

      console.info('[INTENT_ROUTER_RETRY_SUCCESS]', {
        intent: retryParsed.intent,
        latency_ms: retryLatency,
      });

      return buildResult(retryParsed, retryLatency);
    }
  } catch (error) {
    const latency_ms = Date.now() - startedAt;
    const wrappedError =
      error instanceof IntentRouterError
        ? error
        : new IntentRouterRequestError('Intent router request failed', latency_ms, error);

    const heuristic = classifyIntentHeuristically(message, conversationHistory);
    if (canUseActionHeuristic(heuristic)) {
      console.warn('[INTENT_ROUTER_HEURISTIC_FALLBACK]', {
        raw_message: truncateForLog(raw_message),
        recovered_intent: heuristic.intent,
        latency_ms,
        error_class: wrappedError.name,
      });
      return heuristic;
    }

    if (wrappedError instanceof IntentRouterTimeoutError) {
      const timeoutFallback =
        heuristic ??
        buildHeuristicIntent(
          AgentFlowDomain.General,
          AgentFlowIntentName.GeneralChat,
          message,
          0.22,
          { topic_hint: 'router_timeout' },
        );
      console.warn('[INTENT_ROUTER_TIMEOUT_FALLBACK]', {
        raw_message: truncateForLog(raw_message),
        recovered_intent: timeoutFallback.intent,
        latency_ms,
      });
      return timeoutFallback;
    }

    if (
      wrappedError instanceof IntentRouterParseError ||
      wrappedError instanceof IntentRouterSchemaError
    ) {
      const parseFallback = buildHeuristicIntent(
        AgentFlowDomain.General,
        AgentFlowIntentName.GeneralChat,
        message,
        0.2,
        { topic_hint: 'router_parse_fallback' },
      );
      console.warn('[INTENT_ROUTER_PARSE_FALLBACK]', {
        raw_message: truncateForLog(raw_message),
        recovered_intent: parseFallback.intent,
        latency_ms,
        error_class: wrappedError.name,
      });
      return parseFallback;
    }

    console.error('[INTENT_ROUTER_ERROR]', {
      raw_message: truncateForLog(raw_message),
      error_class: wrappedError.name,
      latency_ms,
    });

    throw wrappedError;
  }
}
