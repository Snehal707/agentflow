import { callHermesFast } from '../../lib/hermes';
import type { ResearchBrief } from './types';

const DEFAULT_BRIEF: Omit<ResearchBrief, 'query'> = {
  intent: 'research',
  time_sensitivity: 'recent',
  required_freshness_days: 30,
  geography: [],
  domains_priority: [],
  domains_avoid: ['rss', 'news.google.com'],
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
  "time_sensitivity": "live" | "recent" | "historical",
  "required_freshness_days": number,
  "geography": string[],
  "domains_priority": string[],
  "domains_avoid": string[],
  "sub_questions": string[],
  "evaluation_rubric": string
}

Rules:
- Generate 5-8 sub_questions.
- Prefer fresh primary sources when relevant.
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
  const subQuestions = Array.isArray(parsed.sub_questions)
    ? parsed.sub_questions.filter((item): item is string => typeof item === 'string').slice(0, 8)
    : [];

  return {
    query,
    intent: typeof parsed.intent === 'string' && parsed.intent.trim() ? parsed.intent : DEFAULT_BRIEF.intent,
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
    domains_avoid: normalizeStringArray(parsed.domains_avoid).length
      ? normalizeStringArray(parsed.domains_avoid)
      : DEFAULT_BRIEF.domains_avoid,
    sub_questions:
      subQuestions.length >= 5
        ? subQuestions
        : buildFallbackQuestions(query).slice(0, 6),
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
  return {
    query,
    ...DEFAULT_BRIEF,
    sub_questions: buildFallbackQuestions(query).slice(0, 6),
  };
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
