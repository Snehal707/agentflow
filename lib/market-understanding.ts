import { callHermesFast } from './hermes';

/**
 * What a prediction market is actually about, so research targets the real-world subject
 * instead of the literal market wording. This is the layer that stops "research the
 * prediction market topic: GTA 6 …" from being researched as the field of "market
 * research", or "Tether Gold (XAUT)" from being researched as generic Tether/USDT.
 */
export type MarketUnderstanding = {
  /** The real-world subject the market is predicting (entity + what about it). */
  subject: string;
  /** Underlying real-world driver when the subject is a proxy (e.g. "gold" for XAUT). */
  underlying: string | null;
  /** Shape of the question. */
  questionType:
    | 'price_target'
    | 'release_date'
    | 'event_outcome'
    | 'launch_milestone'
    | 'metric_threshold'
    | 'other';
  /** ISO date (YYYY-MM-DD) the market resolves by, when present. */
  resolutionDate: string | null;
  /** 3-6 web search queries scoped to the subject (no market/contract scaffolding). */
  searchQueries: string[];
};

const SYSTEM_PROMPT = `You are a research planner for a prediction-market app. You convert a market QUESTION into a plan to research the REAL-WORLD subject it is about — NOT the betting market, NOT prediction markets as a concept, NOT the field of "market research".

Rules:
- Identify the real-world subject being predicted (a coin/asset, company, product/game, person, team/tournament, blockchain/project, economic metric, geopolitical event, etc.).
- If the subject is a proxy for an underlying real-world thing, set "underlying" to that thing. Examples: Tether Gold / XAUT -> underlying "gold"; a tokenized stock -> the company; an index token -> the index. Otherwise "underlying" is null.
- Write 3-6 concrete web search queries a researcher would actually type to find current evidence about the subject AND the specific question (price target, release date, winner, launch, threshold). Lead with the most specific. For assets, include the ticker AND the full name AND the underlying. NEVER put "prediction market", "research", "AgentFlow", or a 0x address in a query.
- Classify questionType and extract resolutionDate as YYYY-MM-DD when a date is given (infer the year if only a month/day is given, using the current date context).

Return STRICT JSON only, no prose, no code fences:
{"subject": string, "underlying": string|null, "questionType": "price_target"|"release_date"|"event_outcome"|"launch_milestone"|"metric_threshold"|"other", "resolutionDate": string|null, "searchQueries": string[]}`;

function coerceUnderstanding(raw: unknown): MarketUnderstanding | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const subject = typeof obj.subject === 'string' ? obj.subject.trim() : '';
  if (!subject) return null;

  const queries = Array.isArray(obj.searchQueries)
    ? obj.searchQueries
        .map((q) => (typeof q === 'string' ? q.replace(/\s+/g, ' ').trim() : ''))
        .filter(Boolean)
        // Hard guard: never let scaffolding/contract terms back into retrieval.
        .filter((q) => !/\bprediction market\b|\bagentflow\b|0x[a-fA-F0-9]{40}/i.test(q))
        .slice(0, 6)
    : [];
  if (queries.length === 0) return null;

  const allowedTypes = new Set([
    'price_target',
    'release_date',
    'event_outcome',
    'launch_milestone',
    'metric_threshold',
    'other',
  ]);
  const questionType = (
    typeof obj.questionType === 'string' && allowedTypes.has(obj.questionType)
      ? obj.questionType
      : 'other'
  ) as MarketUnderstanding['questionType'];

  const underlying =
    typeof obj.underlying === 'string' && obj.underlying.trim() ? obj.underlying.trim() : null;
  const resolutionDate =
    typeof obj.resolutionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.resolutionDate.trim())
      ? obj.resolutionDate.trim()
      : null;

  return { subject, underlying, questionType, resolutionDate, searchQueries: queries };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Returns a research plan for a prediction-market task, or null on any failure so the
 * caller can fall back to the existing deterministic query expansion (no regression).
 */
export async function understandMarketResearch(
  task: string,
  options?: { timeoutMs?: number; now?: Date },
): Promise<MarketUnderstanding | null> {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const now = options?.now ?? new Date();
  const userMessage = `CURRENT DATE: ${now.toISOString().slice(0, 10)}\n\nMARKET QUESTION (and any listed outcomes):\n${task}`;

  try {
    const raw = await Promise.race([
      callHermesFast(SYSTEM_PROMPT, userMessage),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('market-understanding timed out')), timeoutMs),
      ),
    ]);
    return coerceUnderstanding(extractJson(raw));
  } catch (error) {
    console.warn(
      '[market-understanding] extraction failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/** Build the pipe-joined query-expansion string the research agent already consumes. */
export function understandingToExpandedTask(understanding: MarketUnderstanding): string {
  const queries = [...understanding.searchQueries];
  if (understanding.underlying) {
    const u = understanding.underlying;
    if (!queries.some((q) => q.toLowerCase().includes(u.toLowerCase()))) {
      queries.push(`${u} price outlook latest`);
    }
  }
  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))].join(' | ');
}

/** Framing block injected into the writer prompt so it researches the subject, not the wording. */
export function understandingToSubjectFraming(understanding: MarketUnderstanding): string {
  const lines = [
    `REAL-WORLD SUBJECT TO RESEARCH: ${understanding.subject}`,
    understanding.underlying
      ? `UNDERLYING DRIVER: ${understanding.underlying} (research this directly — it determines the outcome).`
      : '',
    understanding.resolutionDate ? `MARKET RESOLVES BY: ${understanding.resolutionDate}.` : '',
    'Research the real-world subject and the specific question above. Do NOT write about prediction markets as a concept, "market research" as a field, or unrelated current events. If evidence on the subject is thin, say so plainly rather than substituting a different topic.',
  ];
  return lines.filter(Boolean).join('\n');
}
