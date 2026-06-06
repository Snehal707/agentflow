import { callHermesFast } from '../../lib/hermes';
import { hasNamedEntityAndStrongNarrowingSignal } from './entityDetection';
import type { ResearchBrief } from './types';

const DEFAULT_BRIEF: Omit<ResearchBrief, 'query'> = {
  intent: 'research',
  scope: 'broad',
  time_sensitivity: 'recent',
  required_freshness_days: 30,
  geography: [],
  domains_priority: [],
  domains_avoid: ['rss', 'news.google.com'],
  preferred_source_types: ['primary', 'official', 'reputable news', 'reference'],
  must_answer: [],
  avoid_drift: [
    'Do not let one retrieved article or narrow subtopic redefine the user topic.',
    'Use narrow sources only as supporting evidence, not as the whole frame.',
  ],
  minimum_source_diversity: 3,
  sub_questions: [],
  evaluation_rubric: 'Prefer fresh, source-grounded, non-duplicative evidence.',
};

export async function buildResearchBrief(input: {
  query: string;
  walletContext?: object;
}): Promise<ResearchBrief> {
  const prompt = `Return valid JSON only.

Build a research brief for a deep-research pipeline.
You must return this exact JSON shape:
{
  "query": string,
  "intent": string,
  "scope": "broad" | "narrow",
  "time_sensitivity": "live" | "recent" | "historical",
  "required_freshness_days": number,
  "geography": string[],
  "domains_priority": string[],
  "domains_avoid": string[],
  "preferred_source_types": string[],
  "must_answer": string[],
  "avoid_drift": string[],
  "minimum_source_diversity": number,
  "sub_questions": string[],
  "evaluation_rubric": string
}

Rules:
- Preserve the user's topic. Search results may support the topic, but must not redefine it.
- Classify scope as "broad" for open-ended topics like "forex market", "AI agents", "climate change", "pgvector indexing", "Argentina economy", or "x402 payments".
- Classify scope as "narrow" only when the user names a specific angle, entity, comparison, event, or question.
- For broad topics, must_answer should cover the major dimensions a good general report should answer, not a single subtopic.
- For narrow topics, must_answer should stay tightly aligned to the named angle.
- Add avoid_drift items that would prevent retrieval from overfocusing on one article, vendor, marketing page, or side issue.
- Set minimum_source_diversity to 3 for broad topics and at least 2 for narrow topics.
- Generate 5-8 sub_questions.
- Prefer fresh primary sources when relevant.
- Use preferred_source_types to describe the kinds of sources to seek, e.g. official, primary, reputable news, academic, technical docs, regulatory, market data, reference.
- Keep domains_priority and domains_avoid concise.
- Use only JSON, no markdown fences.`;

  const userMessage = JSON.stringify(
    {
      query: input.query,
      walletContext: input.walletContext ?? null,
      nowIso: new Date().toISOString(),
    },
    null,
    2,
  );

  const first = await callHermesFast(prompt, userMessage);
  const parsed = parseBrief(first, input.query);
  if (parsed) {
    return parsed;
  }

  const retry = await callHermesFast(
    `${prompt}\n\nYour previous answer was invalid JSON. Return JSON only.`,
    userMessage,
  );
  return parseBrief(retry, input.query) ?? fallbackBrief(input.query);
}

function parseBrief(value: string, query: string): ResearchBrief | null {
  try {
    const parsed = JSON.parse(value) as Partial<ResearchBrief>;
    return normalizeBrief(parsed, query);
  } catch {
    return null;
  }
}

function normalizeBrief(parsed: Partial<ResearchBrief>, query: string): ResearchBrief {
  const normalizedSubQuestions = Array.isArray(parsed.sub_questions)
    ? parsed.sub_questions.filter((item): item is string => typeof item === 'string').slice(0, 8)
    : [];
  const normalizedMustAnswer = normalizeStringArray(parsed.must_answer);
  const originalScope =
    parsed.scope === 'broad' || parsed.scope === 'narrow'
      ? parsed.scope
      : inferScope(query);
  const mustAnswer = normalizedMustAnswer.length
    ? normalizedMustAnswer.slice(0, 8)
    : buildFallbackMustAnswer(query, inferScope(query));
  const subQuestions =
    normalizedSubQuestions.length >= 5
      ? normalizedSubQuestions
      : buildFallbackQuestions(query).slice(0, 6);
  const scopeOverride = hasNamedEntityAndStrongNarrowingSignal(query, {
    query,
    must_answer: mustAnswer,
    sub_questions: subQuestions,
  });
  const scope = scopeOverride.matched ? 'narrow' : originalScope;

  if (scopeOverride.matched && originalScope !== 'narrow') {
    console.log(
      `[brief] scope override applied: original=${originalScope} forced=narrow reason=named_entity+narrowing_signal entities=[${scopeOverride.entities.join(',')}] signals=[${scopeOverride.signals.join(',')}]`,
    );
  }

  return {
    query,
    intent: typeof parsed.intent === 'string' && parsed.intent.trim() ? parsed.intent : DEFAULT_BRIEF.intent,
    scope,
    time_sensitivity:
      parsed.time_sensitivity === 'live' ||
      parsed.time_sensitivity === 'recent' ||
      parsed.time_sensitivity === 'historical'
        ? parsed.time_sensitivity
        : DEFAULT_BRIEF.time_sensitivity,
    required_freshness_days:
      typeof parsed.required_freshness_days === 'number' && parsed.required_freshness_days > 0
        ? Math.round(parsed.required_freshness_days)
        : DEFAULT_BRIEF.required_freshness_days,
    geography: normalizeStringArray(parsed.geography),
    domains_priority: normalizeStringArray(parsed.domains_priority),
    domains_avoid: [
      ...new Set([...DEFAULT_BRIEF.domains_avoid, ...normalizeStringArray(parsed.domains_avoid)]),
    ],
    preferred_source_types: normalizeStringArray(parsed.preferred_source_types).length
      ? normalizeStringArray(parsed.preferred_source_types).slice(0, 6)
      : DEFAULT_BRIEF.preferred_source_types,
    must_answer: mustAnswer,
    avoid_drift: normalizeStringArray(parsed.avoid_drift).length
      ? normalizeStringArray(parsed.avoid_drift).slice(0, 6)
      : DEFAULT_BRIEF.avoid_drift,
    minimum_source_diversity:
      typeof parsed.minimum_source_diversity === 'number' && parsed.minimum_source_diversity > 0
        ? Math.max(1, Math.min(6, Math.round(parsed.minimum_source_diversity)))
        : inferScope(query) === 'broad'
          ? 3
          : 2,
    sub_questions: subQuestions,
    evaluation_rubric:
      typeof parsed.evaluation_rubric === 'string' && parsed.evaluation_rubric.trim()
        ? parsed.evaluation_rubric
        : DEFAULT_BRIEF.evaluation_rubric,
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function fallbackBrief(query: string): ResearchBrief {
  const scope = inferScope(query);
  return {
    query,
    ...DEFAULT_BRIEF,
    scope,
    must_answer: buildFallbackMustAnswer(query, scope),
    minimum_source_diversity: scope === 'broad' ? 3 : 2,
    sub_questions: buildFallbackQuestions(query).slice(0, 6),
  };
}

function inferScope(query: string): 'broad' | 'narrow' {
  const cleaned = query.trim();
  if (
    /\b(compare|versus|vs\.?|impact of|effect of|how does|why did|specific|case study|for retail|for developers|in \d{4}|this week|today|latest|current|now)\b/i.test(
      cleaned,
    )
  ) {
    return 'narrow';
  }
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return wordCount <= 8 ? 'broad' : 'narrow';
}

function buildFallbackMustAnswer(query: string, scope: 'broad' | 'narrow'): string[] {
  if (scope === 'narrow') {
    return [
      `Directly answer the user's specific angle on ${query}.`,
      `Identify the strongest source-backed evidence about ${query}.`,
      `Explain important caveats, disagreement, or missing evidence.`,
    ];
  }
  return [
    `Define the topic and its overall scope: ${query}.`,
    `Summarize the current or most relevant status of ${query}.`,
    `Identify major actors, components, or mechanisms involved in ${query}.`,
    `Include important metrics, dates, or examples when sources provide them.`,
    `Explain risks, constraints, disagreements, or unknowns.`,
  ];
}

function buildFallbackQuestions(query: string): string[] {
  return [
    `What is the current status of ${query}?`,
    `What are the most important recent developments related to ${query}?`,
    `Which official or primary sources describe ${query}?`,
    `What quantitative evidence or statistics are available for ${query}?`,
    `What are the strongest counterarguments or risks around ${query}?`,
    `What is still unknown or weakly supported about ${query}?`,
  ];
}
