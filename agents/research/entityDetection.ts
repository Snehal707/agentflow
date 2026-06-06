import type { ResearchBrief } from './types';

export const ENTITY_STOP_WORDS = new Set([
  'ai',
  'agi',
  'aws',
  'eu',
  'us',
  'uk',
  'what',
  'how',
  'which',
  'why',
  'when',
  'where',
]);

const STRONG_NARROWING_SIGNAL_PATTERNS = [
  { label: 'vs', pattern: /\bvs\.?\b/i },
  { label: 'versus', pattern: /\bversus\b/i },
  { label: 'compare', pattern: /\bcompare\b/i },
  { label: 'comparison', pattern: /\bcomparison\b/i },
  { label: 'compared to', pattern: /\bcompared to\b/i },
  { label: 'impact of', pattern: /\bimpact of\b/i },
  { label: 'latest', pattern: /\blatest\b/i },
  { label: 'current', pattern: /\bcurrent\b/i },
  { label: 'today', pattern: /\btoday\b/i },
  { label: 'now', pattern: /\bnow\b/i },
] as const;

export function deriveAllowedEntities(
  brief: Pick<ResearchBrief, 'query' | 'must_answer' | 'sub_questions'>,
): string[] {
  const queryEntities = extractNamedEntityCandidates(brief.query);
  if (queryEntities.length === 0) {
    return [];
  }

  const candidates = new Map<string, number>();
  const texts = [brief.query, ...brief.must_answer, ...brief.sub_questions];

  for (const entity of queryEntities) {
    let count = 0;
    for (const text of texts) {
      if (containsEntity(text, entity)) {
        count += 1;
      }
    }
    if (count > 0) {
      candidates.set(entity, count);
    }
  }

  return [...candidates.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([entity]) => entity)
    .slice(0, 3);
}

export function detectComparisonIntent(brief: Pick<ResearchBrief, 'query'>): boolean {
  return getMatchedNarrowingSignals(brief.query).some((signal) =>
    ['vs', 'versus', 'compare', 'comparison', 'compared to'].includes(signal),
  );
}

export function getMatchedNarrowingSignals(query: string): string[] {
  return STRONG_NARROWING_SIGNAL_PATTERNS
    .filter((signal) => signal.pattern.test(query))
    .map((signal) => signal.label);
}

export function hasNamedEntityAndStrongNarrowingSignal(
  query: string,
  briefLike: Pick<ResearchBrief, 'query' | 'must_answer' | 'sub_questions'>,
): { matched: boolean; entities: string[]; signals: string[] } {
  const entities = deriveAllowedEntities(briefLike);
  const signals = getMatchedNarrowingSignals(query);
  return {
    matched: entities.length > 0 && signals.length > 0,
    entities,
    signals,
  };
}

function extractNamedEntityCandidates(text: string): string[] {
  const results = new Set<string>();
  const matches = text.match(/\b(?:[A-Z][a-zA-Z0-9&.-]+(?:\s+[A-Z][a-zA-Z0-9&.-]+)*)\b/g) ?? [];

  for (const raw of matches) {
    const entity = raw.trim();
    if (!looksLikeEntityName(entity)) continue;
    results.add(entity);
  }

  return [...results];
}

function looksLikeEntityName(value: string): boolean {
  if (!value) return false;
  if (value.length < 3) return false;
  const normalized = value.trim().toLowerCase();
  if (ENTITY_STOP_WORDS.has(normalized)) return false;
  return /[A-Z]/.test(value[0]);
}

function containsEntity(text: string, entity: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(entity)}\\b`, 'i');
  return pattern.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
