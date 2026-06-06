import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adminDb } from '../db/client';
import type { BrainEvent } from './brain-telemetry';

type TelegramRoutingEvent = {
  at: string;
  chatId: number;
  text: string;
  policy: 'chat' | 'clarify' | 'dispatch';
  reason: string;
  classifiedIntent?: string;
  classifiedDomain?: string;
  confidence?: number;
  validationSeverity?: 'pass' | 'soft' | 'hard';
};

export type ConversationReviewLabel =
  | 'correct'
  | 'wrong_intent'
  | 'needs_clarification'
  | 'should_use_tool'
  | 'bad_fallback'
  | 'infra_failure'
  | 'ignore';

export type ConversationReviewCase = {
  id: string;
  kind:
    | 'wrong_intent'
    | 'bad_fallback'
    | 'infra_failure'
    | 'missed_clarification'
    | 'tool_should_have_been_used';
  at: string;
  firstSeenAt: string;
  source: 'brain_event' | 'telegram_routing';
  channel: 'web' | 'telegram';
  walletAddress: string | null;
  sessionId: string | null;
  query: string;
  observedIntent: string | null;
  observedLayer: string | null;
  observedPolicy: string | null;
  reason: string | null;
  responseSummary: string | null;
  occurrenceCount: number;
  recommendedLabel: Exclude<ConversationReviewLabel, 'correct' | 'ignore'>;
  recommendationReason: string;
  reviewLabel: ConversationReviewLabel | null;
  reviewNote: string | null;
};

type StoredReviewLabel = {
  label: ConversationReviewLabel;
  note?: string | null;
  updatedAt: string;
};

const TELEGRAM_ROUTING_LOG_FILE = path.join(
  process.cwd(),
  '.agentflow-telemetry',
  'telegram-routing-events.jsonl',
);
const REVIEW_DIR = path.join(process.cwd(), '.agentflow-memory');
const REVIEW_FILE = path.join(REVIEW_DIR, 'conversation-review-labels.json');

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function shortSummary(value: string | null | undefined, max = 240): string | null {
  if (!value) return null;
  const clean = normalizeText(value);
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}

function hasOperationalSignals(text: string): boolean {
  return /\b(?:send|pay|transfer|request|invoice|history|schedule|split|batch|contact|swap|vault|bridge|portfolio|balance|holdings|positions|funds|wallet|market|predmarket|prediction|redeem|refund|deposit|withdraw|claim|buy|sell|research|report)\b/i.test(
    text,
  );
}

function isIdentityOrPreferenceQuery(text: string): boolean {
  return /\b(?:my name|remember my name|what'?s my name|who am i|call me|preference|prefer|style|how should you answer|what do you remember)\b/i.test(
    text,
  );
}

function isMixedClarificationQuery(text: string): boolean {
  const wantsIdentity = /\b(?:my name|remember my name|what'?s my name)\b/i.test(text);
  const wantsPolicy = /\b(?:telegram|policy|routing|intent|router|fallback)\b/i.test(text);
  const wantsTooling = hasOperationalSignals(text);
  return Number(wantsIdentity) + Number(wantsPolicy) + Number(wantsTooling) > 1;
}

function isSocialOrHarmlessChat(text: string): boolean {
  return /\b(?:hello|hi|hey|thanks|thank you|how are you|who built you|what time|vacation|love you)\b/i.test(
    text,
  );
}

function hasInfraFailure(reason: string | null | undefined, responseSummary: string | null | undefined): boolean {
  const haystack = `${reason ?? ''} ${responseSummary ?? ''}`;
  return /\b(?:fetch failed|timeout|timed out|error executing|unreachable|service unavailable|backend is running|could not reach|connection reset|no reply streamed)\b/i.test(
    haystack,
  );
}

function recommendationForCase(
  kind: ConversationReviewCase['kind'],
  query: string,
): {
  recommendedLabel: Exclude<ConversationReviewLabel, 'correct' | 'ignore'>;
  recommendationReason: string;
} {
  if (kind === 'infra_failure') {
    return {
      recommendedLabel: 'infra_failure',
      recommendationReason:
        'The system reached the right surface, but a backend/tool dependency failed. This is an infrastructure reliability issue, not a routing win.',
    };
  }
  if (kind === 'tool_should_have_been_used') {
    return {
      recommendedLabel: 'should_use_tool',
      recommendationReason:
        'The user asked for grounded product or wallet state, so deterministic tool execution should have been used instead of a freeform fallback.',
    };
  }
  if (kind === 'bad_fallback') {
    return {
      recommendedLabel: 'bad_fallback',
      recommendationReason:
        'A freeform fallback answered a grounded or sensitive request. The fallback should have been blocked or rerouted.',
    };
  }
  if (kind === 'missed_clarification' || isMixedClarificationQuery(query)) {
    return {
      recommendedLabel: 'needs_clarification',
      recommendationReason:
        'The request mixes multiple intents or lacks enough structure, so the system should have asked a clarification question instead of forcing a route.',
    };
  }
  return {
    recommendedLabel: 'wrong_intent',
    recommendationReason:
      'The turn was interpreted into the wrong intent or policy path, so the classifier/router should be corrected.',
  };
}

async function loadReviewLabels(): Promise<Record<string, StoredReviewLabel>> {
  const raw = await readFile(REVIEW_FILE, 'utf8').catch(() => '');
  if (!raw.trim()) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredReviewLabel>) : {};
}

async function saveReviewLabels(labels: Record<string, StoredReviewLabel>): Promise<void> {
  await mkdir(REVIEW_DIR, { recursive: true });
  await writeFile(REVIEW_FILE, JSON.stringify(labels, null, 2), 'utf8');
}

function buildCaseId(
  source: ConversationReviewCase['source'],
  kind: ConversationReviewCase['kind'],
  query: string,
  discriminator: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ source, kind, query: normalizeText(query).toLowerCase(), ...discriminator }))
    .digest('hex')
    .slice(0, 24);
}

function buildDeduplicationKey(
  source: ConversationReviewCase['source'],
  kind: ConversationReviewCase['kind'],
  query: string,
  discriminator: Record<string, unknown>,
): string {
  return JSON.stringify({
    source,
    kind,
    query: normalizeText(query).toLowerCase(),
    ...discriminator,
  });
}

async function loadRecentBrainEvents(limit = 300): Promise<BrainEvent[]> {
  const { data, error } = await adminDb
    .from('brain_events')
    .select(
      'id, session_id, wallet_address, created_at, user_input, intent_label, final_intent, layer_used, validator_passed, outcome, failure_reason, final_response_summary',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[conversation-review] brain_events read failed:', error.message);
    return [];
  }
  return (data ?? []) as BrainEvent[];
}

async function loadTelegramRoutingEvents(): Promise<TelegramRoutingEvent[]> {
  const raw = await readFile(TELEGRAM_ROUTING_LOG_FILE, 'utf8').catch(() => '');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TelegramRoutingEvent);
}

function buildCaseFromBrainEvent(
  event: BrainEvent,
  labels: Record<string, StoredReviewLabel>,
): ConversationReviewCase | null {
  const query = normalizeText(event.user_input ?? '');
  if (!query) return null;

  let kind: ConversationReviewCase['kind'] | null = null;
  if (hasInfraFailure(event.failure_reason, event.final_response_summary)) {
    kind = 'infra_failure';
  } else if (
    event.layer_used === 'hermes_agent' &&
    hasOperationalSignals(query) &&
    !isSocialOrHarmlessChat(query)
  ) {
    kind = 'tool_should_have_been_used';
  } else if (
    event.layer_used === 'hermes_agent' &&
    isMixedClarificationQuery(query)
  ) {
    kind = 'missed_clarification';
  } else if (
    event.layer_used === 'hermes_agent' &&
    isIdentityOrPreferenceQuery(query) &&
    !event.final_intent
  ) {
    kind = 'bad_fallback';
  }

  if (!kind) return null;

  const id = buildCaseId('brain_event', kind, query, {
    wallet: (event.wallet_address ?? '').toLowerCase(),
    layer: event.layer_used ?? '',
    intent: event.final_intent ?? event.intent_label ?? '',
  });
  const stored = labels[id];
  const recommendation = recommendationForCase(kind, query);

  return {
    id,
    kind,
    at: event.created_at,
    firstSeenAt: event.created_at,
    source: 'brain_event',
    channel: 'web',
    walletAddress: event.wallet_address ?? null,
    sessionId: event.session_id ?? null,
    query,
    observedIntent: event.final_intent ?? event.intent_label ?? null,
    observedLayer: event.layer_used ?? null,
    observedPolicy: null,
    reason: shortSummary(event.failure_reason),
    responseSummary: shortSummary(event.final_response_summary),
    occurrenceCount: 1,
    recommendedLabel: recommendation.recommendedLabel,
    recommendationReason: recommendation.recommendationReason,
    reviewLabel: stored?.label ?? null,
    reviewNote: stored?.note ?? null,
  };
}

function buildCaseFromTelegramEvent(
  event: TelegramRoutingEvent,
  labels: Record<string, StoredReviewLabel>,
): ConversationReviewCase | null {
  const query = normalizeText(event.text ?? '');
  if (!query) return null;

  let kind: ConversationReviewCase['kind'] | null = null;
  if (event.policy === 'chat' && hasOperationalSignals(query) && !isSocialOrHarmlessChat(query)) {
    kind = 'wrong_intent';
  } else if (event.policy === 'chat' && isIdentityOrPreferenceQuery(query)) {
    kind = isMixedClarificationQuery(query) ? 'missed_clarification' : 'wrong_intent';
  } else if (event.policy === 'clarify' && !isMixedClarificationQuery(query) && hasOperationalSignals(query)) {
    kind = 'wrong_intent';
  }

  if (!kind) return null;

  const id = buildCaseId('telegram_routing', kind, query, {
    chatId: event.chatId,
    policy: event.policy,
    intent: event.classifiedIntent ?? '',
  });
  const stored = labels[id];
  const recommendation = recommendationForCase(kind, query);

  return {
    id,
    kind,
    at: event.at,
    firstSeenAt: event.at,
    source: 'telegram_routing',
    channel: 'telegram',
    walletAddress: null,
    sessionId: String(event.chatId),
    query,
    observedIntent: event.classifiedIntent ?? null,
    observedLayer: null,
    observedPolicy: event.policy,
    reason: shortSummary(event.reason),
    responseSummary: null,
    occurrenceCount: 1,
    recommendedLabel: recommendation.recommendedLabel,
    recommendationReason: recommendation.recommendationReason,
    reviewLabel: stored?.label ?? null,
    reviewNote: stored?.note ?? null,
  };
}

function mergeCase(
  cases: Map<string, ConversationReviewCase>,
  key: string,
  candidate: ConversationReviewCase,
): void {
  const existing = cases.get(key);
  if (!existing) {
    cases.set(key, candidate);
    return;
  }

  existing.occurrenceCount += 1;
  if (Date.parse(candidate.at) > Date.parse(existing.at)) {
    existing.at = candidate.at;
    existing.reason = candidate.reason;
    existing.responseSummary = candidate.responseSummary;
    existing.observedIntent = candidate.observedIntent;
    existing.observedLayer = candidate.observedLayer;
    existing.observedPolicy = candidate.observedPolicy;
    existing.sessionId = candidate.sessionId;
    existing.walletAddress = candidate.walletAddress;
  }
}

export async function buildConversationReviewCases(limit = 24): Promise<ConversationReviewCase[]> {
  const [labels, brainEvents, telegramEvents] = await Promise.all([
    loadReviewLabels(),
    loadRecentBrainEvents(),
    loadTelegramRoutingEvents(),
  ]);

  const cases = new Map<string, ConversationReviewCase>();

  for (const event of brainEvents) {
    const candidate = buildCaseFromBrainEvent(event, labels);
    if (!candidate) continue;
    const key = buildDeduplicationKey(candidate.source, candidate.kind, candidate.query, {
      wallet: (candidate.walletAddress ?? '').toLowerCase(),
      observedIntent: candidate.observedIntent ?? '',
      observedLayer: candidate.observedLayer ?? '',
    });
    mergeCase(cases, key, candidate);
  }

  for (const event of telegramEvents) {
    const candidate = buildCaseFromTelegramEvent(event, labels);
    if (!candidate) continue;
    const key = buildDeduplicationKey(candidate.source, candidate.kind, candidate.query, {
      observedIntent: candidate.observedIntent ?? '',
      observedPolicy: candidate.observedPolicy ?? '',
    });
    mergeCase(cases, key, candidate);
  }

  return [...cases.values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function saveConversationReviewLabel(
  caseId: string,
  label: ConversationReviewLabel,
  note?: string | null,
): Promise<void> {
  const labels = await loadReviewLabels();
  labels[caseId] = {
    label,
    note: note?.trim() || null,
    updatedAt: new Date().toISOString(),
  };
  await saveReviewLabels(labels);
}

export async function buildConversationReviewDataset(options?: {
  labeledOnly?: boolean;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const cases = await buildConversationReviewCases(options?.limit ?? 200);
  const filtered = options?.labeledOnly ? cases.filter((item) => item.reviewLabel) : cases;
  return filtered.map((item) => ({
    id: item.id,
    kind: item.kind,
    source: item.source,
    channel: item.channel,
    query: item.query,
    walletAddress: item.walletAddress,
    sessionId: item.sessionId,
    firstSeenAt: item.firstSeenAt,
    lastSeenAt: item.at,
    occurrenceCount: item.occurrenceCount,
    observedIntent: item.observedIntent,
    observedLayer: item.observedLayer,
    observedPolicy: item.observedPolicy,
    reason: item.reason,
    responseSummary: item.responseSummary,
    recommendedLabel: item.recommendedLabel,
    recommendationReason: item.recommendationReason,
    reviewLabel: item.reviewLabel,
    reviewNote: item.reviewNote,
  }));
}
