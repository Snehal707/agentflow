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
  /** Entity resolution before search, including known aliases/homonyms. */
  entity?: {
    canonicalName: string;
    aliases: string[];
    officialDomains: string[];
    avoidTerms: string[];
    ambiguity: 'low' | 'medium' | 'high';
    rationale: string;
  };
};

const SYSTEM_PROMPT = `You are a research planner for a prediction-market app. You convert a market QUESTION into a plan to research the REAL-WORLD subject it is about — NOT the betting market, NOT prediction markets as a concept, NOT the field of "market research".

Rules:
- Identify the real-world subject being predicted (a coin/asset, company, product/game, person, team/tournament, blockchain/project, economic metric, geopolitical event, etc.).
- If the subject is a proxy for an underlying real-world thing, set "underlying" to that thing. Examples: Tether Gold / XAUT -> underlying "gold"; a tokenized stock -> the company; an index token -> the index. Otherwise "underlying" is null.
- Write 3-6 concrete web search queries a researcher would actually type to find current evidence about the subject AND the specific question (price target, release date, winner, launch, threshold). Lead with the most specific. For assets, include the ticker AND the full name AND the underlying. NEVER put "prediction market", "research", "AgentFlow", or a 0x address in a query.
- Classify questionType and extract resolutionDate as YYYY-MM-DD when a date is given (infer the year if only a month/day is given, using the current date context).
- ALWAYS return an entity object. It must include canonicalName, aliases, officialDomains, avoidTerms, ambiguity, and rationale for every subject.
- officialDomains should list the subject's own official domains first when known. If unknown, return an empty array and set ambiguity to "high".
- aliases should include the most common ticker, abbreviation, team short-name, or alternate phrasing when known.
- avoidTerms should list likely homonyms or misleading side-topics when ambiguity exists. If none are known, return an empty array.
- ambiguity must reflect how risky homonym drift is for this subject. Use "high" for unresolved or generic subjects.

Return STRICT JSON only, no prose, no code fences:
{"subject": string, "underlying": string|null, "questionType": "price_target"|"release_date"|"event_outcome"|"launch_milestone"|"metric_threshold"|"other", "resolutionDate": string|null, "searchQueries": string[], "entity"?: {"canonicalName": string, "aliases": string[], "officialDomains": string[], "avoidTerms": string[], "ambiguity": "low"|"medium"|"high", "rationale": string}}`;

function uniqueNormalizedStrings(values: Array<string | null | undefined>, max: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const candidate = value?.replace(/\s+/g, ' ').trim();
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(candidate);
    if (normalized.length >= max) break;
  }
  return normalized;
}

function inferEntityAliases(subject: string): string[] {
  const aliases: string[] = [];
  const ticker = subject.match(/\(([A-Z]{2,10})\)/)?.[1];
  if (ticker) aliases.push(ticker);
  const withoutParen = subject.replace(/\([^)]+\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (withoutParen && withoutParen.toLowerCase() !== subject.toLowerCase()) aliases.push(withoutParen);
  aliases.push(subject);
  return uniqueNormalizedStrings(aliases, 8);
}

function isGenericEntityDiscoveryDomain(domain: string): boolean {
  return /(?:^|\.)(coingecko\.com|coinmarketcap\.com|coinbase\.com|defillama\.com|binance\.com|kraken\.com|wikipedia\.org|reuters\.com|bloomberg\.com|wsj\.com|ft\.com)$/.test(
    domain,
  );
}

function normalizeEntityContract(
  subject: string,
  underlying: string | null,
  rawEntity: Record<string, unknown> | null,
): NonNullable<MarketUnderstanding['entity']> {
  const canonicalName =
    typeof rawEntity?.canonicalName === 'string' && rawEntity.canonicalName.trim()
      ? rawEntity.canonicalName.trim()
      : subject;
  const officialDomains = Array.isArray(rawEntity?.officialDomains)
    ? rawEntity.officialDomains
        .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const hasNonGenericOfficialDomain = officialDomains.some(
    (domain) => !isGenericEntityDiscoveryDomain(domain),
  );
  const sanitizedOfficialDomains = hasNonGenericOfficialDomain
    ? officialDomains
    : officialDomains.filter((domain) => !isGenericEntityDiscoveryDomain(domain));
  const avoidTerms = Array.isArray(rawEntity?.avoidTerms)
    ? rawEntity.avoidTerms
        .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const aliases = uniqueNormalizedStrings(
    [
      ...(Array.isArray(rawEntity?.aliases)
        ? rawEntity.aliases.map((value) => (typeof value === 'string' ? value : ''))
        : []),
      ...inferEntityAliases(canonicalName),
      underlying,
    ],
    8,
  );
  const returnedAmbiguity =
    typeof rawEntity?.ambiguity === 'string' &&
    ['low', 'medium', 'high'].includes(rawEntity.ambiguity)
      ? (rawEntity.ambiguity as 'low' | 'medium' | 'high')
      : null;
  const ambiguity =
    returnedAmbiguity &&
    (sanitizedOfficialDomains.length > 0 || aliases.length > 1 || avoidTerms.length > 0)
      ? returnedAmbiguity
      : 'high';
  const genericDiscoveryOnly =
    officialDomains.length > 0 && sanitizedOfficialDomains.length === 0;
  const rationale =
    typeof rawEntity?.rationale === 'string' && rawEntity.rationale.trim()
      ? rawEntity.rationale.trim()
      : ambiguity === 'high'
        ? 'Entity contract was incomplete; treat unresolved homonym risk as high until verified by independent sources.'
        : `Resolved entity contract for ${canonicalName}.`;
  const normalizedRationale = genericDiscoveryOnly
    ? `${rationale} Generic market-data or exchange domains do not count as proof that the subject itself is independently verified.`
    : rationale;

  return {
    canonicalName,
    aliases,
    officialDomains: sanitizedOfficialDomains,
    avoidTerms,
    ambiguity: genericDiscoveryOnly ? 'high' : ambiguity,
    rationale: normalizedRationale,
  };
}

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
  const entityObj =
    obj.entity && typeof obj.entity === 'object' ? (obj.entity as Record<string, unknown>) : null;
  const entity = normalizeEntityContract(subject, underlying, entityObj);

  return {
    subject,
    underlying,
    questionType,
    resolutionDate,
    searchQueries: queries,
    entity,
  };
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

function extractMarketQuestion(task: string): string {
  const match = task.match(/research the prediction market topic:\s*([^\n]+)/i);
  return (match?.[1] || task)
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCategory(task: string): string | null {
  const match = task.match(/\bPrediction market category in AgentFlow:\s*([^\n.]+)/i);
  return match?.[1]?.trim().toLowerCase() || null;
}

function inferResolutionDate(question: string, now: Date): string | null {
  const isoMatch = question.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const monthMatch = question.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i,
  );
  if (!monthMatch) return null;

  const monthIndex = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  }[monthMatch[1].toLowerCase()];
  const day = Number(monthMatch[2]);
  const year = Number(monthMatch[3] || now.getUTCFullYear());
  return `${year}-${String(monthIndex).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function uniqueQueries(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const value of values) {
    const query = value?.replace(/\s+/g, ' ').trim();
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push(query);
  }
  return queries.slice(0, 6);
}

function makeEntity(
  canonicalName: string,
  options: {
    aliases?: string[];
    officialDomains?: string[];
    avoidTerms?: string[];
    ambiguity?: 'low' | 'medium' | 'high';
    rationale: string;
  },
): NonNullable<MarketUnderstanding['entity']> {
  return {
    canonicalName,
    aliases: options.aliases ?? [],
    officialDomains: options.officialDomains ?? [],
    avoidTerms: options.avoidTerms ?? [],
    ambiguity: options.ambiguity ?? 'low',
    rationale: options.rationale,
  };
}

function shouldPreferHeuristicEntity(
  task: string,
  current: MarketUnderstanding,
  heuristic: MarketUnderstanding,
): boolean {
  const currentOfficial = current.entity?.officialDomains?.length ?? 0;
  const heuristicOfficial = heuristic.entity?.officialDomains?.length ?? 0;
  const currentAmbiguity = current.entity?.ambiguity ?? 'high';
  const heuristicAmbiguity = heuristic.entity?.ambiguity ?? 'high';

  if (currentOfficial === 0 && heuristicOfficial > 0) return true;
  if (currentAmbiguity === 'high' && heuristicAmbiguity !== 'high') return true;
  if (/\b(xaut|tether gold)\b/i.test(task)) {
    const currentContract = [
      current.subject,
      current.entity?.canonicalName,
      ...(current.entity?.aliases ?? []),
      ...(current.entity?.officialDomains ?? []),
    ]
      .join(' ')
      .toLowerCase();
    const currentAvoidTerms = (current.entity?.avoidTerms ?? []).join(' ').toLowerCase();
    const hasGoldContract =
      /\bxaut\b|\btether gold\b/.test(currentContract) &&
      /\bgold\b/i.test(current.underlying || currentContract);
    const hasTrustedGoldDomain = /\b(tether\.to|kitco\.com|lbma\.org\.uk|goldprice\.org|gold\.org)\b/.test(
      currentContract,
    );
    if (!hasGoldContract || !hasTrustedGoldDomain || /\bphysical gold\b/.test(currentAvoidTerms)) {
      return true;
    }
  }
  if (/\b(xaut|tether gold)\b/i.test(task) && current.underlying?.toLowerCase() !== 'gold') {
    return true;
  }
  if (
    /\bPrediction market category in AgentFlow:\s*Crypto\b/i.test(task) &&
    /\barc\b/i.test(task) &&
    /\b(mainnet|launch|testnet)\b/i.test(task) &&
    !/\barc network\b/i.test(
      `${current.subject} ${current.entity?.canonicalName || ''} ${(current.entity?.aliases || []).join(' ')}`,
    )
  ) {
    return true;
  }
  if (
    /\bPrediction market category in AgentFlow:\s*(Games|Gaming)\b/i.test(task) &&
    (/\bgta\s*6\b|\bgrand theft auto\b/i.test(task) ||
      (/\bvi\b/i.test(task) && /\blaunch|release|ship|come out|drop|debut|available\b/i.test(task))) &&
    !/\bgrand theft auto\b|\bgta\s*6\b/i.test(
      `${current.subject} ${current.entity?.canonicalName || ''} ${(current.entity?.aliases || []).join(' ')}`,
    )
  ) {
    return true;
  }
  return false;
}

function mergeUnderstandingWithHeuristic(
  task: string,
  current: MarketUnderstanding | null,
  heuristic: MarketUnderstanding | null,
): MarketUnderstanding | null {
  if (!current) return heuristic;
  if (!heuristic) return current;

  const useHeuristicEntity = shouldPreferHeuristicEntity(task, current, heuristic);
  return {
    subject: useHeuristicEntity ? heuristic.subject : current.subject,
    underlying: current.underlying ?? heuristic.underlying,
    questionType: current.questionType === 'other' ? heuristic.questionType : current.questionType,
    resolutionDate: current.resolutionDate ?? heuristic.resolutionDate,
    searchQueries: uniqueQueries([...heuristic.searchQueries, ...current.searchQueries]),
    entity: useHeuristicEntity ? heuristic.entity : current.entity,
  };
}

function heuristicUnderstanding(task: string, now: Date): MarketUnderstanding | null {
  const question = extractMarketQuestion(task);
  const category = extractCategory(task);
  const lower = question.toLowerCase();
  const resolutionDate = inferResolutionDate(question, now);

  if (/\bxaut\b|\btether gold\b/i.test(lower)) {
    return {
      subject: 'Tether Gold (XAUT) price target',
      underlying: 'gold',
      questionType: 'price_target',
      resolutionDate,
      searchQueries: uniqueQueries([
        'XAUT price latest',
        'Tether Gold XAUT latest news',
        'gold price forecast 2026',
        'spot gold price latest',
        'goldprice.org spot gold',
        'site:kitco.com gold price forecast',
        'site:lbma.org.uk gold market',
      ]),
      entity: makeEntity('Tether Gold (XAUT)', {
        aliases: ['XAUT', 'Tether Gold'],
        officialDomains: ['tether.to', 'coingecko.com', 'goldprice.org', 'kitco.com', 'lbma.org.uk'],
        avoidTerms: ['usdt', 'tether usd', 'tp-link'],
        ambiguity: 'low',
        rationale: 'Ticker XAUT maps to Tether Gold and should be researched through gold-market drivers.',
      }),
    };
  }

  if (/\bgta\s*6\b|\bgrand theft auto\b/i.test(lower) || (category === 'games' && /\bvi\b/i.test(lower))) {
    return {
      subject: 'Grand Theft Auto VI release timing',
      underlying: null,
      questionType: 'release_date',
      resolutionDate,
      searchQueries: uniqueQueries([
        'site:rockstargames.com Grand Theft Auto VI',
        'site:rockstargames.com GTA 6 release date',
        'site:take2games.com Grand Theft Auto VI release',
        'Rockstar Games GTA 6 release date latest',
        'Grand Theft Auto VI delay latest',
      ]),
      entity: makeEntity('Grand Theft Auto VI', {
        aliases: ['GTA 6', 'GTA VI', 'Grand Theft Auto VI'],
        officialDomains: ['rockstargames.com', 'take2games.com'],
        avoidTerms: ['gta v', 'legacy', 'apk', 'mod'],
        ambiguity: category === 'games' && /\bvi\b/i.test(lower) && !/\bgta\b/i.test(lower) ? 'medium' : 'low',
        rationale: 'Games category plus launch wording strongly indicates Rockstar\'s Grand Theft Auto VI.',
      }),
    };
  }

  if ((category === 'crypto' || /\bcrypto\b/i.test(task)) && /\barc\b/i.test(lower) && /\bmainnet|launch\b/i.test(lower)) {
    return {
      subject: 'ARC Network mainnet launch',
      underlying: null,
      questionType: 'launch_milestone',
      resolutionDate,
      searchQueries: uniqueQueries([
        'ARC Network crypto',
        'ARC Network blockchain',
        'Circle Arc blockchain',
        'ARC stablecoin-native L1 blockchain',
        'site:arc.network ARC Network mainnet',
        'site:arc.network ARC Network launch',
        'site:arc.io ARC Network blockchain',
        'ARC Network roadmap mainnet 2026',
        'ARC Network launch date announcement',
      ]),
      entity: makeEntity('ARC Network', {
        aliases: ['ARC', 'ARC Network', 'Arc Network', 'ARC blockchain'],
        officialDomains: ['arc.network', 'arc.io', 'circle.com'],
        avoidTerms: [
          'arc browser',
          'arc.net',
          'chip.de',
          'clinic',
          'webbrowser',
          'arc games',
          'arcofopportunity.org',
          'opportunity',
        ],
        ambiguity: /\barc\b/i.test(lower) && !/\bnetwork\b/i.test(lower) ? 'medium' : 'low',
        rationale: 'Crypto category plus mainnet wording points to a blockchain project, not the Arc browser.',
      }),
    };
  }

  if (/\bworld cup\b|\bfifa\b/i.test(lower)) {
    return {
      subject: 'FIFA World Cup 2026 winner',
      underlying: null,
      questionType: 'event_outcome',
      resolutionDate,
      searchQueries: uniqueQueries([
        'site:fifa.com FIFA World Cup 2026',
        'FIFA World Cup 2026 favorites odds',
        'FIFA World Cup 2026 Opta prediction',
        'FIFA World Cup 2026 team rankings',
        'FIFA World Cup 2026 injuries form',
      ]),
      entity: makeEntity('FIFA World Cup 2026', {
        aliases: ['World Cup 2026', 'FIFA World Cup 2026'],
        officialDomains: ['fifa.com', 'bbc.com', 'sportingnews.com', 'theanalyst.com'],
        avoidTerms: ['wikipedia'],
        ambiguity: 'low',
        rationale: 'This should be researched as a sports winner market with team strength and odds evidence.',
      }),
    };
  }

  if (/\breach\b|\bhit\b|\$\d/i.test(lower)) {
    const ticker = question.match(/\(([A-Z]{2,6})\)/)?.[1];
    const stripped = question
      .replace(/^\s*will\s+/i, '')
      .replace(/\breach\b[\s\S]*$/i, '')
      .replace(/\bhit\b[\s\S]*$/i, '')
      .replace(/[?.,:;()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      subject: stripped || question,
      underlying: null,
      questionType: 'price_target',
      resolutionDate,
      searchQueries: uniqueQueries([
        ticker ? `${ticker} price prediction 2026` : null,
        ticker ? `${ticker} price forecast` : null,
        `${stripped || question} price prediction 2026`,
        `${stripped || question} latest news`,
      ]),
      entity: makeEntity(stripped || question, {
        aliases: ticker ? [ticker, stripped || question] : [stripped || question],
        officialDomains: [],
        avoidTerms: [],
        ambiguity: 'high',
        rationale:
          'Price-target wording is present, but the subject is not verified yet. A ticker or token-like name alone is not proof that the asset exists, so retrieval must confirm the entity before drawing conclusions.',
      }),
    };
  }

  if (/\blaunch|release|mainnet|ship\b/i.test(lower)) {
    const stripped = question
      .replace(/^\s*will\s+/i, '')
      .replace(/\bbefore\b[\s\S]*$/i, '')
      .replace(/[?.,:;()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      subject: stripped || question,
      underlying: null,
      questionType: /\bmainnet\b/i.test(lower) ? 'launch_milestone' : 'release_date',
      resolutionDate,
      searchQueries: uniqueQueries([
        `${stripped || question} official announcement`,
        `${stripped || question} roadmap`,
        `${stripped || question} latest news`,
      ]),
      entity: makeEntity(stripped || question, {
        aliases: [stripped || question],
        officialDomains: [],
        avoidTerms: [],
        ambiguity: 'high',
        rationale: 'Launch-style wording is present but the underlying entity is not clearly resolved.',
      }),
    };
  }

  return null;
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
  const heuristic = heuristicUnderstanding(task, now);

  try {
    const raw = await Promise.race([
      callHermesFast(SYSTEM_PROMPT, userMessage),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('market-understanding timed out')), timeoutMs),
      ),
    ]);
    return mergeUnderstandingWithHeuristic(task, coerceUnderstanding(extractJson(raw)), heuristic);
  } catch (error) {
    console.warn(
      '[market-understanding] extraction failed:',
      error instanceof Error ? error.message : String(error),
    );
    return heuristic;
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
