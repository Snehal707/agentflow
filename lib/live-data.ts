/**
 * Fetches structured live context for the research agent before calling Hermes.
 * CoinGecko is used for current token market metrics.
 * DefiLlama is used for chain-level TVL and stablecoin liquidity.
 * GDELT is used for current-event and geopolitical article context.
 * Firecrawl is used to scrape targeted article URLs into compact snapshots.
 * DuckDuckGo is used for lightweight background context and descriptive snippets.
 */
import {
  fetchUrlViaFirecrawl,
  getSearchBackendDiagnostics,
  searchFirecrawlNews,
  searchSearxng,
  type FirecrawlSearchResult,
  type SearchBackendDiagnostic,
} from './firecrawl';
import {
  understandMarketResearch,
  type MarketUnderstanding,
} from './market-understanding';
import { SOURCE_REGISTRY, classifyTopic, type SourceConfig } from './source-registry';
import { detectProtocolQueryShape } from './protocol-query-shape';
import {
  isAuthoritativeSportsEvidenceUrl,
  isAuthoritativeSportsOddsSource,
  isCircularResearchSourceUrl,
  isCreatorAudienceMetricTask,
  isPredictionMarketResearchTask,
  isLowValueSourceForTask,
  isLowValueSocialSourceUrl,
  isLowValueVideoUrl,
  isOfficialCreatorPlatformUrl,
  sourceHostname,
} from './source-policy';
import { decodeTextResponse, normalizeSourceText, repairMojibake } from './text-normalization';

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
  description?: string;
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

type CreatorAudienceMetricSnapshot = {
  source: string;
  channel_name?: string;
  channel_id?: string;
  current_subscribers?: number;
  current_subscribers_display?: string;
  observed_at?: string;
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

type BitcoinOnchainSnapshot = {
  source: 'Mempool.space blocks API';
  chain: 'Bitcoin';
  window: 'last_24h_from_tip';
  latest_block_height: number;
  latest_block_time: string;
  window_start_time: string;
  confirmed_transaction_count_24h: number;
  block_count_24h: number;
  average_transactions_per_block?: number;
  total_fees_btc_24h?: number;
  total_output_btc_24h?: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const LIVE_DATA_FETCH_TIMEOUT_MS = 4_000;
const FAST_GDELT_FETCH_TIMEOUT_MS = 2_000;
const LIVE_DATA_CACHE_TTL_MS = 60_000;
const COINGECKO_CACHE_TTL_MS = 30_000;
const BITCOIN_ONCHAIN_CACHE_TTL_MS = 60_000;
const DEFILLAMA_CACHE_TTL_MS = 300_000;
const DUCKDUCKGO_CACHE_TTL_MS = 120_000;
const GDELT_CACHE_TTL_MS = 120_000;
const NEWS_RSS_CACHE_TTL_MS = 120_000;
const THN_RSS_CACHE_TTL_MS = 120_000;
const WIKIPEDIA_CACHE_TTL_MS = 300_000;
const FIRECRAWL_CACHE_TTL_MS = 300_000;
const FIRECRAWL_EMPTY_RETRY_DELAY_MS = 1_500;
const HYBRID_FIRECRAWL_SEARCH_TIMEOUT_MS = 35_000;
const GDELT_MIN_INTERVAL_MS = 6_000;
const THN_RSS_URL = 'https://feeds.feedburner.com/TheHackersNews';
const CURRENT_EVENT_RECENCY_WINDOW_DAYS = Number(
  process.env.CURRENT_EVENT_RECENCY_WINDOW_DAYS || 45,
);

const liveDataCache = new Map<string, CacheEntry<string>>();
const coinGeckoCache = new Map<string, CacheEntry<CoinGeckoAssetSnapshot[]>>();
const bitcoinOnchainCache = new Map<string, CacheEntry<BitcoinOnchainSnapshot | null>>();
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

function cleanPredictionMarketResearchTaskForSearch(task: string): string {
  const cleaned = task
    .replace(/\r?\n+/g, ' ')
    .replace(/^research\s+(?:the\s+)?(?:prediction\s+)?market(?:\s+topic)?[:\s-]*/i, '')
    .replace(/\bListed outcomes in AgentFlow:[\s\S]*?(?=\bFocus on the real-world event\b|$)/i, ' ')
    .replace(/\bFocus on the real-world event[\s\S]*$/i, ' ')
    .replace(/\bthe\s+prediction\s+market\s+topic\b[:\s-]*/i, ' ')
    .replace(/\bprediction\s+market\s+topic\b[:\s-]*/i, ' ')
    .replace(/\bmarket\s+topic\b[:\s-]*/i, ' ')
    .replace(/\bprediction\b/gi, ' ')
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || task.trim();
}

function extractPredictionMarketQuestion(task: string): string {
  return cleanPredictionMarketResearchTaskForSearch(task);
}

function normalizeLiveDataSearchTask(task: string): string {
  const stripped = task.replace(/\bExecution context:[\s\S]*$/i, '').trim();
  if (/\bprediction\s+market\b/i.test(stripped)) {
    return cleanPredictionMarketResearchTaskForSearch(stripped);
  }
  return stripped.replace(/\s+/g, ' ').trim();
}

function extractPredictionMarketListedOutcomes(task: string): string[] {
  const match = task.match(
    /\bListed outcomes in AgentFlow:\s*([\s\S]*?)(?=\bPrediction market category in AgentFlow:|\bPrediction market provider in AgentFlow:|\bAgentFlow market address reference:|\bUse the market category to disambiguate the subject before searching\b|\bFocus on the real-world event\b|$)/i,
  );
  if (!match?.[1]) return [];
  return match[1]
    .split(/[\/,]|(?:\s+\|\s+)/)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((value) => value.length > 1)
    .slice(0, 8);
}

function extractPredictionMarketCategory(task: string): string | null {
  const match = task.match(/\bPrediction market category in AgentFlow:\s*([^\n.]+)/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim().toLowerCase() || null;
}

function extractPredictionMarketProvider(task: string): string | null {
  const match = task.match(/\bPrediction market provider in AgentFlow:\s*([^\n.]+)/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim().toLowerCase() || null;
}

function normalizeSportsTeamName(value: string): string {
  return value
    .replace(/\bPSG\b/gi, 'Paris Saint-Germain')
    .replace(/\bAthletico Madrid\b/gi, 'Atletico Madrid')
    .replace(/\bBayern\b(?!\s+Munich\b)/gi, 'Bayern Munich')
    .replace(/\bMan Utd\b/gi, 'Manchester United')
    .replace(/\bMan City\b/gi, 'Manchester City')
    .replace(/[?.,:;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSportsPredictionTopic(value: string): string {
  return value
    .replace(/\bUCL\b/gi, 'UEFA Champions League')
    .replace(/\bEPL\b/gi, 'English Premier League')
    .replace(/\bWinner Prediction\b/gi, 'winner')
    .replace(/\bPrediction\b/gi, ' ')
    .replace(/\bEurope(?:'|’)?s Giants Clash\b/gi, ' ')
    .replace(/\bclash of giants\b/gi, ' ')
    .replace(/[?.,:;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSportsPredictionMarketTask(task: string): boolean {
  const category = extractPredictionMarketCategory(task);
  if (category === 'sports') return true;
  return (
    /\bprediction market\b/i.test(task) &&
    /\b(ucl|champions league|uefa|premier league|nba|nfl|mlb|nhl|fifa|world cup|arsenal|bayern|atletico|psg|france|argentina|brazil|england|spain|portugal|netherlands|germany|morocco|belgium)\b/i.test(
      task,
    )
  );
}

function detectSportsCompetition(task: string): {
  league: string;
  season: string | null;
  officialDomain: string | null;
} | null {
  const haystack = task.toLowerCase();
  if (/\bnba\b/.test(haystack)) {
    return { league: 'NBA', season: '2025-26', officialDomain: 'nba.com' };
  }
  if (/\bnfl\b|super bowl|afc|nfc/.test(haystack)) {
    return { league: 'NFL', season: '2026', officialDomain: 'nfl.com' };
  }
  if (/\bmlb\b|world series|american league|national league/.test(haystack)) {
    return { league: 'MLB', season: '2026', officialDomain: 'mlb.com' };
  }
  if (/\bnhl\b|stanley cup/.test(haystack)) {
    return { league: 'NHL', season: '2025-26', officialDomain: 'nhl.com' };
  }
  if (/\b(uefa champions league|champions league|ucl)\b/.test(haystack)) {
    return {
      league: 'UEFA Champions League',
      season: '2025-26',
      officialDomain: 'uefa.com',
    };
  }
  if (/\b(fifa world cup|world cup)\b/.test(haystack)) {
    return { league: 'FIFA World Cup', season: '2026', officialDomain: 'fifa.com' };
  }
  return null;
}

function extractSingleTeamOutcomeSubject(task: string, cleanedTask: string): string | null {
  const question = normalizeSportsTeamName(cleanedTask || task);
  const singleTeamMatch = question.match(
    /\bwill\s+(.+?)\s+win\s+the\s+(?:20\d{2}\s+)?(?:nba finals|nfl|super bowl|world series|stanley cup|champions league|uefa champions league|fifa world cup)\b/i,
  );
  if (singleTeamMatch?.[1]) {
    return normalizeSportsTeamName(singleTeamMatch[1]);
  }
  const outcomes = extractPredictionMarketListedOutcomes(task)
    .map(normalizeSportsTeamName)
    .filter((value) => value && !/^(yes|no|other)$/i.test(value));
  return outcomes.length === 1 ? outcomes[0] : null;
}

function isSportsWinnerPredictionMarketTask(
  task: string,
  understanding?: MarketUnderstanding | null,
): boolean {
  if (extractPredictionMarketCategory(task) !== 'sports') return false;
  const normalized = `${task} ${understanding?.subject || ''}`.toLowerCase();
  const outcomes = extractPredictionMarketListedOutcomes(task).filter(
    (value) => value && !/^(yes|no)$/i.test(value),
  );
  return (
    /\b(who\s+will\s+win|winner|champion|championship|title)\b/i.test(normalized) ||
    outcomes.length >= 3
  );
}

function hasSportsWinnerMarketEvidenceSignal(haystack: string): boolean {
  return /\b(odds|favorite|favorites|betting|prediction|predictions|probability|probabilities|implied|outright|power ranking|power rankings|team rankings|ranking|rankings|re-ranking|re-rank|contender|contenders|opta|the analyst|oddschecker|action network|covers|fox sports|sporting news|the athletic)\b/i.test(
    haystack,
  );
}

function hasSportsWinnerMarketMatchNoiseSignal(haystack: string): boolean {
  return /\b(live updates?|best bets?|preview|match preview|opener|group [a-z0-9]+|where to watch|lineups?|vs\.?|versus|today'?s games|tonight'?s games|monday'?s games|tuesday'?s games|wednesday'?s games|thursday'?s games|friday'?s games|saturday'?s games|sunday'?s games|quarterfinal|quarter-final|semifinal|semi-final|round of 16|coach says|photos?)\b/i.test(
    haystack,
  );
}

function buildSportsPredictionMarketQueries(
  task: string,
  cleanedTask: string,
  understanding?: MarketUnderstanding | null,
): string[] {
  if (!isSportsPredictionMarketTask(task) && !isSportsPredictionMarketTask(cleanedTask)) {
    return [];
  }

  const queries: string[] = [];
  for (const query of understanding?.searchQueries ?? []) {
    addUniqueQuery(queries, query);
  }
  const normalizedBase = normalizeSportsPredictionTopic(cleanedTask || task);
  const outcomes = extractPredictionMarketListedOutcomes(task)
    .map(normalizeSportsTeamName)
    .filter((value) => value && !/^(yes|no|other)$/i.test(value));
  const singleTeamSubject = extractSingleTeamOutcomeSubject(task, cleanedTask);
  const competitionMeta = detectSportsCompetition(`${task} ${cleanedTask}`);
  const competition = competitionMeta
    ? `${competitionMeta.league}${competitionMeta.season ? ` ${competitionMeta.season}` : ''}`
    : normalizedBase;
  const broadTournamentWinnerMarket =
    Boolean(competitionMeta) &&
    /\b(world cup|champions league|uefa|nba finals|super bowl|world series|stanley cup)\b/i.test(
      competition,
    ) &&
    outcomes.length >= 3;
  const teamsText =
    !singleTeamSubject && !broadTournamentWinnerMarket && outcomes.length >= 2 && outcomes.length <= 3
      ? outcomes.join(' ')
      : '';

  if (singleTeamSubject && competitionMeta) {
    addUniqueQuery(queries, `"${singleTeamSubject}" ${competitionMeta.league} finals odds`);
    addUniqueQuery(queries, `"${singleTeamSubject}" ${competitionMeta.league} injuries`);
    addUniqueQuery(queries, `"${singleTeamSubject}" ${competitionMeta.league} roster finals`);
    addUniqueQuery(queries, `"${singleTeamSubject}" ${competitionMeta.league} ${competitionMeta.season || ''}`);
    if (competitionMeta.officialDomain) {
      addUniqueQuery(queries, `site:${competitionMeta.officialDomain} "${singleTeamSubject}" ${competitionMeta.league} finals`);
    }
    addUniqueQuery(queries, `site:espn.com "${singleTeamSubject}" ${competitionMeta.league} finals`);
    addUniqueQuery(queries, `site:oddschecker.com "${singleTeamSubject}" ${competitionMeta.league} odds`);
    addUniqueQuery(queries, `site:actionnetwork.com "${singleTeamSubject}" ${competitionMeta.league} odds`);
    addUniqueQuery(queries, normalizedBase);
  } else if (teamsText) {
    addUniqueQuery(queries, normalizedBase);
    addUniqueQuery(queries, `${competition} ${teamsText}`);
    addUniqueQuery(queries, `${competition} ${teamsText} semi finals`);
    addUniqueQuery(queries, `${competition} ${teamsText} final result`);
    addUniqueQuery(queries, `${competition} ${teamsText} odds predictions`);
    addUniqueQuery(queries, `${competition} ${teamsText} opta analyst`);
    addUniqueQuery(queries, `${competition} ${teamsText} current form injuries`);
  } else {
    addUniqueQuery(queries, normalizedBase);
    if (broadTournamentWinnerMarket) {
      addUniqueQuery(queries, `${competition} winner odds`);
      addUniqueQuery(queries, `${competition} betting odds favorites`);
      addUniqueQuery(queries, `${competition} predictions`);
      addUniqueQuery(queries, `${competition} outright odds`);
      addUniqueQuery(queries, `${competition} opta prediction`);
      addUniqueQuery(queries, `${competition} team rankings`);
      addUniqueQuery(queries, `${competition} power rankings`);
    } else {
      addUniqueQuery(queries, `${competition} odds predictions`);
      addUniqueQuery(queries, `${competition} current form injuries`);
      addUniqueQuery(queries, `${competition} winner odds`);
      addUniqueQuery(queries, `${competition} favorites`);
    }
  }

  if (competitionMeta?.officialDomain) {
    addUniqueQuery(queries, `site:${competitionMeta.officialDomain} ${competition} winners`);
  } else {
    addUniqueQuery(queries, `site:uefa.com ${competition} winners`);
  }
  if (/\bFIFA World Cup 2026\b/i.test(competition)) {
    addUniqueQuery(queries, `${competition} winner odds`);
    addUniqueQuery(queries, `${competition} betting odds favorites`);
    addUniqueQuery(queries, `site:fifa.com ${competition} favorites odds`);
    addUniqueQuery(queries, `site:espn.com ${competition} predictions`);
    addUniqueQuery(queries, `site:theanalyst.com ${competition} prediction`);
    addUniqueQuery(queries, `site:oddschecker.com ${competition} odds`);
    addUniqueQuery(queries, `site:actionnetwork.com ${competition} odds`);
    addUniqueQuery(queries, `site:foxsports.com ${competition} champion odds`);
    addUniqueQuery(queries, `site:covers.com ${competition} odds`);
    addUniqueQuery(queries, `site:cbssports.com ${competition} odds`);
    addUniqueQuery(queries, `${competition} fifa rankings favorites`);
    if (outcomes.length >= 3) {
      const contenders = outcomes.slice(0, 4).join(' ');
      addUniqueQuery(queries, `${competition} ${contenders} winner odds`);
      addUniqueQuery(queries, `${competition} ${contenders} favorites`);
      addUniqueQuery(queries, `${competition} ${contenders} prediction`);
    }
  }
  if (!broadTournamentWinnerMarket) {
    addUniqueQuery(queries, `${competition} winner latest`);
    addUniqueQuery(queries, `${competition} latest`);
  }
  return queries.slice(0, 12);
}

/**
 * Understand what a prediction market is actually about before searching, instead of
 * searching the raw "Will X reach $Y by <date>?" wording (which retrieves little and then
 * falls back to unrelated news). Extracts the subject and the question type and builds a
 * few focused queries. Sports markets keep their dedicated builder.
 */
function buildPredictionMarketSubjectQueries(
  task: string,
  cleanedTask: string,
  understanding?: MarketUnderstanding | null,
): string[] {
  if (!/\bprediction market\b/i.test(task)) return [];
  if (isSportsPredictionMarketTask(task) || isSportsPredictionMarketTask(cleanedTask)) return [];

  // Strip the forecasting scaffolding to isolate the subject.
  const subject =
    stripPredictionMarketIntentSuffix(
      understanding?.entity?.canonicalName || understanding?.subject || '',
    ) ||
    (cleanedTask || task)
      .replace(/^\s*will\s+/i, '')
      .replace(/\b(?:by|before|after|on|until|reach(?:es)?|hit|cross|exceed|surpass)\b[\s\S]*$/i, ' ')
      .replace(/\$[\d,]+(?:\.\d+)?[kmbt]?/gi, ' ')
      .replace(/\b20\d{2}\b/g, ' ')
      .replace(/[?".,:;()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  if (!subject || subject.length < 2) return [];

  const haystack = `${task} ${cleanedTask}`.toLowerCase();
  const targetYear = (task.match(/\b(20\d{2})\b/) || [])[1] ?? String(new Date().getUTCFullYear());
  const category = extractPredictionMarketCategory(task) || extractPredictionMarketCategory(cleanedTask);
  const provider = extractPredictionMarketProvider(task);
  const queries: string[] = [];
  const ticker = (task.match(/\(([A-Z]{2,6})\)/) || [])[1];

  if (/\breach|hit|price|\$|usd|market cap|all[- ]time high|ath\b/i.test(haystack)) {
    // Lead with the ticker + year ("XAUT price prediction 2026"): self-hosted search
    // returns far better asset-specific results for that phrasing than the full name
    // (e.g. "Tether Gold XAUT ..." collapses into generic Tether/USDT results).
    if (ticker) {
      addUniqueQuery(queries, `${ticker} price prediction ${targetYear}`);
      addUniqueQuery(queries, `${ticker} price forecast`);
      addUniqueQuery(queries, `${ticker} latest news`);
    }
    addUniqueQuery(queries, `${subject} price prediction ${targetYear}`);
    addUniqueQuery(queries, `${subject} price forecast`);
    addUniqueQuery(queries, `${subject} market analysis ${targetYear}`);
    addUniqueQuery(queries, `${subject} latest news`);
    if (/\bxaut\b|\btether gold\b/i.test(haystack)) {
      addUniqueQuery(queries, 'XAUT latest news');
      addUniqueQuery(queries, 'Tether Gold latest news');
      addUniqueQuery(queries, `Tether Gold price prediction ${targetYear}`);
      addUniqueQuery(queries, `gold price forecast ${targetYear}`);
      addUniqueQuery(queries, `gold price forecast july ${targetYear}`);
      addUniqueQuery(queries, `spot gold analysis ${targetYear}`);
      addUniqueQuery(queries, 'spot gold price latest');
      addUniqueQuery(queries, 'spot gold latest news');
      addUniqueQuery(queries, 'gold market outlook');
      addUniqueQuery(queries, `gold market outlook ${targetYear}`);
      addUniqueQuery(queries, 'tokenized gold market analysis');
      addUniqueQuery(queries, 'gold market macro drivers');
      addUniqueQuery(queries, 'world gold council gold outlook');
      addUniqueQuery(queries, 'site:kitco.com gold price forecast');
      addUniqueQuery(queries, 'site:lbma.org.uk gold market');
      addUniqueQuery(queries, 'site:reuters.com gold prices');
    }
  } else if (/\blaunch|release|ship|come out|drop|debut|available\b/i.test(haystack)) {
    if (
      category === 'gaming' ||
      category === 'games' ||
      /\bgta\s*6\b|\bgrand theft auto\b/i.test(haystack)
    ) {
      addUniqueQuery(queries, `${subject} release date confirmation`);
      addUniqueQuery(queries, `Rockstar Games ${subject} confirmed launch timeline`);
      addUniqueQuery(queries, `${subject} development status ${targetYear}`);
      addUniqueQuery(queries, 'site:rockstargames.com Grand Theft Auto VI');
      addUniqueQuery(queries, 'site:rockstargames.com GTA 6 release date');
      addUniqueQuery(queries, 'site:take2games.com Grand Theft Auto VI release');
    } else if (category === 'crypto' || provider === 'achmarket' || isArcNetworkTask(subject)) {
      addUniqueQuery(queries, `${subject} mainnet launch ${targetYear}`);
      addUniqueQuery(queries, `${subject} roadmap mainnet ${targetYear}`);
      addUniqueQuery(queries, `${subject} launch date announcement`);
      if (isArcNetworkTask(subject) || /\barc\b/i.test(subject)) {
        addUniqueQuery(queries, 'ARC Network mainnet');
        addUniqueQuery(queries, 'ARC Network mainnet launch');
        addUniqueQuery(queries, 'ARC Network testnet');
        addUniqueQuery(queries, 'ARC Network stablecoin blockchain');
        addUniqueQuery(queries, 'ARC Network onchain finance');
        addUniqueQuery(queries, 'ARC L1 blockchain');
        addUniqueQuery(queries, 'site:arc.network ARC Network mainnet');
        addUniqueQuery(queries, 'site:arc.network ARC Network launch');
        addUniqueQuery(queries, 'site:circle.com ARC Network blockchain');
        addUniqueQuery(queries, 'site:arc.io ARC stablecoin-native L1 blockchain');
      } else {
        addUniqueQuery(queries, `${subject} official announcement`);
      }
    } else {
      addUniqueQuery(queries, `${subject} release date news`);
      addUniqueQuery(queries, `${subject} launch delay latest`);
      addUniqueQuery(queries, `${subject} official announcement`);
    }
  } else {
    addUniqueQuery(queries, `${subject} latest news`);
    addUniqueQuery(queries, `${subject} forecast ${targetYear ?? ''}`.trim());
    addUniqueQuery(queries, `${subject} analysis prediction`);
  }

  return queries.slice(0, 10);
}

function stripPredictionMarketIntentSuffix(subject: string): string {
  return subject
    .replace(
      /\b(price target|price forecast|release timing|release date|winner|launch milestone|mainnet launch|launch date|event outcome|metric threshold)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPredictionMarketSubjectCore(task: string, cleanedTask: string): string {
  const subject = (cleanedTask || task)
    .replace(/^\s*will\s+/i, ' ')
    .replace(
      /\b(?:by|before|after|on|until|reach(?:es)?|hit|cross|exceed|surpass|launch|release|ship|come out|drop|debut|available|win)\b[\s\S]*$/i,
      ' ',
    )
    .replace(/\$[\d,]+(?:\.\d+)?[kmbt]?/gi, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[?".,:;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return subject;
}

function buildPredictionMarketIntentTerms(
  task: string,
  category: string | null,
  questionType?: MarketUnderstanding['questionType'] | null,
): string[] {
  const haystack = task.toLowerCase();
  const terms: string[] = [];
  const addTerm = (term: string | undefined) => {
    const value = term?.replace(/\s+/g, ' ').trim();
    if (!value || terms.includes(value)) return;
    terms.push(value);
  };

  const isPriceTarget = questionType === 'price_target' || /\breach|hit|price|\$|usd|ath\b/i.test(haystack);
  const isGameRelease =
    category === 'games' ||
    category === 'gaming' ||
    /\bgta\s*6\b|\bgrand theft auto\b|\bvideo game\b/i.test(haystack);
  const isCryptoLaunch =
    category === 'crypto' &&
    /\bmainnet|launch|testnet|roadmap|validator|token|blockchain\b/i.test(haystack);

  if (isPriceTarget) {
    addTerm('price');
    addTerm('market analysis');
    addTerm('latest news');
    addTerm('macro drivers');
    addTerm('institutional flows');
  }
  if (isGameRelease) {
    addTerm('release date');
    addTerm('launch window');
    addTerm('development update');
    addTerm('official announcement');
    addTerm('delay');
  } else if (questionType === 'launch_milestone' || isCryptoLaunch || /\bmainnet\b/i.test(haystack)) {
    addTerm('mainnet');
    addTerm('mainnet launch');
    addTerm('roadmap');
    addTerm('testnet');
    addTerm('official announcement');
  } else if (
    questionType === 'release_date' ||
    /\blaunch|release|ship|come out|drop|debut|available\b/i.test(haystack)
  ) {
    addTerm('release date');
    addTerm('launch window');
    addTerm('development update');
    addTerm('official announcement');
    addTerm('delay');
  } else if (questionType === 'event_outcome') {
    addTerm('odds');
    addTerm('latest news');
    addTerm('standings');
  } else if (questionType === 'metric_threshold') {
    addTerm('latest');
    addTerm('data');
    addTerm('trend');
  }

  if (category === 'crypto' && !isPriceTarget) {
    addTerm('crypto');
    addTerm('blockchain');
  } else if (category === 'crypto' && isPriceTarget) {
    addTerm('crypto');
    addTerm('analysis');
  } else if (category === 'games' || category === 'gaming') {
    addTerm('game');
  } else if (category === 'sports') {
    addTerm('sports');
  }

  return terms.slice(0, 6);
}

function buildPredictionMarketEntityQueries(
  task: string,
  cleanedTask: string,
  understanding?: MarketUnderstanding | null,
): string[] {
  if (!/\bprediction market\b/i.test(task)) return [];
  if (isSportsPredictionMarketTask(task) || isSportsPredictionMarketTask(cleanedTask)) return [];

  const category = extractPredictionMarketCategory(task) || extractPredictionMarketCategory(cleanedTask);
  const provider = extractPredictionMarketProvider(task);
  const haystack = `${task} ${cleanedTask}`.toLowerCase();
  const isPriceTarget =
    understanding?.questionType === 'price_target' || /\breach|hit|price|\$|usd|ath\b/i.test(haystack);
  const isCryptoLaunchLike =
    category === 'crypto' && /\bmainnet|launch|testnet|roadmap|validator|token|blockchain\b/i.test(haystack);
  const resolutionYear =
    understanding?.resolutionDate?.slice(0, 4) ||
    (task.match(/\b(20\d{2})\b/) || [])[1] ||
    String(new Date().getUTCFullYear());
  const subject =
    stripPredictionMarketIntentSuffix(understanding?.subject || '') ||
    extractPredictionMarketSubjectCore(task, cleanedTask);
  if (!subject) return [];

  const queries: string[] = [];
  const entity = understanding?.entity;
  const aliases = [
    entity?.canonicalName,
    ...((entity?.aliases ?? []) as string[]),
    subject,
    understanding?.underlying,
  ]
    .map((value) => stripPredictionMarketIntentSuffix(value || ''))
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 5);
  const intentTerms = buildPredictionMarketIntentTerms(task, category, understanding?.questionType);

  if (understanding?.underlying) {
    addUniqueQuery(queries, understanding.underlying);
    addUniqueQuery(queries, `${understanding.underlying} latest`);
    addUniqueQuery(queries, `${understanding.underlying} analysis`);
    if (understanding.questionType === 'price_target') {
      addUniqueQuery(queries, `${understanding.underlying} market analysis ${resolutionYear}`);
      addUniqueQuery(queries, `${understanding.underlying} latest news`);
      addUniqueQuery(queries, `${understanding.underlying} macro drivers`);
    }
  }

  for (const alias of aliases) {
    const normalizedAlias = alias.trim();
    const isShortCryptoAcronym =
      isCryptoLaunchLike &&
      /^[A-Z]{2,4}$/i.test(normalizedAlias) &&
      normalizedAlias.split(/\s+/).length === 1;

    // Short crypto acronyms like "ARC" are too ambiguous to search naked. Search engines
    // return clinics, browsers, charities, and other homonyms unless we force blockchain
    // context into the query itself.
    if (!isShortCryptoAcronym) {
      addUniqueQuery(queries, normalizedAlias);
    }
    for (const term of intentTerms) {
      addUniqueQuery(queries, `${normalizedAlias} ${term}`);
    }
    if (category === 'crypto' && isPriceTarget) {
      addUniqueQuery(queries, `${normalizedAlias} latest news`);
      addUniqueQuery(queries, `${normalizedAlias} market analysis`);
      addUniqueQuery(queries, `${normalizedAlias} macro drivers`);
      addUniqueQuery(queries, `${normalizedAlias} institutional demand`);
    }
    if (isCryptoLaunchLike && alias.split(/\s+/).length <= 2) {
      addUniqueQuery(queries, `${normalizedAlias} blockchain project`);
      addUniqueQuery(queries, `${normalizedAlias} blockchain`);
      addUniqueQuery(queries, `${normalizedAlias} crypto project`);
      addUniqueQuery(queries, `${normalizedAlias} roadmap crypto`);
      addUniqueQuery(queries, `${normalizedAlias} docs blockchain`);
      addUniqueQuery(queries, `${normalizedAlias} onchain finance`);
      addUniqueQuery(queries, `${normalizedAlias} stablecoin blockchain`);
      addUniqueQuery(queries, `${normalizedAlias} layer 1 blockchain`);
      if (/\bmainnet|launch\b/i.test(haystack)) {
        addUniqueQuery(queries, `${normalizedAlias} blockchain mainnet`);
        addUniqueQuery(queries, `${normalizedAlias} crypto mainnet`);
        addUniqueQuery(queries, `${normalizedAlias} mainnet launch crypto`);
        addUniqueQuery(queries, `${normalizedAlias} blockchain launch roadmap`);
      }
    }
  }

  for (const domain of entity?.officialDomains ?? []) {
    const alias = aliases[0] || subject;
    addUniqueQuery(queries, `site:${domain} ${alias}`);
    for (const term of intentTerms.slice(0, 3)) {
      addUniqueQuery(queries, `site:${domain} ${alias} ${term}`);
    }
  }

  if ((category === 'games' || category === 'gaming') && /\bgta\s*6\b|\bgrand theft auto\b/i.test(haystack)) {
    addUniqueQuery(queries, 'Rockstar Games GTA 6 release date');
    addUniqueQuery(queries, 'Take-Two Grand Theft Auto VI release');
  }

  if ((category === 'crypto' || provider === 'achmarket') && /\bxaut\b|\btether gold\b/i.test(haystack)) {
    addUniqueQuery(queries, 'XAUT latest news');
    addUniqueQuery(queries, 'Tether Gold market analysis');
    addUniqueQuery(queries, `gold market analysis ${resolutionYear}`);
    addUniqueQuery(queries, `gold price forecast ${resolutionYear}`);
    addUniqueQuery(queries, `gold price forecast july ${resolutionYear}`);
    addUniqueQuery(queries, 'spot gold latest news');
    addUniqueQuery(queries, 'gold market macro drivers');
    addUniqueQuery(queries, 'world gold council gold outlook');
    addUniqueQuery(queries, 'site:kitco.com gold market');
    addUniqueQuery(queries, 'site:lbma.org.uk gold market');
    addUniqueQuery(queries, 'site:reuters.com gold prices');
    addUniqueQuery(queries, 'site:gold.org gold outlook');
  }

  if ((category === 'crypto' || provider === 'achmarket') && /\barc\b/i.test(haystack) && /\bmainnet|launch\b/i.test(haystack)) {
    addUniqueQuery(queries, 'ARC Network crypto');
    addUniqueQuery(queries, 'ARC Network blockchain');
    addUniqueQuery(queries, 'Circle Arc blockchain');
    addUniqueQuery(queries, 'ARC stablecoin-native L1 blockchain');
    addUniqueQuery(queries, 'ARC onchain finance blockchain');
    addUniqueQuery(queries, 'ARC Network testnet');
    addUniqueQuery(queries, `ARC Network mainnet ${resolutionYear}`);
    addUniqueQuery(queries, 'ARC Network roadmap mainnet');
    addUniqueQuery(queries, 'ARC blockchain launch announcement');
  }

  return queries.slice(0, 12);
}

function buildPredictionMarketDiscoveryQueries(
  task: string,
  understanding: MarketUnderstanding | null,
): string[] {
  if (!/\bprediction market\b/i.test(task) || !understanding) return [];

  const queries: string[] = [];
  const category = extractPredictionMarketCategory(task);
  const haystack = `${task} ${understanding.subject}`.toLowerCase();
  const entity = understanding.entity;
  const canonical = stripPredictionMarketIntentSuffix(entity?.canonicalName || understanding.subject);
  const aliases = [
    canonical,
    ...(entity?.aliases ?? []),
    understanding.underlying,
  ]
    .map((value) => stripPredictionMarketIntentSuffix(value || ''))
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(
      (value, index, values) =>
        values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index,
    )
    .slice(0, 4);

  for (const alias of aliases) {
    addUniqueQuery(queries, alias);
  }

  if (category === 'crypto') {
    for (const alias of aliases.slice(0, 3)) {
      addUniqueQuery(queries, `${alias} crypto`);
      addUniqueQuery(queries, `${alias} blockchain`);
      addUniqueQuery(queries, `${alias} ecosystem`);
      addUniqueQuery(queries, `${alias} docs`);
      addUniqueQuery(queries, `${alias} blog`);
      addUniqueQuery(queries, `${alias} latest news`);
      addUniqueQuery(queries, `${alias} market analysis`);
      addUniqueQuery(queries, `${alias} onchain finance`);
    }
    if (
      understanding.questionType === 'price_target' ||
      /\b(market cap|reach|hit|price|\$|usd|ath)\b/i.test(haystack)
    ) {
      for (const alias of aliases.slice(0, 3)) {
        addUniqueQuery(queries, `${alias} macro drivers`);
        addUniqueQuery(queries, `${alias} ETF flows`);
        addUniqueQuery(queries, `${alias} institutional demand`);
        addUniqueQuery(queries, `site:coindesk.com ${alias} news`);
        addUniqueQuery(queries, `site:coindesk.com ${alias} analysis`);
        addUniqueQuery(queries, `site:theblock.co ${alias} news`);
        addUniqueQuery(queries, `site:theblock.co ${alias} analysis`);
        addUniqueQuery(queries, `site:decrypt.co ${alias} news`);
        addUniqueQuery(queries, `site:decrypt.co ${alias} analysis`);
        addUniqueQuery(queries, `site:forbes.com ${alias} crypto`);
        addUniqueQuery(queries, `site:reuters.com ${alias} crypto`);
      }
    }
    if (/\b(mainnet|launch|testnet)\b/i.test(haystack)) {
      for (const alias of aliases.slice(0, 3)) {
        addUniqueQuery(queries, `${alias} roadmap`);
        addUniqueQuery(queries, `${alias} developer update`);
        addUniqueQuery(queries, `${alias} validator`);
        addUniqueQuery(queries, `${alias} testnet`);
        addUniqueQuery(queries, `${alias} mainnet`);
      }
    }
    if (understanding.underlying) {
      addUniqueQuery(queries, `${understanding.underlying} latest`);
      addUniqueQuery(queries, `${understanding.underlying} market news`);
    }
  } else if (category === 'games' || category === 'gaming') {
    for (const alias of aliases.slice(0, 3)) {
      addUniqueQuery(queries, `${alias} game`);
      addUniqueQuery(queries, `${alias} developer update`);
      addUniqueQuery(queries, `${alias} release`);
      addUniqueQuery(queries, `${alias} trailer`);
    }
  } else if (category === 'sports') {
    for (const alias of aliases.slice(0, 3)) {
      addUniqueQuery(queries, `${alias} odds`);
      addUniqueQuery(queries, `${alias} standings`);
      addUniqueQuery(queries, `${alias} injuries`);
      addUniqueQuery(queries, `${alias} fixtures`);
    }
  }

  return queries.slice(0, 12);
}

function filterCreatorAudienceEvidence(
  snapshots: FirecrawlArticleSnapshot[],
): FirecrawlArticleSnapshot[] {
  const preferred = snapshots.filter((snapshot) => {
    const haystack = `${snapshot.title} ${snapshot.publisher || ''} ${snapshot.url} ${snapshot.summary}`.toLowerCase();
    if (/\b(socialcounts|livecounts|socialblade|viewstats)\b/.test(haystack)) return true;
    if (/\bkalshi\b/.test(haystack)) return true;
    if (isOfficialCreatorPlatformUrl(snapshot.url)) return true;
    return false;
  });

  const filtered = preferred.filter((snapshot) => {
    const haystack = `${snapshot.title} ${snapshot.publisher || ''} ${snapshot.url} ${snapshot.summary}`.toLowerCase();
    if (/\breddit\.com\b/.test(haystack)) return false;
    if (isLowValueVideoUrl(snapshot.url) && !/\blive subscriber|subscriber count\b/i.test(haystack)) {
      return false;
    }
    return true;
  });

  return filtered.length > 0 ? filtered : snapshots;
}

function filterLowValueEvidenceForTask(
  task: string,
  snapshots: FirecrawlArticleSnapshot[],
): FirecrawlArticleSnapshot[] {
  return snapshots.filter((snapshot) =>
    !isLowValueSourceForTask(task, {
      domain: snapshot.publisher,
      url: snapshot.url,
      title: snapshot.title,
      summary: snapshot.summary,
      publisher: snapshot.publisher,
    }),
  );
}

function extractYoutubeChannelId(url: string): string | null {
  const match = url.match(/youtube\.com\/channel\/([A-Za-z0-9_-]{20,})/i);
  return match?.[1] ?? null;
}

function augmentCreatorAudienceEvidence(
  snapshots: FirecrawlArticleSnapshot[],
): FirecrawlArticleSnapshot[] {
  const channelSnapshot = snapshots.find((snapshot) => isOfficialCreatorPlatformUrl(snapshot.url));
  if (!channelSnapshot) return snapshots;
  const channelId = extractYoutubeChannelId(channelSnapshot.url);
  if (!channelId) return snapshots;

  const titleBase = channelSnapshot.title.replace(/\s*-\s*youtube\s*$/i, '').trim() || 'Creator';
  const augmented = [...snapshots];

  if (!augmented.some((snapshot) => /\bsocialcounts\.org\b/i.test(snapshot.url))) {
    augmented.push({
      title: `${titleBase} - YouTube Live Subscriber Count - SocialCounts.org`,
      url: `https://socialcounts.org/youtube-live-subscriber-count/${channelId}`,
      publisher: 'socialcounts.org',
      summary: `Live subscriber tracker for ${titleBase}.`,
    });
  }

  if (!augmented.some((snapshot) => /\blivecounts\.io\b/i.test(snapshot.url))) {
    augmented.push({
      title: `${titleBase} Realtime YouTube Live Subscriber Counter - Livecounts.io`,
      url: `https://livecounts.io/youtube-live-subscriber-counter/${channelId}`,
      publisher: 'livecounts.io',
      summary: `Realtime subscriber tracker for ${titleBase}.`,
    });
  }

  return augmented;
}

function parseDisplaySubscriberCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractCreatorAudienceMetricFromMarkdown(
  markdown: string,
  url: string,
): CreatorAudienceMetricSnapshot | null {
  const currentCountMatch =
    markdown.match(/(?:^|\n)(\d{3}(?:,\d{3})+)\n\nSocialcounts\.Org/i) ||
    markdown.match(/(?:^|\n)(\d{3}(?:,\d{3})+)\n\nSubscribers/i);
  const currentSubscribersDisplay = currentCountMatch?.[1]?.trim();
  const currentSubscribers = parseDisplaySubscriberCount(currentSubscribersDisplay);

  const channelName =
    markdown.match(/\[([^\]]+)\]\(https:\/\/www\.youtube\.com\/channel\/[A-Za-z0-9_-]+\s+"Visit channel on YouTube"\)/i)?.[1]?.trim() ||
    markdown.match(/^([^\n]+)\n\n[-=]{3,}\n\n\d{3}(?:,\d{3})+/m)?.[1]?.trim();
  const channelId = url.match(/\/([A-Za-z0-9_-]{20,})$/)?.[1];
  const observedAtLabel =
    markdown.match(/\|\s*([A-Z][a-z]{2}\s+\d{1,2},\s+20\d{2})<br><br>/)?.[1]?.trim();
  const observedAt = observedAtLabel
    ? new Date(`${observedAtLabel} 00:00:00 UTC`).toISOString().slice(0, 10)
    : undefined;

  if (!currentSubscribersDisplay || !currentSubscribers) {
    return null;
  }

  return {
    source: new URL(url).hostname.replace(/^www\./, ''),
    ...(channelName ? { channel_name: channelName } : {}),
    ...(channelId ? { channel_id: channelId } : {}),
    current_subscribers: currentSubscribers,
    current_subscribers_display: currentSubscribersDisplay,
    ...(observedAt ? { observed_at: observedAt } : {}),
  };
}

async function fetchCreatorAudienceMetricSnapshot(
  snapshots: FirecrawlArticleSnapshot[],
): Promise<CreatorAudienceMetricSnapshot | null> {
  const preferred = snapshots.find((snapshot) => /\bsocialcounts\.org\b/i.test(snapshot.url));
  if (!preferred) return null;

  try {
    const markdown = await fetchUrlViaFirecrawl(preferred.url);
    return extractCreatorAudienceMetricFromMarkdown(markdown, preferred.url);
  } catch {
    return null;
  }
}

function officialFallbackUrlsForPredictionMarket(understanding: MarketUnderstanding): string[] {
  const urls: string[] = [];
  if (/\barc network\b/i.test(understanding.entity?.canonicalName || understanding.subject)) {
    addUniqueQuery(urls, 'https://arc.io/');
    addUniqueQuery(urls, 'https://arc.io/blog');
    addUniqueQuery(urls, 'https://docs.arc.io/arc-chain');
    addUniqueQuery(
      urls,
      'https://www.circle.com/blog/introducing-arc-an-open-layer-1-blockchain-purpose-built-for-stablecoin-finance',
    );
  }
  if (
    /\b(xaut|tether gold)\b/i.test(understanding.subject) ||
    /\bgold\b/i.test(understanding.underlying || '')
  ) {
    addUniqueQuery(urls, 'https://tether.to/en/gold/');
    addUniqueQuery(urls, 'https://www.kitco.com/');
    addUniqueQuery(urls, 'https://www.lbma.org.uk/');
    addUniqueQuery(urls, 'https://www.gold.org/goldhub/');
  }
  for (const domain of understanding.entity?.officialDomains ?? []) {
    const normalizedDomain = domain.trim().toLowerCase();
    if (!normalizedDomain) continue;
    addUniqueQuery(urls, `https://${normalizedDomain}/`);
    addUniqueQuery(urls, `https://${normalizedDomain}/blog`);
    addUniqueQuery(urls, `https://${normalizedDomain}/news`);
  }
  if (/\bgta\b|\bgrand theft auto\b/i.test(understanding.subject)) {
    addUniqueQuery(urls, 'https://www.xbox.com/en-US/games/store/grand-theft-auto-vi/9nl3wwnzlzzn');
    addUniqueQuery(urls, 'https://www.take2games.com/ir/news');
    addUniqueQuery(urls, 'https://www.rockstargames.com/newswire');
  }
  return urls.slice(0, 8);
}

function hasPredictionMarketUnderlyingGoldEvidence(
  snapshots: FirecrawlArticleSnapshot[],
): boolean {
  return snapshots.some((snapshot) =>
    /\b(kitco\.com|lbma\.org\.uk|gold\.org|goldhub|reuters\.com|cmegroup\.com|bullion)\b/i.test(
      `${snapshot.publisher || ''} ${snapshot.url} ${snapshot.title} ${snapshot.summary || ''}`,
    ),
  );
}

async function fetchPredictionMarketOfficialFallbackEvidence(
  task: string,
  understanding: MarketUnderstanding | null,
): Promise<FirecrawlArticleSnapshot[]> {
  if (!understanding?.entity?.officialDomains?.length) return [];
  if (!/\bprediction market\b/i.test(task)) return [];
  if (
    !/\b(mainnet|launch|release|testnet)\b/i.test(task) &&
    !(
      /\b(xaut|tether gold)\b/i.test(task) ||
      /\bgold\b/i.test(understanding.underlying || '')
    )
  ) {
    return [];
  }

  const snapshots = await Promise.all(
    officialFallbackUrlsForPredictionMarket(understanding).map(async (url) => {
      try {
        const markdown = await fetchUrlViaFirecrawl(url);
        const summary = markdownToSnippet(markdown, 420);
        if (!summary) return null;
        if (/\bpage not found\b|\bdoesn't exist\b|\bhas been moved\b/i.test(summary)) {
          return null;
        }
        const title =
          normalizeSourceText(markdown.match(/^#\s+(.+)$/m)?.[1] || '', {
            stripChrome: true,
            collapseWhitespace: true,
          }) || `${understanding.entity?.canonicalName || understanding.subject} official page`;
        const snapshot: FirecrawlArticleSnapshot = {
          title,
          url,
          publisher: extractHostname(url),
          summary,
        };
        return isEntityRelevantPredictionMarketSource(snapshot, task, understanding) ? snapshot : null;
      } catch {
        return null;
      }
    }),
  );

  const deduped = new Map<string, FirecrawlArticleSnapshot>();
  for (const snapshot of snapshots) {
    if (!snapshot || deduped.has(snapshot.url)) continue;
    deduped.set(snapshot.url, snapshot);
  }
  return [...deduped.values()].slice(0, 4);
}

async function fetchPredictionMarketRegistryArticleEvidence(
  task: string,
  understanding: MarketUnderstanding | null,
): Promise<FirecrawlArticleSnapshot[]> {
  if (!isPredictionMarketResearchTask(task)) return [];

  const rssArticles = await fetchDynamicSources(task).catch(() => [] as GdeltArticleSnapshot[]);
  if (rssArticles.length === 0) return [];

  const snapshots = await Promise.all(
    rssArticles.slice(0, 8).map((article) =>
      fetchFirecrawlArticleSnapshot(article, { bypassCache: true }).catch(() => null),
    ),
  );

  const deduped = new Map<string, FirecrawlArticleSnapshot>();
  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    if (matchesResolvedEntityAvoidTerms(snapshot, understanding)) continue;
    if (!isEntityRelevantPredictionMarketSource(snapshot, task, understanding)) continue;
    deduped.set(snapshot.url, snapshot);
  }

  return [...deduped.values()].slice(0, 6);
}

async function fetchPredictionMarketOfficialSearchEvidence(
  task: string,
  understanding: MarketUnderstanding | null,
): Promise<FirecrawlArticleSnapshot[]> {
  if (!/\bprediction market\b/i.test(task) || !understanding?.entity?.officialDomains?.length) {
    return [];
  }

  const canonical = stripPredictionMarketIntentSuffix(
    understanding.entity.canonicalName || understanding.subject,
  );
  if (!canonical) return [];

  const category = extractPredictionMarketCategory(task);
  const queries: string[] = [];
  for (const domain of understanding.entity.officialDomains.slice(0, 2)) {
    addUniqueQuery(queries, `site:${domain} ${canonical}`);
    addUniqueQuery(queries, `site:${domain} ${canonical} official announcement`);
    if (understanding.questionType === 'launch_milestone') {
      if (category === 'games' || category === 'gaming') {
        addUniqueQuery(queries, `site:${domain} ${canonical} release date`);
        addUniqueQuery(queries, `site:${domain} ${canonical} launch`);
      } else if (category === 'crypto') {
        addUniqueQuery(queries, `site:${domain} ${canonical} mainnet`);
        addUniqueQuery(queries, `site:${domain} ${canonical} roadmap`);
      }
    }
  }

  const groups = await Promise.all(
    queries.slice(0, 6).map(async (query) => {
      try {
        const [firecrawlResults, searxngResults] = await Promise.allSettled([
          searchFirecrawlNews(query, 4, { recency: 'all' }),
          searchSearxng(query, 4, { timeoutMs: 10_000, categories: ['news'] }),
        ]);
        const merged = new Map<string, FirecrawlSearchResult>();
        for (const resultSet of [firecrawlResults, searxngResults]) {
          if (resultSet.status !== 'fulfilled') continue;
          for (const result of resultSet.value) {
            const url = result.url?.trim();
            if (!url || merged.has(url)) continue;
            merged.set(url, result);
          }
        }
        return [...merged.values()]
          .map((result) => buildFirecrawlSearchSnapshot(result))
          .filter((snapshot): snapshot is FirecrawlArticleSnapshot => Boolean(snapshot));
      } catch {
        return [] as FirecrawlArticleSnapshot[];
      }
    }),
  );

  const deduped = new Map<string, FirecrawlArticleSnapshot>();
  for (const group of groups) {
    for (const snapshot of group) {
      if (isLikelyHomepageUrl(snapshot.url)) continue;
      if (matchesResolvedEntityAvoidTerms(snapshot, understanding)) continue;
      if (!isEntityRelevantPredictionMarketSource(snapshot, task, understanding)) continue;
      if (!deduped.has(snapshot.url)) {
        deduped.set(snapshot.url, snapshot);
      }
    }
  }

  return selectPredictionMarketEvidenceWithHostDiversity(
    task,
    [...deduped.values()],
    4,
  );
}

async function fetchPredictionMarketSportsAuthorityEvidence(
  task: string,
  understanding: MarketUnderstanding | null,
): Promise<FirecrawlArticleSnapshot[]> {
  if (!/\bprediction market\b/i.test(task) || extractPredictionMarketCategory(task) !== 'sports') {
    return [];
  }

  const canonical = stripPredictionMarketIntentSuffix(
    understanding?.entity?.canonicalName || understanding?.subject || normalizeLiveDataSearchTask(task),
  );
  const competitionMeta = detectSportsCompetition(`${task} ${canonical}`);
  const competition = competitionMeta
    ? `${competitionMeta.league}${competitionMeta.season ? ` ${competitionMeta.season}` : ''}`
    : canonical;
  const queries: string[] = [];

  addUniqueQuery(queries, `site:theanalyst.com ${competition} prediction`);
  addUniqueQuery(queries, `site:theanalyst.com ${competition} winner odds`);
  addUniqueQuery(queries, `site:oddschecker.com ${competition} odds`);
  addUniqueQuery(queries, `site:oddschecker.com ${competition} winner odds`);
  addUniqueQuery(queries, `site:actionnetwork.com ${competition} odds`);
  addUniqueQuery(queries, `site:espn.com ${competition} odds`);
  addUniqueQuery(queries, `site:sportingnews.com ${competition} odds`);

  const fallbackUrls: string[] = [];
  if (/\bFIFA World Cup\b/i.test(competition)) {
    addUniqueQuery(fallbackUrls, 'https://www.foxsports.com/stories/soccer/world-cup-2026-champion-odds');
    addUniqueQuery(
      fallbackUrls,
      'https://www.espn.com/espn/betting/story/_/id/48386952/espn-soccer-futbol-world-cup-betting-odds-championship-groups',
    );
    addUniqueQuery(fallbackUrls, 'https://www.oddschecker.com/us/soccer/world-cup/winner');
    addUniqueQuery(fallbackUrls, 'https://www.oddschecker.com/us/soccer/world-cup');
    addUniqueQuery(
      fallbackUrls,
      'https://theanalyst.com/articles/fifa-world-cup-2026-groups-predictions-previews',
    );
    addUniqueQuery(fallbackUrls, 'https://www.covers.com/world-cup/odds');
    addUniqueQuery(fallbackUrls, 'https://www.cbssports.com/betting/news/world-cup-odds/');
  }

  const fallbackSnapshots = await Promise.all(
    fallbackUrls.slice(0, 7).map(async (url) => {
      try {
        const markdown = await fetchUrlViaFirecrawl(url);
        const summary = markdownToSnippet(markdown, 520);
        if (!summary) return null;
        const title =
          normalizeSourceText(markdown.match(/^#\s+(.+)$/m)?.[1] || '', {
            stripChrome: true,
            collapseWhitespace: true,
          }) || `${competition} odds and predictions`;
        const snapshot: FirecrawlArticleSnapshot = {
          title,
          url,
          publisher: extractHostname(url),
          summary,
        };
        return isEntityRelevantPredictionMarketSource(snapshot, task, understanding)
          ? snapshot
          : null;
      } catch {
        return null;
      }
    }),
  );
  if (process.env.RETR_DEBUG && fallbackUrls.length > 0) {
    const kept = fallbackSnapshots.filter(Boolean) as FirecrawlArticleSnapshot[];
    console.error(
      `[RETR][sports-fallback] competition="${competition}" urls=${fallbackUrls.length} kept=${kept.length} keptHosts=${kept
        .map((snapshot) => extractHostname(snapshot.url) || snapshot.url)
        .join(',')}`,
    );
  }

  const groups = await Promise.all(
    queries.slice(0, 6).map(async (query) => {
      try {
        const [firecrawlResults, searxngResults] = await Promise.allSettled([
          searchFirecrawlNews(query, 4, { recency: 'all' }),
          searchSearxng(query, 4, { timeoutMs: 10_000, categories: ['news'] }),
        ]);
        const merged = new Map<string, FirecrawlSearchResult>();
        for (const resultSet of [firecrawlResults, searxngResults]) {
          if (resultSet.status !== 'fulfilled') continue;
          for (const result of resultSet.value) {
            const url = result.url?.trim();
            if (!url || merged.has(url)) continue;
            merged.set(url, result);
          }
        }
        return [...merged.values()]
          .map((result) => buildFirecrawlSearchSnapshot(result))
          .filter((snapshot): snapshot is FirecrawlArticleSnapshot => Boolean(snapshot));
      } catch {
        return [] as FirecrawlArticleSnapshot[];
      }
    }),
  );

  const deduped = new Map<string, FirecrawlArticleSnapshot>();
  for (const snapshot of fallbackSnapshots) {
    if (!snapshot) continue;
    if (isLikelyHomepageUrl(snapshot.url)) continue;
    if (matchesResolvedEntityAvoidTerms(snapshot, understanding)) continue;
    if (!isEntityRelevantPredictionMarketSource(snapshot, task, understanding)) continue;
    deduped.set(snapshot.url, snapshot);
  }
  for (const group of groups) {
    for (const snapshot of group) {
      if (isLikelyHomepageUrl(snapshot.url)) continue;
      if (matchesResolvedEntityAvoidTerms(snapshot, understanding)) continue;
      if (!isEntityRelevantPredictionMarketSource(snapshot, task, understanding)) continue;
      if (!deduped.has(snapshot.url)) {
        deduped.set(snapshot.url, snapshot);
      }
    }
  }

  return selectPredictionMarketEvidenceWithHostDiversity(task, [...deduped.values()], 4);
}

function mergePredictionMarketCurrentEventSnapshots(
  task: string,
  currentEvents: CurrentEventsSnapshot | null,
  existing: FirecrawlArticleSnapshot[],
  understanding: MarketUnderstanding | null,
): FirecrawlArticleSnapshot[] {
  if (!/\bprediction market\b/i.test(task)) return existing;
  if (existing.length >= 4) return existing;

  const deduped = new Map<string, FirecrawlArticleSnapshot>();
  for (const snapshot of existing) {
    deduped.set(snapshot.url, snapshot);
  }
  for (const snapshot of currentEvents?.article_snapshots ?? []) {
    if (isGoogleNewsUrl(snapshot.url) || isGoogleConsentUrl(snapshot.url)) {
      if (process.env.RETR_DEBUG) {
        console.error(`[RETR][merge-current] skip google url=${snapshot.url}`);
      }
      continue;
    }
    if (!isEntityRelevantPredictionMarketSource(snapshot, task, understanding)) {
      if (process.env.RETR_DEBUG) {
        console.error(
          `[RETR][merge-current] skip entity gate url=${snapshot.url} title=${snapshot.title}`,
        );
      }
      continue;
    }
    if (!deduped.has(snapshot.url)) {
      deduped.set(snapshot.url, snapshot);
    }
  }
  const merged = [...deduped.values()];
  if (merged.length === existing.length) return existing;

  return selectPredictionMarketEvidenceWithHostDiversity(
    task,
    filterPredictionMarketResearchEvidence(
      task,
      [...new Map(merged.map((snapshot) => [snapshot.url, snapshot])).values()],
      understanding,
    ),
    PREDICTION_MARKET_EVIDENCE_LIMIT,
  );
}

async function recoverPredictionMarketSnapshotsFromCurrentEvents(
  task: string,
  currentEvents: CurrentEventsSnapshot | null,
  understanding: MarketUnderstanding | null,
): Promise<FirecrawlArticleSnapshot[]> {
  if (!/\bprediction market\b/i.test(task)) return [];
  const articles = currentEvents?.articles ?? [];
  if (articles.length === 0) return [];

  const recovered = await Promise.all(
    articles.slice(0, 6).map(async (article) => {
      const rawUrl = article.article_url?.trim() || article.url?.trim() || '';
      if (!rawUrl) return null;
      const resolvedUrl = await resolveArticleUrl(rawUrl);
      const directUrl =
        resolvedUrl && !isGoogleNewsUrl(resolvedUrl) && !isLikelyHomepageUrl(resolvedUrl)
          ? resolvedUrl
          : await recoverDirectArticleUrlFromSearch({
              title: article.title,
              publisher: article.publisher,
              domain: article.domain,
            });
      const usableUrl = directUrl || (isGoogleNewsUrl(rawUrl) ? '' : rawUrl);
      if (!usableUrl || isLikelyHomepageUrl(usableUrl)) {
        if (process.env.RETR_DEBUG) {
          console.error(
            `[RETR][recover-current] unusable raw=${rawUrl} resolved=${resolvedUrl || ''} direct=${directUrl || ''}`,
          );
        }
        return null;
      }
      const snapshot: FirecrawlArticleSnapshot = {
        title: article.title,
        url: usableUrl,
        publisher: article.publisher || article.domain,
        seen_at: article.seen_at,
        summary: article.title,
      };
      if (matchesResolvedEntityAvoidTerms(snapshot, understanding)) {
        if (process.env.RETR_DEBUG) {
          console.error(
            `[RETR][recover-current] avoidTerms url=${usableUrl} title=${article.title}`,
          );
        }
        return null;
      }
      if (!isEntityRelevantPredictionMarketSource(snapshot, task, understanding)) {
        if (process.env.RETR_DEBUG) {
          console.error(
            `[RETR][recover-current] entityGate url=${usableUrl} title=${article.title}`,
          );
        }
        return null;
      }
      return snapshot;
    }),
  );

  const deduped = new Map<string, FirecrawlArticleSnapshot>();
  for (const snapshot of recovered) {
    if (!snapshot || deduped.has(snapshot.url)) continue;
    deduped.set(snapshot.url, snapshot);
  }
  return [...deduped.values()];
}

async function enrichPredictionMarketSnapshotsFromPages(
  task: string,
  understanding: MarketUnderstanding | null,
  snapshots: FirecrawlArticleSnapshot[],
): Promise<FirecrawlArticleSnapshot[]> {
  if (!/\bprediction market\b/i.test(task)) return snapshots;
  if (snapshots.length === 0) return snapshots;

  const candidates = snapshots
    .filter((snapshot) => !isLikelyHomepageUrl(snapshot.url))
    .filter((snapshot) => !isLowValueSocialSourceUrl(snapshot.url))
    .slice(0, 6);

  const enriched = await Promise.all(
    candidates.map(async (snapshot) => {
      try {
        const markdown = await fetchUrlViaFirecrawl(snapshot.url);
        const summary = markdownToSnippet(markdown, 520);
        if (!summary) return snapshot;
        const title =
          normalizeSourceText(markdown.match(/^#\s+(.+)$/m)?.[1] || '', {
            stripChrome: true,
            collapseWhitespace: true,
          }) || snapshot.title;
        const enrichedSnapshot: FirecrawlArticleSnapshot = {
          ...snapshot,
          title,
          summary,
        };
        if (matchesResolvedEntityAvoidTerms(enrichedSnapshot, understanding)) {
          return null;
        }
        return enrichedSnapshot;
      } catch {
        return snapshot;
      }
    }),
  );

  const merged = new Map<string, FirecrawlArticleSnapshot>();
  for (const snapshot of snapshots) {
    merged.set(snapshot.url, snapshot);
  }
  for (const snapshot of enriched) {
    if (!snapshot) continue;
    merged.set(snapshot.url, snapshot);
  }
  return [...merged.values()];
}

function splitExpandedTaskQueries(task: string): string[] {
  const normalizedInput =
    task.includes('|') || !/\bprediction market\b/i.test(task)
      ? task
      : normalizeLiveDataSearchTask(task);

  return normalizedInput
    .split('|')
    .map((query) => normalizeLiveDataSearchTask(query))
    .map((query) => query.trim())
    .filter(Boolean);
}

function addUniqueQuery(queries: string[], query: string | undefined): void {
  const value = query?.replace(/\s+/g, ' ').trim();
  if (!value || queries.includes(value)) return;
  queries.push(value);
}

function buildPredictionMarketResearchBrief(
  task: string,
  understanding: MarketUnderstanding | null,
): Record<string, unknown> | null {
  if (!/\bprediction market\b/i.test(task)) return null;
  return {
    query: cleanPredictionMarketResearchTaskForSearch(task),
    subject: understanding?.subject ?? null,
    underlying: understanding?.underlying ?? null,
    question_type: understanding?.questionType ?? null,
    resolution_date: understanding?.resolutionDate ?? null,
    listed_outcomes: extractPredictionMarketListedOutcomes(task),
    category: extractPredictionMarketCategory(task),
    provider: extractPredictionMarketProvider(task),
    entity: understanding?.entity ?? null,
    avoid_drift: true,
  };
}

function buildPredictionMarketSearchSeed(
  task: string,
  understanding: MarketUnderstanding | null,
): string {
  if (!understanding) {
    // No LLM understanding (timeout / parse failure). Do NOT dump the literal
    // "Will X reach $Y by <date>?" sentence into search — that retrieves little and is the
    // ambiguous-fallthrough case that produced false "thin evidence". Derive subject-scoped
    // queries deterministically; fall back to the cleaned task only if the subject can't be
    // isolated (e.g. sports markets, which get their own query builder downstream).
    const cleaned = normalizeLiveDataSearchTask(task);
    const subjectQueries = buildPredictionMarketEntityQueries(task, cleaned, null);
    return subjectQueries.length > 0 ? subjectQueries.join(' | ') : cleaned || task;
  }

  const cleaned = normalizeLiveDataSearchTask(task);
  const queries = [...buildPredictionMarketDiscoveryQueries(task, understanding), ...understanding.searchQueries];
  for (const query of buildPredictionMarketEntityQueries(task, cleaned, understanding)) {
    addUniqueQuery(queries, query);
  }
  const entity = understanding.entity;
  if (entity?.canonicalName) {
    addUniqueQuery(queries, `${entity.canonicalName} latest news`);
    addUniqueQuery(queries, `${entity.canonicalName} official announcement`);
  }
  for (const domain of entity?.officialDomains ?? []) {
    const canonical = entity?.canonicalName || understanding.subject;
    addUniqueQuery(queries, `site:${domain} ${canonical}`);
    if (/\b(mainnet|launch|release)\b/i.test(understanding.subject)) {
      addUniqueQuery(queries, `site:${domain} ${canonical} roadmap`);
      addUniqueQuery(queries, `site:${domain} ${canonical} announcement`);
    }
  }
  if (understanding.underlying) {
    addUniqueQuery(queries, `${understanding.underlying} latest`);
    addUniqueQuery(queries, `${understanding.underlying} analysis`);
  }
  if (/\bworld cup|fifa\b/i.test(understanding.subject)) {
    addUniqueQuery(queries, 'site:fifa.com FIFA World Cup 2026');
    addUniqueQuery(queries, 'FIFA World Cup 2026 favorites odds');
    addUniqueQuery(queries, 'site:theanalyst.com FIFA World Cup 2026 prediction');
    addUniqueQuery(queries, 'site:oddschecker.com FIFA World Cup 2026 odds');
  }
  if (/\bxaut|tether gold\b/i.test(understanding.subject)) {
    addUniqueQuery(queries, 'site:kitco.com gold price forecast');
    addUniqueQuery(queries, 'site:reuters.com gold prices');
    addUniqueQuery(queries, 'site:lbma.org.uk gold market');
    addUniqueQuery(queries, 'spot gold latest news');
    addUniqueQuery(queries, 'gold market outlook 2026');
    addUniqueQuery(queries, 'world gold council gold outlook');
  }
  if (/\bgta\b|\bgrand theft auto\b/i.test(understanding.subject)) {
    addUniqueQuery(queries, 'site:rockstargames.com GTA 6');
    addUniqueQuery(queries, 'site:take2games.com Grand Theft Auto VI');
    addUniqueQuery(queries, 'site:businesswire.com Take-Two Grand Theft Auto VI');
  }
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].join(' | ');
}

function matchesResolvedEntityAvoidTerms(
  snapshot: FirecrawlArticleSnapshot,
  understanding: MarketUnderstanding | null,
): boolean {
  const avoidTerms = understanding?.entity?.avoidTerms ?? [];
  if (avoidTerms.length === 0) return false;
  const haystack =
    `${snapshot.title} ${snapshot.summary} ${snapshot.publisher || ''} ${snapshot.url}`.toLowerCase();
  return avoidTerms.some((term) => term && haystack.includes(term.toLowerCase()));
}

const PREDICTION_MARKET_ENTITY_TOKEN_STOP_WORDS = new Set([
  'will',
  'before',
  'after',
  'between',
  'reach',
  'hit',
  'launch',
  'release',
  'mainnet',
  'win',
  'winner',
  'price',
  'target',
  'protocol',
  'network',
  'blockchain',
  'coin',
  'token',
  'cryptocurrency',
  'team',
  'season',
  'finals',
  'final',
  'playoffs',
  'official',
  'announcement',
  'latest',
  'market',
  'markets',
  'capitalization',
  'cap',
  'trillion',
]);

function isPredictionMarketCategoryAuthorityHost(task: string, hostname: string): boolean {
  const category = extractPredictionMarketCategory(task);
  if (category === 'sports') {
    return /\b(espn\.com|nba\.com|nfl\.com|mlb\.com|nhl\.com|cbssports\.com|foxsports\.com|sportingnews\.com|theanalyst\.com|oddschecker\.com|actionnetwork\.com|covers\.com|draftkings\.com|fanduel\.com|vegasinsider\.com|sports\.yahoo\.com|si\.com|rotowire\.com|fifa\.com|uefa\.com)\b/i.test(
      hostname,
    );
  }
  if (category === 'games' || category === 'gaming') {
    return /\b(rockstargames\.com|take2games\.com|ign\.com|gamespot\.com|polygon\.com|eurogamer\.net|kotaku\.com|businesswire\.com|reuters\.com|playstation\.com|xbox\.com|steampowered\.com|gamingbolt\.com)\b/i.test(
      hostname,
    );
  }
  if (category === 'crypto') {
    return /\b(coingecko\.com|coinmarketcap\.com|defillama\.com|theblock\.co|coindesk\.com|cointelegraph\.com|decrypt\.co|binance\.com|coinbase\.com|kraken\.com|reuters\.com|bloomberg\.com|wsj\.com|ft\.com|kitco\.com|lbma\.org\.uk|cmegroup\.com|circle\.com|arc\.io|arc\.network)\b/i.test(
      hostname,
    );
  }
  return false;
}

function extractPredictionMarketEntityPhrases(
  understanding: MarketUnderstanding | null,
): string[] {
  if (!understanding?.entity) return [];
  return [
    understanding.entity.canonicalName,
    ...understanding.entity.aliases,
    understanding.subject,
    understanding.underlying,
  ]
    .map((value) => value?.replace(/\s+/g, ' ').trim() || '')
    .filter(Boolean)
    .slice(0, 12);
}

function extractPredictionMarketEntityTokens(
  understanding: MarketUnderstanding | null,
): string[] {
  if (!understanding?.entity) return [];
  const tokens = new Set<string>();
  for (const phrase of extractPredictionMarketEntityPhrases(understanding)) {
    for (const token of phrase
      .replace(/[()'",.:;/?-]/g, ' ')
      .split(/\s+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)) {
      if (/^\d+$/.test(token)) continue;
      if (/^(?:19|20)\d{2}$/.test(token)) continue;
      if (token.length < 3 && !/^[a-z]{2,10}$/i.test(token)) continue;
      if (PREDICTION_MARKET_ENTITY_TOKEN_STOP_WORDS.has(token)) continue;
      tokens.add(token);
    }
  }
  return [...tokens].slice(0, 12);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countDistinctPredictionMarketEntityTokenMatches(
  haystack: string,
  understanding: MarketUnderstanding | null,
): number {
  let matches = 0;
  for (const token of extractPredictionMarketEntityTokens(understanding)) {
    if (new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(haystack)) {
      matches += 1;
    }
  }
  return matches;
}

function hasStrongPredictionMarketPhraseMatch(
  haystack: string,
  understanding: MarketUnderstanding | null,
): boolean {
  return extractPredictionMarketEntityPhrases(understanding).some((phrase) => {
    const normalized = phrase.toLowerCase();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount < 2) return false;
    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'i').test(haystack);
  });
}

function hasPredictionMarketSportsContext(haystack: string): boolean {
  return /\b(nba|nfl|mlb|nhl|uefa|fifa|champions league|world cup|finals|playoffs|season|standings|odds|injury|injuries|roster|coach|game|match|series|championship|title|team|player)\b/i.test(
    haystack,
  );
}

/**
 * Category-consistent CONTENT terms that real coverage of the resolved subject carries but a
 * same-named homonym does not — used to rescue obscure single-word entities (e.g. "Monad" the
 * blockchain) from the strict token-count thresholds without reopening drift. Intentionally
 * excludes generic words like "protocol"/"token"/"quantum" that leak into hardware/quantum
 * docs, so it admits Monad-the-blockchain while still rejecting Monad-the-FP-concept,
 * curacao.com, and Xilinx Zynq pages.
 */
function hasPredictionMarketCategoryContentSignal(haystack: string, task: string): boolean {
  const category = extractPredictionMarketCategory(task);
  if (category === 'crypto' || /\b(mainnet|testnet|blockchain)\b/i.test(task)) {
    return /\b(blockchain|mainnet|testnet|layer[- ]?1|l1|evm|web3|defi|cryptocurrency|crypto|tokenomics|staking|validator|on-chain|rollup|smart contract|stablecoin|consensus mechanism)\b/i.test(
      haystack,
    );
  }
  if (category === 'games' || category === 'gaming') {
    return /\b(release date|gameplay|trailer|developer|publisher|game studio|console|playstation|ps5|xbox|steam|launch trailer)\b/i.test(
      haystack,
    );
  }
  return false;
}

function hasPredictionMarketEditorialArticleSignal(snapshot: FirecrawlArticleSnapshot, task: string): boolean {
  const parsed = parseSnapshotUrl(snapshot);
  const hostname = normalizedHostnameFromUrl(parsed);
  const haystack = `${snapshot.title} ${snapshot.summary} ${snapshot.publisher || ''}`.toLowerCase();
  if (extractPredictionMarketCategory(task) === 'crypto') {
    const strongEditorialHost =
      /\b(coindesk\.com|theblock\.co|decrypt\.co|forbes\.com|reuters\.com|bloomberg\.com|wsj\.com|ft\.com|cointelegraph\.com|blockworks\.co|bankless\.com|messari\.io|coinmetrics\.io|glassnode\.com)\b/i.test(
        hostname,
      );
    const articleStyle =
      hasArticleLikePath(snapshot) ||
      /\b(news|analysis|report|insight|editorial|market analysis|etf|macro|flows|institutional)\b/i.test(
        haystack,
      );
    return strongEditorialHost && articleStyle;
  }
  return false;
}

function hasMeaningfulUnderlyingMatch(
  haystack: string,
  understanding: MarketUnderstanding | null,
): boolean {
  if (!understanding?.underlying) return false;
  const normalized = understanding.underlying.toLowerCase().trim();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'i').test(haystack);
  }
  if (normalized.length < 4) return false;
  return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'i').test(haystack);
}

function isEntityRelevantPredictionMarketSource(
  snapshot: FirecrawlArticleSnapshot,
  task: string,
  understanding: MarketUnderstanding | null,
): boolean {
  if (!understanding?.entity) return true;
  const parsed = parseSnapshotUrl(snapshot);
  const hostname = normalizedHostnameFromUrl(parsed);
  const haystack =
    `${snapshot.title} ${snapshot.summary} ${snapshot.publisher || ''} ${snapshot.url}`.toLowerCase();
  if (!haystack.trim()) return false;
  if (matchesResolvedEntityAvoidTerms(snapshot, understanding)) return false;

  if (
    understanding.entity.officialDomains.some(
      (domain) => domain && hostnameMatches(hostname, domain.toLowerCase()),
    )
  ) {
    return true;
  }

  if (hasStrongPredictionMarketPhraseMatch(haystack, understanding)) {
    return true;
  }

  const distinctTokenMatches = countDistinctPredictionMarketEntityTokenMatches(
    haystack,
    understanding,
  );
  const authoritativeCategorySource = isPredictionMarketCategoryAuthorityHost(task, hostname);
  const underlyingMatch = hasMeaningfulUnderlyingMatch(haystack, understanding);
  const canonicalWords = understanding.entity.canonicalName
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const canonicalSingleToken = canonicalWords.length === 1;
  const sportsTask = extractPredictionMarketCategory(task) === 'sports';
  const sportsContext = hasPredictionMarketSportsContext(haystack);
  const sportsWinnerMarket = isSportsWinnerPredictionMarketTask(task, understanding);

  if (!sportsTask && authoritativeCategorySource && (distinctTokenMatches >= 1 || underlyingMatch)) {
    return true;
  }

  if (sportsTask) {
    if (!sportsContext) return false;
    if (sportsWinnerMarket && !hasSportsWinnerMarketEvidenceSignal(haystack)) {
      return false;
    }
    if (
      sportsWinnerMarket &&
      hasSportsWinnerMarketMatchNoiseSignal(haystack) &&
      !/\b(winner odds|outright|favorites|power rankings|team rankings|re-ranking|re-rank|contender|contenders)\b/i.test(
        haystack,
      )
    ) {
      return false;
    }
    return distinctTokenMatches >= 2 || hasStrongPredictionMarketPhraseMatch(haystack, understanding);
  }

  if (canonicalSingleToken) {
    // A one-word entity (e.g. "Monad") can NEVER reach distinctTokenMatches >= 2, so the
    // thresholds below silently reject all real coverage except official-domain and
    // category-authority hosts — that is why an obscure crypto launch surfaced only
    // CoinMarketCap. Rescue sources that name the canonical entity AND carry strong
    // category-consistent content (crypto/games terms); the homonym pages do not.
    const canonicalToken = canonicalWords[0];
    const canonicalTokenMatch = canonicalToken
      ? new RegExp(`\\b${escapeRegExp(canonicalToken)}\\b`, 'i').test(haystack)
      : false;
    if (canonicalTokenMatch && hasPredictionMarketCategoryContentSignal(haystack, task)) {
      return true;
    }
    if (understanding.entity.ambiguity === 'low') {
      return distinctTokenMatches >= 2 || underlyingMatch;
    }
    return distinctTokenMatches >= 2 && (underlyingMatch || authoritativeCategorySource);
  }

  if (understanding.entity.ambiguity === 'high') {
    return distinctTokenMatches >= 2;
  }
  if (understanding.entity.ambiguity === 'medium') {
    return distinctTokenMatches >= 2;
  }
  return distinctTokenMatches >= 1 || underlyingMatch;
}

function resolvedEntitySourceBoost(
  snapshot: FirecrawlArticleSnapshot,
  understanding: MarketUnderstanding | null,
): number {
  if (!understanding?.entity) return 0;
  const haystack =
    `${snapshot.title} ${snapshot.summary} ${snapshot.publisher || ''} ${snapshot.url}`.toLowerCase();
  let score = 0;
  for (const domain of understanding.entity.officialDomains) {
    if (domain && haystack.includes(domain.toLowerCase())) score += 24;
  }
  if (haystack.includes(understanding.entity.canonicalName.toLowerCase())) score += 24;
  for (const alias of understanding.entity.aliases) {
    if (alias && haystack.includes(alias.toLowerCase())) score += 12;
  }
  if (understanding.underlying && haystack.includes(understanding.underlying.toLowerCase())) {
    score += 14;
  }
  if (matchesResolvedEntityAvoidTerms(snapshot, understanding)) score -= 150;
  return score;
}

function buildPredictionMarketSourceDiagnostics(
  task: string,
  understanding: MarketUnderstanding | null,
  snapshots: FirecrawlArticleSnapshot[],
  backendDiagnostics: SearchBackendDiagnostic[] = [],
): Record<string, unknown> | null {
  if (!/\bprediction market\b/i.test(task)) return null;
  const diversityKeyForSnapshot = (snapshot: FirecrawlArticleSnapshot): string => {
    const host = sourceHostname(snapshot.url);
    if (host && host !== 'news.google.com') return host;
    const publisher = (snapshot.publisher || '')
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\s+/g, ' ')
      .trim();
    return publisher || host;
  };
  const hosts = new Set(
    snapshots
      .map((snapshot) => diversityKeyForSnapshot(snapshot))
      .filter(Boolean),
  );
  const officialDomains = understanding?.entity?.officialDomains ?? [];
  const hasOfficialMatch = snapshots.some((snapshot) =>
    officialDomains.some((domain) =>
      `${snapshot.publisher || ''} ${snapshot.url}`.toLowerCase().includes(domain.toLowerCase()),
    ),
  );
  const authoritativeCategoryMatches = snapshots.filter((snapshot) =>
    isPredictionMarketCategoryAuthorityHost(
      task,
      normalizedHostnameFromUrl(parseSnapshotUrl(snapshot)),
    ),
  ).length;
  const relevantEntityMatches = snapshots.filter((snapshot) =>
    isEntityRelevantPredictionMarketSource(snapshot, task, understanding),
  ).length;
  const drifted = snapshots.some((snapshot) => matchesResolvedEntityAvoidTerms(snapshot, understanding));
  const diversity = hosts.size >= 2 ? 'sufficient' : 'insufficient';
  const unresolvedEntity =
    Boolean(understanding?.entity) &&
    ((snapshots.length > 0 && relevantEntityMatches === 0) ||
      (snapshots.length === 0 && understanding?.entity?.ambiguity === 'high'));
  const backendFailures = backendDiagnostics
    .filter((backend) => backend.status === 'unavailable' || backend.status === 'degraded')
    .map((backend) =>
      backend.lastError
        ? `${backend.provider}: ${backend.lastError}`
        : `${backend.provider}: unavailable`,
    );
  const searchBackendUnhealthy =
    backendDiagnostics.length > 0 &&
    backendDiagnostics.every((backend) => backend.status === 'unavailable' || backend.status === 'degraded');
  const driftRisk = drifted
    ? 'high'
    : unresolvedEntity
      ? 'high'
    : understanding?.entity?.ambiguity === 'high'
      ? 'high'
      : understanding?.entity?.ambiguity === 'medium' && !hasOfficialMatch
        ? 'medium'
        : diversity === 'insufficient'
          ? 'medium'
          : 'low';
  return {
    source_diversity: diversity,
    unique_source_domains: hosts.size,
    has_official_match: hasOfficialMatch,
    authoritative_category_matches: authoritativeCategoryMatches,
    relevant_entity_matches: relevantEntityMatches,
    unresolved_entity: unresolvedEntity,
    drift_risk: driftRisk,
    entity_ambiguity: understanding?.entity?.ambiguity ?? null,
    search_backend_unhealthy: searchBackendUnhealthy,
    search_backend_failures: backendFailures,
    search_backends: backendDiagnostics,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isArcNetworkTask(task: string): boolean {
  return /\barc network\b|\barc blockchain\b|\barc testnet\b|\barc ecosystem\b/i.test(task);
}

function buildResearchQueryVariants(task: string): string[] {
  const cleanedTask = normalizeLiveDataSearchTask(task);
  const sportsPredictionQueries = buildSportsPredictionMarketQueries(task, cleanedTask);
  if (sportsPredictionQueries.length > 0) {
    return sportsPredictionQueries;
  }
  const queries: string[] = [];
  for (const subjectQuery of buildPredictionMarketEntityQueries(task, cleanedTask, null)) {
    addUniqueQuery(queries, subjectQuery);
  }
  const splitQueries = splitExpandedTaskQueries(cleanedTask);

  for (const variant of splitQueries) {
    const stripped = stripFirecrawlResearchScaffolding(variant);
    const expanded = expandFirecrawlCryptoSymbols(stripped || variant);
    const normalized = normalizeCurrentEventQuery(expanded || stripped || variant);
    const primary = normalized || expanded || stripped || variant;
    addUniqueQuery(queries, primary);
    addUniqueQuery(queries, normalizeCurrentEventQuery(primary));
    for (const enrichmentVariant of buildCurrentStateFirecrawlVariants(primary)) {
      addUniqueQuery(queries, enrichmentVariant);
    }
  }

  if (splitQueries.length === 0) {
    const stripped = stripFirecrawlResearchScaffolding(cleanedTask);
    const expanded = expandFirecrawlCryptoSymbols(stripped || cleanedTask);
    const normalized = normalizeCurrentEventQuery(expanded || stripped || cleanedTask);
    const primary = normalized || expanded || stripped || cleanedTask;
    addUniqueQuery(queries, primary);
    for (const enrichmentVariant of buildCurrentStateFirecrawlVariants(primary)) {
      addUniqueQuery(queries, enrichmentVariant);
    }
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

  return queries.slice(0, 16);
}

const FIRECRAWL_SCAFFOLDING_PREFIXES: RegExp[] = [
  /^\s*(?:make|write|create|generate|prepare|give)(?:\s+(?:me|us))?(?:\s+a)?\s+research\s+on\s+/i,
  /^\s*research\s+on\s+/i,
  /^\s*research\s+/i,
  /^\s*tell\s+me\s+about\s+/i,
  /^\s*what\s+is\s+/i,
  /^\s*give\s+me\s+(?:a\s+)?report\s+on\s+/i,
  /^\s*report\s+on\s+/i,
  /^\s*analy[sz]e\s+/i,
  /^\s*analysis\s+of\s+/i,
  /^\s*brief\s+on\s+/i,
];

const FIRECRAWL_SYMBOL_EXPANSIONS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bbtc\b/gi, replacement: 'bitcoin' },
  { pattern: /\beth\b/gi, replacement: 'ethereum' },
  { pattern: /\bsol\b/gi, replacement: 'solana' },
  { pattern: /\bbnb\b/gi, replacement: 'binance coin' },
  { pattern: /\bxrp\b/gi, replacement: 'ripple' },
];

export type ForecastingIntent = {
  forecasting: boolean;
  horizonLabel?: string;
  targetYear?: number;
};

function stripFirecrawlResearchScaffolding(task: string): string {
  let stripped = stripExecutionContext(task);
  for (const pattern of FIRECRAWL_SCAFFOLDING_PREFIXES) {
    stripped = stripped.replace(pattern, '');
  }
  return stripped.replace(/\s+/g, ' ').trim();
}

function expandFirecrawlCryptoSymbols(task: string): string {
  let expanded = task;
  for (const rule of FIRECRAWL_SYMBOL_EXPANSIONS) {
    expanded = expanded.replace(rule.pattern, rule.replacement);
  }
  return expanded.replace(/\s+/g, ' ').trim();
}

function singularizeForecastUnit(unit: string): string {
  return unit.replace(/s$/i, '');
}

export function detectForecastingIntent(task: string): ForecastingIntent {
  const lower = task.toLowerCase();
  const currentYear = new Date().getUTCFullYear();

  const horizonMatch =
    lower.match(/\bover the next\s+(\d+)\s+(years?|months?|decades?)\b/) ||
    lower.match(/\bwhere will .+? be in\s+(\d+)\s+(years?|months?|decades?)\b/) ||
    lower.match(/\bin\s+(\d+)\s+(years?|months?)\b/) ||
    lower.match(/\bnext\s+(\d+)\s+(years?|months?|decades?)\b/);
  if (horizonMatch) {
    const amount = Number(horizonMatch[1]);
    const unit = singularizeForecastUnit(horizonMatch[2]);
    if (Number.isFinite(amount) && amount > 0) {
      const targetYear =
        unit === 'year' ? currentYear + amount : unit === 'decade' ? currentYear + amount * 10 : undefined;
      return {
        forecasting: true,
        horizonLabel: `${amount} ${amount === 1 ? unit : `${unit}s`}`,
        targetYear,
      };
    }
  }

  const explicitYearMatch = lower.match(/\bby\s+(20\d{2}|21\d{2})\b/);
  if (explicitYearMatch) {
    const targetYear = Number(explicitYearMatch[1]);
    return {
      forecasting: true,
      horizonLabel: `by ${targetYear}`,
      targetYear,
    };
  }

  if (
    /\b(long[\s-]?term\s+(?:outlook|forecast))\b/.test(lower) ||
    /\bfuture of\b/.test(lower) ||
    /\bprice prediction\b/.test(lower) ||
    /\bgrowth potential\b/.test(lower) ||
    /\bforecast\b/.test(lower) ||
    /\bprojection\b/.test(lower)
  ) {
    return { forecasting: true };
  }

  // Price-target / dated questions are forecasts even without an explicit year, e.g.
  // "will X reach $4,750 by July 31st" or "hit $100k". The previous logic only matched
  // "by <year>", so these were treated as plain news and restricted to last-week results.
  const priceTarget = /\b(reach|hit|exceed|surpass|cross|climb to|rise to|fall to|drop to|top)\b[^.]*\$?\d/.test(lower);
  const datedDeadline =
    /\bby\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(lower) ||
    /\b(?:before|after)\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(lower);
  if (priceTarget || datedDeadline) {
    return { forecasting: true };
  }

  return { forecasting: false };
}

function buildForecastingEntityQuery(baseQuery: string): string {
  return baseQuery
    .replace(/\bover the next\s+\d+\s+(?:year|years|month|months|decade|decades)\b/gi, '')
    .replace(/\bwhere will\s+/gi, '')
    .replace(/\bbe in\s+\d+\s+(?:year|years|month|months|decade|decades)\b/gi, '')
    .replace(/\bin\s+\d+\s+(?:year|years|month|months)\b/gi, '')
    .replace(/\bnext\s+\d+\s+(?:year|years|month|months|decade|decades)\b/gi, '')
    .replace(/\bnext decade\b/gi, '')
    .replace(/\bby\s+(?:20\d{2}|21\d{2})\b/gi, '')
    .replace(/\blong[\s-]?term\s+(?:outlook|forecast)\b/gi, '')
    .replace(/\bfuture of\b/gi, '')
    .replace(/\bprice prediction\b/gi, '')
    .replace(/\bgrowth potential\b/gi, '')
    .replace(/\bforecast\b/gi, '')
    .replace(/\bprojection\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildForecastingFirecrawlVariants(baseQuery: string, intent: ForecastingIntent): string[] {
  const variants: string[] = [];
  const entityQuery = buildForecastingEntityQuery(baseQuery) || baseQuery;
  const lowerEntity = entityQuery.toLowerCase();
  const targetYear = intent.targetYear;

  if (targetYear && /\b(bitcoin|ethereum|solana|binance coin|ripple)\b/.test(lowerEntity)) {
    addUniqueQuery(variants, `${entityQuery} price prediction ${targetYear}`);
  } else if (/\bprice prediction\b/i.test(baseQuery) && targetYear) {
    addUniqueQuery(variants, `${entityQuery} price prediction ${targetYear}`);
  } else if (/\b(bitcoin|ethereum|solana|binance coin|ripple)\b/.test(lowerEntity)) {
    addUniqueQuery(variants, `${entityQuery} price prediction`);
  }

  addUniqueQuery(variants, `${entityQuery} long term forecast`);
  if (intent.horizonLabel) {
    addUniqueQuery(variants, `${entityQuery} ${intent.horizonLabel} outlook`);
  } else {
    addUniqueQuery(variants, `${entityQuery} future outlook`);
  }
  addUniqueQuery(variants, `${entityQuery} growth potential`);

  if (/\bbitcoin\b/.test(lowerEntity)) {
    addUniqueQuery(variants, 'bitcoin halving cycle analysis');
  }

  if (/\bxaut\b|\btether gold\b|\bgold\b/.test(lowerEntity)) {
    addUniqueQuery(variants, `gold price forecast ${targetYear || new Date().getUTCFullYear()}`);
    addUniqueQuery(variants, 'spot gold price latest');
    addUniqueQuery(variants, 'site:kitco.com gold price forecast');
    addUniqueQuery(variants, 'site:lbma.org.uk gold market');
    addUniqueQuery(variants, 'site:reuters.com gold prices');
  }

  return variants;
}

function buildCurrentStateFirecrawlVariants(baseQuery: string): string[] {
  const variants: string[] = [];
  const lower = baseQuery.toLowerCase();
  const broadAssetLike =
    /^(bitcoin|ethereum|solana|binance coin|ripple)\b/.test(lower) ||
    /\b(bitcoin|ethereum|solana|binance coin|ripple)\b/.test(lower);
  const creatorAudienceLike = isCreatorAudienceMetricTask(baseQuery);

  if (broadAssetLike) {
    addUniqueQuery(variants, `${baseQuery} market analysis`);
    addUniqueQuery(variants, `${baseQuery} news ${new Date().getUTCFullYear()}`);
    addUniqueQuery(variants, `site:coindesk.com ${baseQuery} news`);
    addUniqueQuery(variants, `site:theblock.co ${baseQuery} analysis`);
    addUniqueQuery(variants, `site:decrypt.co ${baseQuery} news`);
    addUniqueQuery(variants, `site:reuters.com ${baseQuery} crypto`);
  } else if (creatorAudienceLike) {
    addUniqueQuery(variants, `${baseQuery} current subscriber count`);
    addUniqueQuery(variants, `${baseQuery} live subscriber count`);
    addUniqueQuery(variants, `${baseQuery} official YouTube channel subscribers`);
    addUniqueQuery(variants, `${baseQuery} SocialBlade subscribers`);
  } else if (/\bmainnet\b|\blaunch\b/i.test(baseQuery)) {
    addUniqueQuery(variants, `${baseQuery} official announcement`);
    addUniqueQuery(variants, `${baseQuery} roadmap`);
    addUniqueQuery(variants, `${baseQuery} latest news`);
    if (isArcNetworkTask(baseQuery)) {
      addUniqueQuery(variants, 'ARC Network crypto');
      addUniqueQuery(variants, 'ARC Network blockchain');
      addUniqueQuery(variants, 'Circle Arc blockchain');
      addUniqueQuery(variants, 'ARC stablecoin-native L1 blockchain');
      addUniqueQuery(variants, 'site:arc.network ARC Network mainnet');
      addUniqueQuery(variants, 'site:arc.network ARC Network testnet mainnet');
      addUniqueQuery(variants, 'site:arc.network ARC Network launch');
      addUniqueQuery(variants, 'site:circle.com ARC Network blockchain');
      addUniqueQuery(variants, 'site:arc.io ARC stablecoin-native L1 blockchain');
    }
    if (/\bgta\s*6\b|\bgrand theft auto\s*(?:6|vi)\b/i.test(baseQuery)) {
      addUniqueQuery(variants, 'site:rockstargames.com GTA 6 release date');
      addUniqueQuery(variants, 'site:rockstargames.com Grand Theft Auto VI');
      addUniqueQuery(variants, 'site:take2games.com Grand Theft Auto VI release');
      addUniqueQuery(variants, 'Rockstar Games GTA 6 release date latest');
    }
  } else if (/\blandscape\b|\becosystem\b/i.test(baseQuery)) {
    addUniqueQuery(variants, `${baseQuery} analysis`);
  }

  return variants;
}

export function buildPrimaryFirecrawlQueryVariants(
  task: string,
  contextTask = task,
  understanding?: MarketUnderstanding | null,
): string[] {
  const cleanedContextTask = normalizeLiveDataSearchTask(contextTask);
  const sportsPredictionQueries = buildSportsPredictionMarketQueries(
    contextTask,
    cleanedContextTask,
    understanding ?? null,
  );
  if (sportsPredictionQueries.length > 0) {
    return sportsPredictionQueries;
  }
  const splitQueries = splitExpandedTaskQueries(task);
  const normalizedTask = normalizeLiveDataSearchTask(task);
  const category = extractPredictionMarketCategory(contextTask) || extractPredictionMarketCategory(task);
  const isPredictionTask =
    /\bprediction market\b/i.test(contextTask) || /\bprediction market\b/i.test(task);
  const predictionLaunchTask =
    isPredictionTask && /\b(launch|release|ship|come out|debut|available|mainnet)\b/i.test(contextTask);
  const baseQueries =
    splitQueries.length > 0
      ? splitQueries
      : [normalizedTask || cleanedContextTask];
  const queries: string[] = [];
  const subjectQueries = buildPredictionMarketSubjectQueries(
    contextTask,
    cleanedContextTask,
    understanding ?? null,
  );
  const entityQueries = isPredictionTask
    ? buildPredictionMarketEntityQueries(
        contextTask,
        cleanedContextTask,
        understanding ?? null,
      )
    : [];
  const discoveryQueries = isPredictionTask
    ? buildPredictionMarketDiscoveryQueries(contextTask, understanding ?? null)
    : [];

  // Lead with subject-scoped queries for non-sports prediction markets so retrieval is
  // about the market's actual subject, not the literal "Will X by <date>?" phrasing.
  if (isPredictionTask) {
    for (const subjectQuery of subjectQueries) {
      addUniqueQuery(queries, subjectQuery);
    }
    for (const subjectQuery of entityQueries) {
      addUniqueQuery(queries, subjectQuery);
    }
    for (const subjectQuery of discoveryQueries) {
      addUniqueQuery(queries, subjectQuery);
    }
  }

  for (const query of baseQueries) {
    const stripped = stripFirecrawlResearchScaffolding(query);
    const expanded = expandFirecrawlCryptoSymbols(stripped || query);
    const normalized = normalizeCurrentEventQuery(expanded || stripped || query);
    const primary = normalized || expanded || stripped || query;
    const forecastingIntent = detectForecastingIntent(primary);

    addUniqueQuery(queries, primary);

    const enrichmentVariants = predictionLaunchTask
      ? buildCurrentStateFirecrawlVariants(primary)
      : forecastingIntent.forecasting
        ? buildForecastingFirecrawlVariants(primary, forecastingIntent)
        : buildCurrentStateFirecrawlVariants(primary);

    for (const variant of enrichmentVariants) {
      addUniqueQuery(queries, variant);
    }
  }

  if (queries.length === 0) {
    addUniqueQuery(queries, normalizeCurrentEventQuery(expandFirecrawlCryptoSymbols(normalizedTask)));
  }

  const ranked = queries.slice();
  if (isPredictionTask) {
    const rank = (query: string): number => {
      const normalized = query.toLowerCase();
      let score = 0;
      if (subjectQueries.some((item) => item.toLowerCase() === normalized)) score += 80;
      if (entityQueries.some((item) => item.toLowerCase() === normalized)) score += 60;
      if (discoveryQueries.some((item) => item.toLowerCase() === normalized)) score += 50;
      if (/\b(official announcement|release date confirmation|launch date announcement|mainnet launch|roadmap mainnet|winner odds|betting odds|opta|theanalyst)\b/i.test(query)) {
        score += 25;
      }
      if (/^site:/i.test(query)) score += 15;
      if (
        /\b(xaut|tether gold)\b/i.test(contextTask) &&
        /\b(gold|spot gold|kitco|lbma|world gold council|gold\.org|reuters)\b/i.test(query)
      ) {
        score += 32;
      }
      if (
        /\b(xaut|tether gold)\b/i.test(contextTask) &&
        /\bprice prediction\b/i.test(query) &&
        !/\b(gold|spot gold|kitco|lbma|world gold council|gold\.org|reuters)\b/i.test(query)
      ) {
        score -= 10;
      }
      if (/\bnetwork network\b/i.test(normalized)) score -= 40;
      if (/\bprediction market\b/i.test(normalized)) score -= 20;
      return score;
    };
    ranked.sort((a, b) => rank(b) - rank(a));
  }

  return ranked.slice(0, 14);
}

// Keep a wide evidence set for prediction-market reports. The previous logic capped at 5 (and
// often fewer once one official source matched), which manufactured "thin evidence" out of rich
// retrieval. Downstream rendering/claim-building applies its own narrower caps.
const PREDICTION_MARKET_EVIDENCE_LIMIT = 10;

function selectPredictionMarketEvidenceWithHostDiversity(
  task: string,
  snapshots: FirecrawlArticleSnapshot[],
  limit: number,
): FirecrawlArticleSnapshot[] {
  const dedupedSnapshots = [...new Map(snapshots.map((snapshot) => [snapshot.url, snapshot])).values()];
  const selected: FirecrawlArticleSnapshot[] = [];
  const hostCounts = new Map<string, number>();
  const maxPerHost = extractPredictionMarketCategory(task) === 'sports' ? 2 : 2;

  const canAdd = (snapshot: FirecrawlArticleSnapshot): boolean => {
    const host = normalizedHostnameFromUrl(parseSnapshotUrl(snapshot));
    if (!host) return true;
    return (hostCounts.get(host) ?? 0) < maxPerHost;
  };

  const push = (snapshot: FirecrawlArticleSnapshot): void => {
    selected.push(snapshot);
    const host = normalizedHostnameFromUrl(parseSnapshotUrl(snapshot));
    if (!host) return;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  };

  for (const snapshot of dedupedSnapshots) {
    if (!canAdd(snapshot)) continue;
    push(snapshot);
    if (selected.length >= limit) return selected;
  }

  for (const snapshot of dedupedSnapshots) {
    if (selected.some((item) => item.url === snapshot.url)) continue;
    push(snapshot);
    if (selected.length >= limit) break;
  }

  return selected;
}

function isOfficialPredictionMarketSource(
  snapshot: FirecrawlArticleSnapshot,
  understanding: MarketUnderstanding | null,
): boolean {
  if (!understanding?.entity?.officialDomains?.length) return false;
  const hostname = normalizedHostnameFromUrl(parseSnapshotUrl(snapshot));
  if (!hostname) return false;
  return understanding.entity.officialDomains.some((domain) =>
    domain ? hostnameMatches(hostname, domain.toLowerCase()) : false,
  );
}

function predictionMarketEvidenceSortScore(
  snapshot: FirecrawlArticleSnapshot,
  task: string,
  understanding: MarketUnderstanding | null,
): number {
  const qualityContext = buildSourceQualityContext(task);
  const hostname = normalizedHostnameFromUrl(parseSnapshotUrl(snapshot));
  const official = isOfficialPredictionMarketSource(snapshot, understanding);
  const authoritativeCategorySource = isPredictionMarketCategoryAuthorityHost(task, hostname);
  const editorial = hasPredictionMarketEditorialArticleSignal(snapshot, task);
  let score = resolvedEntitySourceBoost(snapshot, understanding);

  score += sourceQualityScore(snapshot, qualityContext);
  score += eventRecencyScore(snapshot.seen_at);
  score += firecrawlSnapshotRelevance(snapshot, task);
  if (editorial) score += 28;
  if (authoritativeCategorySource && !official) score += 18;
  if (official) score -= 18;
  if (official && !hasArticleLikePath(snapshot)) score -= 10;

  return score;
}

function filterPredictionMarketResearchEvidence(
  task: string,
  snapshots: FirecrawlArticleSnapshot[],
  understanding?: MarketUnderstanding | null,
): FirecrawlArticleSnapshot[] {
  if (!/\bprediction market\b/i.test(task)) return snapshots;

  // Drop only genuine junk: circular market sources, resolved-entity homonym drift, and
  // low-value social/video. Everything else is candidate evidence. Critically, we do NOT
  // collapse to a narrow token-matched subset the moment one official source appears — that
  // turned rich retrieval (a dozen good Reuters/Bloomberg/news articles) into 2-source "thin"
  // reports. Homonym drift is handled by avoidTerms; relevance is handled by ranking, not by
  // discarding any news that doesn't echo the exact entity token.
  const candidates = snapshots.filter((snapshot) => {
    if (isCircularResearchSourceUrl(task, snapshot.url)) return false;
    if (isGoogleNewsUrl(snapshot.url) || isGoogleConsentUrl(snapshot.url)) return false;
    if (matchesResolvedEntityAvoidTerms(snapshot, understanding ?? null)) return false;
    if (isLowValueSocialSourceUrl(snapshot.url)) return false;
    if (isLowValueVideoUrl(snapshot.url)) return false;
    return true;
  });
  if (candidates.length === 0) return [];

  const entityRelevantCandidates: FirecrawlArticleSnapshot[] = [];
  const gateRejected: FirecrawlArticleSnapshot[] = [];
  for (const snapshot of candidates) {
    if (!understanding?.entity || isEntityRelevantPredictionMarketSource(snapshot, task, understanding)) {
      entityRelevantCandidates.push(snapshot);
    } else {
      gateRejected.push(snapshot);
    }
  }
  if (understanding?.entity && process.env.RESEARCH_GATE_TRACE) {
    console.log(
      `[research][gate] entity="${understanding.entity.canonicalName}" ambiguity=${understanding.entity.ambiguity} candidates=${candidates.length} kept=${entityRelevantCandidates.length} rejected=${gateRejected.length}` +
        (gateRejected.length
          ? ` rejectedHosts=${gateRejected
              .map((snapshot) => normalizedHostnameFromUrl(parseSnapshotUrl(snapshot)))
              .filter(Boolean)
              .join(',')}`
          : ''),
    );
  }
  if (understanding?.entity && entityRelevantCandidates.length === 0) {
    return [];
  }

  const qualityContext = buildSourceQualityContext(task);

  const isOfficialOrAuthoritative = (snapshot: FirecrawlArticleSnapshot): boolean => {
    const haystack = `${snapshot.publisher || ''} ${snapshot.url}`.toLowerCase();
    if (
      understanding?.entity?.officialDomains?.some((domain) =>
        haystack.includes(domain.toLowerCase()),
      )
    ) {
      return true;
    }
    if (
      isPredictionMarketCategoryAuthorityHost(
        task,
        normalizedHostnameFromUrl(parseSnapshotUrl(snapshot)),
      )
    ) {
      return true;
    }
    if (/\b(rockstargames\.com|take2games\.com)\b/i.test(haystack)) return true;
    return isAuthoritativeSportsEvidenceUrl(snapshot.url, snapshot.publisher);
  };

  // Favor dynamic editorial/category-authority coverage for betting insight, while still
  // allowing official sources to survive as supporting evidence instead of becoming the
  // backbone of every thin run.
  return selectPredictionMarketEvidenceWithHostDiversity(
    task,
    [...entityRelevantCandidates]
    .sort((a, b) => {
      const scoreDelta =
        predictionMarketEvidenceSortScore(b, task, understanding ?? null) -
        predictionMarketEvidenceSortScore(a, task, understanding ?? null);
      if (scoreDelta !== 0) return scoreDelta;
      const authoritativeDelta =
        Number(isOfficialOrAuthoritative(b)) - Number(isOfficialOrAuthoritative(a));
      if (authoritativeDelta !== 0) return authoritativeDelta;
      return sourceQualityScore(b, qualityContext) - sourceQualityScore(a, qualityContext);
    }),
    PREDICTION_MARKET_EVIDENCE_LIMIT,
  );
}

function hasAuthoritativeSportsOddsEvidence(
  task: string,
  snapshots: FirecrawlArticleSnapshot[],
): boolean {
  if (extractPredictionMarketCategory(task) !== 'sports') return false;
  return snapshots.some((snapshot) => {
    const haystack =
      `${snapshot.title} ${snapshot.summary} ${snapshot.publisher || ''} ${snapshot.url}`.toLowerCase();
    return (
      isAuthoritativeSportsOddsSource(snapshot.url, snapshot.publisher) &&
      /\b(odds|favorite|favorites|betting|prediction|predictions|probability|probabilities|implied)\b/i.test(
        haystack,
      )
    );
  });
}

function sanitizePredictionMarketCurrentEvents(
  task: string,
  currentEvents: CurrentEventsSnapshot | null,
  understanding?: MarketUnderstanding | null,
): CurrentEventsSnapshot | null {
  if (!currentEvents || !/\bprediction market\b/i.test(task)) {
    return currentEvents;
  }

  const filterUrl = (url: string | undefined): boolean => {
    if (!url) return false;
    if (isCircularResearchSourceUrl(task, url)) return false;
    if (isGoogleNewsUrl(url) || isGoogleConsentUrl(url)) return false;
    return true;
  };

  const filteredArticles = (currentEvents.articles || []).filter((article) =>
    filterUrl(article.url),
  );
  const filteredSnapshots = (currentEvents.article_snapshots || []).filter((article) =>
    filterUrl(article.url),
  );
  const entityFilteredArticles = understanding?.entity
    ? filteredArticles.filter((article) =>
        isEntityRelevantPredictionMarketSource(
          {
            title: article.title,
            summary:
              (article as { summary?: string; description?: string }).summary ??
              (article as { summary?: string; description?: string }).description ??
              '',
            publisher:
              article.publisher ??
              (article as { domain?: string }).domain ??
              '',
            url: article.url,
            seen_at: article.seen_at,
          },
          task,
          understanding,
        ),
      )
    : filteredArticles;
  const entityFilteredSnapshots = understanding?.entity
    ? filteredSnapshots.filter((article) =>
        isEntityRelevantPredictionMarketSource(
          {
            title: article.title,
            summary: article.summary ?? '',
            publisher: article.publisher ?? '',
            url: article.url,
            seen_at: article.seen_at,
          },
          task,
          understanding,
        ),
      )
    : filteredSnapshots;
  if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(task)) {
    console.error(
      `[RETR][sanitize-current] filteredArticles=${filteredArticles.length} filteredSnapshots=${filteredSnapshots.length} entityArticles=${entityFilteredArticles.length} entitySnapshots=${entityFilteredSnapshots.length}`,
    );
    if (entityFilteredSnapshots.length > 0) {
      console.error(
        `[RETR][sanitize-current]   snapshotUrls=${entityFilteredSnapshots
          .slice(0, 6)
          .map((article) => article.url)
          .join(' | ')}`,
      );
    }
  }
  const recencyFilteredArticles =
    extractPredictionMarketCategory(task) === 'sports'
      ? entityFilteredArticles.filter((article) => !article.seen_at || isRecentCurrentEvent(article))
      : entityFilteredArticles;
  const recencyFilteredSnapshots =
    extractPredictionMarketCategory(task) === 'sports'
      ? entityFilteredSnapshots.filter(
          (article) => !article.seen_at || isRecentCurrentEvent(snapshotToCurrentEventArticle(article)),
        )
      : entityFilteredSnapshots;

  const authoritativeCount =
    recencyFilteredArticles.filter((article) =>
      isAuthoritativeSportsEvidenceUrl(article.url, article.publisher),
    ).length +
    recencyFilteredSnapshots.filter((article) =>
      isAuthoritativeSportsEvidenceUrl(article.url, article.publisher),
    ).length;

  const trimLowValueSocial = authoritativeCount >= 2;
  const socialFilter = (url: string) =>
    !trimLowValueSocial ||
    (!isLowValueSocialSourceUrl(url) && !isLowValueVideoUrl(url));

  // Geopolitical framing signals (conflict/Hormuz/Red Sea route status) are derived
  // topic-agnostically from whatever current-events articles came back. For a
  // non-geopolitical market (sports, games, crypto price, etc.) those signals are
  // contamination — they make the report pipeline inject shipping/conflict claims that
  // have nothing to do with the market. Only keep framing when the market itself is
  // genuinely geopolitical.
  const keepFramingSignals = detectResearchDomain(task) === 'geopolitics';
  const { framing_signals: _droppedFramingSignals, ...restCurrentEvents } = currentEvents;

  return {
    ...restCurrentEvents,
    ...(keepFramingSignals && currentEvents.framing_signals
      ? { framing_signals: currentEvents.framing_signals }
      : {}),
    articles: recencyFilteredArticles.filter((article) => socialFilter(article.url)),
    article_snapshots: recencyFilteredSnapshots.filter((article) => socialFilter(article.url)),
  };
}

const COIN_KEYWORDS: Array<{ pattern: RegExp; coinId: string; symbol: string }> = [
  { pattern: /\btether gold\b|\bxaut\b/i, coinId: 'tether-gold', symbol: 'XAUT' },
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

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = LIVE_DATA_FETCH_TIMEOUT_MS): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }

  return (await response.json()) as T;
}

async function fetchTextWithTimeout(url: string, timeoutMs = LIVE_DATA_FETCH_TIMEOUT_MS): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }

  return decodeTextResponse(response);
}

function detectResearchDomain(task: string): ResearchDomain {
  const cleanedTask = stripExecutionContext(task);
  const predictionMarketCategory = extractPredictionMarketCategory(cleanedTask);
  if (predictionMarketCategory) {
    if (predictionMarketCategory === 'crypto') return 'crypto';
    if (predictionMarketCategory === 'politics' || predictionMarketCategory === 'geopolitics') {
      return 'geopolitics';
    }
    return 'general';
  }
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
  if (/\btether gold\b|\bxaut\b/i.test(task)) {
    return [{ coinId: 'tether-gold', symbol: 'XAUT' }];
  }

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

function shouldFetchDefiLlamaDataForTask(
  task: string,
  understanding?: MarketUnderstanding | null,
): boolean {
  const explicitDefiMetric = /\b(defillama|tvl|total value locked|stablecoins?|liquidity|defi ecosystem|protocol revenue|chain fees|on[-\s]?chain liquidity)\b/i.test(
    task,
  );
  if (!isPredictionMarketResearchTask(task)) {
    return true;
  }
  if (explicitDefiMetric) {
    return true;
  }
  if (
    understanding?.questionType === 'launch_milestone' ||
    /\b(mainnet|testnet|launch date|launch before|pre[-\s]?mainnet)\b/i.test(task)
  ) {
    return false;
  }
  if (
    understanding?.questionType === 'price_target' ||
    /\b(reach|hit|market cap|valuation|price target|\$\d)\b/i.test(task)
  ) {
    return false;
  }
  return true;
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

function isBitcoinTransactionMetricsTask(task: string): boolean {
  return /\b(bitcoin|btc)\b/i.test(task) &&
    /\b(transaction|transactions|txs?|on[-\s]?chain|network activity|block activity)\b/i.test(task);
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

function buildCurrentEventQueries(
  task: string,
  understanding?: MarketUnderstanding | null,
): string[] {
  const cleanedTask = normalizeLiveDataSearchTask(task);
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

  const predictionMarketTask = /\bprediction market\b/i.test(task);
  if (predictionMarketTask && understanding) {
    const canonical = stripPredictionMarketIntentSuffix(
      understanding.entity?.canonicalName || understanding.subject,
    );
    const marketCategory = extractPredictionMarketCategory(task);
    const sportsWinnerMarket =
      marketCategory === 'sports' &&
      understanding.questionType === 'event_outcome' &&
      isSportsWinnerPredictionMarketTask(task, understanding);
    const entityAliases = [
      ...(understanding.entity?.aliases ?? []),
      understanding.subject,
    ]
      .map((value) => stripPredictionMarketIntentSuffix(value || ''))
      .map((value) => value.replace(/\bGTAVI\b/gi, 'GTA VI').replace(/\bGTA6\b/gi, 'GTA 6'))
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const aliasQueries = [...new Set(entityAliases)].filter((alias) => {
      if (!canonical) return true;
      if (alias.toLowerCase() === canonical.toLowerCase()) return false;
      if (
        marketCategory === 'crypto' &&
        understanding.questionType === 'launch_milestone' &&
        /^[A-Z]{2,5}$/i.test(alias)
      ) {
        return false;
      }
      return alias.length >= 3;
    });
    if (canonical) {
      if (!sportsWinnerMarket) {
        addQuery(`${canonical} latest`);
        addQuery(`${canonical} latest news`);
      }
      if (understanding.questionType === 'launch_milestone') {
        if (marketCategory === 'crypto') {
          addQuery(`${canonical} blockchain`);
          addQuery(`${canonical} mainnet`);
          addQuery(`${canonical} mainnet launch`);
          addQuery(`${canonical} roadmap`);
          addQuery(`${canonical} testnet`);
          addQuery(`${canonical} official announcement`);
          const officialDomain = understanding.entity?.officialDomains?.[0];
          if (officialDomain) {
            addQuery(`site:${officialDomain} ${canonical} mainnet`);
            addQuery(`site:${officialDomain} ${canonical} official announcement`);
          }
        } else if (marketCategory === 'games' || marketCategory === 'gaming') {
          addQuery(`${canonical} release date`);
          addQuery(`${canonical} launch window`);
          addQuery(`${canonical} development update`);
          addQuery(`${canonical} official announcement`);
          addQuery(`${canonical} delay latest`);
          const officialDomain = understanding.entity?.officialDomains?.[0];
          if (officialDomain) {
            addQuery(`site:${officialDomain} ${canonical} release date`);
            addQuery(`site:${officialDomain} ${canonical} official announcement`);
          }
        } else {
          addQuery(`${canonical} official announcement`);
        }
      }
      if (understanding.questionType === 'event_outcome' && marketCategory === 'sports') {
        addQuery(`${canonical} odds`);
        addQuery(`${canonical} favorites`);
        addQuery(`${canonical} team rankings`);
        if (sportsWinnerMarket) {
          addQuery(`${canonical} winner odds`);
          addQuery(`${canonical} outright odds`);
          addQuery(`${canonical} opta prediction`);
          addQuery(`${canonical} power rankings`);
        } else {
          addQuery(`${canonical} injuries form`);
        }
      }
      if (marketCategory === 'crypto') {
        addQuery(`${canonical} crypto`);
        addQuery(`${canonical} blockchain project`);
      }
      if (/\barc network\b/i.test(canonical)) {
        addQuery('ARC Network blockchain');
        addQuery('ARC Network stablecoin blockchain');
        addQuery('Circle ARC Network blockchain');
      }
      for (const alias of aliasQueries.slice(0, 2)) {
        if (!sportsWinnerMarket) {
          addQuery(`${alias} latest`);
          addQuery(`${alias} latest news`);
        }
        if (understanding.questionType === 'launch_milestone') {
          if (marketCategory === 'games' || marketCategory === 'gaming') {
            addQuery(`${alias} release date`);
            addQuery(`${alias} official announcement`);
          } else if (marketCategory === 'crypto' && !/^[A-Z]{2,5}$/i.test(alias)) {
            addQuery(`${alias} mainnet`);
            addQuery(`${alias} official announcement`);
          }
        }
      }
    }
  }

  if (!predictionMarketTask || !understanding) {
    for (const query of buildResearchQueryVariants(task)) {
      addQuery(query);
    }
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

function isBroadCryptoPredictionMarketTask(
  task: string,
  understanding: MarketUnderstanding | null,
): boolean {
  if (!/\bprediction market\b/i.test(task)) return false;
  if (extractPredictionMarketCategory(task) !== 'crypto') return false;
  if (understanding?.questionType === 'launch_milestone') return false;
  if (/\b(mainnet|launch|testnet|roadmap|validator)\b/i.test(task)) return false;
  return /\b(bitcoin|btc|ethereum|eth|solana|sol|market cap|reach|hit|price|\$|usd|ath)\b/i.test(
    task,
  );
}

function isBroadLongHorizonOverviewTask(task: string): boolean {
  const cleanedTask = stripExecutionContext(task).trim().toLowerCase();
  if (!cleanedTask) return false;

  if (
    /\bover the next\s+\d+\s+(?:year|years|month|months|decade|decades)\b/.test(cleanedTask) ||
    /\bnext\s+\d+\s+(?:year|years|month|months|decade|decades)\b/.test(cleanedTask) ||
    /\bnext decade\b/.test(cleanedTask) ||
    /\b10\s+years\b/.test(cleanedTask) ||
    /\blong[\s-]?term\b/.test(cleanedTask)
  ) {
    return true;
  }

  return /^(?:make\s+a\s+)?research\s+on\b/.test(cleanedTask) &&
    /\b(outlook|ecosystem|economy|regulation|market outlook)\b/.test(cleanedTask);
}

export function shouldGatherCurrentEvents(task: string): boolean {
  const cleanedTask = normalizeLiveDataSearchTask(task);
  if (isSportsPredictionMarketTask(task) || isSportsPredictionMarketTask(cleanedTask)) {
    return true;
  }
  if (isBroadLongHorizonOverviewTask(cleanedTask)) {
    return false;
  }
  if (isBroadCurrentStateResearchTask(cleanedTask)) {
    return true;
  }
  if (
    classifyTopic(cleanedTask).labels.length === 0 &&
    detectProtocolQueryShape(cleanedTask) !== 'none'
  ) {
    return false;
  }
  return (
    detectResearchDomain(cleanedTask) === 'geopolitics' ||
    isTimeSensitiveTask(cleanedTask) ||
    /\b(latest|recent|current|today|news|update|updates|developments?|what changed|market analysis)\b/i.test(
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
  const fallbackArticleUrl =
    'article_url' in article && typeof article.article_url === 'string' ? article.article_url : '';
  const url = (article.url || fallbackArticleUrl || '').toLowerCase();
  if (
    /\bplay\.google\.com\/store\/apps\b/.test(url) ||
    /\bapps\.apple\.com\b/.test(url) ||
    /\bstore\.steampowered\.com\/app\b/.test(url)
  ) {
    return false;
  }
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

function isGoogleConsentUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /consent\.google\.com|[?&]continue=https?:\/\/news\.google\.com|\/sorry\/|\/setprefs/i.test(
    url,
  );
}

function isGoogleConsentInterstitialText(text: string | undefined): boolean {
  if (!text) return false;
  return /\bbefore you continue to google\b|\bwe use cookies and data to\b|\bdeliver and maintain google services\b/i.test(
    text,
  );
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
  return repairMojibake(
    value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'"),
  );
}

function markdownToSnippet(markdown: string, maxChars = 520): string | null {
  const text = normalizeSourceText(markdown, { stripChrome: true, collapseWhitespace: true })
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || isGoogleConsentInterstitialText(text)) {
    return null;
  }

  return truncateSentences(text, maxChars) ?? null;
}

function extractVisiblePublishedDateFromMarkdown(markdown: string | undefined): string | undefined {
  if (!markdown) return undefined;

  const normalized = markdown.replace(/\r\n/g, '\n');
  const patterns = [
    /\bPublished\s*\n+\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i,
    /\bPublished\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i,
    /\bPublished\s*\n+\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/i,
    /\bPublished\s*:?\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/i,
    /\bUpdated\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i,
    /\bLast updated\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i,
  ];

  for (const pattern of patterns) {
    const candidate = normalized.match(pattern)?.[1]?.trim();
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  return undefined;
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
    'article:published',
    'datePublished',
    'og:updated_time',
    'article:modified',
    'modifiedTime',
    'last_updated_date',
  ]) || result.date || extractVisiblePublishedDateFromMarkdown(result.markdown);

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

  if (!url || isLikelyHomepageUrl(url) || isGoogleConsentUrl(url)) {
    return null;
  }
  if (/\/(?:llms\.txt|robots\.txt|sitemap(?:[_-]index)?\.xml)(?:[?#]|$)/i.test(url)) {
    return null;
  }

  const normalizedTitle =
    normalizeSourceText(result.title?.trim() || '', { stripChrome: true }) ||
    normalizeSourceText(getMetadataString(metadata, ['og_title', 'og:title', 'title']) || '', {
      stripChrome: true,
    }) ||
    'Untitled article';
  const rawPublisher =
    getMetadataString(metadata, ['ogSiteName', 'og:site_name', 'og_site_name']) ||
    extractHostname(url);
  const publisher = normalizePublisherLabel(rawPublisher, url) || rawPublisher;
  const normalizedSummaryText = normalizeSourceText(result.description || result.snippet || '', {
    stripChrome: true,
    collapseWhitespace: true,
  });
  const summary =
    truncateSentences(normalizedSummaryText, 320) ||
    (result.markdown ? markdownToSnippet(result.markdown, 420) : null);

  if (
    !summary ||
    isGoogleConsentInterstitialText(normalizedTitle) ||
    isGoogleConsentInterstitialText(summary)
  ) {
    return null;
  }

  return {
    title: normalizedTitle,
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
  const creatorAudienceTask = isCreatorAudienceMetricTask(task);

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
  if (creatorAudienceTask && /\b(socialcounts|livecounts|socialblade|viewstats)\b/.test(haystack)) score += 50;
  if (creatorAudienceTask && isOfficialCreatorPlatformUrl(snapshot.url)) score += 25;
  if (/\/live\//i.test(snapshot.url)) score -= 2;
  if (/^(here'?s what|what is|why\b|how\b|potential\b)/i.test(snapshot.title)) score -= 20;
  if (/\bcould\b|\bmay\b|\bwhat needs to happen\b/.test(haystack)) score -= 10;
  if (/^[A-Z][A-Za-z'. -]{1,40}\s+says\b/i.test(snapshot.title)) score -= 15;

  return score;
}

type SourceQualityStrictness = 'strict' | 'soft';

type SourceQualityContext = {
  task: string;
  strictness: SourceQualityStrictness;
  cryptoTopic: boolean;
};

const GENERIC_ASSET_PATH_RE = /\/(?:price|prices|currencies|coins|quote|quotes|symbols?|markets?|chart|charts?)(?:\/|$)/i;
const GENERIC_REFERENCE_PATH_RE = /\/(?:wiki|wikipedia|learn|get-started|getting-started|what-is|about)(?:\/|$)/i;
const ARTICLE_PATH_RE = /\/(?:article|articles|news|analysis|research|insight|insights|blog|post|posts|report|reports|markets)(?:\/|$)/i;
const DATED_PATH_RE = /\/20\d{2}\/(?:0?[1-9]|1[0-2])(?:\/|$)|\/20\d{2}[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])(?:\/|$)/i;
const LOCALIZED_PATH_RE = /^\/(?:de|fr|es|it|pt|ru|zh|ja|ko|tr|id|vi|nl|pl|sv|ar)(?:\/|$)/i;
const NON_ENGLISH_TITLE_RE = /\b(?:aktuelle|nachrichten|heute|kurs|vollstandige|vollständige|leitfaden|preis|marktkapitalisierung|kryptowaehrungen|kryptowährungen|devisen|wechselkurs)\b/i;

const GENERIC_DESTINATION_HOSTS = [
  'coinmarketcap.com',
  'coingecko.com',
  'tradingview.com',
  'finance.yahoo.com',
  'coinbase.com',
  'binance.com',
  'kraken.com',
  'forbes.com/digital-assets/assets',
  'finanzen.net',
  'investing.com',
];

const OFFICIAL_PROTOCOL_ROOT_HOSTS = [
  'bitcoin.org',
  'ethereum.org',
  'solana.com',
  'solana.org',
];

const CRYPTO_RESEARCH_HOST_BOOSTS: Array<{ host: string; boost: number }> = [
  { host: 'coindesk.com', boost: 18 },
  { host: 'theblock.co', boost: 18 },
  { host: 'decrypt.co', boost: 16 },
  { host: 'bankless.com', boost: 15 },
  { host: 'coinmetrics.io', boost: 18 },
  { host: 'glassnode.com', boost: 18 },
  { host: 'insights.glassnode.com', boost: 20 },
  { host: 'messari.io', boost: 18 },
  { host: 'galaxy.com', boost: 14 },
  { host: 'ark-invest.com', boost: 14 },
  { host: 'bitmex.com', boost: 14 },
  { host: 'blog.bitmex.com', boost: 16 },
  { host: 'dune.com', boost: 12 },
  { host: 'l2beat.com', boost: 12 },
  { host: 'defillama.com', boost: 10 },
  { host: 'mempool.space', boost: 12 },
];

const NON_ENGLISH_SOURCE_HOSTS = [
  'wiwo.de',
  'finanzen.net',
  'btc-echo.de',
  'kryptovergleich.de',
  'wallstreet-online.de',
  'tagesschau.de',
  'handelsblatt.com',
  'zeit.de',
  'srf.ch',
  'zdfheute.de',
  'focus.de',
];

function parseSnapshotUrl(snapshot: FirecrawlArticleSnapshot): URL | null {
  try {
    return new URL(snapshot.url);
  } catch {
    return null;
  }
}

function normalizedHostnameFromUrl(parsed: URL | null): string {
  return parsed?.hostname.replace(/^www\./i, '').toLowerCase() || '';
}

function hostnameMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

function isBroadCurrentStateResearchTask(task: string): boolean {
  const cleanedTask = stripFirecrawlResearchScaffolding(task).toLowerCase();
  if (!cleanedTask) return false;

  const words = cleanedTask.split(/\s+/).filter(Boolean);
  const broadAsset =
    /^(bitcoin|btc|ethereum|eth|solana|sol|crypto|cryptocurrency|crypto market|market)$/i.test(cleanedTask) ||
    /\b(bitcoin|btc|ethereum|eth|solana|sol)\b/i.test(cleanedTask);
  if (!broadAsset || isArcNetworkTask(task)) return false;
  const currentState =
    words.length <= 5 ||
    /\b(current|latest|today|news|market analysis|state|landscape|research|report)\b/i.test(task);

  return currentState && !isBroadLongHorizonOverviewTask(task);
}

function isCryptoResearchTopic(task: string): boolean {
  return (
    detectResearchDomain(task) === 'crypto' ||
    pickCoinTargets(task).length > 0 ||
    /\b(crypto|bitcoin|btc|ethereum|eth|solana|sol|defi|web3|on[-\s]?chain|l2|stablecoin)\b/i.test(task)
  );
}

function buildSourceQualityContext(task: string): SourceQualityContext {
  return {
    task,
    strictness:
      isPredictionMarketResearchTask(task) || isBroadCurrentStateResearchTask(task)
        ? 'strict'
        : 'soft',
    cryptoTopic: isCryptoResearchTopic(task),
  };
}

function titleLooksGenericDestination(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return true;
  if (/^(bitcoin|btc|ethereum|eth|solana|sol)$/i.test(title.trim())) return true;
  return /\b(price today|live price|market cap|price chart|price prediction|kurs|usd|btc usd|eth usd|sol usd|wikipedia|get started|getting started)\b/i.test(
    normalized,
  );
}

function hasArticleLikePath(snapshot: FirecrawlArticleSnapshot): boolean {
  const parsed = parseSnapshotUrl(snapshot);
  const path = parsed?.pathname || '';
  const segments = path.split('/').filter(Boolean);
  const longestHyphenatedSegment = segments.reduce(
    (max, segment) => Math.max(max, segment.split('-').filter(Boolean).length),
    0,
  );
  const titleWords = snapshot.title.split(/\s+/).filter(Boolean).length;

  return (
    ARTICLE_PATH_RE.test(path) ||
    DATED_PATH_RE.test(path) ||
    longestHyphenatedSegment >= 5 ||
    (longestHyphenatedSegment >= 4 && titleWords >= 6)
  );
}

function isPreferredCryptoResearchDomain(snapshot: FirecrawlArticleSnapshot): boolean {
  const hostname = normalizedHostnameFromUrl(parseSnapshotUrl(snapshot));
  if (!hostname) return false;
  return CRYPTO_RESEARCH_HOST_BOOSTS.some((item) => hostnameMatches(hostname, item.host));
}

function cryptoPreferredDomainBoost(snapshot: FirecrawlArticleSnapshot): number {
  const hostname = normalizedHostnameFromUrl(parseSnapshotUrl(snapshot));
  const match = CRYPTO_RESEARCH_HOST_BOOSTS.find((item) => hostnameMatches(hostname, item.host));
  return match?.boost || 0;
}

function isGenericDestination(snapshot: FirecrawlArticleSnapshot): boolean {
  const parsed = parseSnapshotUrl(snapshot);
  const hostname = normalizedHostnameFromUrl(parsed);
  const path = parsed?.pathname || '';
  const normalizedPath = path.replace(/\/+$/, '') || '/';
  const title = snapshot.title || '';

  if (!parsed || !hostname) return true;
  if (hostnameMatches(hostname, 'wikipedia.org')) return true;
  if (GENERIC_ASSET_PATH_RE.test(path) || GENERIC_REFERENCE_PATH_RE.test(path)) return true;
  if (GENERIC_DESTINATION_HOSTS.some((candidate) => hostnameMatches(hostname, candidate))) {
    return !hasArticleLikePath(snapshot);
  }
  if (
    OFFICIAL_PROTOCOL_ROOT_HOSTS.some((candidate) => hostnameMatches(hostname, candidate)) &&
    (normalizedPath === '/' || LOCALIZED_PATH_RE.test(path) || /^\/(?:en|de)?\/?(?:get-started|getting-started|learn|about)?\/?$/i.test(path))
  ) {
    return true;
  }
  if (LOCALIZED_PATH_RE.test(path) && titleLooksGenericDestination(title)) return true;
  if (titleLooksGenericDestination(title) && !hasArticleLikePath(snapshot)) return true;

  return false;
}

function isLikelyNonEnglishSource(snapshot: FirecrawlArticleSnapshot): boolean {
  const parsed = parseSnapshotUrl(snapshot);
  const hostname = normalizedHostnameFromUrl(parsed);
  const path = parsed?.pathname || '';
  const title = repairMojibake(snapshot.title || '');

  if (!parsed || !hostname) return false;
  if (LOCALIZED_PATH_RE.test(path)) return true;
  if (NON_ENGLISH_SOURCE_HOSTS.some((candidate) => hostnameMatches(hostname, candidate))) return true;
  if (NON_ENGLISH_TITLE_RE.test(title)) return true;
  return /[^\x00-\x7F]/.test(title) && /\b(?:kurs|nachrichten|aktuell|preis)\b/i.test(title);
}

function sourcePublishedAgeDays(snapshot: FirecrawlArticleSnapshot): number | null {
  if (!snapshot.seen_at) return null;
  const timestamp = Date.parse(snapshot.seen_at);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / 86_400_000);
}

function sourceQualityScore(snapshot: FirecrawlArticleSnapshot, context: SourceQualityContext): number {
  const parsed = parseSnapshotUrl(snapshot);
  const path = parsed?.pathname || '';
  const hostname = normalizedHostnameFromUrl(parsed);
  const generic = isGenericDestination(snapshot);
  const articleLike = hasArticleLikePath(snapshot);
  const ageDays = sourcePublishedAgeDays(snapshot);
  let score = 0;
  const creatorAudienceTask = isCreatorAudienceMetricTask(context.task);

  if (generic) score -= context.strictness === 'strict' ? 45 : 16;
  if (articleLike) score += 26;
  if (ARTICLE_PATH_RE.test(path)) score += 10;
  if (DATED_PATH_RE.test(path)) score += 8;
  if (LOCALIZED_PATH_RE.test(path)) score -= context.strictness === 'strict' ? 16 : 5;
  if (isLikelyNonEnglishSource(snapshot)) score -= context.strictness === 'strict' ? 80 : 20;
  if (hostnameMatches(hostname, 'wikipedia.org')) score -= 40;

  if (context.cryptoTopic && isPreferredCryptoResearchDomain(snapshot) && !generic) {
    score += cryptoPreferredDomainBoost(snapshot);
  }
  if (context.cryptoTopic && hasPredictionMarketEditorialArticleSignal(snapshot, context.task)) {
    score += 42;
  }
  if (
    context.cryptoTopic &&
    /\b(coindesk\.com|theblock\.co|decrypt\.co|forbes\.com|reuters\.com|bloomberg\.com|wsj\.com|ft\.com|cointelegraph\.com|blockworks\.co)\b/i.test(
      `${hostname} ${snapshot.title} ${snapshot.summary}`,
    ) &&
    !generic
  ) {
    score += 26;
  }
  if (
    context.cryptoTopic &&
    /\b(etf|macro|institutional|flows|demand|treasury|liquidity|reserve|halving)\b/i.test(
      `${snapshot.title} ${snapshot.summary}`,
    ) &&
    !generic
  ) {
    score += 18;
  }
  if (creatorAudienceTask && /\b(socialcounts\.org|livecounts\.io|socialblade\.com|viewstats\.com)\b/.test(`${hostname} ${snapshot.title} ${snapshot.summary}`.toLowerCase())) {
    score += 70;
  }
  if (creatorAudienceTask && isOfficialCreatorPlatformUrl(snapshot.url)) {
    score += 35;
  }

  if (context.strictness === 'strict') {
    if (ageDays !== null && ageDays <= 90) score += 12;
    if (ageDays !== null && ageDays > 90) score -= 12;
    if (generic && !snapshot.seen_at) score -= 20;
    if (generic && !articleLike) score -= 10;
    if (context.cryptoTopic && generic) score -= 22;
  } else if (ageDays !== null && ageDays <= 90) {
    score += 4;
  }

  return score;
}

function genericSourceFamilyKey(snapshot: FirecrawlArticleSnapshot): string {
  const parsed = parseSnapshotUrl(snapshot);
  const hostname = normalizedHostnameFromUrl(parsed);
  if (!hostname) return snapshot.url;
  if (hostnameMatches(hostname, 'wikipedia.org')) return 'wikipedia';
  const matchedGeneric = GENERIC_DESTINATION_HOSTS.find((candidate) => hostnameMatches(hostname, candidate));
  if (matchedGeneric) return matchedGeneric;
  const matchedOfficial = OFFICIAL_PROTOCOL_ROOT_HOSTS.find((candidate) => hostnameMatches(hostname, candidate));
  if (matchedOfficial) return matchedOfficial;
  return hostname;
}

function selectQualityDiverseSnapshots(
  ranked: FirecrawlArticleSnapshot[],
  context: SourceQualityContext,
  limit: number,
  task?: string,
): FirecrawlArticleSnapshot[] {
  if (context.strictness !== 'strict') {
    return ranked.slice(0, limit);
  }

  const selected: FirecrawlArticleSnapshot[] = [];
  const genericFamilies = new Set<string>();
  const hostCounts = new Map<string, number>();
  let genericCount = 0;
  let editorialCryptoCount = 0;
  const maxPerHost =
    task && extractPredictionMarketCategory(task) === 'sports' ? 1 : 2;
  const genericCap =
    task &&
    extractPredictionMarketCategory(task) === 'crypto' &&
    /\b(market cap|reach|hit|price|\$|usd|ath)\b/i.test(task)
      ? 1
      : 2;

  const canAddHost = (snapshot: FirecrawlArticleSnapshot): boolean => {
    const host = normalizedHostnameFromUrl(parseSnapshotUrl(snapshot));
    if (!host) return true;
    return (hostCounts.get(host) ?? 0) < maxPerHost;
  };

  const recordHost = (snapshot: FirecrawlArticleSnapshot): void => {
    const host = normalizedHostnameFromUrl(parseSnapshotUrl(snapshot));
    if (!host) return;
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  };

  for (const snapshot of ranked) {
    if (!canAddHost(snapshot)) continue;
    if (
      task &&
      extractPredictionMarketCategory(task) === 'crypto' &&
      hasPredictionMarketEditorialArticleSignal(snapshot, task)
    ) {
      selected.push(snapshot);
      recordHost(snapshot);
      editorialCryptoCount += 1;
      if (selected.length >= limit) {
        return selected;
      }
      continue;
    }
    const generic = isGenericDestination(snapshot);
    if (generic) {
      const family = genericSourceFamilyKey(snapshot);
      if (
        genericCount >= genericCap ||
        genericFamilies.has(family) ||
        (
          task &&
          extractPredictionMarketCategory(task) === 'crypto' &&
          editorialCryptoCount >= 1
        )
      ) {
        continue;
      }
      genericFamilies.add(family);
      genericCount += 1;
    }

    selected.push(snapshot);
    recordHost(snapshot);
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const snapshot of ranked) {
    if (selected.some((item) => item.url === snapshot.url)) continue;
    if (!canAddHost(snapshot)) continue;
    const generic = isGenericDestination(snapshot);
    if (generic) {
      const family = genericSourceFamilyKey(snapshot);
      if (genericCount >= genericCap || genericFamilies.has(family)) continue;
      genericFamilies.add(family);
      genericCount += 1;
    }
    selected.push(snapshot);
    recordHost(snapshot);
    if (selected.length >= limit) break;
  }

  return selected;
}

function hasRequiredFirecrawlTopicAnchor(
  snapshot: FirecrawlArticleSnapshot,
  task: string,
  understanding?: MarketUnderstanding | null,
): boolean {
  const haystack = `${snapshot.title} ${snapshot.summary} ${snapshot.publisher || ''} ${snapshot.url}`.toLowerCase();
  const anchors: RegExp[] = [];

  if (
    /\bprediction market\b/i.test(task) &&
    understanding?.entity &&
    isEntityRelevantPredictionMarketSource(snapshot, task, understanding)
  ) {
    return true;
  }

  // Tether Gold (XAUT) must not collapse into generic "Tether" (USDT) results — require a
  // gold-specific anchor so the topic-relevant forecast pages survive ranking.
  if (/\bxaut\b|\btether[- ]gold\b/i.test(task)) anchors.push(/\bxaut\b|\btether[- ]gold\b|\bgold\b/i);
  if (/\bbitcoin\b|\bbtc\b/i.test(task)) anchors.push(/\bbitcoin\b|\bbtc\b/i);
  if (/\bethereum\b|\beth\b/i.test(task)) anchors.push(/\bethereum\b|\beth\b/i);
  if (/\bsolana\b|\bsol\b/i.test(task)) anchors.push(/\bsolana\b|\bsol\b/i);
  if (/\bx402\b/i.test(task)) anchors.push(/\bx402\b/i);
  if (/\barc network\b|\barc blockchain\b|\barc testnet\b/i.test(task)) {
    anchors.push(/\barc\b|\barc\.network\b/i);
  }
  if (/\barc\b/i.test(task) && /\bmainnet\b|\blaunch\b|\btestnet\b/i.test(task)) {
    if (extractPredictionMarketCategory(task) === 'crypto') {
      const hasArcToken = /\barc\b|\barc\.network\b/i.test(haystack);
      const hasCryptoContext =
        /\b(mainnet|blockchain|crypto|network|testnet|validator|chain|web3|roadmap|smart contract|explorer|docs)\b/i.test(
          haystack,
        );
      return hasArcToken && hasCryptoContext;
    }
    anchors.push(/\barc\b|\barc\.network\b/i);
  }
  if (
    extractPredictionMarketCategory(task) === 'crypto' &&
    /\bmainnet\b|\blaunch\b|\btestnet\b/i.test(task)
  ) {
    const shortAcronym = task.match(/\b([A-Z]{2,4})\b/);
    if (shortAcronym?.[1]) {
      const token = shortAcronym[1];
      const hasAcronymToken = new RegExp(`\\b${escapeRegex(token)}\\b`, 'i').test(haystack);
      const hasCryptoContext =
        /\b(mainnet|blockchain|crypto|network|testnet|validator|chain|web3|roadmap|smart contract|explorer|docs)\b/i.test(
          haystack,
        );
      if (!hasAcronymToken || !hasCryptoContext) {
        return false;
      }
    }
  }
  if (/\bgta\s*6\b|\bgrand theft auto\s*(?:6|vi)\b/i.test(task)) {
    if (/\bgta\s*(?:v|5)\b|\bgrand theft auto\s*(?:v|5)\b|\blegacy\b/i.test(haystack)) {
      return false;
    }
    anchors.push(/\bgta\s*(?:6|vi)\b|\bgrand theft auto\s*(?:6|vi)\b/i);
  }
  const versionedAcronyms = [...task.matchAll(/\b([A-Z]{2,6})\s*(\d{1,2}|[IVX]{1,5})\b/g)];
  for (const match of versionedAcronyms) {
    const token = match[1]?.trim();
    const version = match[2]?.trim();
    if (!token || !version) continue;
    anchors.push(new RegExp(`\\b${escapeRegex(token)}\\s*${escapeRegex(version)}\\b`, 'i'));
  }
  if (/\bstablecoin\b|\busdc\b|\busd coin\b/i.test(task)) {
    anchors.push(/\bstablecoin\b|\busdc\b|\busd[- ]coin\b/i);
  }
  if (isCreatorAudienceMetricTask(task)) {
    anchors.push(/\bmrbeast\b/i);
    anchors.push(/\bsubscriber\b|\bsubscribers\b|\byoutube\b/i);
  }

  if (anchors.length > 0) {
    return anchors.some((anchor) => anchor.test(haystack));
  }

  const normalizedTask = stripFirecrawlResearchScaffolding(task).toLowerCase();
  const meaningfulTerms = normalizedTask
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(
      (term) =>
        (term.length >= 5 || ['fed'].includes(term)) &&
        ![
          'research',
          'report',
          'current',
          'state',
          'status',
          'options',
          'opportunities',
          'market',
          'analysis',
          'latest',
          'about',
          'show',
          'vault',
          'yield',
          'yields',
        ].includes(term),
    )
    .slice(0, 4);

  return meaningfulTerms.length === 0 || meaningfulTerms.some((term) => haystack.includes(term));
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
  options?: { bypassCache?: boolean; understanding?: MarketUnderstanding | null },
): Promise<FirecrawlArticleSnapshot[]> {
  const { searchFirecrawlNews, searchSearxng } = await import('./firecrawl');
  const forecastingIntent = detectForecastingIntent(task);
  const understanding = options?.understanding ?? null;
  const shippingFocused = /\bshipping\b|\bhormuz\b|\bstrait\b|\binsurance\b|\btanker\b|\bred sea\b|\bsuez\b/i.test(
    task,
  );
  const sourceQualityContext = buildSourceQualityContext(task);
  const uniqueQueries = [...new Set(queryVariants.map((query) => query.trim()).filter(Boolean))];
  const discoveryQueries = new Set(
    buildPredictionMarketDiscoveryQueries(task, understanding).map((query) => query.trim().toLowerCase()),
  );
  const scoreQuery = (query: string): number => {
    let score = 0;
    const normalized = query.toLowerCase();
    if (normalized === task.trim().toLowerCase()) score += 30;
    if (/^site:/.test(normalized)) score += /\bprediction market\b/i.test(task) ? 10 : 24;
    if (/\bprediction market\b/i.test(task) && discoveryQueries.has(normalized)) score += 34;
    if (/\b(official|announcement|newsroom|roadmap)\b/.test(normalized)) score += 16;
    if (/\b(odds|favorite|favorites|probability|prediction)\b/.test(normalized)) score += 10;
    if (/\b(kitco|lbma|reuters|rockstar|rockstargames|take2|fifa|theanalyst|oddschecker)\b/.test(normalized)) score += 18;
    if (
      /\b(xaut|tether gold)\b/i.test(task) &&
      /\b(gold|spot gold|kitco|lbma|world gold council|gold\.org|reuters)\b/i.test(normalized)
    ) {
      score += 28;
    }
    if (
      /\b(xaut|tether gold)\b/i.test(task) &&
      /\bprice prediction\b/i.test(normalized) &&
      !/\b(gold|spot gold|kitco|lbma|world gold council|gold\.org|reuters)\b/i.test(normalized)
    ) {
      score -= 10;
    }
    if (/\bprediction market\b/i.test(task) && /\b(crypto|blockchain|ecosystem|docs|blog|developer update|game|trailer|fixtures|injuries|standings)\b/i.test(normalized)) {
      score += 18;
    }
    if (sourceQualityContext.strictness === 'strict') {
      if (/\b(news|analysis|research|insights?|report|market analysis|landscape)\b/i.test(query)) {
        score += 35;
      }
      if (/^(bitcoin|btc|ethereum|eth|solana|sol)$/i.test(normalized.trim())) {
        score -= 35;
      }
    }
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
    if (sourceQualityContext.strictness !== 'strict' && /\breport\b|\bresearch\b|\bimpact\b|\bdisruptions?\b/i.test(query)) score -= 20;
    return score;
  };
  const isPredictionMarketQuery = /\bprediction market\b/i.test(task);
  const maxQueries = Math.min(uniqueQueries.length, isPredictionMarketQuery ? 9 : 5);
  const sortedQueries = uniqueQueries.slice().sort((a, b) => scoreQuery(b) - scoreQuery(a));

  // Guarantee broad subject queries are actually searched. site:-scoped queries score highly but
  // official domains are frequently thin/poorly indexed in Firecrawl + SearXNG, so without a cap
  // they crowd out the broad queries ("<subject> latest news") that return real evidence — which
  // is what made GTA 6 / World Cup markets look like they had "insufficient evidence". We cap how
  // many site: queries can take slots, then backfill any unused budget with the skipped ones.
  const siteQueryCap = isPredictionMarketQuery ? 2 : 2;
  const isSiteQuery = (query: string) => /^site:/i.test(query.trim());
  const selectedQueries: string[] = [];
  let siteSelected = 0;
  for (const query of sortedQueries) {
    if (selectedQueries.length >= maxQueries) break;
    if (isSiteQuery(query)) {
      if (siteSelected >= siteQueryCap) continue;
      siteSelected += 1;
    }
    selectedQueries.push(query);
  }
  if (selectedQueries.length < maxQueries) {
    for (const query of sortedQueries) {
      if (selectedQueries.length >= maxQueries) break;
      if (!selectedQueries.includes(query)) selectedQueries.push(query);
    }
  }

  if (selectedQueries.length === 0) {
    return [];
  }

  const searchFirecrawlWithBudget = async (query: string): Promise<FirecrawlSearchResult[]> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Firecrawl search budget exceeded for "${query}"`)),
        HYBRID_FIRECRAWL_SEARCH_TIMEOUT_MS,
      );

      searchFirecrawlNews(query, 6, {
        recency:
          forecastingIntent.forecasting || /\bprediction market\b/i.test(task) ? 'all' : 'week',
      })
        .then((results) => {
          clearTimeout(timer);
          resolve(results);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });

  const fetchSnapshotsForQuery = async (
    query: string,
    attempt: 'primary' | 'retry',
    bypassCacheForAttempt = false,
  ): Promise<FirecrawlArticleSnapshot[]> => {
    const cacheKey = `${attempt}:${query}`;
    const cached = bypassCacheForAttempt ? null : getCacheValue(firecrawlSearchCache.get(cacheKey));
    if (cached) {
      return cached;
    }

    try {
      const [firecrawlResults, searxngResults] = await Promise.allSettled([
        searchFirecrawlWithBudget(query),
        searchSearxng(query, 6, {
          timeoutMs: 15_000,
          categories:
            forecastingIntent.forecasting || /\bprediction market\b/i.test(task)
              ? ['news']
              : undefined,
        }),
      ]);

      const mergedResults = new Map<string, FirecrawlSearchResult>();
      const pushResults = (results: FirecrawlSearchResult[]) => {
        for (const result of results) {
          const resultUrl = result.url?.trim();
          if (!resultUrl || mergedResults.has(resultUrl)) continue;
          mergedResults.set(resultUrl, result);
        }
      };

      if (firecrawlResults.status === 'fulfilled') {
        pushResults(firecrawlResults.value);
      } else if (process.env.RETR_DEBUG || /\bprediction market\b/i.test(task)) {
        console.error(
          `[RETR]   firecrawl search failed for "${query.slice(0, 120)}": ${
            firecrawlResults.reason instanceof Error
              ? firecrawlResults.reason.message
              : String(firecrawlResults.reason)
          }`,
        );
      }
      if (searxngResults.status === 'fulfilled') {
        pushResults(searxngResults.value);
      } else if (process.env.RETR_DEBUG || /\bprediction market\b/i.test(task)) {
        console.error(
          `[RETR]   searxng search failed for "${query.slice(0, 120)}": ${
            searxngResults.reason instanceof Error
              ? searxngResults.reason.message
              : String(searxngResults.reason)
          }`,
        );
      }

      const snapshots = [...mergedResults.values()]
        .map((result) => buildFirecrawlSearchSnapshot(result))
        .filter((snapshot): snapshot is FirecrawlArticleSnapshot => Boolean(snapshot))
        .filter(isUsableCurrentEventArticle)
        .filter((snapshot) => !matchesResolvedEntityAvoidTerms(snapshot, understanding));

      if (bypassCacheForAttempt || snapshots.length === 0) {
        return snapshots;
      }

      return setTimedCache(
        firecrawlSearchCache,
        cacheKey,
        snapshots,
        FIRECRAWL_CACHE_TTL_MS,
      );
    } catch {
      return [];
    }
  };

  const loadSnapshotGroups = (
    attempt: 'primary' | 'retry',
    bypassCacheForAttempt = false,
  ): Promise<FirecrawlArticleSnapshot[][]> =>
    Promise.all(
      selectedQueries.map((query) => fetchSnapshotsForQuery(query, attempt, bypassCacheForAttempt)),
    );
  const countRelevantSnapshots = (groups: FirecrawlArticleSnapshot[][]): number => {
    const seen = new Set<string>();
    let count = 0;
    for (const group of groups) {
      for (const snapshot of group) {
        if (seen.has(snapshot.url)) continue;
        seen.add(snapshot.url);
        if (!isUsableCurrentEventArticle(snapshot)) continue;
        if (matchesResolvedEntityAvoidTerms(snapshot, understanding)) continue;
        if (!hasRequiredFirecrawlTopicAnchor(snapshot, task, understanding)) continue;
        if (sourceQualityContext.strictness === 'strict' && isLikelyNonEnglishSource(snapshot)) {
          continue;
        }
        count += 1;
      }
    }
    return count;
  };

  const __t0 = Date.now();
  let snapshotGroups = await loadSnapshotGroups(
    'primary',
    options?.bypassCache === true,
  );
  const primaryRelevantCount = countRelevantSnapshots(snapshotGroups);
  if (
    snapshotGroups.every((group) => group.length === 0) ||
    (isPredictionMarketQuery && primaryRelevantCount < 2)
  ) {
    await sleep(FIRECRAWL_EMPTY_RETRY_DELAY_MS);
    const retryGroups = await loadSnapshotGroups('retry', true);
    snapshotGroups = snapshotGroups.map((group, index) => [
      ...group,
      ...(retryGroups[index] || []),
    ]);
  }
  const __searchMs = Date.now() - __t0;

  const deduped = new Map<string, FirecrawlArticleSnapshot>();
  for (const group of snapshotGroups) {
    for (const snapshot of group) {
      if (!deduped.has(snapshot.url)) {
        deduped.set(snapshot.url, snapshot);
      }
    }
  }

  if (process.env.RETR_DEBUG) {
    const all = [...deduped.values()];
    const afterUsable = all.filter(isUsableCurrentEventArticle);
    const afterAnchor = afterUsable.filter((s) => hasRequiredFirecrawlTopicAnchor(s, task, understanding));
    const afterLang = afterAnchor.filter((s) => sourceQualityContext.strictness !== 'strict' || !isLikelyNonEnglishSource(s));
    console.error(`[RETR] task="${task.slice(0, 50)}" strictness=${sourceQualityContext.strictness} searchMs=${__searchMs} queries=${selectedQueries.length}`);
    console.error(`[RETR]   perQuery=${snapshotGroups.map((g) => g.length).join(',')} deduped=${deduped.size} -> usable=${afterUsable.length} -> anchor=${afterAnchor.length} -> lang=${afterLang.length}`);
    console.error(`[RETR]   deduped urls: ${all.slice(0, 12).map((s) => s.url).join(' | ')}`);
    console.error(`[RETR]   dropped by anchor: ${afterUsable.filter((s) => !hasRequiredFirecrawlTopicAnchor(s, task, understanding)).slice(0, 8).map((s) => s.url).join(' | ')}`);
  }

  const enrichedSnapshots = isPredictionMarketQuery
    ? await enrichPredictionMarketSnapshotsFromPages(task, understanding, [...deduped.values()])
    : [...deduped.values()];

  const ranked = enrichedSnapshots
    .filter(isUsableCurrentEventArticle)
    .filter((snapshot) => !matchesResolvedEntityAvoidTerms(snapshot, understanding))
    .filter((snapshot) => hasRequiredFirecrawlTopicAnchor(snapshot, task, understanding))
    .filter((snapshot) => sourceQualityContext.strictness !== 'strict' || !isLikelyNonEnglishSource(snapshot))
    .sort((a, b) => {
      const entityDelta =
        resolvedEntitySourceBoost(b, understanding) - resolvedEntitySourceBoost(a, understanding);
      if (entityDelta !== 0) {
        return entityDelta;
      }
      const qualityDelta =
        sourceQualityScore(b, sourceQualityContext) - sourceQualityScore(a, sourceQualityContext);
      if (qualityDelta !== 0) {
        return qualityDelta;
      }
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
      const selected = selectQualityDiverseSnapshots(shippingSpecific, sourceQualityContext, 4, task);
      if (process.env.RETR_DEBUG) {
        console.error(
          `[RETR]   shipping selected=${selected.length} hosts=${selected
            .map((snapshot) => normalizedHostnameFromUrl(parseSnapshotUrl(snapshot)))
            .filter(Boolean)
            .join(',')}`,
        );
      }
      return selected;
    }
  }

  const selected = selectQualityDiverseSnapshots(ranked, sourceQualityContext, 5, task);
  if (process.env.RETR_DEBUG) {
    console.error(
      `[RETR]   ranked=${ranked.length} selected=${selected.length} hosts=${selected
        .map((snapshot) => normalizedHostnameFromUrl(parseSnapshotUrl(snapshot)))
        .filter(Boolean)
        .join(',')}`,
    );
  }
  return selected;
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

function extractGoogleNewsDecodeParams(html: string): {
  id: string;
  timestamp: string;
  signature: string;
} | null {
  const id = html.match(/data-n-a-id="([^"]+)"/i)?.[1]?.trim();
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/i)?.[1]?.trim();
  const signature = html.match(/data-n-a-sg="([^"]+)"/i)?.[1]?.trim();
  if (!id || !timestamp || !signature) return null;
  return { id, timestamp, signature };
}

async function decodeGoogleNewsArticleUrl(url: string): Promise<string | null> {
  try {
    const articleHtml = await fetchTextWithTimeout(url, LIVE_DATA_FETCH_TIMEOUT_MS);
    const params = extractGoogleNewsDecodeParams(articleHtml);
    if (!params) return null;

    const requestPayload = [[[
      'Fbv4je',
      `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${params.id}",${params.timestamp},"${params.signature}"]`,
      null,
      'generic',
    ]]];

    const response = await fetch(
      'https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Referrer: 'https://news.google.com/',
          'User-Agent': 'Mozilla/5.0',
        },
        body: `f.req=${encodeURIComponent(JSON.stringify(requestPayload))}`,
        signal: AbortSignal.timeout(LIVE_DATA_FETCH_TIMEOUT_MS),
      },
    );
    const text = await decodeTextResponse(response);
    const decodedUrl =
      text.match(/\[\\"garturlres\\",\\"(.*?)\\",/i)?.[1]?.trim() ||
      text.match(/\["garturlres","(.*?)",/i)?.[1]?.trim();
    if (!decodedUrl || isGoogleNewsUrl(decodedUrl) || isGoogleConsentUrl(decodedUrl)) {
      return null;
    }
    return decodedUrl;
  } catch {
    return null;
  }
}

async function resolveArticleUrl(url: string): Promise<string> {
  const cached = getCacheValue(redirectUrlCache.get(url));
  if (cached) {
    return cached;
  }

  if (isGoogleNewsUrl(url)) {
    const decoded = await decodeGoogleNewsArticleUrl(url);
    if (decoded) {
      redirectUrlCache.set(url, {
        value: decoded,
        expiresAt: Date.now() + NEWS_RSS_CACHE_TTL_MS,
      });
      return decoded;
    }
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(LIVE_DATA_FETCH_TIMEOUT_MS),
    });
    const resolved = response.url || url;
    const finalUrl = isGoogleConsentUrl(resolved) ? url : resolved;
    redirectUrlCache.set(url, {
      value: finalUrl,
      expiresAt: Date.now() + NEWS_RSS_CACHE_TTL_MS,
    });
    return finalUrl;
  } catch {
    redirectUrlCache.set(url, {
      value: url,
      expiresAt: Date.now() + NEWS_RSS_CACHE_TTL_MS,
    });
    return url;
  }
}

function scoreRecoveredArticleTitleMatch(
  expectedTitle: string,
  candidateTitle: string,
): number {
  const expected = normalizeArticleTitle(expectedTitle);
  const candidate = normalizeArticleTitle(candidateTitle);
  if (!expected || !candidate) return 0;
  if (expected === candidate) return 12;
  if (candidate.includes(expected) || expected.includes(candidate)) return 10;

  const expectedTokens = new Set(expected.split(/\s+/).filter((token) => token.length >= 4));
  const candidateTokens = new Set(candidate.split(/\s+/).filter((token) => token.length >= 4));
  let overlap = 0;
  for (const token of expectedTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  return overlap;
}

async function recoverDirectArticleUrlFromSearch(article: {
  title: string;
  publisher?: string;
  domain?: string;
}): Promise<string | null> {
  const domain = article.domain?.trim().toLowerCase() || '';
  const queries = [
    domain ? `site:${domain} "${article.title}"` : '',
    `"${article.title}" ${article.publisher || ''}`.trim(),
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const [firecrawlResults, searxngResults] = await Promise.allSettled([
        searchFirecrawlNews(query, 6, { recency: 'all' }),
        searchSearxng(query, 6, { timeoutMs: 10_000, categories: ['news'] }),
      ]);
      const merged = new Map<string, FirecrawlSearchResult>();
      for (const resultSet of [firecrawlResults, searxngResults]) {
        if (resultSet.status !== 'fulfilled') continue;
        for (const result of resultSet.value) {
          const url = result.url?.trim();
          if (!url || merged.has(url)) continue;
          merged.set(url, result);
        }
      }
      const results = [...merged.values()];
      let bestUrl: string | null = null;
      let bestScore = 0;

      for (const result of results) {
        const url = result.url?.trim();
        if (!url || isGoogleNewsUrl(url) || isLikelyHomepageUrl(url)) continue;
        if (isLowValueSocialSourceUrl(url) || isLowValueVideoUrl(url)) continue;

        const host = sourceHostname(url);
        let score = scoreRecoveredArticleTitleMatch(article.title, result.title || '');
        if (domain && host === domain) score += 6;
        else if (domain && host.endsWith(`.${domain}`)) score += 4;
        if (article.publisher && new RegExp(escapeRegex(article.publisher), 'i').test(result.title || '')) {
          score += 2;
        }
        if (score > bestScore) {
          bestScore = score;
          bestUrl = url;
        }
      }

      if (bestUrl && bestScore >= 6) {
        return bestUrl;
      }
    } catch {
      // Ignore search recovery failures and fall back to the original URL.
    }
  }

  return null;
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

type MempoolBlock = {
  height?: number;
  timestamp?: number;
  tx_count?: number;
  extras?: {
    totalFees?: number;
    totalOutputAmt?: number;
  };
};

function validMempoolBlocks(value: unknown): MempoolBlock[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is MempoolBlock => {
        if (!entry || typeof entry !== 'object') return false;
        const block = entry as MempoolBlock;
        return Number.isFinite(block.height) &&
          Number.isFinite(block.timestamp) &&
          Number.isFinite(block.tx_count);
      })
    : [];
}

async function fetchMempoolBlocksPage(height?: number): Promise<MempoolBlock[]> {
  const path = height === undefined
    ? 'https://mempool.space/api/v1/blocks'
    : `https://mempool.space/api/v1/blocks/${encodeURIComponent(String(height))}`;
  const json = await fetchJsonWithTimeout<unknown>(path, 8_000);
  return validMempoolBlocks(json);
}

async function fetchBitcoinOnchainData(task: string): Promise<BitcoinOnchainSnapshot | null> {
  if (!isBitcoinTransactionMetricsTask(task)) return null;

  const cached = getCacheValue(bitcoinOnchainCache.get('bitcoin'));
  if (cached !== null) return cached;

  const firstPage = await fetchMempoolBlocksPage();
  const tip = firstPage[0];
  if (!tip?.height || !tip.timestamp) {
    return setTimedCache(bitcoinOnchainCache, 'bitcoin', null, BITCOIN_ONCHAIN_CACHE_TTL_MS);
  }

  const tipTimestamp = tip.timestamp;
  const tipHeight = tip.height;
  const windowStartTimestamp = tipTimestamp - 86_400;
  const collected = new Map<number, MempoolBlock>();
  let page = firstPage;
  let nextHeight = tipHeight;

  for (let pageIndex = 0; pageIndex < 24; pageIndex += 1) {
    for (const block of page) {
      if (typeof block.height !== 'number') continue;
      collected.set(block.height, block);
    }

    const oldest = page[page.length - 1];
    if (!oldest?.height || !oldest.timestamp || oldest.timestamp < windowStartTimestamp) {
      break;
    }

    nextHeight = oldest.height - 1;
    page = await fetchMempoolBlocksPage(nextHeight);
    if (page.length === 0) break;
  }

  const blocksInWindow = [...collected.values()]
    .filter((block) =>
      typeof block.timestamp === 'number' &&
      block.timestamp >= windowStartTimestamp &&
      block.timestamp <= tipTimestamp,
    )
    .sort((a, b) => (a.height ?? 0) - (b.height ?? 0));

  const confirmedTransactionCount = blocksInWindow.reduce(
    (sum, block) => sum + (typeof block.tx_count === 'number' ? block.tx_count : 0),
    0,
  );
  const totalFeesSats = blocksInWindow.reduce(
    (sum, block) => sum + (typeof block.extras?.totalFees === 'number' ? block.extras.totalFees : 0),
    0,
  );
  const totalOutputSats = blocksInWindow.reduce(
    (sum, block) =>
      sum + (typeof block.extras?.totalOutputAmt === 'number' ? block.extras.totalOutputAmt : 0),
    0,
  );

  if (blocksInWindow.length === 0 || confirmedTransactionCount === 0) {
    return setTimedCache(bitcoinOnchainCache, 'bitcoin', null, BITCOIN_ONCHAIN_CACHE_TTL_MS);
  }

  return setTimedCache(
    bitcoinOnchainCache,
    'bitcoin',
    {
      source: 'Mempool.space blocks API',
      chain: 'Bitcoin',
      window: 'last_24h_from_tip',
      latest_block_height: tipHeight,
      latest_block_time: unixToIso(tipTimestamp) ?? new Date(tipTimestamp * 1000).toISOString(),
      window_start_time: new Date(windowStartTimestamp * 1000).toISOString(),
      confirmed_transaction_count_24h: confirmedTransactionCount,
      block_count_24h: blocksInWindow.length,
      average_transactions_per_block: Number(
        (confirmedTransactionCount / blocksInWindow.length).toFixed(2),
      ),
      ...(totalFeesSats > 0 ? { total_fees_btc_24h: Number((totalFeesSats / 100_000_000).toFixed(8)) } : {}),
      ...(totalOutputSats > 0 ? { total_output_btc_24h: Number((totalOutputSats / 100_000_000).toFixed(8)) } : {}),
    },
    BITCOIN_ONCHAIN_CACHE_TTL_MS,
  );
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
    FAST_GDELT_FETCH_TIMEOUT_MS,
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
  const cleanRssField = (value: string): string =>
    decodeXmlEntities(value)
      .replace(/^<!\[CDATA\[/i, '')
      .replace(/\]\]>$/i, '')
      .trim();
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
    const rawDescription = block.match(/<description>([\s\S]*?)<\/description>/i)?.[1];
    const rawPubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1];
    const rawSourceUrl = block.match(/<source\s+url="([^"]+)"/i)?.[1];
    const rawSourceName = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1];

    if (!rawTitle || !rawLink) continue;

    const title = normalizeSourceText(cleanRssField(rawTitle.trim()), { stripChrome: true });
    const link = cleanRssField(rawLink.trim());
    const sourceUrl = rawSourceUrl ? cleanRssField(rawSourceUrl.trim()) : undefined;
    const lastSeparator = title.lastIndexOf(' - ');
    const publisher = rawSourceName
      ? normalizeSourceText(cleanRssField(rawSourceName.trim()), { stripChrome: true })
      : lastSeparator > 0
        ? title.slice(lastSeparator + 3).trim()
        : undefined;
    const cleanTitle =
      lastSeparator > 0 ? title.slice(0, lastSeparator).trim() : title;
    const description = normalizeSourceText(
      stripHtml(cleanRssField((rawDescription || '').trim())),
      { stripChrome: true, collapseWhitespace: true },
    );
    const publishedAt = rawPubDate ? new Date(rawPubDate).toISOString() : undefined;
    const preferredUrl = sourceUrl && !isLikelyHomepageUrl(sourceUrl) ? sourceUrl : link;
    const publisherDomain = extractHostname(sourceUrl) || extractHostname(preferredUrl);

    snapshots.push({
      title: cleanTitle,
      url: preferredUrl,
      article_url: link,
      publisher,
      domain: publisherDomain,
      description: description || undefined,
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
      const directUrl =
        resolvedUrl && !isGoogleNewsUrl(resolvedUrl) && !isLikelyHomepageUrl(resolvedUrl)
          ? resolvedUrl
          : await recoverDirectArticleUrlFromSearch({
              title: snapshot.title,
              publisher: snapshot.publisher,
              domain: snapshot.domain,
            });
      return {
        ...snapshot,
        article_url: snapshot.url,
        url: directUrl || resolvedUrl,
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

function buildRelevantQueryWords(
  task: string,
  understanding?: MarketUnderstanding | null,
): string[] {
  if (/\bprediction market\b/i.test(task)) {
    const tokens = new Set<string>();
    const addToken = (value: string | null | undefined) => {
      for (const token of (value || '')
        .toLowerCase()
        .replace(/[^\w\s.-]/g, ' ')
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 2)) {
        if (
          [
            'will',
            'before',
            'after',
            'reach',
            'launch',
            'mainnet',
            'market',
            'prediction',
            'topic',
            'listed',
            'outcomes',
            'agentflow',
            'provider',
            'category',
            'address',
            'reference',
            'searching',
            'focus',
            'example',
            'should',
            'researched',
            'real',
            'world',
            'event',
          ].includes(token)
        ) {
          continue;
        }
        tokens.add(token);
      }
    };
    addToken(extractPredictionMarketQuestion(task));
    addToken(understanding?.entity?.canonicalName);
    for (const alias of understanding?.entity?.aliases ?? []) addToken(alias);
    addToken(understanding?.underlying || undefined);
    if (extractPredictionMarketCategory(task) === 'crypto') {
      addToken('blockchain');
      addToken('crypto');
      if (understanding?.questionType === 'launch_milestone') {
        addToken('mainnet');
        addToken('testnet');
        addToken('roadmap');
      }
    }
    return [...tokens].slice(0, 12);
  }

  return task
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 3)
    .filter(
      (word) =>
        ![
          'what',
          'when',
          'where',
          'which',
          'about',
          'from',
          'with',
          'current',
          'latest',
          'recent',
          'today',
          'president',
          'prime',
          'minister',
          'person',
          'people',
        ].includes(word),
    );
}

function isSimpleIdentityLookup(task: string): boolean {
  const cleaned = stripExecutionContext(task).trim();
  if (!cleaned) return false;
  if (isTimeSensitiveTask(cleaned) && !/\bcurrent president\b|\bpresident of\b/i.test(cleaned)) {
    return false;
  }
  return /^(?:who|what)\s+(?:is|was|are|were)\s+[^?]{2,80}\??$/i.test(cleaned) ||
    /^[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,4}\s+(?:the\s+)?(?:current\s+)?(?:president|prime minister|ceo|founder|chair|leader)(?:\s+of\s+[\w\s.'-]+)?\??$/i.test(cleaned);
}

function normalizeIdentityLookupQuery(task: string): string {
  const cleaned = stripExecutionContext(task)
    .replace(/[?.,:;()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const whoMatch = cleaned.match(/^(?:who|what)\s+(?:is|was|are|were)\s+(.+)$/i);
  const subject = (whoMatch?.[1] ?? cleaned)
    .replace(/\b(?:the\s+)?(?:current\s+)?(?:president|prime minister|ceo|founder|chair|leader)(?:\s+of\s+[\w\s.'-]+)?$/i, '')
    .replace(/\b(?:of|from|for)\s+(?:the\s+)?(?:usa|u\.s\.a\.|united states|america)$/i, '')
    .replace(/\bthe\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return subject || cleaned;
}

function isArticleRelevantToTask(article: GdeltArticleSnapshot, task: string): boolean {
  const queryWords = buildRelevantQueryWords(task);
  if (queryWords.length === 0) return true;
  const haystack = [
    article.title,
    article.description,
    article.url,
    article.article_url,
    article.publisher,
    article.domain,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return queryWords.some((word) =>
    new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(haystack),
  );
}

function currentEventTopicAnchors(
  task: string,
  understanding?: MarketUnderstanding | null,
): RegExp[] {
  const anchors: RegExp[] = [];
  if (/\bx402\b/i.test(task)) anchors.push(/\bx402\b/i);
  if (/\bopenai\b|\bchatgpt\b/i.test(task)) anchors.push(/\bopenai\b|\bchatgpt\b/i);
  if (/\bstablecoin\b|\busdc\b|\busd coin\b/i.test(task)) {
    anchors.push(/\bstablecoin\b|\busdc\b|\busd[- ]coin\b/i);
  }
  if (/\bbitcoin\b|\bbtc\b/i.test(task)) anchors.push(/\bbitcoin\b|\bbtc\b/i);
  if (/\bethereum\b|\beth\b/i.test(task)) anchors.push(/\bethereum\b|\beth\b/i);
  if (/\bsolana\b|\bsol\b/i.test(task)) anchors.push(/\bsolana\b|\bsol\b/i);
  if (/\biran\b/i.test(task)) anchors.push(/\biran\b/i);
  if (isArcNetworkTask(task)) anchors.push(/\barc\b|\barc\.network\b/i);
  if (/\bprediction market\b/i.test(task) && understanding?.entity) {
    const canonical = understanding.entity.canonicalName.toLowerCase().trim();
    if (canonical.includes('arc network')) {
      anchors.push(/\barc network\b|\barc\.io\b|\barc\.network\b|\bdocs\.arc\.io\b/i);
    } else if (
      canonical.includes('grand theft auto vi') ||
      canonical.includes('grand theft auto 6')
    ) {
      anchors.push(/\bgta\s*(?:6|vi)\b|\bgrand theft auto\s*(?:6|vi)\b/i);
    } else if (canonical) {
      anchors.push(new RegExp(`\\b${escapeRegex(canonical)}\\b`, 'i'));
    }
  }
  return anchors;
}

function isStronglyRelevantCurrentEventArticle(
  article: GdeltArticleSnapshot,
  task: string,
  understanding?: MarketUnderstanding | null,
): boolean {
  if (!isArticleRelevantToTask(article, task)) return false;
  if (/\bprediction market\b/i.test(task) && understanding?.entity) {
    const pseudoSnapshot: FirecrawlArticleSnapshot = {
      title: article.title,
      url: article.url || article.article_url || '',
      publisher: article.publisher,
      seen_at: article.seen_at,
      summary:
        normalizeSourceText(article.description || '', {
          stripChrome: true,
          collapseWhitespace: true,
        }) || article.title,
    };
    return isEntityRelevantPredictionMarketSource(pseudoSnapshot, task, understanding);
  }
  const queryWords = buildRelevantQueryWords(task, understanding);
  if (queryWords.length > 0) {
    const haystack = [
      article.title,
      article.description,
      article.url,
      article.article_url,
      article.publisher,
      article.domain,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!queryWords.some((word) => new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(haystack))) {
      return false;
    }
  }
  const anchors = currentEventTopicAnchors(task, understanding);
  if (anchors.length === 0) return true;
  const haystack = [
    article.title,
    article.description,
    article.url,
    article.article_url,
    article.publisher,
    article.domain,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return anchors.some((anchor) => anchor.test(haystack));
}

function buildMetadataSummaryFromArticle(article: GdeltArticleSnapshot): string {
  const description = normalizeSourceText(article.description || '', {
    stripChrome: true,
    collapseWhitespace: true,
  });
  const title = normalizeSourceText(article.title || '', {
    stripChrome: true,
    collapseWhitespace: true,
  });
  const combined =
    description && title && !description.toLowerCase().includes(title.toLowerCase())
      ? `${title}. ${description}`
      : description || title;
  return truncateSentences(combined, 320) || title;
}

function buildMetadataSnapshotFromArticle(
  article: GdeltArticleSnapshot,
  urlOverride?: string,
): FirecrawlArticleSnapshot | null {
  const url = (urlOverride || article.url || article.article_url || '').trim();
  if (!url || isGoogleConsentUrl(url) || isLikelyHomepageUrl(url)) {
    return null;
  }

  const summary = buildMetadataSummaryFromArticle(article);
  if (!summary || isGoogleConsentInterstitialText(summary)) {
    return null;
  }

  return {
    title: article.title,
    url,
    publisher: article.publisher,
    seen_at: article.seen_at,
    summary,
  };
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

    const xml = await decodeTextResponse(response);
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

      const title = normalizeSourceText(decodeXmlEntities(rawTitle.trim()), { stripChrome: true });
      const link = decodeXmlEntities(rawLink.trim());
      const description = normalizeSourceText(
        stripHtml(decodeXmlEntities(rawDescription.trim())),
        { stripChrome: true, collapseWhitespace: true },
      );
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

const GEOPOLITICAL_ARTICLE_PATTERN =
  /\b(?:war|conflict|ceasefire|missile|airstrike|air\s?strike|drone\s+strike|troops?|sanctions?|blockade|strait\s+of\s+hormuz|hormuz|red\s+sea|suez|houthi|tankers?|warship|naval|israel|hamas|hezbollah|gaza|iran|iranian|ukraine|russia|taiwan|yemen|lebanon|syria)\b/i;

function articleLooksGeopolitical(
  title: string | undefined,
  summary: string | undefined,
  publisher: string | undefined,
): boolean {
  return GEOPOLITICAL_ARTICLE_PATTERN.test(`${title ?? ''} ${summary ?? ''} ${publisher ?? ''}`);
}

async function fetchCurrentEventsData(
  task: string,
  options?: { bypassCache?: boolean; understanding?: MarketUnderstanding | null },
): Promise<CurrentEventsSnapshot | null> {
  const queryVariants = buildCurrentEventQueries(task, options?.understanding);
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
  if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(task)) {
    console.error(
      `[RETR][current-events] task="${task.slice(0, 80)}" queries=${queryVariants.length} statusQueries=${statusQueryVariants.length}`,
    );
    for (let index = 0; index < queryVariants.length; index += 1) {
      const gdeltCount = gdeltGroups[index]?.length ?? 0;
      const rssCount = rssGroups[index]?.length ?? 0;
      const rssPreview = (rssGroups[index] ?? [])
        .slice(0, 3)
        .map((article) => `${article.publisher || article.domain || '?'}::${article.title}`)
        .join(' | ');
      console.error(
        `[RETR][current-events]   query="${queryVariants[index]}" gdelt=${gdeltCount} rss=${rssCount}${rssPreview ? ` rssPreview=${rssPreview}` : ''}`,
      );
    }
  }
  const groups = [...gdeltGroups, ...rssGroups];
  const statusGroups = [...statusGdeltGroups, ...statusRssGroups];

  let relevantFirecrawlSearchSnapshots = firecrawlSearchSnapshots.filter((snapshot) =>
    isStronglyRelevantCurrentEventArticle(
      snapshotToCurrentEventArticle(snapshot),
      task,
      options?.understanding,
    ),
  );
  let merged = mergeCurrentEventArticles(groups).filter((article) =>
    isStronglyRelevantCurrentEventArticle(article, task, options?.understanding),
  );
  if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(task)) {
    console.error(
      `[RETR][current-events]   firecrawlRelevant=${relevantFirecrawlSearchSnapshots.length} mergedRelevant=${merged.length}`,
    );
    if (merged.length > 0) {
      console.error(
        `[RETR][current-events]   mergedTitles=${merged
          .slice(0, 6)
          .map((article) => `${article.publisher || article.domain || '?'}::${article.title}`)
          .join(' | ')}`,
      );
    }
  }
  if (merged.length === 0 && relevantFirecrawlSearchSnapshots.length > 0) {
    merged = relevantFirecrawlSearchSnapshots.map(snapshotToCurrentEventArticle);
  }

  // When the research topic is not itself geopolitical, drop conflict/shipping articles.
  // Thin retrieval (e.g. a sports or games prediction market) otherwise falls back to the
  // dominant live geopolitical news, which then contaminates the report with off-topic
  // shipping sources and framing. Stay thin rather than surface unrelated news.
  if (detectResearchDomain(task) !== 'geopolitics') {
    relevantFirecrawlSearchSnapshots = relevantFirecrawlSearchSnapshots.filter(
      (snapshot) => !articleLooksGeopolitical(snapshot.title, snapshot.summary, snapshot.publisher),
    );
    merged = merged.filter(
      (article) => !articleLooksGeopolitical(article.title, undefined, article.publisher),
    );
  }

  if (merged.length === 0) {
    if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(task)) {
      console.error('[RETR][current-events]   merged emptied before snapshot selection');
    }
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
    relevantFirecrawlSearchSnapshots.length > 0
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
    relevantFirecrawlSearchSnapshots.length > 0
        ? relevantFirecrawlSearchSnapshots
        : (fallbackSnapshots.length > 0
            ? fallbackSnapshots
            : (recentArticles.length > 0 ? recentArticles : merged)
                .slice(0, 4)
                .map((article) => buildMetadataSnapshotFromArticle(article))
                .filter((snapshot): snapshot is FirecrawlArticleSnapshot => Boolean(snapshot))
          ).filter((snapshot) =>
          isStronglyRelevantCurrentEventArticle(
            snapshotToCurrentEventArticle(snapshot),
            task,
            options?.understanding,
          ),
        );
  if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(task)) {
    console.error(
      `[RETR][current-events]   fallbackSnapshots=${fallbackSnapshots.length} articleSnapshots=${articleSnapshots.length} selectedArticlesBase=${(recentArticles.length > 0 ? recentArticles : backgroundArticles).length}`,
    );
    if (articleSnapshots.length > 0) {
      console.error(
        `[RETR][current-events]   snapshotUrls=${articleSnapshots
          .slice(0, 6)
          .map((snapshot) => snapshot.url)
          .join(' | ')}`,
      );
    }
  }
  const snapshotArticles = articleSnapshots.map(snapshotToCurrentEventArticle);
  const predictionMarketSelectedArticles = /\bprediction market\b/i.test(task)
    ? (() => {
        const ordered = [
          ...snapshotArticles,
          ...(recentArticles.length > 0 ? recentArticles : backgroundArticles),
          ...merged,
        ];
        const selected: GdeltArticleSnapshot[] = [];
        const seen = new Set<string>();
        for (const article of ordered) {
          if (!isStronglyRelevantCurrentEventArticle(article, task, options?.understanding)) continue;
          const key = normalizeArticleKey(article);
          if (seen.has(key)) continue;
          seen.add(key);
          selected.push(article);
          if (selected.length >= 4) break;
        }
        return selected;
      })()
    : [];
  const rankedEvidenceArticles = mergeCurrentEventArticles([
    snapshotArticles,
    recentArticles.length > 0 ? recentArticles : backgroundArticles,
  ]).filter((article) =>
    isStronglyRelevantCurrentEventArticle(article, task, options?.understanding),
  );
  const selectedArticles =
    predictionMarketSelectedArticles.length > 0
      ? predictionMarketSelectedArticles
      : rankedEvidenceArticles.length > 0
      ? rankedEvidenceArticles.slice(0, 4)
      : snapshotArticles.length > 0
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
        ? 'Targeted Firecrawl scrape with GDELT document API and Google News RSS support'
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
  if (isGoogleConsentUrl(url)) return null;

  const cached = options?.bypassCache ? null : getCacheValue(firecrawlArticleCache.get(url));
  if (cached) {
    return cached;
  }

  try {
    const markdown = await fetchUrlViaFirecrawl(url);
    const summary = markdownToSnippet(markdown);
    if (
      !summary ||
      isGoogleConsentInterstitialText(article.title) ||
      isGoogleConsentInterstitialText(summary)
    ) {
      const metadataSnapshot = buildMetadataSnapshotFromArticle(article, url);
      if (!options?.bypassCache) {
        firecrawlArticleCache.set(url, {
          value: metadataSnapshot,
          expiresAt: Date.now() + FIRECRAWL_CACHE_TTL_MS,
        });
      }
      return metadataSnapshot;
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
    const metadataSnapshot = buildMetadataSnapshotFromArticle(article, url);
    if (!options?.bypassCache) {
      firecrawlArticleCache.set(url, {
        value: metadataSnapshot,
        expiresAt: Date.now() + FIRECRAWL_CACHE_TTL_MS,
      });
    }
    return metadataSnapshot;
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

const GENERIC_QUERY_STOPWORDS = new Set([
  'research',
  'researching',
  'news',
  'newest',
  'latest',
  'recent',
  'current',
  'updates',
  'update',
  'analysis',
  'analyze',
  'report',
  'reports',
  'reporting',
  'about',
  'on',
  'regarding',
  'today',
  'now',
  'state',
  'status',
  'make',
  'give',
  'tell',
  'show',
  'find',
  'me',
  'my',
]);

const GENERIC_RSS_LABEL_TERMS = new Set([
  'ai',
  'research',
  'crypto',
  'defi',
  'markets',
  'economy',
  'world',
  'news',
  'business',
  'government',
  'regulation',
  'legal',
  'community',
]);

export function buildRssMatchTerms(task: string): string[] {
  const terms = new Set<string>();
  const predictionQuestion = isPredictionMarketResearchTask(task)
    ? extractPredictionMarketQuestion(task)
    : null;
  const cleaned = (predictionQuestion || task).toLowerCase().replace(/[^\w\s-]/g, ' ');
  for (const raw of cleaned.split(/\s+/)) {
    const w = raw.trim();
    if (w.length < 2 || RSS_MATCH_STOPWORDS.has(w) || GENERIC_QUERY_STOPWORDS.has(w)) continue;
    terms.add(w);
  }
  if (isPredictionMarketResearchTask(task)) {
    if (/\bxaut\b|\btether gold\b/i.test(cleaned)) {
      terms.add('xaut');
      terms.add('gold');
      terms.add('bullion');
      terms.add('tether gold');
    }
    if (
      /\bPrediction market category in AgentFlow:\s*Crypto\b/i.test(task) &&
      /\barc\b/i.test(cleaned) &&
      /\b(mainnet|launch|testnet)\b/i.test(cleaned)
    ) {
      terms.add('arc');
      terms.add('mainnet');
      terms.add('blockchain');
      terms.add('stablecoin');
      terms.add('testnet');
    }
    if (/\b(world cup|fifa)\b/i.test(cleaned)) {
      terms.add('fifa');
      terms.add('world cup');
      terms.add('odds');
      terms.add('favorites');
    }
    if (/\b(gta 6|grand theft auto)\b/i.test(cleaned)) {
      terms.add('gta');
      terms.add('rockstar');
      terms.add('release');
    }
  }
  for (const label of classifyTopic(task).labels) {
    const l = label.toLowerCase().trim();
    if (
      l.length >= 2 &&
      !RSS_MATCH_STOPWORDS.has(l) &&
      !GENERIC_QUERY_STOPWORDS.has(l) &&
      !GENERIC_RSS_LABEL_TERMS.has(l)
    ) {
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
  const cleanRssField = (value: string): string =>
    decodeXmlEntities(value)
      .replace(/^<!\[CDATA\[/i, '')
      .replace(/\]\]>$/i, '')
      .trim();
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

  const title = normalizeSourceText(cleanRssField(rawTitle.trim()), { stripChrome: true });
  const link = cleanRssField(rawLink.trim());
  const description = normalizeSourceText(
    stripHtml(cleanRssField(rawDescription.trim())),
    { stripChrome: true, collapseWhitespace: true },
  );
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

  for (const rssUrl of source.rssUrls.slice(0, 2)) {
    try {
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': 'AgentFlow Research Bot' },
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) continue;

      const xml = await decodeTextResponse(res);
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
          description,
          language: 'English',
          seen_at: seenAt,
        };

        if (isRelevant) {
          results.push(snapshot);
          if (results.length >= 5) break;
        }
      }
    } catch (err) {
      console.warn(`[live-data] RSS fetch failed for ${source.name}:`, err);
    }
  }

  if (results.length > 0) {
    return results.slice(0, 5);
  }
  return [];
}

export async function fetchDynamicSources(task: string): Promise<GdeltArticleSnapshot[]> {
  const cacheKey = task.trim().toLowerCase();
  const cached = getCacheValue(dynamicRssCache.get(cacheKey));
  if (cached) return cached;

  const predictionCategory = /\bprediction market\b/i.test(task)
    ? extractPredictionMarketCategory(task)
    : null;
  const classificationTask = predictionCategory
    ? normalizeLiveDataSearchTask(task)
    : task;
  const { labels } = classifyTopic(classificationTask);
  const protocolQueryShape = detectProtocolQueryShape(task);
  let sources = SOURCE_REGISTRY.filter((source) => source.enabled && source.rssUrls?.length);
  const predictionCryptoTask =
    /\bprediction market\b/i.test(task) && predictionCategory === 'crypto';
  if (predictionCryptoTask) {
    const cryptoOnly = sources.filter((s) =>
      s.topics.some((topic) =>
        ['crypto', 'defi', 'blockchain', 'token', 'web3', 'onchain', 'stablecoin', 'bitcoin', 'ethereum', 'markets'].includes(
          topic,
        ),
      ),
    );
    if (cryptoOnly.length > 0) {
      sources = cryptoOnly;
    }
  }
  if (predictionCategory === 'sports') {
    const sportsOnly = sources.filter((s) =>
      s.topics.some((topic) =>
        ['sports', 'football', 'soccer', 'betting', 'odds'].includes(topic),
      ) || /\b(?:espn|cbs sports|sporting news|fifa|uefa|the analyst|oddschecker|action network|fox sports|bbc sport)\b/i.test(s.name),
    );
    if (sportsOnly.length > 0) {
      sources = sportsOnly;
    }
  }
  if (predictionCategory === 'games' || predictionCategory === 'gaming') {
    const gamesOnly = sources.filter((s) =>
      s.topics.some((topic) =>
        ['gaming', 'games', 'entertainment', 'technology'].includes(topic),
      ) || /\b(?:ign|gamespot|polygon|eurogamer|rockstar|playstation|xbox|steam)\b/i.test(s.name),
    );
    if (gamesOnly.length > 0) {
      sources = gamesOnly;
    }
  }
  if (!predictionCategory && labels.length > 0) {
    const narrowed = sources.filter((s) => s.topics.some((t) => labels.includes(t)));
    if (narrowed.length > 0) {
      sources = narrowed;
    } else {
      // e.g. Arc / DefiLlama are API-only in the registry — do not fall back to unrelated world-news RSS.
      sources = [];
    }
  } else if (protocolQueryShape !== 'none') {
    const narrowed = sources.filter((s) =>
      s.topics.some((topic) =>
        ['crypto', 'defi', 'blockchain', 'token', 'web3', 'onchain', 'stablecoin', 'ethereum', 'l2'].includes(
          topic,
        ),
      ),
    );
    if (narrowed.length > 0) {
      sources = narrowed;
    }
  }

  sources = rankDynamicRssSources(task, sources).slice(0, 5);

  if (sources.length === 0) {
    console.log(
      `[live-data] selected sources: (no RSS-capable sources matched topic labels: ${labels.join(', ') || 'none'})`,
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
  if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(task)) {
    console.error(
      `[RETR][dynamic-rss] task="${task.slice(0, 80)}" selectedSources=${sources.length} raw=${all.length} deduped=${result.length}`,
    );
    if (result.length > 0) {
      console.error(
        `[RETR][dynamic-rss]   urls=${result
          .slice(0, 8)
          .map((item) => `${item.publisher || item.domain || '?'}::${item.title}`)
          .join(' | ')}`,
      );
    }
  }
  return setTimedCache(dynamicRssCache, cacheKey, result, DYNAMIC_RSS_CACHE_TTL_MS);
}

function rankDynamicRssSources(task: string, sources: SourceConfig[]): SourceConfig[] {
  const { labels } = classifyTopic(task);
  const queryLower = task.toLowerCase();

  const scored = sources.map((source) => {
    let score = 0;
    const overlap = source.topics.filter((topic) => {
      if (labels.includes(topic)) return true;
      if (topic.length < 3) return false;
      try {
        return new RegExp(`\\b${topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
          queryLower,
        );
      } catch {
        return queryLower.includes(topic);
      }
    }).length;

    if (queryLower.includes(source.name.toLowerCase())) {
      score += 6;
    }
    score += overlap * 3;

    const trustScore: Record<SourceConfig['trust'], number> = {
      high: 4,
      medium_high: 3,
      medium: 2,
      low_medium: 1,
    };
    score += trustScore[source.trust];

    if (source.speed === 'fast') score += 2;
    if (source.speed === 'medium') score += 1;
    if (source.cost === 'low') score += 1;
    score += source.priority * 0.5;

    return { source, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored.map((entry) => entry.source);
}

export async function fetchLiveData(
  task: string,
  options?: { originalTask?: string; understanding?: MarketUnderstanding | null },
): Promise<string> {
  const contextTask = options?.originalTask?.trim() || task;
  const isPredictionMarketTask = /\bprediction market\b/i.test(contextTask);
  const sourceTask = normalizeLiveDataSearchTask(task);
  const normalizedTask = sourceTask.trim().toLowerCase();
  const bypassCurrentEventCache = shouldBypassCurrentEventCaches(sourceTask);
  const useLiveDataCache = !bypassCurrentEventCache && !isPredictionMarketTask;
  const cached = useLiveDataCache ? getCacheValue(liveDataCache.get(normalizedTask)) : null;
  if (cached) {
    return cached;
  }

  const snapshotAt = new Date().toISOString();
  const researchDomain = detectResearchDomain(contextTask);
  // Prediction-market research needs Firecrawl/SearXNG evidence even when current events
  // are gathered, otherwise a price market collapses to a single CoinGecko snapshot.
  let predictionMarketUnderstanding = isPredictionMarketTask
    ? options?.understanding ??
      (await understandMarketResearch(contextTask, { timeoutMs: 20_000 }).catch(() => null))
    : null;
  const shouldFetchCurrentEvents =
    shouldGatherCurrentEvents(contextTask) ||
    isPredictionMarketTask;
  const shouldAlsoFetchFirecrawl =
    shouldFetchCurrentEvents && (isCreatorAudienceMetricTask(sourceTask) || isPredictionMarketTask);
  const firecrawlQuerySeed = predictionMarketUnderstanding
    ? buildPredictionMarketSearchSeed(contextTask, predictionMarketUnderstanding)
    : isPredictionMarketTask
      ? // Prediction-market task but LLM understanding failed: derive a deterministic
        // subject seed instead of searching the literal market sentence.
        buildPredictionMarketSearchSeed(contextTask, null)
      : task;
  const firecrawlQueryVariants = buildPrimaryFirecrawlQueryVariants(
    firecrawlQuerySeed,
    contextTask,
    predictionMarketUnderstanding,
  );
  const payload: Record<string, unknown> = {
    snapshot_at: snapshotAt,
    research_domain: researchDomain,
    ...(predictionMarketUnderstanding
      ? {
          prediction_market_understanding: predictionMarketUnderstanding,
          research_brief: buildPredictionMarketResearchBrief(
            contextTask,
            predictionMarketUnderstanding,
          ),
        }
      : {}),
  };

  if (researchDomain === 'crypto') {
    const [firecrawlEvidence, registryArticleEvidence, officialSearchEvidence, officialFallbackEvidence, coingecko, bitcoinOnchain, defillama, wikipedia, currentEvents] =
      await Promise.allSettled([
        shouldFetchCurrentEvents && !isPredictionMarketTask
          ? Promise.resolve([] as FirecrawlArticleSnapshot[])
          : fetchFirecrawlSearchSnapshots(firecrawlQueryVariants, contextTask, {
              bypassCache: bypassCurrentEventCache,
              understanding: predictionMarketUnderstanding,
            }),
        isPredictionMarketTask
          ? fetchPredictionMarketRegistryArticleEvidence(
              contextTask,
              predictionMarketUnderstanding,
            )
          : Promise.resolve([] as FirecrawlArticleSnapshot[]),
        isPredictionMarketTask
          ? fetchPredictionMarketOfficialSearchEvidence(
              contextTask,
              predictionMarketUnderstanding,
            )
          : Promise.resolve([] as FirecrawlArticleSnapshot[]),
        isPredictionMarketTask
          ? fetchPredictionMarketOfficialFallbackEvidence(
              contextTask,
              predictionMarketUnderstanding,
            )
          : Promise.resolve([] as FirecrawlArticleSnapshot[]),
        fetchCoinGeckoData(sourceTask),
        fetchBitcoinOnchainData(sourceTask),
        shouldFetchDefiLlamaDataForTask(contextTask, predictionMarketUnderstanding)
          ? fetchDefiLlamaData(sourceTask)
          : Promise.resolve([] as DefiLlamaChainSnapshot[]),
        fetchWikipediaData(
          predictionMarketUnderstanding?.subject || sourceTask,
          researchDomain,
        ),
        shouldFetchCurrentEvents
          ? fetchCurrentEventsData(contextTask, {
              bypassCache: bypassCurrentEventCache,
              understanding: predictionMarketUnderstanding,
            })
          : Promise.resolve(null),
      ]);

    if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(contextTask)) {
      console.error(
        `[RETR][crypto] firecrawl=${firecrawlEvidence.status === 'fulfilled' ? firecrawlEvidence.value.length : 'ERR'} registry=${
          registryArticleEvidence.status === 'fulfilled' ? registryArticleEvidence.value.length : 'ERR'
        } officialSearch=${
          officialSearchEvidence.status === 'fulfilled' ? officialSearchEvidence.value.length : 'ERR'
        } officialFallback=${
          officialFallbackEvidence.status === 'fulfilled' ? officialFallbackEvidence.value.length : 'ERR'
        } currentEvents=${
          currentEvents.status === 'fulfilled'
            ? ((currentEvents.value?.article_snapshots?.length ?? 0) as number)
            : 'ERR'
        }`,
      );
    }

    if (firecrawlEvidence.status === 'fulfilled') {
      const currentEventsValue =
        currentEvents.status === 'fulfilled' ? currentEvents.value : null;
      const combinedEvidence = [
        ...(firecrawlEvidence.value ?? []),
        ...(registryArticleEvidence.status === 'fulfilled' ? registryArticleEvidence.value : []),
        ...(officialSearchEvidence.status === 'fulfilled' ? officialSearchEvidence.value : []),
        ...(officialFallbackEvidence.status === 'fulfilled' ? officialFallbackEvidence.value : []),
      ];
      const taskFilteredEvidence = filterLowValueEvidenceForTask(contextTask, combinedEvidence);
      let finalFirecrawlEvidence = filterPredictionMarketResearchEvidence(
        contextTask,
        taskFilteredEvidence,
        predictionMarketUnderstanding,
      );
      if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(contextTask)) {
        console.error(
          `[RETR][crypto] combined=${combinedEvidence.length} taskFiltered=${taskFilteredEvidence.length} filtered=${finalFirecrawlEvidence.length}`,
        );
      }
      finalFirecrawlEvidence = mergePredictionMarketCurrentEventSnapshots(
        contextTask,
        currentEventsValue,
        finalFirecrawlEvidence,
        predictionMarketUnderstanding,
      );
      if (process.env.RETR_DEBUG && /\bprediction market\b/i.test(contextTask)) {
        console.error(
          `[RETR][crypto] afterCurrentEvents=${finalFirecrawlEvidence.length} currentSnapshots=${
            currentEventsValue?.article_snapshots?.length ?? 0
          }`,
        );
      }
      if (finalFirecrawlEvidence.length < 3) {
        const recoveredEvidence = await recoverPredictionMarketSnapshotsFromCurrentEvents(
          contextTask,
          currentEventsValue,
          predictionMarketUnderstanding,
        );
        if (recoveredEvidence.length > 0) {
          finalFirecrawlEvidence = selectPredictionMarketEvidenceWithHostDiversity(
            contextTask,
            filterPredictionMarketResearchEvidence(
              contextTask,
              [...finalFirecrawlEvidence, ...recoveredEvidence],
              predictionMarketUnderstanding,
            ),
            PREDICTION_MARKET_EVIDENCE_LIMIT,
          );
        }
      }
      if (finalFirecrawlEvidence.length > 0) {
        const hasOfficialEvidence = finalFirecrawlEvidence.some((snapshot) =>
          isOfficialPredictionMarketSource(snapshot, predictionMarketUnderstanding),
        );
        const hasNonOfficialEvidence = finalFirecrawlEvidence.some(
          (snapshot) => !isOfficialPredictionMarketSource(snapshot, predictionMarketUnderstanding),
        );
        payload.dynamic_sources = {
          source: hasNonOfficialEvidence
            ? hasOfficialEvidence
              ? 'Hybrid live search with supporting official evidence'
              : registryArticleEvidence.status === 'fulfilled' &&
                  registryArticleEvidence.value.length > 0
                ? 'Registry RSS + hybrid live search'
                : 'Hybrid live search (primary evidence)'
            : 'Official-domain evidence only',
          articles: finalFirecrawlEvidence,
        };
        if (predictionMarketUnderstanding) {
          payload.source_diagnostics = buildPredictionMarketSourceDiagnostics(
            contextTask,
            predictionMarketUnderstanding,
            finalFirecrawlEvidence,
            getSearchBackendDiagnostics(),
          );
        }
      }
    }

    if (coingecko.status === 'fulfilled' && coingecko.value.length > 0) {
      payload.coingecko = {
        source: 'CoinGecko simple price API',
        assets: coingecko.value,
      };
    }

    if (bitcoinOnchain.status === 'fulfilled' && bitcoinOnchain.value) {
      payload.bitcoin_onchain = bitcoinOnchain.value;
    }

    if (defillama.status === 'fulfilled' && defillama.value.length > 0) {
      payload.defillama = {
        source: 'DefiLlama chains API + stablecoins API',
        chains: defillama.value,
      };
    }

    if (wikipedia.status === 'fulfilled' && wikipedia.value.length > 0) {
      payload.wikipedia = {
        source: 'Wikipedia OpenSearch + REST summary API',
        pages: wikipedia.value,
      };
    }

    if (currentEvents.status === 'fulfilled' && currentEvents.value) {
      payload.current_events = sanitizePredictionMarketCurrentEvents(
        contextTask,
        currentEvents.value,
        predictionMarketUnderstanding,
      );
    }
  } else if (researchDomain === 'geopolitics') {
    const [currentEvents, wikipedia] = await Promise.allSettled([
      fetchCurrentEventsData(contextTask, {
        bypassCache: bypassCurrentEventCache,
        understanding: predictionMarketUnderstanding,
      }),
      
      fetchWikipediaData(sourceTask, researchDomain),
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

    if (wikipedia.status === 'fulfilled' && wikipedia.value.length > 0) {
      payload.wikipedia = {
        source: 'Wikipedia OpenSearch + REST summary API',
        pages: wikipedia.value,
      };
    }
  } else {
    const identityLookup = isSimpleIdentityLookup(sourceTask);
    const lookupTask = identityLookup ? normalizeIdentityLookupQuery(sourceTask) : sourceTask;
    const [firecrawlEvidence, registryArticleEvidence, sportsAuthorityEvidence, officialSearchEvidence, officialFallbackEvidence, wikipedia, currentEvents] = await Promise.all([
      (
        shouldFetchCurrentEvents && !shouldAlsoFetchFirecrawl
          ? Promise.resolve([] as FirecrawlArticleSnapshot[])
          : fetchFirecrawlSearchSnapshots(firecrawlQueryVariants, contextTask, {
              bypassCache: bypassCurrentEventCache,
              understanding: predictionMarketUnderstanding,
            })
      ).catch(() => [] as FirecrawlArticleSnapshot[]),
      isPredictionMarketTask
        ? fetchPredictionMarketRegistryArticleEvidence(
            contextTask,
            predictionMarketUnderstanding,
          ).catch(() => [] as FirecrawlArticleSnapshot[])
        : Promise.resolve([] as FirecrawlArticleSnapshot[]),
      isPredictionMarketTask
        ? fetchPredictionMarketSportsAuthorityEvidence(contextTask, predictionMarketUnderstanding).catch(
            () => [] as FirecrawlArticleSnapshot[],
          )
        : Promise.resolve([] as FirecrawlArticleSnapshot[]),
      isPredictionMarketTask
        ? fetchPredictionMarketOfficialSearchEvidence(
            contextTask,
            predictionMarketUnderstanding,
          ).catch(() => [] as FirecrawlArticleSnapshot[])
        : Promise.resolve([] as FirecrawlArticleSnapshot[]),
      isPredictionMarketTask
        ? fetchPredictionMarketOfficialFallbackEvidence(
            contextTask,
            predictionMarketUnderstanding,
          ).catch(() => [] as FirecrawlArticleSnapshot[])
        : Promise.resolve([] as FirecrawlArticleSnapshot[]),
      fetchWikipediaData(
        predictionMarketUnderstanding?.subject || lookupTask,
        researchDomain,
      ).catch(() => [] as WikipediaPageSnapshot[]),
      (
        !identityLookup && shouldFetchCurrentEvents
          ? fetchCurrentEventsData(contextTask, {
              bypassCache: bypassCurrentEventCache,
              understanding: predictionMarketUnderstanding,
            })
          : Promise.resolve(null)
      ).catch(() => null),
    ]);

    const creatorAudienceTask = isCreatorAudienceMetricTask(sourceTask);
    const preferredPredictionEvidence =
      extractPredictionMarketCategory(contextTask) === 'sports'
        ? [
            ...sportsAuthorityEvidence,
            ...registryArticleEvidence,
            ...officialSearchEvidence,
            ...officialFallbackEvidence,
            ...firecrawlEvidence,
          ]
        : [
            ...registryArticleEvidence,
            ...officialSearchEvidence,
            ...officialFallbackEvidence,
            ...firecrawlEvidence,
            ...sportsAuthorityEvidence,
          ];
    const taskFilteredEvidence = filterLowValueEvidenceForTask(
      contextTask,
      preferredPredictionEvidence,
    );
    const creatorAugmentedEvidence = creatorAudienceTask
      ? augmentCreatorAudienceEvidence(taskFilteredEvidence)
      : taskFilteredEvidence;
    let finalFirecrawlEvidence = creatorAudienceTask
      ? filterCreatorAudienceEvidence(creatorAugmentedEvidence)
      : filterPredictionMarketResearchEvidence(
          contextTask,
          creatorAugmentedEvidence,
          predictionMarketUnderstanding,
        );
    finalFirecrawlEvidence = mergePredictionMarketCurrentEventSnapshots(
      contextTask,
      currentEvents,
      finalFirecrawlEvidence,
      predictionMarketUnderstanding,
    );
    if (
      extractPredictionMarketCategory(contextTask) === 'sports' &&
      sportsAuthorityEvidence.length > 0 &&
      !hasAuthoritativeSportsOddsEvidence(contextTask, finalFirecrawlEvidence)
    ) {
      finalFirecrawlEvidence = selectPredictionMarketEvidenceWithHostDiversity(
        contextTask,
        filterPredictionMarketResearchEvidence(
          contextTask,
          [...sportsAuthorityEvidence, ...finalFirecrawlEvidence],
          predictionMarketUnderstanding,
        ),
        PREDICTION_MARKET_EVIDENCE_LIMIT,
      );
    }
    if (finalFirecrawlEvidence.length < 3) {
      const recoveredEvidence = await recoverPredictionMarketSnapshotsFromCurrentEvents(
        contextTask,
        currentEvents,
        predictionMarketUnderstanding,
      );
      if (recoveredEvidence.length > 0) {
        finalFirecrawlEvidence = selectPredictionMarketEvidenceWithHostDiversity(
          contextTask,
          filterPredictionMarketResearchEvidence(
            contextTask,
            [...finalFirecrawlEvidence, ...recoveredEvidence],
            predictionMarketUnderstanding,
          ),
          PREDICTION_MARKET_EVIDENCE_LIMIT,
        );
      }
    }
    const creatorAudienceMetrics = creatorAudienceTask
      ? await fetchCreatorAudienceMetricSnapshot(finalFirecrawlEvidence)
      : null;

    if (finalFirecrawlEvidence.length > 0) {
      payload.dynamic_sources = {
        source:
          officialSearchEvidence.length > 0 || officialFallbackEvidence.length > 0
          ? 'Official-domain search + Firecrawl evidence'
          : sportsAuthorityEvidence.length > 0
          ? 'Sports authority search + Firecrawl evidence'
          : firecrawlEvidence.length > 0
          ? 'Firecrawl search (primary evidence)'
          : 'Filtered live article evidence',
        articles: finalFirecrawlEvidence,
      };
      if (predictionMarketUnderstanding) {
        payload.source_diagnostics = buildPredictionMarketSourceDiagnostics(
          contextTask,
          predictionMarketUnderstanding,
          finalFirecrawlEvidence,
          getSearchBackendDiagnostics(),
        );
      }
    }

    if (creatorAudienceMetrics) {
      payload.creator_audience_metrics = creatorAudienceMetrics;
    }

    if (wikipedia.length > 0) {
      payload.wikipedia = {
        source: 'Wikipedia OpenSearch + REST summary API',
        pages: wikipedia,
      };
    }

    if (currentEvents) {
      payload.current_events = sanitizePredictionMarketCurrentEvents(
        contextTask,
        currentEvents,
        predictionMarketUnderstanding,
      );
    }

  }

  if (predictionMarketUnderstanding && !payload.source_diagnostics) {
    payload.source_diagnostics = buildPredictionMarketSourceDiagnostics(
      contextTask,
      predictionMarketUnderstanding,
      [],
      getSearchBackendDiagnostics(),
    );
  }

  const hasSourceData = Boolean(
      payload.coingecko ||
      payload.bitcoin_onchain ||
      payload.defillama ||
      payload.duckduckgo ||
      payload.wikipedia ||
      payload.gdelt ||
      payload.current_events ||
      payload.the_hacker_news ||
      payload.dynamic_sources,
  );
  const result = hasSourceData ? JSON.stringify(payload, null, 2) : '';

  if (normalizedTask && useLiveDataCache && hasSourceData) {
    liveDataCache.set(normalizedTask, {
      value: result,
      expiresAt: Date.now() + LIVE_DATA_CACHE_TTL_MS,
    });
  }

  return result;
}
