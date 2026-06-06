import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type RetrieveEvent = {
  kind: 'retrieve';
  at: string;
  walletAddress: string;
  query: string;
  sessionId?: string;
  requestedLimit: number;
  returnedCount: number;
  topCategories: string[];
  topTypes: string[];
  source: 'db' | 'local_fallback';
};

export type SemanticMemoryReviewLabel =
  | 'correct'
  | 'needs_profile'
  | 'needs_episodic'
  | 'needs_routing'
  | 'needs_clarification'
  | 'ignore';

export type SemanticMemoryReviewCase = {
  id: string;
  kind: 'profile_mismatch' | 'routing_mismatch' | 'recall_zero_result';
  at: string;
  firstSeenAt: string;
  walletAddress: string;
  query: string;
  sessionId?: string;
  source: 'db' | 'local_fallback';
  returnedCount: number;
  topTypes: string[];
  topCategories: string[];
  expectedMemoryType: 'profile' | 'routing_example' | 'episodic_or_session';
  observedTopType: string | null;
  occurrenceCount: number;
  recommendedLabel: Exclude<SemanticMemoryReviewLabel, 'correct' | 'ignore'>;
  recommendationReason: string;
  reviewLabel: SemanticMemoryReviewLabel | null;
  reviewNote: string | null;
};

type StoredReviewLabel = {
  label: SemanticMemoryReviewLabel;
  note?: string | null;
  updatedAt: string;
};

const TELEMETRY_FILE = path.join(process.cwd(), '.agentflow-telemetry', 'semantic-memory-events.jsonl');
const REVIEW_DIR = path.join(process.cwd(), '.agentflow-memory');
const REVIEW_FILE = path.join(REVIEW_DIR, 'semantic-memory-review-labels.json');

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isProfileIntentQuery(query: string): boolean {
  return /\b(?:my name|remember my name|what'?s my name|who am i|call me|preference|prefer|style|how should you answer)\b/i.test(
    query,
  );
}

function isRoutingPolicyQuery(query: string): boolean {
  return /\b(?:telegram|policy|intent|router|routing|chat mode|fallback|bot policy)\b/i.test(query);
}

function isRecallLikeQuery(query: string): boolean {
  return /\b(?:remember|previous|before|last|earlier|left off|what were we talking about|what did i tell you)\b/i.test(
    query,
  );
}

function isMixedIntentQuery(query: string): boolean {
  const profile = isProfileIntentQuery(query);
  const routing = isRoutingPolicyQuery(query);
  const recall = isRecallLikeQuery(query);
  return Number(profile) + Number(routing) + Number(recall) > 1;
}

function recommendLabel(
  kind: SemanticMemoryReviewCase['kind'],
  event: RetrieveEvent,
): {
  recommendedLabel: Exclude<SemanticMemoryReviewLabel, 'correct' | 'ignore'>;
  recommendationReason: string;
} {
  const profileIntent = isProfileIntentQuery(event.query);
  const routingIntent = isRoutingPolicyQuery(event.query);
  const recallIntent = isRecallLikeQuery(event.query);

  if (profileIntent && routingIntent) {
    return {
      recommendedLabel: 'needs_clarification',
      recommendationReason: 'The query mixes multiple memory intents, so the system should clarify instead of picking one memory class blindly.',
    };
  }

  if (kind === 'profile_mismatch' && profileIntent) {
    return {
      recommendedLabel: 'needs_profile',
      recommendationReason: 'This query is asking about identity, preference, or reply style, so profile memory should dominate.',
    };
  }

  if (kind === 'routing_mismatch') {
    return {
      recommendedLabel: 'needs_routing',
      recommendationReason: 'This query is about policy or routing behavior, so routing-example memory should dominate.',
    };
  }

  if (kind === 'recall_zero_result' && recallIntent) {
    return {
      recommendedLabel: 'needs_episodic',
      recommendationReason: 'This is a recall-style query and the system returned nothing, so episodic or session memory likely should have been retrieved.',
    };
  }

  return {
    recommendedLabel: 'needs_profile',
    recommendationReason: 'This query is asking about identity, preference, or reply style, so profile memory should dominate.',
  };
}

async function loadRetrieveEvents(): Promise<RetrieveEvent[]> {
  const raw = await readFile(TELEMETRY_FILE, 'utf8').catch(() => '');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RetrieveEvent)
    .filter((event): event is RetrieveEvent => event.kind === 'retrieve');
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
  kind: SemanticMemoryReviewCase['kind'],
  event: RetrieveEvent,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        kind,
        at: event.at,
        walletAddress: event.walletAddress,
        query: normalizeText(event.query),
        sessionId: event.sessionId ?? '',
        source: event.source,
        returnedCount: event.returnedCount,
        topTypes: event.topTypes,
        topCategories: event.topCategories,
      }),
    )
    .digest('hex')
    .slice(0, 24);
}

function buildDeduplicationKey(
  kind: SemanticMemoryReviewCase['kind'],
  event: RetrieveEvent,
): string {
  return JSON.stringify({
    kind,
    walletAddress: event.walletAddress.toLowerCase(),
    query: normalizeText(event.query).toLowerCase(),
    source: event.source,
    returnedCount: event.returnedCount,
    topTypes: event.topTypes.slice(0, 3),
    topCategories: event.topCategories.slice(0, 3),
  });
}

function toReviewCase(
  kind: SemanticMemoryReviewCase['kind'],
  event: RetrieveEvent,
  labels: Record<string, StoredReviewLabel>,
): SemanticMemoryReviewCase {
  const id = buildCaseId(kind, event);
  const stored = labels[id];
  const expectedMemoryType =
    kind === 'profile_mismatch'
      ? 'profile'
      : kind === 'routing_mismatch'
        ? 'routing_example'
        : 'episodic_or_session';
  const recommendation = recommendLabel(kind, event);

  return {
    id,
    kind,
    at: event.at,
    firstSeenAt: event.at,
    walletAddress: event.walletAddress,
    query: event.query,
    sessionId: event.sessionId,
    source: event.source,
    returnedCount: event.returnedCount,
    topTypes: event.topTypes,
    topCategories: event.topCategories,
    expectedMemoryType,
    observedTopType: event.topTypes[0] ?? null,
    occurrenceCount: 1,
    recommendedLabel: recommendation.recommendedLabel,
    recommendationReason: recommendation.recommendationReason,
    reviewLabel: stored?.label ?? null,
    reviewNote: stored?.note ?? null,
  };
}

export async function buildSemanticMemoryReviewCases(limit = 20): Promise<SemanticMemoryReviewCase[]> {
  const [events, labels] = await Promise.all([loadRetrieveEvents(), loadReviewLabels()]);

  const cases = new Map<string, SemanticMemoryReviewCase>();
  for (const event of events) {
    const topType = event.topTypes[0] ?? null;

    if (isProfileIntentQuery(event.query) && topType && topType !== 'profile') {
      const key = buildDeduplicationKey('profile_mismatch', event);
      const existing = cases.get(key);
      if (existing) {
        existing.occurrenceCount += 1;
        if (Date.parse(event.at) > Date.parse(existing.at)) {
          existing.at = event.at;
          existing.sessionId = event.sessionId;
        }
      } else {
        cases.set(key, toReviewCase('profile_mismatch', event, labels));
      }
    }

    if (isRoutingPolicyQuery(event.query) && topType && topType !== 'routing_example') {
      const key = buildDeduplicationKey('routing_mismatch', event);
      const existing = cases.get(key);
      if (existing) {
        existing.occurrenceCount += 1;
        if (Date.parse(event.at) > Date.parse(existing.at)) {
          existing.at = event.at;
          existing.sessionId = event.sessionId;
        }
      } else {
        cases.set(key, toReviewCase('routing_mismatch', event, labels));
      }
    }

    if (isRecallLikeQuery(event.query) && event.returnedCount === 0) {
      const key = buildDeduplicationKey('recall_zero_result', event);
      const existing = cases.get(key);
      if (existing) {
        existing.occurrenceCount += 1;
        if (Date.parse(event.at) > Date.parse(existing.at)) {
          existing.at = event.at;
          existing.sessionId = event.sessionId;
        }
      } else {
        cases.set(key, toReviewCase('recall_zero_result', event, labels));
      }
    }
  }

  return [...cases.values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function saveSemanticMemoryReviewLabel(
  caseId: string,
  label: SemanticMemoryReviewLabel,
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

export async function buildSemanticMemoryReviewDataset(options?: {
  labeledOnly?: boolean;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const cases = await buildSemanticMemoryReviewCases(options?.limit ?? 200);
  const filtered = options?.labeledOnly ? cases.filter((item) => item.reviewLabel) : cases;
  return filtered.map((item) => ({
    id: item.id,
    kind: item.kind,
    query: item.query,
    walletAddress: item.walletAddress,
    sessionId: item.sessionId ?? null,
    source: item.source,
    firstSeenAt: item.firstSeenAt,
    lastSeenAt: item.at,
    occurrenceCount: item.occurrenceCount,
    expectedMemoryType: item.expectedMemoryType,
    observedTopType: item.observedTopType,
    topTypes: item.topTypes,
    topCategories: item.topCategories,
    recommendedLabel: item.recommendedLabel,
    recommendationReason: item.recommendationReason,
    reviewLabel: item.reviewLabel,
    reviewNote: item.reviewNote,
  }));
}
