/**
 * Fetches structured live context for the research agent before calling Hermes.
 * CoinGecko is used for current token market metrics.
 * DefiLlama is used for chain-level TVL and stablecoin liquidity.
 * GDELT is used for current-event and geopolitical article context.
 * Firecrawl is used to search and scrape the newest article bodies into compact snapshots.
 * DuckDuckGo is used for lightweight background context and descriptive snippets.
 */
import { fetchUrlViaFirecrawl, searchFirecrawlNews, type FirecrawlSearchResult } from './firecrawl';
import { classifyTopic, selectSources, type SourceConfig } from './source-registry';

type ResearchDomain = 'crypto' | 'geopolitics' | 'general';

type CoinGeckoAssetSnapshot = {
  symbol: string;
  coinId: string;
  price_usd?: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  change_24h_pct?: number;
  last_updated_at?: string;
};

type DuckDuckGoSnapshot = {
  query: string;
  abstract?: string;
  answer?: string;
  definition?: string;
  related_topics?: string[];
};

type WikipediaPageSnapshot = {
  title: string;
  description?: string;
  summary?: string;
  url?: string;
  last_updated_at?: string;
};

type GdeltArticleSnapshot = {
  title: string;
  url: string;
  article_url?: string;
  domain?: string;
  publisher?: string;
  language?: string;
  source_country?: string;
  seen_at?: string;
};

type CurrentEventsSnapshot = {
  source: string;
  query_variants: string[];
  recency_window_days: number;
  latest_seen_at?: string;
  freshness: 'fresh' | 'stale_or_thin';
  has_recent_articles: boolean;
  articles: GdeltArticleSnapshot[];
  background_articles?: GdeltArticleSnapshot[];
  status_articles?: GdeltArticleSnapshot[];
  article_snapshots?: FirecrawlArticleSnapshot[];
  framing_signals?: CurrentEventFramingSignals;
};

type FirecrawlArticleSnapshot = {
  title: string;
  url: string;
  publisher?: string;
  seen_at?: string;
  summary: string;
};

type CurrentEventSignalSupport = {
  title: string;
  source_name: string;
  source_url: string;
  date_or_period?: string;
};

type CurrentEventFramingSignals = {
  broader_conflict_status?: 'reported_active_war' | 'unclear';
  hormuz_route_status?:
    | 'severely_constrained_with_limited_passage'
    | 'severely_constrained'
    | 'elevated_risk_routes_still_operating'
    | 'unclear';
  red_sea_route_status?:
    | 'elevated_risk_latest_direct_shipping_strikes_not_confirmed'
    | 'direct_shipping_attacks_reported'
    | 'unclear';
  notes: string[];
  support?: CurrentEventSignalSupport[];
};

type DefiLlamaChainSnapshot = {
  chain: string;
  tvl_usd?: number;
  stablecoins_usd?: number;
  stablecoins_change_1d_usd?: number;
  stablecoins_change_1d_pct?: number;
  top_stablecoins?: Array<{
    symbol: string;
    name: string;
    circulating_usd: number;
  }>;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const LIVE_DATA_FETCH_TIMEOUT_MS = 4_000;
const LIVE_DATA_CACHE_TTL_MS = 60_000;
const COINGECKO_CACHE_TTL_MS = 30_000;
const DEFILLAMA_CACHE_TTL_MS = 300_000;
const DUCKDUCKGO_CACHE_TTL_MS = 120_000;
const GDELT_CACHE_TTL_MS = 120_000;
const NEWS_RSS_CACHE_TTL_MS = 120_000;
const THN_RSS_CACHE_TTL_MS = 120_000;
const WIKIPEDIA_CACHE_TTL_MS = 300_000;
const FIRECRAWL_CACHE_TTL_MS = 300_000;
const GDELT_MIN_INTERVAL_MS = 6_000;
const THN_RSS_URL = 'https://feeds.feedburner.com/TheHackersNews';
const CURRENT_EVENT_RECENCY_WINDOW_DAYS = Number(
  process.env.CURRENT_EVENT_RECENCY_WINDOW_DAYS || 45,
);

const liveDataCache = new Map<string, CacheEntry<string>>();
const coinGeckoCache = new Map<string, CacheEntry<CoinGeckoAssetSnapshot[]>>();
const duckDuckGoCache = new Map<string, CacheEntry<DuckDuckGoSnapshot | null>>();
const gdeltCache = new Map<string, CacheEntry<GdeltArticleSnapshot[]>>();
const newsRssCache = new Map<string, CacheEntry<GdeltArticleSnapshot[]>>();
const thnRssCache = new Map<string, CacheEntry<GdeltArticleSnapshot[]>>();
const wikipediaCache = new Map<string, CacheEntry<WikipediaPageSnapshot[]>>();
const firecrawlArticleCache = new Map<string, CacheEntry<FirecrawlArticleSnapshot | null>>();
const firecrawlSearchCache = new Map<string, CacheEntry<FirecrawlArticleSnapshot[]>>();
const redirectUrlCache = new Map<string, CacheEntry<string | null>>();

let defillamaChainsCache: CacheEntry<Array<{ name?: string; tvl?: number }>> | null =
  null;
let defillamaStablecoinsCache: CacheEntry<{
  peggedAssets?: Array<{
    name?: string;
    symbol?: string;
    chainCirculating?: Record<
      string,
      {
        current?: { peggedUSD?: number };
        circulatingPrevDay?: { peggedUSD?: number };
      }
    >;
  }>;
}> | null = null;
let gdeltNextAllowedAt = 0;

function stripExecutionContext(task: string): string {
  return task.replace(/\bExecution context:[\s\S]*$/i, '').replace(/\s+/g, ' ').trim();
}

function splitExpandedTaskQueries(task: string): string[] {
  return task
    .split('|')
    .map((query) => query.trim())
    .filter(Boolean);
}

function addUniqueQuery(queries: string[], query: string | undefined): void {
  const value = query?.replace(/\s+/g, ' ').trim();
  if (!value || queries.includes(value)) return;
  queries.push(value);
}

function isArcNetworkTask(task: string): boolean {
  return /\barc network\b|\barc blockchain\b|\barc testnet\b|\barc ecosystem\b/i.test(task);
}

function buildResearchQueryVariants(task: string): string[] {
  const cleanedTask = stripExecutionContext(task);
  const queries: string[] = [];
  const splitQueries = splitExpandedTaskQueries(cleanedTask);

  for (const variant of splitQueries) {
    addUniqueQuery(queries, variant);
    addUniqueQuery(queries, normalizeCurrentEventQuery(variant));
  }

  if (splitQueries.length === 0) {
    addUniqueQuery(queries, normalizeCurrentEventQuery(cleanedTask));
  }

  if (isArcNetworkTask(cleanedTask)) {
    addUniqueQuery(queries, 'Arc Network blockchain Circle L1 stablecoin');
    addUniqueQuery(queries, 'Arc testnet Circle stablecoin blockchain');
    addUniqueQuery(queries, 'site:arc.network Arc Network ecosystem');
    addUniqueQuery(queries, 'site:circle.com Arc Network blockchain');
    addUniqueQuery(queries, 'Arc Network ecosystem DeFi projects');

    if (/\becosystem\b|\bdefi\b|\bprojects?\b/i.test(cleanedTask)) {
      addUniqueQuery(queries, 'Arc Network DeFi ecosystem builders apps');
      addUniqueQuery(queries, 'Arc Network stablecoin developers projects');
    }
  }

  return queries.slice(0, 10);
}

const COIN_KEYWORDS: Array<{ pattern: RegExp; coinId: string; symbol: string }> = [
  { pattern: /\bbitcoin\b|\bbtc\b/i, coinId: 'bitcoin', symbol: 'BTC' },
  { pattern: /\bethereum\b|\beth\b/i, coinId: 'ethereum', symbol: 'ETH' },
  { pattern: /\bsolana\b|\bsol\b/i, coinId: 'solana', symbol: 'SOL' },
  { pattern: /\bbase\b/i, coinId: 'ethereum', symbol: 'ETH' },
  { pattern: /\busdc\b|\busd coin\b/i, coinId: 'usd-coin', symbol: 'USDC' },
  { pattern: /\btether\b|\busdt\b/i, coinId: 'tether', symbol: 'USDT' },
  { pattern: /\bdai\b/i, coinId: 'dai', symbol: 'DAI' },
];

const COIN_TO_CHAIN_TARGET: Record<string, string> = {
  bitcoin: 'Bitcoin',
  ethereum: 'Ethereum',
  solana: 'Solana',
};

const CHAIN_KEYWORDS: Array<{ pattern: RegExp; chain: string }> = [
  { pattern: /\bethereum\b|\beth\b/i, chain: 'Ethereum' },
  { pattern: /\bsolana\b|\bsol\b/i, chain: 'Solana' },
  { pattern: /\bbase\b/i, chain: 'Base' },
  { pattern: /\barbitrum\b/i, chain: 'Arbitrum' },
  { pattern: /\boptimism\b|\bop mainnet\b/i, chain: 'OP Mainnet' },
  { pattern: /\bpolygon\b|\bmatic\b/i, chain: 'Polygon' },
  { pattern: /\bavalanche\b|\bavax\b/i, chain: 'Avalanche' },
  { pattern: /\bbsc\b|\bbnb chain\b|\bbinance smart chain\b/i, chain: 'BSC' },
  { pattern: /\btron\b|\btrx\b/i, chain: 'Tron' },
  { pattern: /\bsui\b/i, chain: 'Sui' },
  { pattern: /\baptos\b/i, chain: 'Aptos' },
  { pattern: /\bbitcoin\b|\bbtc\b/i, chain: 'Bitcoin' },
];

const GEOPOLITICS_KEYWORDS: RegExp[] = [
  /\bwar\b/i,
  /\bconflict\b/i,
  /\btension\b/i,
  /\btensions\b/i,
  /\bmilitary\b/i,
  /\bstrike\b/i,
  /\bairstrike\b/i,
  /\bmissile\b/i,
  /\bsanction/i,
  /\bproxy\b/i,
  /\bceasefire\b/i,
  /\bgeopolitic/i,
  /\brisk assessment\b/i,
  /\btroops?\b/i,
  /\bnuclear\b/i,
  /\biran\b/i,
  /\bisrael\b/i,
  /\bgaza\b/i,
  /\bhamas\b/i,
  /\bhezbollah\b/i,
  /\brussia\b/i,
  /\bukraine\b/i,
  /\bchina\b/i,
  /\btaiwan\b/i,
  /\bunited states\b/i,
  /\bUS\b/,
  /\busa\b/i,
  /\bu\.s\.?\b/i,
  /\bhormuz\b/i,
  /\bshipping\b/i,
  /\bshipping routes\b/i,
  /\bstrait of hormuz\b/i,
];

const GEOPOLITICAL_ENTITIES: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: 'Iran', pattern: /\biran\b/i },
  {
    canonical: 'United States',
    pattern: /\bunited states\b|\busa\b|\bu\.s\.?\b|\bamerica\b/i,
  },
  { canonical: 'Israel', pattern: /\bisrael\b/i },
  { canonical: 'Russia', pattern: /\brussia\b/i },
  { canonical: 'Ukraine', pattern: /\bukraine\b/i },
  { canonical: 'China', pattern: /\bchina\b/i },
  { canonical: 'Taiwan', pattern: /\btaiwan\b/i },
  { canonical: 'Gaza', pattern: /\bgaza\b/i },
  { canonical: 'Hamas', pattern: /\bhamas\b/i },
  { canonical: 'Hezbollah', pattern: /\bhezbollah\b/i },
  { canonical: 'Lebanon', pattern: /\blebanon\b/i },
  { canonical: 'Syria', pattern: /\bsyria\b/i },
  { canonical: 'Yemen', pattern: /\byemen\b/i },
];

const TRUSTED_CURRENT_EVENT_SOURCES: Array<{
  pattern: RegExp;
  score: number;
}> = [
  { pattern: /\bassociated press\b|\bap news\b|apnews\.com/i, score: 100 },
  { pattern: /\breuters\b|reuters\.com/i, score: 95 },
  { pattern: /\bbbc\b|bbc\.com|bbc\.co\.uk/i, score: 90 },
  { pattern: /\bun\b|\bunited nations\b|un\.org/i, score: 92 },
  { pattern: /\bdefense\.gov\b|\bpentagon\b/i, score: 90 },
  { pattern: /\bstate\.gov\b/i, score: 90 },
  { pattern: /\bcbs news\b|cbsnews\.com/i, score: 88 },
  { pattern: /\bcnbc\b|cnbc\.com/i, score: 86 },
  { pattern: /\bpbs news\b|pbs\.org/i, score: 84 },
  { pattern: /\baxios\b/i, score: 86 },
  { pattern: /\bnytimes\b|\bnew york times\b/i, score: 82 },
  { pattern: /\bwashington post\b/i, score: 80 },
  { pattern: /\bfinancial times\b|ft\.com/i, score: 80 },
  { pattern: /\bwall street journal\b|wsj\.com/i, score: 80 },
  { pattern: /\bthe guardian\b/i, score: 76 },
  { pattern: /\busni\b|news\.usni\.org/i, score: 74 },
  { pattern: /\bcouncil on foreign relations\b|\bcfr\b/i, score: 72 },
  { pattern: /\batlantic council\b/i, score: 68 },
  { pattern: /\bhstoday\b|hstoday\.us/i, score: -8 },
];

function normalizePublisherLabel(publisher: string | undefined, url: string): string | undefined {
  const haystack = `${publisher || ''} ${url}`;
  if (/\bassociated press\b|\bap news\b|apnews\.com/i.test(haystack)) return 'AP News';
  if (/\breuters\b|reuters\.com/i.test(haystack)) return 'Reuters';
  if (/\bbbc\b|bbc\.com|bbc\.co\.uk/i.test(haystack)) return 'BBC News';
  if (/\bnytimes\b|\bnew york times\b/i.test(haystack)) return 'The New York Times';
  if (/\bwashington post\b|washingtonpost\.com/i.test(haystack)) return 'The Washington Post';
  if (/\bcbs news\b|cbsnews\.com/i.test(haystack)) return 'CBS News';
  if (/\bcnbc\b|cnbc\.com/i.test(haystack)) return 'CNBC';
  if (/\bpbs news\b|pbs\.org/i.test(haystack)) return 'PBS News';
  if (/\bcouncil on foreign relations\b|\bcfr\b/i.test(haystack)) return 'Council on Foreign Relations';
  if (/\busni\b|news\.usni\.org/i.test(haystack)) return 'USNI News';
  if (/\bhstoday\b|hstoday\.us/i.test(haystack)) return 'HSToday';
  return publisher;
}

function getCacheValue<T>(entry: CacheEntry<T> | null | undefined): T | null {
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) return null;
  return entry.value;
}

function setTimedCache<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
): T {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(LIVE_DATA_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchTextWithTimeout(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(LIVE_DATA_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }

  return response.text();
}

function detectResearchDomain(task: string): ResearchDomain {
  const cleanedTask = stripExecutionContext(task);
  if (isArcNetworkTask(cleanedTask)) {
    return 'crypto';
  }
  const cryptoHits =
    COIN_KEYWORDS.filter((item) => item.pattern.test(cleanedTask)).length +
    CHAIN_KEYWORDS.filter((item) => item.pattern.test(cleanedTask)).length +
    (/\bcrypto\b|\bcoin\b|\btoken\b|\bdefi\b|\bstablecoin\b|\bmarket cap\b/i.test(cleanedTask)
      ? 2
      : 0);

  const geopoliticsHits = GEOPOLITICS_KEYWORDS.filter((pattern) =>
    pattern.test(cleanedTask),
  ).length;
  const geopoliticalEntityHits = extractGeopoliticalEntities(cleanedTask).length;

  if (
    (geopoliticsHits > cryptoHits && geopoliticsHits >= 2) ||
    geopoliticalEntityHits >= 2 ||
    (geopoliticalEntityHits >= 1 && /\bshipping\b|\bhormuz\b|\bstrait\b/i.test(cleanedTask))
  ) {
    return 'geopolitics';
  }

  if (cryptoHits > 0) {
    return 'crypto';
  }

  return 'general';
}

function pickCoinTargets(task: string): Array<{ coinId: string; symbol: string }> {
  const matches = COIN_KEYWORDS.filter((item) => item.pattern.test(task)).map(
    (item) => ({
      coinId: item.coinId,
      symbol: item.symbol,
    }),
  );

  const deduped = new Map<string, { coinId: string; symbol: string }>();
  for (const item of matches) {
    deduped.set(item.coinId, item);
  }

  if (deduped.size > 0) {
    return [...deduped.values()].slice(0, 5);
  }

  if (isArcNetworkTask(task)) {
    return [];
  }

  if (/\bcrypto\b|\bcoin\b|\btoken\b|\bmarket cap\b|\bstablecoin\b/i.test(task)) {
    return [
      { coinId: 'bitcoin', symbol: 'BTC' },
      { coinId: 'ethereum', symbol: 'ETH' },
      { coinId: 'solana', symbol: 'SOL' },
    ];
  }

  return [];
}

function pickChainTargets(task: string): string[] {
  const deduped = new Set<string>();

  if (isArcNetworkTask(task)) {
    deduped.add('Arc');
  }

  for (const item of CHAIN_KEYWORDS) {
    if (item.pattern.test(task)) {
      deduped.add(item.chain);
    }
  }

  if (deduped.size === 0) {
    for (const item of pickCoinTargets(task)) {
      const chain = COIN_TO_CHAIN_TARGET[item.coinId];
      if (chain) deduped.add(chain);
    }
  }

  return [...deduped].slice(0, 5);
}

function unixToIso(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return new Date(value * 1000).toISOString();
}

function gdeltTimestampToIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return undefined;

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  ).toISOString();
}

function buildGdeltQuery(task: string): string {
  const cleaned = task.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? `${cleaned} sourcelang:english` : 'sourcelang:english';
}

function extractGeopoliticalEntities(task: string): string[] {
  const matches = GEOPOLITICAL_ENTITIES.filter((entity) => {
    if (entity.canonical === 'United States') {
      return entity.pattern.test(task) || /\bUS\b/.test(task);
    }
    return entity.pattern.test(task);
  }).map((entity) => entity.canonical);
  return [...new Set(matches)].slice(0, 3);
}

function normalizeCurrentEventQuery(task: string): string {
  return task
    .replace(/^\s*(make|write|create|generate|prepare|give)(?:\s+(?:me|us))?(?:\s+a)?\s+/i, '')
    .replace(/^\s*(research report|report|analysis|assessment|brief)\s+(?:on|of)\s+/i, '')
    .replace(/\bresearch report\b/gi, ' ')
    .replace(/\breport\b/gi, ' ')
    .replace(/\banalysis\b/gi, ' ')
    .replace(/\bassessment\b/gi, ' ')
    .replace(/\bbrief\b/gi, ' ')
    .replace(/\bcurrent status\b/gi, ' ')
    .replace(/\bongoing\b/gi, ' ')
    .replace(/\blatest\b/gi, ' ')
    .replace(/\btoday\b/gi, ' ')
    .replace(/[?.,:;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(on|of|about)\s+/i, '')
    .trim();
}

function buildCurrentEventQueries(task: string): string[] {
  const cleanedTask = stripExecutionContext(task);
  const queries: string[] = [];
  const entities = extractGeopoliticalEntities(cleanedTask);
  const shippingFocused = /\bshipping\b|\bhormuz\b|\bstrait of hormuz\b|\bred sea\b|\bsuez\b/i.test(
    cleanedTask,
  );
  const addQuery = (query: string) => {
    const value = query.replace(/\s+/g, ' ').trim();
    if (!value) return;
  if (!queries.includes(value)) {
      queries.push(value);
    }
  };

  for (const query of buildResearchQueryVariants(cleanedTask)) {
    addQuery(query);
  }

  if (shippingFocused) {
    addQuery('Strait of Hormuz shipping latest');
    addQuery('Hormuz shipping disruption latest');
    addQuery('Red Sea shipping latest');
  }
  if (entities.length >= 2) {
    addQuery(`${entities.join(' ')} latest`);
    if (!shippingFocused) {
      addQuery(`${entities.join(' ')} conflict latest`);
    }
    addQuery(`${entities.join(' ')} tensions latest`);
    if (shippingFocused) {
      addQuery(`${entities.join(' ')} shipping latest`);
      addQuery(`${entities.join(' ')} hormuz shipping latest`);
      addQuery(`${entities.join(' ')} red sea shipping latest`);
    }
  } else if (entities.length === 1) {
    addQuery(`${entities[0]} latest`);
    if (shippingFocused) {
      addQuery(`${entities[0]} shipping latest`);
    }
  }

  return queries.slice(0, 10);
}

function shouldGatherCurrentEvents(task: string): boolean {
  const cleanedTask = stripExecutionContext(task);
  return (
    detectResearchDomain(cleanedTask) === 'geopolitics' ||
    isTimeSensitiveTask(cleanedTask) ||
    /\bresearch\b|\becosystem\b|\bdefi projects?\b|\bdevelopments?\b|\bmarket analysis\b/i.test(
      cleanedTask,
    ) ||
    isArcNetworkTask(cleanedTask)
  );
}

function buildConflictStatusQueries(task: string): string[] {
  const cleanedTask = stripExecutionContext(task);
  const entities = extractGeopoliticalEntities(cleanedTask);
  const queries: string[] = [];
  const addQuery = (query: string) => {
    const value = query.replace(/\s+/g, ' ').trim();
    if (!value) return;
    if (!queries.includes(value)) {
      queries.push(value);
    }
  };

  if (entities.length >= 2) {
    addQuery(`${entities.join(' ')} war latest`);
    addQuery(`${entities.join(' ')} conflict latest`);
    addQuery(`${entities.join(' ')} latest`);
  } else if (/\bwar\b|\bconflict\b|\btension|\bshipping\b|\bhormuz\b/i.test(cleanedTask)) {
    const normalized = normalizeCurrentEventQuery(cleanedTask);
    if (normalized) {
      addQuery(`${normalized} war latest`);
      addQuery(`${normalized} conflict latest`);
    }
  }

  return queries.slice(0, 3);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}

function truncateSentences(value: string | undefined, maxChars: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;

  const truncated = normalized.slice(0, maxChars);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('? '),
    truncated.lastIndexOf('! '),
  );

  if (lastSentenceEnd > 120) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }

  return `${truncated.trim()}...`;
}

function currentEventSourceScore(article: GdeltArticleSnapshot): number {
  const haystack = [
    article.publisher,
    article.domain,
    article.url,
    article.title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const source of TRUSTED_CURRENT_EVENT_SOURCES) {
    if (source.pattern.test(haystack)) {
      return source.score;
    }
  }

  return 10;
}

function eventRecencyScore(seenAt?: string): number {
  if (!seenAt) return 0;
  const timestamp = Date.parse(seenAt);
  if (!Number.isFinite(timestamp)) return 0;
  if (timestamp > Date.now() + 6 * 60 * 60 * 1000) return -100;
  const ageDays = (Date.now() - timestamp) / 86_400_000;
  if (ageDays <= 3) return 40;
  if (ageDays <= 7) return 32;
  if (ageDays <= 14) return 24;
  if (ageDays <= CURRENT_EVENT_RECENCY_WINDOW_DAYS) return 16;
  if (ageDays <= 120) return 8;
  return 0;
}

function isFutureSeenAt(seenAt?: string): boolean {
  if (!seenAt) return false;
  const timestamp = Date.parse(seenAt);
  return Number.isFinite(timestamp) && timestamp > Date.now() + 6 * 60 * 60 * 1000;
}

function isUsableCurrentEventArticle(article: GdeltArticleSnapshot | FirecrawlArticleSnapshot): boolean {
  return !isFutureSeenAt(article.seen_at);
}

function currentEventRank(article: GdeltArticleSnapshot): number {
  return (
    currentEventSourceScore(article) +
    eventRecencyScore(article.seen_at) +
    currentEventUrlQualityScore(article)
  );
}

function isTimeSensitiveTask(task: string): boolean {
  return /\b(latest|today|current|ongoing|recent|breaking|news|update|updates|this week|right now)\b/i.test(
    task,
  );
}

function shouldBypassCurrentEventCaches(task: string): boolean {
  const cleanedTask = stripExecutionContext(task);
  return detectResearchDomain(cleanedTask) === 'geopolitics' || isTimeSensitiveTask(cleanedTask);
}

function isRecentCurrentEvent(article: GdeltArticleSnapshot): boolean {
  if (!article.seen_at) return false;
  const timestamp = Date.parse(article.seen_at);
  if (!Number.isFinite(timestamp)) return false;
  const ageDays = (Date.now() - timestamp) / 86_400_000;
  return ageDays <= CURRENT_EVENT_RECENCY_WINDOW_DAYS;
}

function normalizeArticleKey(article: GdeltArticleSnapshot): string {
  const titleKey = normalizeArticleTitle(article.title);
  const publisherKey = normalizePublisherKey(article);
  if (titleKey && publisherKey) {
    return `${publisherKey}:${titleKey}`;
  }

  const url = (article.url || article.article_url || '').toLowerCase().replace(/\/+$/, '');
  if (url) return url;

  return `${publisherKey || 'unknown'}:${titleKey || 'untitled'}`.trim();
}

function mergeCurrentEventArticles(
  articleGroups: GdeltArticleSnapshot[][],
): GdeltArticleSnapshot[] {
  const deduped = new Map<string, GdeltArticleSnapshot>();

  for (const group of articleGroups) {
    for (const article of group) {
      if (!isUsableCurrentEventArticle(article)) continue;
      const key = normalizeArticleKey(article);
      const existing = deduped.get(key);
      if (!existing || currentEventRank(article) > currentEventRank(existing)) {
        deduped.set(key, article);
      }
    }
  }

  return [...deduped.values()].sort((a, b) => currentEventRank(b) - currentEventRank(a));
}

function isGoogleNewsUrl(url: string | undefined): boolean {
  return Boolean(url && /news\.google\.com/i.test(url));
}

function normalizeArticleTitle(title: string | undefined): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePublisherKey(article: GdeltArticleSnapshot): string {
  return (article.publisher || article.domain || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function currentEventUrlQualityScore(article: GdeltArticleSnapshot): number {
  const url = article.url?.trim();
  if (!url) return 0;
  if (isLikelyHomepageUrl(url)) return -12;
  if (isGoogleNewsUrl(url)) return -6;
  return 18;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function markdownToSnippet(markdown: string, maxChars = 520): string | null {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return truncateSentences(text, maxChars) ?? null;
}

function extractHostname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return undefined;
  }
}

function getMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!metadata) return undefined;

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function extractFirecrawlSeenAt(result: FirecrawlSearchResult): string | undefined {
  const metadata =
    result.metadata && typeof result.metadata === 'object' ? result.metadata : undefined;
  const candidate = getMetadataString(metadata, [
    'publishedTime',
    'article:published_time',
    'article_published_time',
    'modifiedTime',
    'last_updated_date',
  ]);

  if (!candidate) return undefined;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function buildFirecrawlSearchSnapshot(
  result: FirecrawlSearchResult,
): FirecrawlArticleSnapshot | null {
  const metadata =
    result.metadata && typeof result.metadata === 'object' ? result.metadata : undefined;
  const url =
    getMetadataString(metadata, ['sourceURL', 'ogUrl', 'og:url', 'url']) ||
    result.url?.trim();

  if (!url || isLikelyHomepageUrl(url)) {
    return null;
  }

  const title =
    result.title?.trim() ||
    getMetadataString(metadata, ['og_title', 'og:title', 'title']) ||
    'Untitled article';
  const rawPublisher =
    getMetadataString(metadata, ['ogSiteName', 'og:site_name', 'og_site_name']) ||
    extractHostname(url);
  const publisher = normalizePublisherLabel(rawPublisher, url) || rawPublisher;
  const summary =
    truncateSentences(result.description || result.snippet, 320) ||
    (result.markdown ? markdownToSnippet(result.markdown, 420) : null);

  if (!summary) {
    return null;
  }

  return {
    title,
    url,
    publisher,
    seen_at: extractFirecrawlSeenAt(result),
    summary,
  };
}

function snapshotToCurrentEventArticle(
  snapshot: FirecrawlArticleSnapshot,
): GdeltArticleSnapshot {
  return {
    title: snapshot.title,
    url: snapshot.url,
    publisher: snapshot.publisher,
    domain: extractHostname(snapshot.url),
    seen_at: snapshot.seen_at,
    language: 'English',
  };
}

function firecrawlSnapshotRelevance(snapshot: FirecrawlArticleSnapshot, task: string): number {
  const haystack = `${snapshot.title} ${snapshot.summary} ${snapshot.publisher || ''}`.toLowerCase();
  let score = currentEventSourceScore(snapshotToCurrentEventArticle(snapshot));

  const shippingTerms = [
    'shipping',
    'ship',
    'tanker',
    'lpg',
    'insurance',
    'hormuz',
    'strait',
    'red sea',
    'suez',
    'maritime',
    'port',
  ];

  if (/\bshipping\b|\bhormuz\b|\bstrait\b|\binsurance\b|\btanker\b|\bred sea\b|\bsuez\b/i.test(task)) {
    for (const term of shippingTerms) {
      if (haystack.includes(term)) {
        score += 8;
      }
    }
  }

  if (/\biran\b/i.test(task) && haystack.includes('iran')) score += 6;
  if (/\bunited states\b|\busa\b|\bu\.s\.?\b|\bus\b/i.test(task) && /\bunited states\b|\bu\.s\b|\bus\b/.test(haystack)) score += 6;
  if (/\bhormuz\b|\bstrait of hormuz\b/i.test(task) && /\bhormuz\b|\bstrait of hormuz\b/.test(haystack)) score += 10;
  if (/\bshipping\b|\bmaritime\b|\binsurance\b|\btanker\b/i.test(task) && /\bshipping\b|\bmaritime\b|\binsurance\b|\btanker\b/.test(haystack)) score += 8;
  if (/\/live\//i.test(snapshot.url)) score -= 2;
  if (/^(here'?s what|what is|why\b|how\b|potential\b)/i.test(snapshot.title)) score -= 20;
  if (/\bcould\b|\bmay\b|\bwhat needs to happen\b/.test(haystack)) score -= 10;
  if (/^[A-Z][A-Za-z'. -]{1,40}\s+says\b/i.test(snapshot.title)) score -= 15;

  return score;
}

function shippingEvidenceScore(snapshot: FirecrawlArticleSnapshot): number {
  const haystack = `${snapshot.title} ${snapshot.summary} ${snapshot.publisher || ''}`.toLowerCase();
  let score = 0;

  if (/\bhormuz\b|\bstrait of hormuz\b/.test(haystack)) score += 4;
  if (/\bred sea\b/.test(haystack)) score += 4;
  if (/\bshipping\b|\bship\b|\bmaritime\b/.test(haystack)) score += 3;
  if (/\btanker\b|\binsurance\b|\boil\b|\btransit\b/.test(haystack)) score += 2;

  return score;
}

function buildSignalSupport(
  article: GdeltArticleSnapshot | FirecrawlArticleSnapshot,
): CurrentEventSignalSupport {
  const normalizedSourceName = normalizePublisherLabel(
    ('publisher' in article && article.publisher) || ('domain' in article && article.domain) || undefined,
    article.url,
  );
  return {
    title: article.title,
    source_name:
      normalizedSourceName ||
      ('publisher' in article && article.publisher) ||
      ('domain' in article && article.domain) ||
      extractHostname(article.url) ||
      'Unknown source',
    source_url: article.url,
    date_or_period: article.seen_at,
  };
}

function deriveCurrentEventFramingSignals(params: {
  task: string;
  articles: GdeltArticleSnapshot[];
  statusArticles: GdeltArticleSnapshot[];
  articleSnapshots: FirecrawlArticleSnapshot[];
}): CurrentEventFramingSignals | undefined {
  const combined = new Map<string, GdeltArticleSnapshot | FirecrawlArticleSnapshot>();
  for (const article of [...params.articles, ...params.statusArticles, ...params.articleSnapshots]) {
    const key =
      'summary' in article
        ? `${article.url.toLowerCase()}::${normalizeArticleTitle(article.title)}`
        : normalizeArticleKey(article);
    if (!combined.has(key)) {
      combined.set(key, article);
    }
  }

  const recent = [...combined.values()].filter((article) => {
    if (!article.seen_at) return true;
    return eventRecencyScore(article.seen_at) >= 16;
  });

  const strong = recent.filter((article) => {
    const proxy: GdeltArticleSnapshot =
      'summary' in article
        ? {
            title: article.title,
            url: article.url,
            publisher: article.publisher,
            seen_at: article.seen_at,
            domain: extractHostname(article.url),
          }
        : article;
    return currentEventSourceScore(proxy) >= 80;
  });

  const textOf = (article: GdeltArticleSnapshot | FirecrawlArticleSnapshot): string =>
    `${article.title} ${
      'summary' in article ? article.summary : ''
    } ${'publisher' in article ? article.publisher || '' : ''}`.toLowerCase();

  const supportBy = (
    predicate: (article: GdeltArticleSnapshot | FirecrawlArticleSnapshot) => boolean,
  ) => strong.filter(predicate);

  const broaderConflictSupport = supportBy((article) => {
    const text = textOf(article);
    return (
      /\bwar\b/.test(text) ||
      /\bsince war began\b/.test(text) ||
      /\bongoing conflict\b/.test(text) ||
      /\bactive conflict\b/.test(text)
    );
  });
  const broaderConflictContext = supportBy((article) => {
    const text = textOf(article);
    return (
      (/\biran\b/.test(text) || /\bu\.s\b|\bunited states\b|\bisrael\b/.test(text)) &&
      (/\bwar\b/.test(text) || /\bconflict\b/.test(text) || /\bescalat/i.test(text))
    );
  });

  const hormuzSevereSupport = supportBy((article) => {
    const text = textOf(article);
    return (
      /\bhormuz\b|\bstrait of hormuz\b/.test(text) &&
      (/\btoll booth\b/.test(text) ||
        /\bgatekeep/i.test(text) ||
        /\beffectively closed\b/.test(text) ||
        /\ball but halted\b/.test(text) ||
        /\bsecond attempt\b/.test(text) ||
        /\bnon[- ]hostile vessels?\b/.test(text) ||
        /\bpermission\b/.test(text) ||
        /\bdetour/i.test(text) ||
        /\bfallen\b.*\b90%/.test(text) ||
        /\bflowing through the strait of hormuz again\b/.test(text))
    );
  });

  const hormuzLimitedPassageSupport = supportBy((article) => {
    const text = textOf(article);
    return (
      /\bhormuz\b|\bstrait of hormuz\b/.test(text) &&
      (/\bpass through\b/.test(text) ||
        /\bcrossing\b/.test(text) ||
        /\beastbound\b/.test(text) ||
        /\blimited passage\b/.test(text) ||
        /\bsome vessels?\b/.test(text) ||
        /\btransit continues\b/.test(text))
    );
  });

  const redSeaDirectShippingSupport = supportBy((article) => {
    const text = textOf(article);
    return (
      /\bred sea\b/.test(text) &&
      (/\bmerchant ship\b/.test(text) ||
        /\bcommercial shipping\b/.test(text) ||
        /\bvessel\b/.test(text) && /\battack|struck|hit\b/.test(text))
    );
  });

  const redSeaRiskSupport = supportBy((article) => {
    const text = textOf(article);
    return (
      /\bred sea\b/.test(text) &&
      (/\braises concerns\b/.test(text) ||
        /\bfears of renewed\b/.test(text) ||
        /\bshipping routes\b/.test(text) ||
        /\bshipping risk\b/.test(text))
    );
  });

  const notes: string[] = [];
  const support: CurrentEventSignalSupport[] = [];
  const pushSupport = (articles: Array<GdeltArticleSnapshot | FirecrawlArticleSnapshot>) => {
    for (const article of articles.slice(0, 2)) {
      if (!support.some((item) => item.source_url === article.url)) {
        support.push(buildSignalSupport(article));
      }
    }
  };

  let broaderConflictStatus: CurrentEventFramingSignals['broader_conflict_status'] = 'unclear';
  if (
    new Set(broaderConflictSupport.map((article) => buildSignalSupport(article).source_name)).size >= 2 ||
    (broaderConflictSupport.length >= 1 && broaderConflictContext.length >= 2) ||
    (broaderConflictSupport.length >= 1 && extractGeopoliticalEntities(params.task).length >= 2)
  ) {
    broaderConflictStatus = 'reported_active_war';
    notes.push(
      'Recent strong-source coverage explicitly describes an active war or ongoing conflict; distinguish that broader war status from route-level shipping conditions.',
    );
    pushSupport([...broaderConflictSupport, ...broaderConflictContext]);
  }

  let hormuzRouteStatus: CurrentEventFramingSignals['hormuz_route_status'] = 'unclear';
  if (hormuzSevereSupport.length > 0 && hormuzLimitedPassageSupport.length > 0) {
    hormuzRouteStatus = 'severely_constrained_with_limited_passage';
    notes.push(
      'Hormuz should be framed as severely constrained with some limited passage resuming, not simply open.',
    );
    pushSupport([...hormuzSevereSupport, ...hormuzLimitedPassageSupport]);
  } else if (hormuzSevereSupport.length > 0) {
    hormuzRouteStatus = 'severely_constrained';
    notes.push('Hormuz should be framed as severely constrained rather than merely elevated risk.');
    pushSupport(hormuzSevereSupport);
  } else if (/\bhormuz\b|\bshipping\b/i.test(params.task)) {
    hormuzRouteStatus = 'elevated_risk_routes_still_operating';
  }

  let redSeaRouteStatus: CurrentEventFramingSignals['red_sea_route_status'] = 'unclear';
  if (redSeaDirectShippingSupport.length > 0) {
    redSeaRouteStatus = 'direct_shipping_attacks_reported';
    pushSupport(redSeaDirectShippingSupport);
  } else if (redSeaRiskSupport.length > 0) {
    redSeaRouteStatus = 'elevated_risk_latest_direct_shipping_strikes_not_confirmed';
    notes.push(
      'Red Sea wording should stay risk-focused unless the latest coverage explicitly confirms new direct attacks on shipping.',
    );
    pushSupport(redSeaRiskSupport);
  }

  if (
    broaderConflictStatus === 'unclear' &&
    hormuzRouteStatus === 'unclear' &&
    redSeaRouteStatus === 'unclear'
  ) {
    return undefined;
  }

  return {
    broader_conflict_status: broaderConflictStatus,
    hormuz_route_status: hormuzRouteStatus,
    red_sea_route_status: redSeaRouteStatus,
    notes,
    support: support.length > 0 ? support.slice(0, 4) : undefined,
  };
}

async function fetchFirecrawlSearchSnapshots(
  queryVariants: string[],
  task: string,
  options?: { bypassCache?: boolean },
): Promise<FirecrawlArticleSnapshot[]> {
  const shippingFocused = /\bshipping\b|\bhormuz\b|\bstrait\b|\binsurance\b|\btanker\b|\bred sea\b|\bsuez\b/i.test(
    task,
  );
  const uniqueQueries = [...new Set(queryVariants.map((query) => query.trim()).filter(Boolean))];
  const scoreQuery = (query: string): number => {
    let score = 0;
    const normalized = query.toLowerCase();
    if (normalized === task.trim().toLowerCase()) score += 30;
    if (shippingFocused && /\bshipping\b|\bhormuz\b|\bstrait\b|\binsurance\b|\btanker\b|\bred sea\b|\bsuez\b/i.test(query)) {
      score += 25;
    }
    if (shippingFocused && /\bhormuz\b|\bstrait\b|\bred sea\b|\bsuez\b/i.test(query)) {
      score += 30;
    }
    if (/\biran\b/i.test(query)) score += 8;
    if (/\bunited states\b|\busa\b|\bu\.s\.?\b|\bus-iran\b|\biran-us\b/i.test(query)) score += 8;
    if (/\blatest\b/i.test(query)) score += 4;
    if (/\bconflict\b/i.test(query)) score -= 2;
    if (/\breport\b|\bresearch\b|\bimpact\b|\bdisruptions?\b/i.test(query)) score -= 20;
    return score;
  };
  const maxQueries = Math.min(uniqueQueries.length, 5);
  const selectedQueries = uniqueQueries
    .sort((a, b) => scoreQuery(b) - scoreQuery(a))
    .slice(0, maxQueries);

  if (selectedQueries.length === 0) {
    return [];
  }

  const snapshotGroups = await Promise.all(
    selectedQueries.map(async (query) => {
      const cached = options?.bypassCache ? null : getCacheValue(firecrawlSearchCache.get(query));
      if (cached) {
        return cached;
      }

      try {
        const results = await searchFirecrawlNews(query, 6);
        const snapshots = results
          .map((result) => buildFirecrawlSearchSnapshot(result))
          .filter((snapshot): snapshot is FirecrawlArticleSnapshot => Boolean(snapshot))
          .filter(isUsableCurrentEventArticle);

        if (options?.bypassCache) {
          return snapshots;
        }

        return setTimedCache(
          firecrawlSearchCache,
          query,
          snapshots,
          FIRECRAWL_CACHE_TTL_MS,
        );
      } catch {
        if (options?.bypassCache) {
          return [];
        }

        return setTimedCache(
          firecrawlSearchCache,
          query,
          [],
          FIRECRAWL_CACHE_TTL_MS,
        );
      }
    }),
  );

  const deduped = new Map<string, FirecrawlArticleSnapshot>();
  for (const group of snapshotGroups) {
    for (const snapshot of group) {
      if (!deduped.has(snapshot.url)) {
        deduped.set(snapshot.url, snapshot);
      }
    }
  }

  const ranked = [...deduped.values()]
    .filter(isUsableCurrentEventArticle)
    .sort((a, b) => {
      const relevanceDelta = firecrawlSnapshotRelevance(b, task) - firecrawlSnapshotRelevance(a, task);
      if (relevanceDelta !== 0) {
        return relevanceDelta;
      }
      return eventRecencyScore(b.seen_at) - eventRecencyScore(a.seen_at);
    })
  ;

  if (shippingFocused) {
    const shippingSpecific = ranked.filter((snapshot) => shippingEvidenceScore(snapshot) >= 4);
    if (shippingSpecific.length > 0) {
      return shippingSpecific.slice(0, 4);
    }
  }

  return ranked.slice(0, 5);
}

function isLikelyHomepageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' || parsed.pathname === '';
  } catch {
    return false;
  }
}

function getFirecrawlTargetUrl(article: GdeltArticleSnapshot): string | null {
  const direct = article.url?.trim();
  if (direct && !isLikelyHomepageUrl(direct)) {
    return direct;
  }

  const preferred = article.article_url?.trim();
  if (preferred) {
    return preferred;
  }

  const fallback = direct;
  if (!fallback || isLikelyHomepageUrl(fallback)) {
    return null;
  }

  return fallback;
}

function hasDirectScrapeableUrl(article: GdeltArticleSnapshot): boolean {
  const direct = article.url?.trim();
  return Boolean(direct && !isLikelyHomepageUrl(direct) && !isGoogleNewsUrl(direct));
}

async function resolveArticleUrl(url: string): Promise<string> {
  const cached = getCacheValue(redirectUrlCache.get(url));
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(LIVE_DATA_FETCH_TIMEOUT_MS),
    });
    const resolved = response.url || url;
    redirectUrlCache.set(url, {
      value: resolved,
      expiresAt: Date.now() + NEWS_RSS_CACHE_TTL_MS,
    });
    return resolved;
  } catch {
    redirectUrlCache.set(url, {
      value: url,
      expiresAt: Date.now() + NEWS_RSS_CACHE_TTL_MS,
    });
    return url;
  }
}

function titleFromWikipediaUrl(url: string): string | null {
  const match = url.match(/\/wiki\/([^?#]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function pickWikipediaQueries(task: string, domain: ResearchDomain): string[] {
  if (domain === 'crypto') {
    const entityQueries = new Set<string>();
    if (isArcNetworkTask(task)) {
      entityQueries.add('Circle Internet Financial');
      entityQueries.add('USD Coin');
      entityQueries.add('Blockchain');
      return [...entityQueries].slice(0, 3);
    }
    for (const coin of pickCoinTargets(task)) {
      if (coin.coinId === 'bitcoin') entityQueries.add('Bitcoin');
      if (coin.coinId === 'ethereum') entityQueries.add('Ethereum');
      if (coin.coinId === 'solana') entityQueries.add('Solana');
      if (coin.coinId === 'usd-coin') entityQueries.add('USD Coin');
    }
    for (const chain of pickChainTargets(task)) {
      entityQueries.add(chain);
    }
    return [...entityQueries].slice(0, 2);
  }

  if (domain === 'geopolitics') {
    const queries = new Set<string>();
    queries.add(task);
    queries.add(task.replace(/\brisk assessment\b/i, '').trim());

    if (/\biran\b/i.test(task) && /\bunited states\b|\busa\b|\bu\.s\.?\b/i.test(task)) {
      queries.add('Iran-United States relations');
    }

    if (/\brussia\b/i.test(task) && /\bukraine\b/i.test(task)) {
      queries.add('Russia-Ukraine conflict');
    }

    return [...queries].filter(Boolean).slice(0, 2);
  }

  return [
    task,
    task
      .replace(/^\s*(what is|what are|who is|who are|explain|define)\s+/i, '')
      .replace(/\?+$/, '')
      .trim(),
  ]
    .filter(Boolean)
    .slice(0, 1);
}

async function fetchCoinGeckoData(task: string): Promise<CoinGeckoAssetSnapshot[]> {
  const targets = pickCoinTargets(task);
  if (targets.length === 0) return [];

  const ids = targets.map((item) => item.coinId).join(',');
  const cacheKey = ids;
  const cached = getCacheValue(coinGeckoCache.get(cacheKey));
  if (cached) {
    return cached;
  }

  const json = await fetchJsonWithTimeout<
    Record<
      string,
      {
        usd?: number;
        usd_market_cap?: number;
        usd_24h_vol?: number;
        usd_24h_change?: number;
        last_updated_at?: number;
      }
    >
  >(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      ids,
    )}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
  );

  const snapshots: CoinGeckoAssetSnapshot[] = [];

  for (const target of targets) {
    const row = json[target.coinId];
    if (!row) continue;

    snapshots.push({
      symbol: target.symbol,
      coinId: target.coinId,
      price_usd: row.usd,
      market_cap_usd: row.usd_market_cap,
      volume_24h_usd: row.usd_24h_vol,
      change_24h_pct: row.usd_24h_change,
      last_updated_at: unixToIso(row.last_updated_at),
    });
  }

  return setTimedCache(coinGeckoCache, cacheKey, snapshots, COINGECKO_CACHE_TTL_MS);
}

async function fetchDefiLlamaData(task: string): Promise<DefiLlamaChainSnapshot[]> {
  const targets = pickChainTargets(task);
  if (targets.length === 0) return [];

  let chainsJson = getCacheValue(defillamaChainsCache);
  if (!chainsJson) {
    chainsJson = await fetchJsonWithTimeout<Array<{ name?: string; tvl?: number }>>(
      'https://api.llama.fi/v2/chains',
    );
    defillamaChainsCache = {
      value: chainsJson,
      expiresAt: Date.now() + DEFILLAMA_CACHE_TTL_MS,
    };
  }

  let stablecoinsJson = getCacheValue(defillamaStablecoinsCache);
  if (!stablecoinsJson) {
    stablecoinsJson = await fetchJsonWithTimeout<{
      peggedAssets?: Array<{
        name?: string;
        symbol?: string;
        chainCirculating?: Record<
          string,
          {
            current?: { peggedUSD?: number };
            circulatingPrevDay?: { peggedUSD?: number };
          }
        >;
      }>;
    }>('https://stablecoins.llama.fi/stablecoins');
    defillamaStablecoinsCache = {
      value: stablecoinsJson,
      expiresAt: Date.now() + DEFILLAMA_CACHE_TTL_MS,
    };
  }

  const chainRows = new Map<string, { name?: string; tvl?: number }>();
  for (const row of chainsJson) {
    if (typeof row.name === 'string' && row.name) {
      chainRows.set(row.name.toLowerCase(), row);
    }
  }

  const peggedAssets = Array.isArray(stablecoinsJson.peggedAssets)
    ? stablecoinsJson.peggedAssets
    : [];

  const snapshots: DefiLlamaChainSnapshot[] = [];

  for (const target of targets) {
    const chainRow = chainRows.get(target.toLowerCase());
    let stablecoinsUsd = 0;
    let stablecoinsPrevDayUsd = 0;
    const topStablecoins: Array<{
      symbol: string;
      name: string;
      circulating_usd: number;
    }> = [];

    for (const asset of peggedAssets) {
      const chainData = asset.chainCirculating?.[target];
      const current = chainData?.current?.peggedUSD;
      const prevDay = chainData?.circulatingPrevDay?.peggedUSD;

      if (typeof current === 'number' && Number.isFinite(current) && current > 0) {
        stablecoinsUsd += current;
        topStablecoins.push({
          symbol: asset.symbol || asset.name || 'UNKNOWN',
          name: asset.name || asset.symbol || 'Unknown',
          circulating_usd: current,
        });
      }

      if (typeof prevDay === 'number' && Number.isFinite(prevDay) && prevDay > 0) {
        stablecoinsPrevDayUsd += prevDay;
      }
    }

    topStablecoins.sort((a, b) => b.circulating_usd - a.circulating_usd);

    const change1dUsd =
      stablecoinsPrevDayUsd > 0 ? stablecoinsUsd - stablecoinsPrevDayUsd : undefined;
    const change1dPct =
      stablecoinsPrevDayUsd > 0
        ? ((stablecoinsUsd - stablecoinsPrevDayUsd) / stablecoinsPrevDayUsd) * 100
        : undefined;

    if (
      typeof chainRow?.tvl !== 'number' &&
      stablecoinsUsd === 0 &&
      topStablecoins.length === 0
    ) {
      continue;
    }

    snapshots.push({
      chain: target,
      tvl_usd: chainRow?.tvl,
      stablecoins_usd: stablecoinsUsd > 0 ? stablecoinsUsd : undefined,
      stablecoins_change_1d_usd: change1dUsd,
      stablecoins_change_1d_pct: change1dPct,
      top_stablecoins: topStablecoins.slice(0, 3),
    });
  }

  return snapshots;
}

function flattenDuckDuckGoTopics(
  topics: unknown,
  bucket: string[],
  limit = 5,
): void {
  if (!Array.isArray(topics) || bucket.length >= limit) return;

  for (const topic of topics) {
    if (bucket.length >= limit) return;

    if (
      topic &&
      typeof topic === 'object' &&
      'Text' in topic &&
      typeof (topic as { Text?: unknown }).Text === 'string'
    ) {
      bucket.push((topic as { Text: string }).Text);
      continue;
    }

    if (topic && typeof topic === 'object' && 'Topics' in topic) {
      flattenDuckDuckGoTopics((topic as { Topics?: unknown }).Topics, bucket, limit);
    }
  }
}

async function fetchDuckDuckGoData(task: string): Promise<DuckDuckGoSnapshot | null> {
  const queries = buildResearchQueryVariants(task).slice(0, 5);
  const query = queries[0];
  if (!query) return null;

  const fetchSnapshotForQuery = async (
    queryVariant: string,
  ): Promise<DuckDuckGoSnapshot | null> => {
    const cachedEntry = duckDuckGoCache.get(queryVariant);
    const cached = getCacheValue(cachedEntry);
    if (cachedEntry && Date.now() < cachedEntry.expiresAt) {
      return cached;
    }

    const json = await fetchJsonWithTimeout<{
      AbstractText?: string;
      Answer?: string;
      Definition?: string;
      RelatedTopics?: unknown;
    }>(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(
        queryVariant,
      )}&format=json&no_html=1&skip_disambig=1`,
    );

    const relatedTopics: string[] = [];
    flattenDuckDuckGoTopics(json.RelatedTopics, relatedTopics);

    const snapshot: DuckDuckGoSnapshot = {
      query: queryVariant,
      abstract: json.AbstractText?.trim() || undefined,
      answer: json.Answer?.trim() || undefined,
      definition: json.Definition?.trim() || undefined,
      related_topics: relatedTopics.length > 0 ? relatedTopics : undefined,
    };

    if (
      !snapshot.abstract &&
      !snapshot.answer &&
      !snapshot.definition &&
      !snapshot.related_topics?.length
    ) {
      duckDuckGoCache.set(queryVariant, {
        value: null,
        expiresAt: Date.now() + DUCKDUCKGO_CACHE_TTL_MS,
      });
      return null;
    }

    return setTimedCache(
      duckDuckGoCache,
      queryVariant,
      snapshot,
      DUCKDUCKGO_CACHE_TTL_MS,
    );
  };

  const snapshots = await Promise.all(
    queries.map((queryVariant) => fetchSnapshotForQuery(queryVariant).catch(() => null)),
  );
  const availableSnapshots = snapshots.filter(
    (snapshot): snapshot is DuckDuckGoSnapshot => Boolean(snapshot),
  );

  if (availableSnapshots.length === 0) {
    return null;
  }

  const rankSnapshot = (snapshot: DuckDuckGoSnapshot): number => {
    let score = 0;
    if (snapshot.abstract) score += 4;
    if (snapshot.answer) score += 3;
    if (snapshot.definition) score += 2;
    score += snapshot.related_topics?.length || 0;
    return score;
  };

  const bestSnapshot = [...availableSnapshots].sort(
    (a, b) => rankSnapshot(b) - rankSnapshot(a),
  )[0];
  const relatedTopics = [
    ...new Set(
      availableSnapshots.flatMap((snapshot) => snapshot.related_topics || []),
    ),
  ].slice(0, 8);

  return {
    query: queries.join(' | '),
    abstract: bestSnapshot.abstract,
    answer: bestSnapshot.answer,
    definition: bestSnapshot.definition,
    related_topics: relatedTopics.length > 0 ? relatedTopics : undefined,
  };
}

async function fetchWikipediaData(
  task: string,
  domain: ResearchDomain,
): Promise<WikipediaPageSnapshot[]> {
  const cacheKey = `${domain}:${task.trim().toLowerCase()}`;
  const cached = getCacheValue(wikipediaCache.get(cacheKey));
  if (cached) {
    return cached;
  }

  const queries = pickWikipediaQueries(task, domain);
  const pages = new Map<string, WikipediaPageSnapshot>();

  for (const query of queries) {
    if (!query.trim()) continue;

    const search = await fetchJsonWithTimeout<
      [string, string[], string[], string[]]
    >(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
        query,
      )}&limit=3&namespace=0&format=json&origin=*`,
    ).catch(() => null);

    const urls = Array.isArray(search?.[3]) ? search[3] : [];
    for (const url of urls) {
      if (typeof url !== 'string') continue;
      const title = titleFromWikipediaUrl(url);
      if (!title || pages.has(title)) continue;

      const summary = await fetchJsonWithTimeout<{
        title?: string;
        displaytitle?: string;
        description?: string;
        extract?: string;
        timestamp?: string;
        content_urls?: { desktop?: { page?: string } };
      }>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      ).catch(() => null);

      if (!summary) continue;

      const description = summary.description?.trim();
      if (
        /index of articles associated with the same name/i.test(description || '') ||
        /\bdisambiguation\b/i.test(summary.title || '')
      ) {
        continue;
      }

      pages.set(title, {
        title: stripHtml(summary.displaytitle || summary.title || title),
        description,
        summary: truncateSentences(summary.extract, 420),
        url: summary.content_urls?.desktop?.page || url,
        last_updated_at: summary.timestamp,
      });

      if (pages.size >= 2) break;
    }

    if (pages.size >= 2) break;
  }

  return setTimedCache(
    wikipediaCache,
    cacheKey,
    [...pages.values()].slice(0, 2),
    WIKIPEDIA_CACHE_TTL_MS,
  );
}

async function fetchGdeltData(
  task: string,
  options?: { bypassCache?: boolean },
): Promise<GdeltArticleSnapshot[]> {
  const query = stripExecutionContext(task).trim().toLowerCase();
  if (!query) return [];

  const cached = options?.bypassCache ? null : getCacheValue(gdeltCache.get(query));
  if (cached) {
    return cached;
  }

  if (Date.now() < gdeltNextAllowedAt) {
    return [];
  }

  gdeltNextAllowedAt = Date.now() + GDELT_MIN_INTERVAL_MS;

  const json = await fetchJsonWithTimeout<{
    articles?: Array<{
      url?: string;
      title?: string;
      seendate?: string;
      domain?: string;
      language?: string;
      sourcecountry?: string;
    }>;
  }>(
    `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
      buildGdeltQuery(task),
    )}&mode=artlist&maxrecords=6&sort=DateDesc&format=json`,
  );

  const articles = Array.isArray(json.articles) ? json.articles : [];
  const snapshots = articles
    .filter(
      (article): article is Required<Pick<typeof article, 'title' | 'url'>> &
        typeof article =>
        typeof article.title === 'string' && typeof article.url === 'string',
    )
    .filter((article) => !article.language || /english/i.test(article.language))
    .map((article) => ({
      title: article.title,
      url: article.url,
      publisher: article.domain,
      domain: article.domain,
      language: article.language,
      source_country: article.sourcecountry,
      seen_at: gdeltTimestampToIso(article.seendate),
    }))
    .filter(isUsableCurrentEventArticle)
    .sort((a, b) => currentEventRank(b) - currentEventRank(a))
    .slice(0, 3);

  if (options?.bypassCache) {
    return snapshots;
  }

  return setTimedCache(gdeltCache, query, snapshots, GDELT_CACHE_TTL_MS);
}

async function fetchGoogleNewsRssData(
  task: string,
  options?: { bypassCache?: boolean },
): Promise<GdeltArticleSnapshot[]> {
  const query = task.trim().toLowerCase();
  if (!query) return [];

  const cached = options?.bypassCache ? null : getCacheValue(newsRssCache.get(query));
  if (cached) {
    return cached;
  }

  const xml = await fetchTextWithTimeout(
    `https://news.google.com/rss/search?q=${encodeURIComponent(
      task,
    )}&hl=en-US&gl=US&ceid=US:en`,
  );

  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const snapshots: GdeltArticleSnapshot[] = [];

  for (const match of itemBlocks) {
    const block = match[1];
    const rawTitle = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const rawLink = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
    const rawPubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
    const rawSourceUrl = block.match(/<source\s+url="([^"]+)"/i)?.[1];
    const rawSourceName = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1];

    if (!rawTitle || !rawLink) continue;

    const title = decodeXmlEntities(rawTitle.trim());
    const link = decodeXmlEntities(rawLink.trim());
    const sourceUrl = rawSourceUrl ? decodeXmlEntities(rawSourceUrl.trim()) : undefined;
    const lastSeparator = title.lastIndexOf(' - ');
    const publisher = rawSourceName
      ? decodeXmlEntities(rawSourceName.trim())
      : lastSeparator > 0
        ? title.slice(lastSeparator + 3).trim()
        : undefined;
    const cleanTitle =
      lastSeparator > 0 ? title.slice(0, lastSeparator).trim() : title;
    const publishedAt = rawPubDate ? new Date(rawPubDate).toISOString() : undefined;
    const preferredUrl = sourceUrl && !isLikelyHomepageUrl(sourceUrl) ? sourceUrl : link;

    snapshots.push({
      title: cleanTitle,
      url: preferredUrl,
      article_url: link,
      publisher,
      seen_at: publishedAt,
      language: 'English',
    });
  }

  const topSnapshots = snapshots
    .filter(isUsableCurrentEventArticle)
    .sort((a, b) => currentEventRank(b) - currentEventRank(a))
    .slice(0, 3);
  const resolvedSnapshots = await Promise.all(
    topSnapshots.map(async (snapshot) => {
      if (!isGoogleNewsUrl(snapshot.url)) {
        return snapshot;
      }

      const resolvedUrl = await resolveArticleUrl(snapshot.url);
      return {
        ...snapshot,
        article_url: snapshot.url,
        url: resolvedUrl,
      };
    }),
  );

  if (options?.bypassCache) {
    return resolvedSnapshots;
  }

  return setTimedCache(
    newsRssCache,
    query,
    resolvedSnapshots,
    NEWS_RSS_CACHE_TTL_MS,
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRelevantQueryWords(task: string): string[] {
  return task
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 3);
}

async function fetchHackerNewsRSS(
  task: string,
  options?: { bypassCache?: boolean },
): Promise<GdeltArticleSnapshot[]> {
  const query = task.trim().toLowerCase();
  if (!query) return [];

  const cached = options?.bypassCache ? null : getCacheValue(thnRssCache.get(query));
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(THN_RSS_URL, {
      headers: { 'User-Agent': 'AgentFlow Research Bot' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      if (options?.bypassCache) return [];
      return setTimedCache(thnRssCache, query, [], THN_RSS_CACHE_TTL_MS);
    }

    const xml = await response.text();
    const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    const queryWords = buildRelevantQueryWords(task);
    const securityPattern =
      /\b(crypto|blockchain|defi|usdc|circle|arc|web3|wallet|hack|exploit|breach|vulnerability|phishing|scam|attack)\b/i;
    // Only fall back to the security catch-all when the user's task itself is
    // about security/crypto. Otherwise THN starts polluting unrelated reports
    // (e.g. an AI-org hackathon report) with random exchange-hack headlines.
    const taskIsSecurityRelated = securityPattern.test(query);
    const snapshots: GdeltArticleSnapshot[] = [];

    for (const match of itemBlocks) {
      const block = match[1];
      const rawTitle =
        block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ||
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
        '';
      const rawLink = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
      const rawDescription =
        block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i)?.[1] ||
        block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ||
        '';
      const rawPubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';

      const title = decodeXmlEntities(rawTitle.trim());
      const link = decodeXmlEntities(rawLink.trim());
      const description = stripHtml(decodeXmlEntities(rawDescription.trim())).replace(/\s+/g, ' ').trim();
      const seenAt = rawPubDate && Number.isFinite(Date.parse(rawPubDate))
        ? new Date(rawPubDate).toISOString()
        : undefined;

      if (!title || !link) continue;

      const combined = `${title} ${description}`.toLowerCase();
      const queryMatch =
        queryWords.length > 0 &&
        queryWords.some((word) => new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(combined));
      const isRelevant =
        queryMatch || (taskIsSecurityRelated && securityPattern.test(combined));
      if (!isRelevant) continue;

      snapshots.push({
        title,
        url: link,
        publisher: 'The Hacker News',
        domain: 'thehackernews.com',
        language: 'English',
        seen_at: seenAt,
      });
    }

    const result = snapshots
      .filter(isUsableCurrentEventArticle)
      .sort((a, b) => currentEventRank(b) - currentEventRank(a))
      .slice(0, 5);

    if (options?.bypassCache) {
      return result;
    }

    return setTimedCache(thnRssCache, query, result, THN_RSS_CACHE_TTL_MS);
  } catch (error) {
    console.warn('[live-data] THN RSS failed:', error);
    if (options?.bypassCache) return [];
    return setTimedCache(thnRssCache, query, [], THN_RSS_CACHE_TTL_MS);
  }
}

async function fetchCurrentEventsData(
  task: string,
  options?: { bypassCache?: boolean },
): Promise<CurrentEventsSnapshot | null> {
  const queryVariants = buildCurrentEventQueries(task);
  const statusQueryVariants = buildConflictStatusQueries(task);
  if (queryVariants.length === 0) {
    return null;
  }

  const [gdeltGroups, rssGroups, firecrawlSearchSnapshots, statusGdeltGroups, statusRssGroups] =
    await Promise.all([
    Promise.all(queryVariants.map((query) => fetchGdeltData(query, options).catch(() => []))),
    Promise.all(queryVariants.map((query) => fetchGoogleNewsRssData(query, options).catch(() => []))),
    fetchFirecrawlSearchSnapshots(queryVariants, task, options).catch(() => []),
    Promise.all(statusQueryVariants.map((query) => fetchGdeltData(query, options).catch(() => []))),
    Promise.all(statusQueryVariants.map((query) => fetchGoogleNewsRssData(query, options).catch(() => []))),
  ]);
  const groups = [...gdeltGroups, ...rssGroups];
  const statusGroups = [...statusGdeltGroups, ...statusRssGroups];

  let merged = mergeCurrentEventArticles(groups);
  if (merged.length === 0 && firecrawlSearchSnapshots.length > 0) {
    merged = firecrawlSearchSnapshots.map(snapshotToCurrentEventArticle);
  }

  if (merged.length === 0) {
    return null;
  }

  const recentArticles = merged.filter(isRecentCurrentEvent);
  const backgroundArticles = merged.filter((article) => !isRecentCurrentEvent(article));
  const latestSeenAt = merged
    .map((article) => article.seen_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const gdeltCandidates = mergeCurrentEventArticles(gdeltGroups);
  const statusArticles = mergeCurrentEventArticles(statusGroups).slice(0, 6);
  const fallbackSnapshots =
    firecrawlSearchSnapshots.length > 0
      ? []
      : await fetchFirecrawlArticleSnapshots(
          gdeltCandidates.length > 0
            ? gdeltCandidates
            : recentArticles.length > 0
              ? recentArticles
              : merged,
          options,
        );
  const articleSnapshots =
    firecrawlSearchSnapshots.length > 0 ? firecrawlSearchSnapshots : fallbackSnapshots;
  const snapshotArticles = articleSnapshots.map(snapshotToCurrentEventArticle);
  const selectedArticles =
    snapshotArticles.length > 0
      ? snapshotArticles.slice(0, 4)
      : (recentArticles.length > 0 ? recentArticles : backgroundArticles).slice(0, 4);
  const selectedBackground =
    recentArticles.length > 0 ? backgroundArticles.slice(0, 2) : [];
  const framingSignals = deriveCurrentEventFramingSignals({
    task,
    articles: selectedArticles,
    statusArticles,
    articleSnapshots,
  });

  return {
    source:
      articleSnapshots.length > 0
        ? 'Firecrawl news search with GDELT document API and Google News RSS support'
        : 'Merged GDELT document API and Google News RSS',
    query_variants: queryVariants,
    recency_window_days: CURRENT_EVENT_RECENCY_WINDOW_DAYS,
    latest_seen_at: latestSeenAt,
    freshness: recentArticles.length > 0 ? 'fresh' : 'stale_or_thin',
    has_recent_articles: recentArticles.length > 0,
    articles: selectedArticles,
    background_articles: selectedBackground.length > 0 ? selectedBackground : undefined,
    status_articles: statusArticles.length > 0 ? statusArticles : undefined,
    article_snapshots: articleSnapshots.length > 0 ? articleSnapshots : undefined,
    framing_signals: framingSignals,
  };
}

async function fetchFirecrawlArticleSnapshot(
  article: GdeltArticleSnapshot,
  options?: { bypassCache?: boolean },
): Promise<FirecrawlArticleSnapshot | null> {
  const rawUrl = getFirecrawlTargetUrl(article);
  if (!rawUrl) return null;
  const url = /news\.google\.com/i.test(rawUrl) ? await resolveArticleUrl(rawUrl) : rawUrl;

  const cached = options?.bypassCache ? null : getCacheValue(firecrawlArticleCache.get(url));
  if (cached) {
    return cached;
  }

  try {
    const markdown = await fetchUrlViaFirecrawl(url);
    const summary = markdownToSnippet(markdown);
    if (!summary) {
      if (!options?.bypassCache) {
        firecrawlArticleCache.set(url, {
          value: null,
          expiresAt: Date.now() + FIRECRAWL_CACHE_TTL_MS,
        });
      }
      return null;
    }

    const snapshot = {
      title: article.title,
      url,
      publisher: article.publisher,
      seen_at: article.seen_at,
      summary,
    };

    if (options?.bypassCache) {
      return snapshot;
    }

    return setTimedCache(
      firecrawlArticleCache,
      url,
      snapshot,
      FIRECRAWL_CACHE_TTL_MS,
    );
  } catch {
    if (!options?.bypassCache) {
      firecrawlArticleCache.set(url, {
        value: null,
        expiresAt: Date.now() + FIRECRAWL_CACHE_TTL_MS,
      });
    }
    return null;
  }
}

async function fetchFirecrawlArticleSnapshots(
  articles: GdeltArticleSnapshot[],
  options?: { bypassCache?: boolean },
): Promise<FirecrawlArticleSnapshot[]> {
  const targets = [...articles]
    .sort((a, b) => {
      const directDelta =
        Number(hasDirectScrapeableUrl(b)) - Number(hasDirectScrapeableUrl(a));
      if (directDelta !== 0) {
        return directDelta;
      }
      return currentEventRank(b) - currentEventRank(a);
    })
    .filter((article) => Boolean(getFirecrawlTargetUrl(article)))
    .slice(0, 2);
  if (targets.length === 0) return [];

  const snapshots = await Promise.all(
    targets.map((article) => fetchFirecrawlArticleSnapshot(article, options)),
  );

  return snapshots.filter((snapshot): snapshot is FirecrawlArticleSnapshot => Boolean(snapshot));
}

const dynamicRssCache = new Map<string, CacheEntry<GdeltArticleSnapshot[]>>();
const DYNAMIC_RSS_CACHE_TTL_MS = 120_000;

/** Stopwords for RSS relevance — keep short domain terms like "ai", "ml", "arc". */
const RSS_MATCH_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'all',
  'can',
  'was',
  'one',
  'our',
  'out',
  'get',
  'has',
  'how',
  'may',
  'new',
  'now',
  'see',
  'way',
  'who',
  'did',
  'let',
  'put',
  'say',
  'too',
  'use',
  'any',
  'via',
  'into',
  'from',
  'with',
  'that',
  'this',
  'your',
  'what',
  'when',
  'will',
  'have',
  'been',
  'more',
  'some',
  'than',
  'then',
  'very',
  'just',
  'also',
  'only',
  'each',
  'such',
  'make',
  'like',
  'using',
  'about',
  'here',
  'they',
  'them',
]);

function buildRssMatchTerms(task: string): string[] {
  const terms = new Set<string>();
  const cleaned = task.toLowerCase().replace(/[^\w\s-]/g, ' ');
  for (const raw of cleaned.split(/\s+/)) {
    const w = raw.trim();
    if (w.length < 2 || RSS_MATCH_STOPWORDS.has(w)) continue;
    terms.add(w);
  }
  for (const label of classifyTopic(task).labels) {
    const l = label.toLowerCase().trim();
    if (l.length >= 2 && !RSS_MATCH_STOPWORDS.has(l)) {
      terms.add(l);
    }
  }
  return [...terms];
}

function parseRssItemBlock(block: string): {
  title: string;
  link: string;
  description: string;
  seenAt?: string;
} | null {
  const rawTitle =
    block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ||
    block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
    '';
  const rawLink = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
  const rawDescription =
    block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i)?.[1] ||
    block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ||
    '';
  const rawPubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';

  const title = decodeXmlEntities(rawTitle.trim());
  const link = decodeXmlEntities(rawLink.trim());
  const description = stripHtml(decodeXmlEntities(rawDescription.trim()))
    .replace(/\s+/g, ' ')
    .trim();
  const seenAt =
    rawPubDate && Number.isFinite(Date.parse(rawPubDate))
      ? new Date(rawPubDate).toISOString()
      : undefined;

  if (!title || !link) return null;
  return { title, link, description, seenAt };
}

async function fetchRSSFromRegistry(
  source: SourceConfig,
  task: string,
): Promise<GdeltArticleSnapshot[]> {
  if (!source.rssUrls?.length) return [];

  const matchTerms = buildRssMatchTerms(task);
  const results: GdeltArticleSnapshot[] = [];
  const fallback: GdeltArticleSnapshot[] = [];

  for (const rssUrl of source.rssUrls.slice(0, 2)) {
    try {
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': 'AgentFlow Research Bot' },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

      for (const match of itemBlocks) {
        const parsed = parseRssItemBlock(match[1]);
        if (!parsed) continue;

        const { title, link, description, seenAt } = parsed;
        const combined = `${title} ${description}`.toLowerCase();
        const isRelevant =
          matchTerms.length > 0 &&
          matchTerms.some((t) => combined.includes(t));

        const snapshot: GdeltArticleSnapshot = {
          title,
          url: link,
          publisher: source.name,
          domain: source.baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
          language: 'English',
          seen_at: seenAt,
        };

        if (isRelevant) {
          results.push(snapshot);
          if (results.length >= 5) break;
        } else if (fallback.length < 4) {
          fallback.push(snapshot);
        }
      }
    } catch (err) {
      console.warn(`[live-data] RSS fetch failed for ${source.name}:`, err);
    }
  }

  if (results.length > 0) {
    return results.slice(0, 5);
  }
  // Broad queries (e.g. "latest AI breakthroughs") often share no token with a headline;
  // return a few recent items so downstream agents have real URLs to cite.
  return fallback.slice(0, 3);
}

export async function fetchDynamicSources(task: string): Promise<GdeltArticleSnapshot[]> {
  const cacheKey = task.trim().toLowerCase();
  const cached = getCacheValue(dynamicRssCache.get(cacheKey));
  if (cached) return cached;

  const { labels } = classifyTopic(task);
  let sources = selectSources(task, 8).filter((s) => s.rssUrls?.length);
  if (labels.length > 0) {
    const narrowed = sources.filter((s) => s.topics.some((t) => labels.includes(t)));
    if (narrowed.length > 0) {
      sources = narrowed.slice(0, 5);
    } else {
      // e.g. Arc / DefiLlama are API-only in the registry — do not fall back to unrelated world-news RSS.
      sources = [];
    }
  } else {
    sources = sources.slice(0, 5);
  }

  if (sources.length === 0) {
    console.log(
      `[live-data] selected sources: (no RSS feeds in registry match topic labels: ${labels.join(', ') || 'none'})`,
    );
    return setTimedCache(dynamicRssCache, cacheKey, [], DYNAMIC_RSS_CACHE_TTL_MS);
  }

  const names = sources.map((s) => s.name).join(', ');
  console.log(`[live-data] selected sources: ${names}`);
  console.log(`[live-data] dynamic sources selected for "${task.slice(0, 60)}": ${names}`);

  const groups = await Promise.allSettled(
    sources.map((s) => fetchRSSFromRegistry(s, task)),
  );

  const all: GdeltArticleSnapshot[] = [];
  for (const g of groups) {
    if (g.status === 'fulfilled') {
      all.push(...g.value);
    }
  }

  const seen = new Set<string>();
  const deduped = all.filter((item) => {
    const key = item.title.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const result = deduped.slice(0, 15);
  return setTimedCache(dynamicRssCache, cacheKey, result, DYNAMIC_RSS_CACHE_TTL_MS);
}

export async function fetchLiveData(task: string): Promise<string> {
  const sourceTask = stripExecutionContext(task);
  const normalizedTask = sourceTask.trim().toLowerCase();
  const bypassCurrentEventCache = shouldBypassCurrentEventCaches(sourceTask);
  const cached = bypassCurrentEventCache ? null : getCacheValue(liveDataCache.get(normalizedTask));
  if (cached) {
    return cached;
  }

  const snapshotAt = new Date().toISOString();
  const researchDomain = detectResearchDomain(sourceTask);
  const payload: Record<string, unknown> = {
    snapshot_at: snapshotAt,
    research_domain: researchDomain,
  };

  if (researchDomain === 'crypto') {
    const [coingecko, defillama, duckduckgo, wikipedia, currentEvents, thn, dynamic] =
      await Promise.allSettled([
        fetchCoinGeckoData(sourceTask),
        fetchDefiLlamaData(sourceTask),
        fetchDuckDuckGoData(sourceTask),
        fetchWikipediaData(sourceTask, researchDomain),
        shouldGatherCurrentEvents(sourceTask)
          ? fetchCurrentEventsData(sourceTask, { bypassCache: bypassCurrentEventCache })
          : Promise.resolve(null),
        fetchHackerNewsRSS(sourceTask, { bypassCache: bypassCurrentEventCache }),
        fetchDynamicSources(sourceTask),
      ]);

    if (coingecko.status === 'fulfilled' && coingecko.value.length > 0) {
      payload.coingecko = {
        source: 'CoinGecko simple price API',
        assets: coingecko.value,
      };
    }

    if (defillama.status === 'fulfilled' && defillama.value.length > 0) {
      payload.defillama = {
        source: 'DefiLlama chains API + stablecoins API',
        chains: defillama.value,
      };
    }

    if (duckduckgo.status === 'fulfilled' && duckduckgo.value) {
      payload.duckduckgo = {
        source: 'DuckDuckGo instant answer API',
        ...duckduckgo.value,
      };
    }

    if (wikipedia.status === 'fulfilled' && wikipedia.value.length > 0) {
      payload.wikipedia = {
        source: 'Wikipedia OpenSearch + REST summary API',
        pages: wikipedia.value,
      };
    }

    if (currentEvents.status === 'fulfilled' && currentEvents.value) {
      payload.current_events = currentEvents.value;
    }

    if (thn.status === 'fulfilled' && thn.value.length > 0) {
      payload.the_hacker_news = {
        source: 'The Hacker News RSS',
        articles: thn.value,
      };
    }

    if (dynamic.status === 'fulfilled' && dynamic.value.length > 0) {
      payload.dynamic_sources = {
        source: 'Dynamic RSS (source registry)',
        articles: dynamic.value,
      };
    }
  } else if (researchDomain === 'geopolitics') {
    const [currentEvents, duckduckgo, wikipedia, thn] = await Promise.allSettled([
      fetchCurrentEventsData(sourceTask, { bypassCache: bypassCurrentEventCache }),
      fetchDuckDuckGoData(sourceTask),
      fetchWikipediaData(sourceTask, researchDomain),
      fetchHackerNewsRSS(sourceTask, { bypassCache: bypassCurrentEventCache }),
    ]);

    if (currentEvents.status === 'fulfilled' && currentEvents.value) {
      const framingSignals =
        typeof currentEvents.value === 'object' && currentEvents.value
          ? (currentEvents.value as CurrentEventsSnapshot).framing_signals
          : undefined;
      const premiseParts = [
        'Do not accept claims of an ongoing war, direct conflict, or major escalation unless recent dated evidence supports that framing.',
      ];
      if (framingSignals?.broader_conflict_status === 'reported_active_war') {
        premiseParts.push(
          'Recent strong-source coverage in LIVE DATA explicitly describes an active war or ongoing conflict. Do not downgrade that to "no war confirmed"; instead separate broader conflict status from route-level shipping conditions.',
        );
      }
      if (framingSignals?.hormuz_route_status === 'severely_constrained_with_limited_passage') {
        premiseParts.push(
          'For Hormuz, use "severely constrained with limited passage resuming" rather than simply "open".',
        );
      }
      if (
        framingSignals?.red_sea_route_status ===
        'elevated_risk_latest_direct_shipping_strikes_not_confirmed'
      ) {
        premiseParts.push(
          'For the Red Sea, keep the latest phase risk-focused and do not claim fresh direct shipping strikes unless directly sourced.',
        );
      }
      payload.current_events = currentEvents.value;
      payload.premise_check = {
        verify_user_framing: true,
        as_of: snapshotAt,
        note: premiseParts.join(' '),
        framing_signals: framingSignals,
      };
    }

    if (duckduckgo.status === 'fulfilled' && duckduckgo.value) {
      payload.duckduckgo = {
        source: 'DuckDuckGo instant answer API',
        ...duckduckgo.value,
      };
    }

    if (wikipedia.status === 'fulfilled' && wikipedia.value.length > 0) {
      payload.wikipedia = {
        source: 'Wikipedia OpenSearch + REST summary API',
        pages: wikipedia.value,
      };
    }

    if (thn.status === 'fulfilled' && thn.value.length > 0) {
      payload.the_hacker_news = {
        source: 'The Hacker News RSS',
        articles: thn.value,
      };
    }
  } else {
    const [duckduckgo, wikipedia, currentEvents, thn, dynamic] = await Promise.all([
      fetchDuckDuckGoData(sourceTask).catch(() => null),
      fetchWikipediaData(sourceTask, researchDomain).catch(() => [] as WikipediaPageSnapshot[]),
      (
        shouldGatherCurrentEvents(sourceTask)
          ? fetchCurrentEventsData(sourceTask, { bypassCache: bypassCurrentEventCache })
          : Promise.resolve(null)
      ).catch(() => null),
      fetchHackerNewsRSS(sourceTask, { bypassCache: bypassCurrentEventCache }).catch(
        () => [] as GdeltArticleSnapshot[],
      ),
      fetchDynamicSources(sourceTask).catch(() => [] as GdeltArticleSnapshot[]),
    ]);

    if (duckduckgo) {
      payload.duckduckgo = {
        source: 'DuckDuckGo instant answer API',
        ...duckduckgo,
      };
    }

    if (wikipedia.length > 0) {
      payload.wikipedia = {
        source: 'Wikipedia OpenSearch + REST summary API',
        pages: wikipedia,
      };
    }

    if (currentEvents) {
      payload.current_events = currentEvents;
    }

    if (thn.length > 0) {
      payload.the_hacker_news = {
        source: 'The Hacker News RSS',
        articles: thn,
      };
    }

    if (dynamic.length > 0) {
      payload.dynamic_sources = {
        source: 'Dynamic RSS (source registry)',
        articles: dynamic,
      };
    }

  }

  const hasSourceData = Boolean(
    payload.coingecko ||
      payload.defillama ||
      payload.duckduckgo ||
      payload.wikipedia ||
      payload.gdelt ||
      payload.current_events ||
      payload.the_hacker_news ||
      payload.dynamic_sources,
  );
  const result = hasSourceData ? JSON.stringify(payload, null, 2) : '';

  if (normalizedTask && !bypassCurrentEventCache) {
    liveDataCache.set(normalizedTask, {
      value: result,
      expiresAt: Date.now() + LIVE_DATA_CACHE_TTL_MS,
    });
  }

  return result;
}
