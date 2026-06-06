import { hasMojibakeMarkers, repairMojibake } from './text-normalization';
import {
  isCircularResearchSourceUrl,
  isLowValueSourceForTask,
  isLowValueSocialSourceUrl,
  isOfficialCreatorPlatformUrl,
  sourceHostname,
  sourcePriority,
} from './source-policy';

type Obj = Record<string, unknown>;

export type NormalizedReportSource = {
  id: string;
  name: string;
  url: string;
  usedFor?: string;
  canonical: boolean;
  publishedAt?: string;
  accessedAt?: string;
};

export type NormalizedClaim = {
  topic: string;
  claim_id: string;
  section:
    | 'current_status'
    | 'reported_developments'
    | 'data_and_statistics'
    | 'analysis'
    | 'risks'
    | 'conclusion';
  entity: string;
  geography?: string;
  route?: 'hormuz' | 'red_sea' | 'suez';
  status: string;
  status_type:
    | 'broader_conflict_status'
    | 'route_status'
    | 'shipping_strike_status'
    | 'diplomatic_status'
    | 'metric'
    | 'development'
    | 'risk'
    | 'general';
  confidence: 'high' | 'medium' | 'low';
  time_ref?: string;
  summary: string;
  evidence_source_ids: string[];
  canonical_url?: string;
  disputed: boolean;
  notes: string[];
};

type FramingSignals = {
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
  notes?: string[];
  support?: Array<{
    title?: string;
    source_name?: string;
    source_url?: string;
    date_or_period?: string;
  }>;
};

type GroundedSourceHint = {
  name: string;
  url: string;
  publishedAt?: string;
  accessedAt?: string;
};

type LiveDataSourceGrounding = {
  byUrl: Map<string, GroundedSourceHint>;
  byName: Map<string, GroundedSourceHint[]>;
  hasEvidenceInventory: boolean;
  snapshotAt?: string;
};

type FinalizeParams = {
  task: string;
  writerMarkdown: string;
  research: Obj | null;
  analysis: Obj | null;
  liveData: Obj | null;
};

type RawClaimState = {
  topic: string;
  sources: ReturnType<typeof createSourceRegistry>;
  rawClaims: NormalizedClaim[];
  issues: string[];
};

type FinalClaimState = {
  topic: string;
  sources: NormalizedReportSource[];
  claims: NormalizedClaim[];
  issues: string[];
};

const asString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const asObject = (value: unknown) =>
  value && typeof value === 'object' ? (value as Obj) : null;
const asArray = <T = unknown>(value: unknown) =>
  Array.isArray(value) ? (value as T[]) : [];

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function asDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : value;
}

function todayDateString(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isFutureDateValue(value: string, now = new Date()): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const iso = trimmed.match(/\b(20\d{2})-(\d{2})(?:-(\d{2}))?\b/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = iso[3] ? Number(iso[3]) : 1;
    const candidate = Date.UTC(year, month, day);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Number.isFinite(candidate) && candidate > today;
  }

  const monthYear = trimmed.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i,
  );
  if (monthYear) {
    const month = MONTH_INDEX[monthYear[1].toLowerCase()];
    const year = Number(monthYear[2]);
    const candidate = Date.UTC(year, month, 1);
    const currentMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    return Number.isFinite(candidate) && candidate > currentMonth;
  }

  return false;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanInlineEvidenceText(value: string): string {
  return stripHtmlTags(value)
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\b(?:title|url|symbol|id):\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortenText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
    : normalized;
}

function inferPrimaryTopicLabel(task: string, research: Obj | null): string | null {
  const scope = asObject(research?.scope);
  const entities = asArray(scope?.entities)
    .map((entry) => asString(entry))
    .filter((value): value is string => Boolean(value));

  const taskLower = task.toLowerCase();
  const exactEntity = entities.find((entity) =>
    new RegExp(`\\b${escapeRegExp(entity)}\\b`, 'i').test(task),
  );
  if (exactEntity) return exactEntity;

  const capitalized = task.match(/\b[A-Z][a-zA-Z0-9.-]{2,}\b/);
  if (capitalized?.[0]) return capitalized[0];

  const token = taskLower.match(/\b(bitcoin|ethereum|solana|xrp|dogecoin|litecoin|cardano|avalanche|chainlink|openai|anthropic|ipcc)\b/i);
  return token?.[0] ?? null;
}

function isOffTopicVariantForPrimary(primaryTopicLabel: string | null, text: string): boolean {
  if (!primaryTopicLabel) return false;
  const primary = primaryTopicLabel.trim();
  if (!primary) return false;
  return new RegExp(
    `\\b${escapeRegExp(primary)}\\s+(cash|sv|gold|classic|wrapped|inu)\\b`,
    'i',
  ).test(text);
}

function isRelevantToPrimaryTopic(primaryTopicLabel: string | null, text: string): boolean {
  if (!primaryTopicLabel) return true;
  return !isOffTopicVariantForPrimary(primaryTopicLabel, text);
}

function shouldBypassPrimaryTopicSourceFilter(
  task: string,
  primaryTopicLabel: string | null,
): boolean {
  if (!primaryTopicLabel) return true;
  if (/\bprediction market\b/i.test(task)) return true;
  if (/^[A-Z0-9]{2,5}$/.test(primaryTopicLabel.trim())) return true;
  return false;
}

function articleMatchesPrimaryTopic(
  task: string,
  primaryTopicLabel: string | null,
  articleText: string,
): boolean {
  if (shouldBypassPrimaryTopicSourceFilter(task, primaryTopicLabel)) {
    return true;
  }
  if (!primaryTopicLabel) return true;
  return new RegExp(`\\b${escapeRegExp(primaryTopicLabel)}\\b`, 'i').test(articleText);
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isGoogleNewsRssUrl(url: string): boolean {
  return /^https?:\/\/news\.google\.com\/rss\/articles\//i.test(url);
}

function normalizeSourceName(name: string | null, url: string): string {
  const haystack = `${name || ''} ${url}`;
  if (/\bassociated press\b|\bap news\b|apnews\.com/i.test(haystack)) return 'AP News';
  if (/\breuters\b|reuters\.com/i.test(haystack)) return 'Reuters';
  if (/\bbbc\b|bbc\.com|bbc\.co\.uk/i.test(haystack)) return 'BBC News';
  if (/\bcbs news\b|cbsnews\.com/i.test(haystack)) return 'CBS News';
  if (/\bpbs news\b|pbs\.org/i.test(haystack)) return 'PBS News';
  if (/\bnew york times\b|nytimes\.com/i.test(haystack)) return 'The New York Times';
  if (/\bwashington post\b|washingtonpost\.com/i.test(haystack)) return 'The Washington Post';
  if (/\bcnbc\b|cnbc\.com/i.test(haystack)) return 'CNBC';
  if (/\bfinancial times\b|ft\.com/i.test(haystack)) return 'Financial Times';
  if (/\batlantic council\b|atlanticcouncil\.org/i.test(haystack)) return 'Atlantic Council';
  if (/\bcoingecko\b|coingecko\.com/i.test(haystack)) return 'CoinGecko';
  if (/\bcoinmarketcap\b|coinmarketcap\.com/i.test(haystack)) return 'CoinMarketCap';
  if (/\bdefillama\b|defillama\.com/i.test(haystack)) return 'DefiLlama';
  if (/\bmempool\.space\b|\bmempool space\b/i.test(haystack)) return 'Mempool.space';
  if (/\bcoindesk\b|coindesk\.com/i.test(haystack)) return 'CoinDesk';
  if (/\bforbes\b|forbes\.com/i.test(haystack)) return 'Forbes';
  return name || new URL(url).hostname.replace(/^www\./, '');
}

function sourceNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function sourceUrlKey(url: string): string {
  return url.trim().toLowerCase();
}

function pushGroundedSource(
  grounding: LiveDataSourceGrounding,
  task: string,
  hint: GroundedSourceHint,
): void {
  const url = normalizeUrl(hint.url);
  const name = hint.name.trim();
  if (!url || !name) return;
  if (isLowValueSocialSourceUrl(url)) return;
  if (isCircularResearchSourceUrl(task, url)) return;
  if (isLowValueSourceForTask(task, { url, title: hint.name, publisher: hint.name })) return;

  const normalizedName = normalizeSourceName(name, url);
  const entry: GroundedSourceHint = {
    name: normalizedName,
    url,
    ...(hint.publishedAt ? { publishedAt: asDate(hint.publishedAt) } : {}),
    ...(hint.accessedAt ? { accessedAt: asDate(hint.accessedAt) } : {}),
  };

  grounding.byUrl.set(sourceUrlKey(url), entry);
  const key = sourceNameKey(normalizedName);
  const existing = grounding.byName.get(key) ?? [];
  existing.push(entry);
  grounding.byName.set(key, existing);
  grounding.hasEvidenceInventory = true;
}

function buildLiveDataSourceGrounding(
  liveData: Obj | null,
  task: string,
  primaryTopicLabel?: string | null,
): LiveDataSourceGrounding {
  const grounding: LiveDataSourceGrounding = {
    byUrl: new Map(),
    byName: new Map(),
    hasEvidenceInventory: false,
    snapshotAt: asDate(asString(liveData?.snapshot_at)),
  };

  const snapshotAt = grounding.snapshotAt;
  const coingecko = asObject(liveData?.coingecko);
  for (const entry of asArray(coingecko?.assets)) {
    const asset = asObject(entry);
    const coinId = asString(asset?.coinId);
    if (!coinId) continue;
    pushGroundedSource(grounding, task, {
      name: 'CoinGecko',
      url: `https://www.coingecko.com/en/coins/${encodeURIComponent(coinId)}`,
      ...(asString(asset?.last_updated_at) ? { publishedAt: asString(asset?.last_updated_at)! } : {}),
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }

  const defillama = asObject(liveData?.defillama);
  for (const entry of asArray(defillama?.chains)) {
    const chain = asString(asObject(entry)?.chain);
    if (!chain) continue;
    pushGroundedSource(grounding, task, {
      name: 'DefiLlama',
      url: `https://defillama.com/chain/${encodeURIComponent(chain)}`,
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }

  const bitcoinOnchain = asObject(liveData?.bitcoin_onchain);
  if (bitcoinOnchain) {
    pushGroundedSource(grounding, task, {
      name: 'Mempool.space',
      url: 'https://mempool.space/blocks',
      ...(asString(bitcoinOnchain?.latest_block_time)
        ? { publishedAt: asString(bitcoinOnchain.latest_block_time)! }
        : {}),
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }

  const wikipedia = asObject(liveData?.wikipedia);
  for (const entry of asArray(wikipedia?.pages)) {
    const page = asObject(entry);
    const url = normalizeUrl(asString(page?.url));
    if (!url) continue;
    pushGroundedSource(grounding, task, {
      name: 'Wikipedia',
      url,
      ...(asString(page?.last_updated_at) ? { publishedAt: asString(page?.last_updated_at)! } : {}),
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }

  const liveCurrentEvents = currentEvents(liveData);
  const liveFramingSignals = asObject(liveCurrentEvents?.framing_signals);
  for (const entry of asArray(liveFramingSignals?.support)) {
    const support = asObject(entry);
    const url = normalizeUrl(asString(support?.source_url));
    if (!url) continue;
    pushGroundedSource(grounding, task, {
      name: asString(support?.source_name) ?? asString(support?.title) ?? 'Current event source',
      url,
      ...(asString(support?.date_or_period) ? { publishedAt: asString(support?.date_or_period)! } : {}),
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }
  for (const entry of asArray(liveCurrentEvents?.article_snapshots)) {
    const article = asObject(entry);
    const url = normalizeUrl(asString(article?.url));
    if (!url) continue;
    pushGroundedSource(grounding, task, {
      name: asString(article?.publisher) ?? asString(article?.title) ?? 'Current event source',
      url,
      ...(asString(article?.seen_at) ? { publishedAt: asString(article?.seen_at)! } : {}),
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }
  for (const entry of asArray(liveCurrentEvents?.articles)) {
    const article = asObject(entry);
    const url = normalizeUrl(asString(article?.url));
    if (!url) continue;
    pushGroundedSource(grounding, task, {
      name: asString(article?.publisher) ?? asString(article?.domain) ?? asString(article?.title) ?? 'Current event source',
      url,
      ...(asString(article?.seen_at) ? { publishedAt: asString(article?.seen_at)! } : {}),
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }

  const dynamicSources = asObject(liveData?.dynamic_sources);
  for (const entry of asArray(dynamicSources?.articles)) {
    const article = asObject(entry);
    const articleText = [
      asString(article?.title),
      asString(article?.summary),
      asString(article?.publisher),
      asString(article?.url),
    ]
      .filter(Boolean)
      .join(' ');
    if (!articleMatchesPrimaryTopic(task, primaryTopicLabel ?? null, articleText)) {
      continue;
    }
    const url = normalizeUrl(asString(article?.url));
    if (!url) continue;
    pushGroundedSource(grounding, task, {
      name: asString(article?.publisher) ?? asString(article?.title) ?? 'Dynamic source',
      url,
      ...(asString(article?.seen_at) ? { publishedAt: asString(article?.seen_at)! } : {}),
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }

  for (const entry of asArray(liveData?.sources)) {
    const source = asObject(entry);
    const url = normalizeUrl(asString(source?.url));
    if (!url) continue;
    pushGroundedSource(grounding, task, {
      name: asString(source?.title) ?? asString(source?.domain) ?? 'Retrieved source',
      url,
      ...(asString(source?.date) ? { publishedAt: asString(source?.date)! } : {}),
      ...(snapshotAt ? { accessedAt: snapshotAt } : {}),
    });
  }

  return grounding;
}

function resolveGroundedSourceHint(
  grounding: LiveDataSourceGrounding,
  nameValue: unknown,
  urlValue: unknown,
): GroundedSourceHint | null {
  const rawUrl = normalizeUrl(asString(urlValue));
  if (rawUrl) {
    const byUrl = grounding.byUrl.get(sourceUrlKey(rawUrl));
    if (byUrl) return byUrl;
  }

  const rawName = asString(nameValue);
  if (rawName) {
    const normalizedName = normalizeSourceName(rawName, rawUrl ?? 'https://example.com');
    const matches = grounding.byName.get(sourceNameKey(normalizedName)) ?? [];
    if (matches.length === 1) return matches[0];
    if (rawUrl) {
      const rawHost = (() => {
        try {
          return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
          return '';
        }
      })();
      const hostMatch = matches.find((entry) => {
        try {
          return new URL(entry.url).hostname.replace(/^www\./, '').toLowerCase() === rawHost;
        } catch {
          return false;
        }
      });
      if (hostMatch) return hostMatch;
    }
    if (matches[0]) return matches[0];
  }

  return null;
}

function createSourceRegistry(task: string) {
  const byId = new Map<string, NormalizedReportSource>();
  const byKey = new Map<string, string>();

  return {
    add(
      nameValue: unknown,
      urlValue: unknown,
      usedForValue?: unknown,
      dateMeta?: { publishedAt?: unknown; accessedAt?: unknown },
    ): string[] {
      const rawUrl = normalizeUrl(asString(urlValue));
      const rawName = asString(nameValue);
      const usedFor = asString(usedForValue) ?? undefined;
      const publishedAt = asDate(asString(dateMeta?.publishedAt));
      const accessedAt = asDate(asString(dateMeta?.accessedAt));
      if (!rawUrl) return [];
      if (isLowValueSocialSourceUrl(rawUrl)) return [];
      if (isCircularResearchSourceUrl(task, rawUrl)) return [];
      if (isLowValueSourceForTask(task, { url: rawUrl, title: rawName ?? undefined, publisher: rawName ?? undefined })) {
        return [];
      }

      const name = normalizeSourceName(rawName, rawUrl);
      if (
        /\b(firecrawl|gdelt|google news rss|rss|feed|dashboard|scraper|parser|search)\b/i.test(
          name,
        )
      ) {
        return [];
      }

      const key = name.toLowerCase();
      const existingId = byKey.get(key);
      if (existingId) {
        const previous = byId.get(existingId)!;
        if (sourcePriority(rawUrl, name) > sourcePriority(previous.url, previous.name)) {
          byId.set(existingId, {
            ...previous,
            url: rawUrl,
            canonical: !isGoogleNewsRssUrl(rawUrl),
            usedFor: previous.usedFor ?? usedFor,
            publishedAt: previous.publishedAt ?? publishedAt,
            accessedAt: previous.accessedAt ?? accessedAt,
          });
        } else if (!previous.publishedAt || !previous.accessedAt) {
          byId.set(existingId, {
            ...previous,
            publishedAt: previous.publishedAt ?? publishedAt,
            accessedAt: previous.accessedAt ?? accessedAt,
            usedFor: previous.usedFor ?? usedFor,
          });
        }
        return [existingId];
      }

      const id =
        key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
        `source-${byId.size + 1}`;
      byId.set(id, {
        id,
        name,
        url: rawUrl,
        usedFor,
        canonical: !isGoogleNewsRssUrl(rawUrl),
        publishedAt,
        accessedAt,
      });
      byKey.set(key, id);
      return [id];
    },
    get(id: string) {
      return byId.get(id);
    },
    list() {
      const sorted = [...byId.values()].sort(
        (left, right) =>
          sourcePriority(right.url, right.name) - sourcePriority(left.url, left.name),
      );
      const nonWikipedia = sorted.filter((source) => !/\bwikipedia\.org\b/i.test(source.url));
      return (nonWikipedia.length >= 2 ? nonWikipedia : sorted).slice(0, 8);
    },
  };
}

function addSupplementalLiveEvidenceSources(
  liveData: Obj | null,
  task: string,
  sources: ReturnType<typeof createSourceRegistry>,
  primaryTopicLabel?: string | null,
): void {
  const snapshotAt = asDate(asString(liveData?.snapshot_at)) ?? todayDateString();
  const add = (
    name: unknown,
    url: unknown,
    usedFor: unknown,
    publishedAt?: unknown,
  ) => {
    const rawUrl = normalizeUrl(asString(url));
    if (!rawUrl) return;
    const priority = sourcePriority(rawUrl, asString(name) ?? undefined);
    if (priority < 20) return;
    sources.add(name, rawUrl, usedFor, {
      publishedAt,
      accessedAt: snapshotAt,
    });
  };

  const coingecko = asObject(liveData?.coingecko);
  for (const entry of asArray(coingecko?.assets)) {
    const asset = asObject(entry);
    const coinId = asString(asset?.coinId);
    if (!coinId) continue;
    add(
      'CoinGecko',
      `https://www.coingecko.com/en/coins/${encodeURIComponent(coinId)}`,
      'live market data',
      asset?.last_updated_at,
    );
  }

  const defillama = asObject(liveData?.defillama);
  for (const entry of asArray(defillama?.chains)) {
    const chain = asString(asObject(entry)?.chain);
    if (!chain) continue;
    add('DefiLlama', `https://defillama.com/chain/${encodeURIComponent(chain)}`, 'TVL data');
  }

  const bitcoinOnchain = asObject(liveData?.bitcoin_onchain);
  if (bitcoinOnchain) {
    add(
      'Mempool.space',
      'https://mempool.space/blocks',
      'Bitcoin block and transaction metrics',
      bitcoinOnchain.latest_block_time,
    );
  }

  const dynamicSources = asObject(liveData?.dynamic_sources);
  for (const entry of asArray(dynamicSources?.articles).slice(0, 6)) {
    const article = asObject(entry);
    const articleText = [
      asString(article?.title),
      asString(article?.summary),
      asString(article?.publisher),
      asString(article?.url),
    ]
      .filter(Boolean)
      .join(' ');
    if (!articleMatchesPrimaryTopic(task, primaryTopicLabel ?? null, articleText)) {
      continue;
    }
    add(
      asString(article?.publisher) ?? asString(article?.title) ?? 'Retrieved source',
      article?.url,
      asString(article?.summary) ?? 'retrieved article evidence',
      article?.seen_at,
    );
  }

  const events = currentEvents(liveData);
  for (const entry of [
    ...asArray(events?.article_snapshots),
    ...asArray(events?.articles),
  ].slice(0, 6)) {
    const article = asObject(entry);
    add(
      asString(article?.publisher) ?? asString(article?.domain) ?? asString(article?.title) ?? 'Current event source',
      article?.url,
      asString(article?.summary) ?? asString(article?.title) ?? 'current event evidence',
      article?.seen_at,
    );
  }
}

function currentEvents(liveData: Obj | null): Obj | null {
  return asObject(liveData?.current_events);
}

function framingSignals(liveData: Obj | null): FramingSignals | null {
  return (asObject(currentEvents(liveData)?.framing_signals) as FramingSignals | null) || null;
}

function routeFromText(text: string): 'hormuz' | 'red_sea' | 'suez' | undefined {
  if (/\bhormuz|strait of hormuz\b/i.test(text)) return 'hormuz';
  if (/\bred sea\b/i.test(text)) return 'red_sea';
  if (/\bsuez\b/i.test(text)) return 'suez';
  return undefined;
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  const text = asString(value)?.toLowerCase();
  return text === 'high' || text === 'medium' || text === 'low' ? text : 'medium';
}

function claimId(...parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join('::')
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, '-');
}

function hasSourceEvidence(claim: NormalizedClaim): boolean {
  return claim.evidence_source_ids.length > 0;
}

function parseConflictStatus(text: string):
  | 'reported_active_war'
  | 'inactive_or_unconfirmed_conflict'
  | undefined {
  if (
    /\bno (?:active )?(?:direct )?(?:full[- ]scale )?(?:war|conflict)\b|\bwar (?:is )?not confirmed\b|\bconflict (?:is )?not confirmed\b/i.test(
      text,
    )
  ) {
    return 'inactive_or_unconfirmed_conflict';
  }

  if (
    /\bactive war\b|\bongoing war\b|\bactive conflict\b|\bprotracted conflict\b|\bhostilities\b|\bwar entering\b|\bwar nearing\b|\bwar with iran\b/i.test(
      text,
    )
  ) {
    return 'reported_active_war';
  }

  return undefined;
}

function parseHormuzRouteStatus(text: string):
  | 'fully_blocked'
  | 'severely_constrained_with_limited_passage'
  | 'severely_constrained'
  | 'elevated_risk_routes_still_operating'
  | undefined {
  const severe =
    /\bseverely constrained\b|\bseverely disrupted\b|\bgatekeep\b|\btoll\b|\bvet(?:ting)?\b|\bdetour\b|\bchokehold\b|\bpermission\b|\bcontrol regime\b|\btraffic had fallen\b|\btraffic collapse\b|\beffectively closed\b|\boperational control\b/i.test(
      text,
    );
  const limitedPassage =
    /\blimited passage\b|\blimited transit\b|\bsome transit\b|\bsome vessels\b|\bsuccessful transits?\b|\bgot through\b|\bresum(?:e|ing)\b|\bnon-hostile vessels may transit\b|\beastbound vessel\b|\bships? still moved\b/i.test(
      text,
    );
  const blocked =
    /\bfully blocked\b|\bfully closed\b|\bcompletely blocked\b|\bshut entirely\b|\bno vessels permitted\b/i.test(
      text,
    );
  const elevatedRisk =
    /\belevated risk\b|\bheightened risk\b|\brisk to shipping\b|\bconcerns for shipping\b/i.test(
      text,
    );

  if ((severe || blocked) && limitedPassage) return 'severely_constrained_with_limited_passage';
  if (blocked) return 'fully_blocked';
  if (severe) return 'severely_constrained';
  if (elevatedRisk) return 'elevated_risk_routes_still_operating';
  return undefined;
}

function parseRedSeaStatus(text: string):
  | 'direct_shipping_attacks_reported'
  | 'elevated_risk_latest_direct_shipping_strikes_not_confirmed'
  | undefined {
  const shippingAttack =
    /\bcommercial shipping\b|\bmerchant shipping\b|\bvessels?\b|\btankers?\b|\bshipping routes?\b/i.test(
      text,
    ) &&
    /\battack|strike|missile|drone\b/i.test(text) &&
    !/\bnot confirmed\b|\bconcern\b|\bfear\b|\brisk\b/i.test(text);

  if (shippingAttack) return 'direct_shipping_attacks_reported';

  if (
    /\bhouthi\b|\bmissile\b|\battack\b|\bconcerns?\b|\bfears?\b|\belevated risk\b|\bnot confirmed\b|\brenewed concerns?\b/i.test(
      text,
    )
  ) {
    return 'elevated_risk_latest_direct_shipping_strikes_not_confirmed';
  }

  return undefined;
}

function parseDiplomaticStatus(text: string):
  | 'reported_by_one_side_disputed_by_other'
  | 'reported_diplomatic_development'
  | undefined {
  if (!/\bproposal|talks?|ceasefire|diplomatic|negotiat|warning\b/i.test(text)) {
    return undefined;
  }
  if (/\bdisput|den(y|ied)|reject|rejected|unrealistic\b/i.test(text)) {
    return 'reported_by_one_side_disputed_by_other';
  }
  return 'reported_diplomatic_development';
}

function normalizeDevelopmentSummary(text: string): string {
  const route = routeFromText(text);
  if (route === 'hormuz') {
    if (
      /\btoll\b|\bvet(?:ting)?\b|\bpermission\b|\bdetour\b|\biranian waters\b|\bcontrol\b/i.test(
        text,
      )
    ) {
      return 'Recent reporting described tighter Iranian administrative control over transit through the Strait of Hormuz.';
    }
    return 'Recent reporting described a Hormuz shipping development with route-level consequences.';
  }
  if (route === 'red_sea') {
    if (/\bhouthi\b|\bmissile\b|\battack\b/i.test(text)) {
      return 'Recent reporting described a Red Sea security development that increased concern about shipping risk.';
    }
    return 'Recent reporting described a Red Sea route-risk development.';
  }
  const diplomatic = parseDiplomaticStatus(text);
  if (diplomatic === 'reported_by_one_side_disputed_by_other') {
    return 'A diplomatic claim was reported by one side and disputed or rejected by the other.';
  }
  if (diplomatic === 'reported_diplomatic_development') {
    return 'Recent reporting described a diplomatic development relevant to the conflict.';
  }
  const cleaned = cleanInlineEvidenceText(text);
  if (!cleaned) {
    return 'Recent reporting described a topic-relevant development.';
  }
  return shortenText(cleaned, 180);
}

function addLiveArticleClaims(
  params: FinalizeParams,
  sources: ReturnType<typeof createSourceRegistry>,
  addStructuredClaim: (claim: NormalizedClaim) => void,
  addEvidenceSource: (nameValue: unknown, urlValue: unknown, usedForValue?: unknown) => string[],
  topic: string,
  primaryTopicLabel: string | null,
): void {
  const pushArticleClaim = (article: Obj, section: NormalizedClaim['section']) => {
    const title = asString(article?.title);
    const summary = asString(article?.summary);
    const publisher = asString(article?.publisher) ?? asString(article?.domain) ?? 'Retrieved source';
    const url = article?.url;
    const text = [title, summary].filter(Boolean).join(' — ');
    if (!text) return;
    if (!articleMatchesPrimaryTopic(params.task, primaryTopicLabel, `${publisher} ${text} ${asString(url) ?? ''}`)) {
      return;
    }

    const ids = addEvidenceSource(publisher, url, summary ?? title ?? 'retrieved article evidence');
    if (!ids.length) return;

    addStructuredClaim({
      topic,
      claim_id: claimId(
        topic,
        'live-article',
        section,
        asDate(asString(article?.seen_at)),
        title ?? summary ?? undefined,
      ),
      section,
      entity: primaryTopicLabel ?? 'Topic',
      status: 'reported',
      status_type: 'development',
      confidence: 'medium',
      time_ref: asDate(asString(article?.seen_at)),
      summary: sentence(shortenText(cleanInlineEvidenceText(text), 220)),
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [text],
    });
  };

  const dynamicSources = asObject(params.liveData?.dynamic_sources);
  for (const entry of asArray(dynamicSources?.articles).slice(0, 4)) {
    const article = asObject(entry);
    if (!article) continue;
    pushArticleClaim(article, 'reported_developments');
  }

  const events = currentEvents(params.liveData);
  for (const entry of [...asArray(events?.article_snapshots), ...asArray(events?.articles)].slice(0, 4)) {
    const article = asObject(entry);
    if (!article) continue;
    pushArticleClaim(article, 'reported_developments');
  }
}

function addClaim(map: Map<string, NormalizedClaim>, claim: NormalizedClaim): void {
  const existing = map.get(claim.claim_id);
  if (!existing) {
    map.set(claim.claim_id, claim);
    return;
  }

  const confidenceRank = { low: 1, medium: 2, high: 3 };
  const pickCurrent =
    confidenceRank[claim.confidence] > confidenceRank[existing.confidence] ||
    (!hasSourceEvidence(existing) && hasSourceEvidence(claim));

  map.set(
    claim.claim_id,
    pickCurrent
      ? claim
      : {
          ...existing,
          disputed: existing.disputed || claim.disputed,
          evidence_source_ids: [
            ...new Set([...existing.evidence_source_ids, ...claim.evidence_source_ids]),
          ],
          notes: [...new Set([...existing.notes, ...claim.notes])],
        },
  );
}

function buildRawClaims(params: FinalizeParams): RawClaimState {
  const topic = asString(params.research?.topic) || params.task || 'AgentFlow';
  const primaryTopicLabel = inferPrimaryTopicLabel(params.task, params.research);
  const sources = createSourceRegistry(params.task);
  const rawClaims = new Map<string, NormalizedClaim>();
  const issues: string[] = [];
  const sourceGrounding = buildLiveDataSourceGrounding(
    params.liveData,
    params.task,
    primaryTopicLabel,
  );
  const framing = framingSignals(params.liveData);
  const support = asArray<{
    title?: string;
    source_name?: string;
    source_url?: string;
    date_or_period?: string;
  }>(framing?.support);

  const addStructuredClaim = (claim: NormalizedClaim) => addClaim(rawClaims, claim);
  const addEvidenceSource = (
    nameValue: unknown,
    urlValue: unknown,
    usedForValue?: unknown,
  ): string[] => {
    const grounded = resolveGroundedSourceHint(sourceGrounding, nameValue, urlValue);
    const rawUrl = normalizeUrl(asString(urlValue));
    const rawName = asString(nameValue);

    if (sourceGrounding.hasEvidenceInventory && !grounded) {
      const descriptor = rawName || rawUrl || 'unknown source';
      issues.push(`Unsupported source omitted from final source list: ${descriptor}`);
      return [];
    }

    return sources.add(
      grounded?.name ?? rawName,
      grounded?.url ?? rawUrl,
      usedForValue,
      {
        publishedAt: grounded?.publishedAt,
        accessedAt:
          grounded?.accessedAt ??
          (sourceGrounding.hasEvidenceInventory ? sourceGrounding.snapshotAt : todayDateString()),
      },
    );
  };

  if (framing?.broader_conflict_status === 'reported_active_war') {
    const ids = addEvidenceSource(
      support[0]?.source_name,
      support[0]?.source_url,
      support[0]?.title ?? 'Active conflict reporting',
    );
    if (!ids.length) {
      issues.push('Active conflict framing had no canonicalizable source support.');
    } else {
      addStructuredClaim({
      topic,
      claim_id: claimId(topic, 'raw', 'framing', 'broader-conflict'),
      section: 'current_status',
      entity: 'Iran and the United States',
      geography: 'Middle East',
      status: 'reported_active_war',
      status_type: 'broader_conflict_status',
      confidence: 'high',
      time_ref: asDate(support[0]?.date_or_period),
      summary: 'Recent strong-source public reporting described the broader conflict as active.',
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [...(framing.notes || [])],
      });
    }
  }

  if (framing?.hormuz_route_status) {
    const ids = addEvidenceSource(
      support[1]?.source_name ?? support[0]?.source_name,
      support[1]?.source_url ?? support[0]?.source_url,
      support[1]?.title ?? 'Hormuz route status',
    );
    if (ids.length) {
      addStructuredClaim({
      topic,
      claim_id: claimId(topic, 'raw', 'framing', 'hormuz'),
      section: 'current_status',
      entity: 'Commercial shipping',
      geography: 'Strait of Hormuz',
      route: 'hormuz',
      status: framing.hormuz_route_status,
      status_type: 'route_status',
      confidence: 'high',
      time_ref: asDate(support[1]?.date_or_period ?? support[0]?.date_or_period),
      summary:
        framing.hormuz_route_status === 'severely_constrained_with_limited_passage'
          ? 'The Strait of Hormuz is severely disrupted, with limited successful transits still occurring.'
          : framing.hormuz_route_status === 'severely_constrained'
            ? 'The Strait of Hormuz remains severely disrupted in the latest reporting.'
            : 'The Strait of Hormuz faces elevated risk while some route activity continues.',
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [...(framing.notes || [])],
      });
    }
  }

  if (framing?.red_sea_route_status) {
    const redSeaSupport =
      support.find((item) => /\bred sea\b|shipping/i.test(`${item.title || ''}`)) || support[0];
    const ids = addEvidenceSource(
      redSeaSupport?.source_name,
      redSeaSupport?.source_url,
      redSeaSupport?.title ?? 'Red Sea route status',
    );
    if (ids.length) {
      addStructuredClaim({
      topic,
      claim_id: claimId(topic, 'raw', 'framing', 'red-sea'),
      section: 'current_status',
      entity: 'Commercial shipping',
      geography: 'Red Sea',
      route: 'red_sea',
      status: framing.red_sea_route_status,
      status_type:
        framing.red_sea_route_status === 'direct_shipping_attacks_reported'
          ? 'shipping_strike_status'
          : 'route_status',
      confidence: 'high',
      time_ref: asDate(redSeaSupport?.date_or_period),
      summary:
        framing.red_sea_route_status === 'direct_shipping_attacks_reported'
          ? 'The latest retrieved reporting includes direct attacks on commercial shipping in the Red Sea.'
          : 'Red Sea shipping risk is elevated, but fresh direct strikes on commercial shipping are not confirmed in the latest retrieved reporting.',
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [...(framing.notes || [])],
      });
    }
  }

  for (const entry of asArray(params.research?.facts)) {
    const item = asObject(entry);
    const text = asString(item?.claim);
    if (!item || !text) continue;

    const ids = addEvidenceSource(
      item.source_name ?? item.name,
      item.source_url ?? item.url,
      item.support ?? item.used_for,
    );
    if (!ids.length) continue;
    const timeRef = asDate(asString(item.date_or_period));
    const confidence = normalizeConfidence(item.confidence);
    const route = routeFromText(text);
    const conflictStatus = parseConflictStatus(text);
    const hormuzStatus = route === 'hormuz' ? parseHormuzRouteStatus(text) : undefined;
    const redSeaStatus = route === 'red_sea' ? parseRedSeaStatus(text) : undefined;
    const diplomaticStatus = parseDiplomaticStatus(text);

    if (conflictStatus) {
      addStructuredClaim({
        topic,
        claim_id: claimId(topic, 'fact', 'broader-conflict', conflictStatus, timeRef),
        section: 'current_status',
        entity: 'Iran and the United States',
        geography: 'Middle East',
        status: conflictStatus,
        status_type: 'broader_conflict_status',
        confidence,
        time_ref: timeRef,
        summary:
          conflictStatus === 'reported_active_war'
            ? 'Recent strong-source public reporting described the broader conflict as active.'
            : 'Some retrieved wording framed the conflict more cautiously or as not fully confirmed.',
        evidence_source_ids: ids,
        canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
        disputed: conflictStatus !== 'reported_active_war',
        notes: [text],
      });
      continue;
    }

    if (hormuzStatus) {
      addStructuredClaim({
        topic,
        claim_id: claimId(topic, 'fact', 'hormuz', hormuzStatus, timeRef),
        section: 'current_status',
        entity: 'Commercial shipping',
        geography: 'Strait of Hormuz',
        route: 'hormuz',
        status: hormuzStatus,
        status_type: 'route_status',
        confidence,
        time_ref: timeRef,
        summary:
          hormuzStatus === 'severely_constrained_with_limited_passage'
            ? 'Recent reporting described severe disruption in Hormuz while some transit still occurred.'
            : hormuzStatus === 'fully_blocked'
              ? 'Some retrieved wording described Hormuz as fully blocked or fully closed.'
              : hormuzStatus === 'severely_constrained'
                ? 'Recent reporting described severe disruption in Hormuz.'
                : 'Recent reporting described elevated risk in Hormuz while some route activity continued.',
        evidence_source_ids: ids,
        canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
        disputed: hormuzStatus === 'fully_blocked',
        notes: [text],
      });
      continue;
    }

    if (redSeaStatus) {
      addStructuredClaim({
        topic,
        claim_id: claimId(topic, 'fact', 'red-sea', redSeaStatus, timeRef),
        section: 'current_status',
        entity: 'Commercial shipping',
        geography: 'Red Sea',
        route: 'red_sea',
        status: redSeaStatus,
        status_type:
          redSeaStatus === 'direct_shipping_attacks_reported'
            ? 'shipping_strike_status'
            : 'route_status',
        confidence,
        time_ref: timeRef,
        summary:
          redSeaStatus === 'direct_shipping_attacks_reported'
            ? 'Some retrieved wording described direct attacks on commercial shipping in the Red Sea.'
            : 'Recent reporting described elevated Red Sea route risk without confirming fresh direct strikes on commercial shipping.',
        evidence_source_ids: ids,
        canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
        disputed: false,
        notes: [text],
      });
      continue;
    }

    if (diplomaticStatus) {
      addStructuredClaim({
        topic,
        claim_id: claimId(topic, 'fact', 'diplomatic', diplomaticStatus, timeRef),
        section: 'reported_developments',
        entity: 'Iran and the United States',
        geography: 'Middle East',
        status: diplomaticStatus,
        status_type: 'diplomatic_status',
        confidence,
        time_ref: timeRef,
        summary:
          diplomaticStatus === 'reported_by_one_side_disputed_by_other'
            ? 'A diplomatic claim was reported by one side and disputed or rejected by the other.'
            : 'Recent reporting described a diplomatic development relevant to the conflict.',
        evidence_source_ids: ids,
        canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
        disputed: diplomaticStatus === 'reported_by_one_side_disputed_by_other',
        notes: [text],
      });
      continue;
    }
  }

  for (const entry of asArray(params.research?.recent_developments)) {
    const item = asObject(entry);
    const text = asString(item?.event);
    if (!item || !text) continue;

    const ids = addEvidenceSource(
      item.source_name ?? item.name,
      item.source_url ?? item.url,
      item.support ?? item.importance,
    );
    if (!ids.length) continue;

    addStructuredClaim({
      topic,
      claim_id: claimId(
        topic,
        'development',
        routeFromText(text),
        asDate(asString(item.date_or_period)),
        normalizeDevelopmentSummary(text),
      ),
      section: 'reported_developments',
      entity:
        routeFromText(text) === 'hormuz'
          ? 'Commercial shipping'
          : routeFromText(text) === 'red_sea'
            ? 'Commercial shipping'
            : 'Topic',
      geography:
        routeFromText(text) === 'hormuz'
          ? 'Strait of Hormuz'
          : routeFromText(text) === 'red_sea'
            ? 'Red Sea'
            : undefined,
      route: routeFromText(text),
      status: 'reported',
      status_type: parseDiplomaticStatus(text) ? 'diplomatic_status' : 'development',
      confidence: normalizeConfidence(item.confidence),
      time_ref: asDate(asString(item.date_or_period)),
      summary: normalizeDevelopmentSummary(text),
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: Boolean(parseDiplomaticStatus(text) === 'reported_by_one_side_disputed_by_other'),
      notes: [text],
    });
  }

  for (const entry of asArray(params.research?.metrics)) {
    const item = asObject(entry);
    const name = asString(item?.name);
    const value = asString(item?.value);
    if (!item || !name || !value) continue;

    const ids = addEvidenceSource(
      item.source_name ?? item.name,
      item.source_url ?? item.url,
      item.support,
    );
    if (!ids.length) continue;

    addStructuredClaim({
      topic,
      claim_id: claimId(topic, 'metric', name, asDate(asString(item.date_or_period))),
      section: 'data_and_statistics',
      entity: name,
      geography: routeFromText(name),
      route: routeFromText(name),
      status: `${value}${asString(item.unit) ? ` ${asString(item.unit)}` : ''}`,
      status_type: 'metric',
      confidence: normalizeConfidence(item.confidence),
      time_ref: asDate(asString(item.date_or_period)),
      summary: `${name}: ${value}${asString(item.unit) ? ` ${asString(item.unit)}` : ''}`,
      evidence_source_ids: ids,
      canonical_url: ids[0] ? sources.get(ids[0])?.url : undefined,
      disputed: false,
      notes: [],
    });
  }

  addLiveArticleClaims(
    params,
    sources,
    addStructuredClaim,
    addEvidenceSource,
    topic,
    primaryTopicLabel,
  );

  addSupplementalLiveEvidenceSources(
    params.liveData,
    params.task,
    sources,
    primaryTopicLabel,
  );

  for (const claim of rawClaims.values()) {
    if (!hasSourceEvidence(claim)) {
      issues.push(`Claim ${claim.claim_id} has no source evidence attached.`);
    }
  }

  return { topic, sources, rawClaims: [...rawClaims.values()], issues };
}

function summarizeHormuzStatus(
  status:
    | 'fully_blocked'
    | 'severely_constrained_with_limited_passage'
    | 'severely_constrained'
    | 'elevated_risk_routes_still_operating',
): string {
  switch (status) {
    case 'severely_constrained_with_limited_passage':
      return 'The Strait of Hormuz is severely disrupted, with limited successful transits still occurring.';
    case 'severely_constrained':
      return 'The Strait of Hormuz remains severely disrupted in the latest reporting.';
    case 'fully_blocked':
      return 'Some retrieved wording described the Strait of Hormuz as fully blocked, but that status should only survive if no limited transit evidence exists.';
    default:
      return 'The Strait of Hormuz faces elevated risk while some route activity continues.';
  }
}

function summarizeRedSeaStatus(
  status:
    | 'direct_shipping_attacks_reported'
    | 'elevated_risk_latest_direct_shipping_strikes_not_confirmed',
): string {
  return status === 'direct_shipping_attacks_reported'
    ? 'The latest retrieved reporting includes direct attacks on commercial shipping in the Red Sea.'
    : 'Red Sea shipping risk is elevated, but fresh direct strikes on commercial shipping are not confirmed in the latest retrieved reporting.';
}

export function applySignalGuardrails(rawClaims: NormalizedClaim[]): {
  claims: NormalizedClaim[];
  issues: string[];
} {
  const issues: string[] = [];
  const claimMap = new Map<string, NormalizedClaim>();
  rawClaims.forEach((claim) => addClaim(claimMap, claim));

  const claims = [...claimMap.values()];
  const currentStatusClaims = claims.filter((claim) => claim.section === 'current_status');

  const conflictClaims = currentStatusClaims.filter(
    (claim) => claim.status_type === 'broader_conflict_status',
  );
  const hormuzClaims = currentStatusClaims.filter(
    (claim) => claim.route === 'hormuz' && claim.status_type === 'route_status',
  );
  const redSeaClaims = currentStatusClaims.filter(
    (claim) =>
      claim.route === 'red_sea' &&
      (claim.status_type === 'route_status' || claim.status_type === 'shipping_strike_status'),
  );
  const diplomaticClaims = claims.filter(
    (claim) => claim.status_type === 'diplomatic_status',
  );

  const reconciledClaims: NormalizedClaim[] = [];

  if (conflictClaims.length) {
    const activeClaims = conflictClaims.filter(
      (claim) => claim.status === 'reported_active_war',
    );
    const inactiveClaims = conflictClaims.filter(
      (claim) => claim.status === 'inactive_or_unconfirmed_conflict',
    );
    const sourceClaims = activeClaims.length ? activeClaims : inactiveClaims;
    const best = sourceClaims.sort((left, right) =>
      left.confidence === right.confidence
        ? (right.time_ref || '').localeCompare(left.time_ref || '')
        : left.confidence === 'high'
          ? 1
          : right.confidence === 'high'
            ? -1
            : left.confidence === 'medium'
              ? 1
              : -1,
    )[0];

    if (best) {
      reconciledClaims.push({
        ...best,
        claim_id: claimId(best.topic, 'reconciled', 'broader-conflict'),
        summary:
          best.status === 'reported_active_war'
            ? inactiveClaims.length
              ? 'Current strong-source reporting describes the broader conflict as active, even though some retrieved language is more cautious.'
              : 'Recent strong-source public reporting described the broader conflict as active.'
            : 'The current retrieved source set describes the broader conflict cautiously rather than as a clearly active war.',
        disputed: inactiveClaims.length > 0,
        notes: [
          ...new Set([
            ...best.notes,
            ...(inactiveClaims.length > 0 ? ['Retrieved source wording was mixed on conflict-status framing.'] : []),
          ]),
        ],
      });
    }
  }

  if (hormuzClaims.length) {
    const limited = hormuzClaims.some(
      (claim) =>
        claim.status === 'severely_constrained_with_limited_passage' ||
        /limited transit|limited passage|successful transits/i.test(claim.summary),
    );
    const blocked = hormuzClaims.some((claim) => claim.status === 'fully_blocked');
    const severe = hormuzClaims.some(
      (claim) =>
        claim.status === 'severely_constrained' ||
        claim.status === 'severely_constrained_with_limited_passage' ||
        claim.status === 'fully_blocked',
    );
    const elevated = hormuzClaims.some(
      (claim) => claim.status === 'elevated_risk_routes_still_operating',
    );
    const best = hormuzClaims.sort((left, right) =>
      left.confidence === right.confidence
        ? (right.time_ref || '').localeCompare(left.time_ref || '')
        : left.confidence === 'high'
          ? 1
          : right.confidence === 'high'
            ? -1
            : left.confidence === 'medium'
              ? 1
              : -1,
    )[0];

    let status:
      | 'fully_blocked'
      | 'severely_constrained_with_limited_passage'
      | 'severely_constrained'
      | 'elevated_risk_routes_still_operating';

    if (limited && severe) status = 'severely_constrained_with_limited_passage';
    else if (blocked && !limited) status = 'fully_blocked';
    else if (severe) status = 'severely_constrained';
    else status = elevated ? 'elevated_risk_routes_still_operating' : 'severely_constrained';

    if (status === 'fully_blocked') {
      issues.push('Hormuz reconciliation resolved to fully blocked because no limited-transit evidence was present.');
    }

    if (best) {
      reconciledClaims.push({
        ...best,
        claim_id: claimId(best.topic, 'reconciled', 'hormuz'),
        status,
        summary:
          status === 'fully_blocked' && limited
            ? summarizeHormuzStatus('severely_constrained_with_limited_passage')
            : summarizeHormuzStatus(status),
        disputed: blocked && limited,
        notes: [
          ...new Set([
            ...best.notes,
            ...(blocked && limited
              ? ['Blocked-route wording was reconciled against limited-transit evidence.']
              : []),
          ]),
        ],
      });
    }
  }

  if (redSeaClaims.length) {
    const direct = redSeaClaims.some(
      (claim) => claim.status === 'direct_shipping_attacks_reported',
    );
    const riskOnly = redSeaClaims.some(
      (claim) =>
        claim.status === 'elevated_risk_latest_direct_shipping_strikes_not_confirmed' ||
        /not confirmed|elevated risk/i.test(claim.summary),
    );
    const best = redSeaClaims.sort((left, right) =>
      left.confidence === right.confidence
        ? (right.time_ref || '').localeCompare(left.time_ref || '')
        : left.confidence === 'high'
          ? 1
          : right.confidence === 'high'
            ? -1
            : left.confidence === 'medium'
              ? 1
              : -1,
    )[0];

    const status =
      direct && !riskOnly
        ? 'direct_shipping_attacks_reported'
        : 'elevated_risk_latest_direct_shipping_strikes_not_confirmed';

    if (best) {
      reconciledClaims.push({
        ...best,
        claim_id: claimId(best.topic, 'reconciled', 'red-sea'),
        status,
        status_type:
          status === 'direct_shipping_attacks_reported'
            ? 'shipping_strike_status'
            : 'route_status',
        summary: summarizeRedSeaStatus(status),
        disputed: direct && riskOnly,
        notes: [
          ...new Set([
            ...best.notes,
            ...(direct && riskOnly
              ? ['Direct-attack wording was downgraded because the latest retrieved evidence only supports elevated risk.']
              : []),
          ]),
        ],
      });
    }
  }

  if (diplomaticClaims.length) {
    const disputed = diplomaticClaims.some((claim) => claim.disputed);
    const best = diplomaticClaims.sort((left, right) =>
      left.confidence === right.confidence
        ? (right.time_ref || '').localeCompare(left.time_ref || '')
        : left.confidence === 'high'
          ? 1
          : right.confidence === 'high'
            ? -1
            : left.confidence === 'medium'
              ? 1
              : -1,
    )[0];
    if (best) {
      reconciledClaims.push({
        ...best,
        claim_id: claimId(best.topic, 'reconciled', 'diplomatic'),
        summary: disputed
          ? 'A diplomatic claim was reported by one side and disputed or rejected by the other.'
          : 'Recent reporting described a diplomatic development relevant to the conflict.',
        disputed,
      });
    }
  }

  const finalClaims = [
    ...claims.filter((claim) => claim.section !== 'current_status'),
    ...reconciledClaims,
  ];

  for (const claim of finalClaims) {
    if (
      claim.status_type === 'broader_conflict_status' &&
      claim.status === 'inactive_or_unconfirmed_conflict' &&
      conflictClaims.some((entry) => entry.status === 'reported_active_war')
    ) {
      issues.push('Active-conflict evidence was present alongside inactive-conflict wording.');
    }
    if (
      claim.route === 'hormuz' &&
      claim.status_type === 'route_status' &&
      claim.status === 'fully_blocked' &&
      hormuzClaims.some((entry) =>
        /limited transit|limited passage|successful transits/i.test(entry.summary),
      )
    ) {
      issues.push('Hormuz route remained fully blocked after limited-transit evidence was retrieved.');
    }
    if (
      claim.route === 'red_sea' &&
      claim.status === 'direct_shipping_attacks_reported' &&
      redSeaClaims.some((entry) => /not confirmed/i.test(entry.summary))
    ) {
      issues.push('Red Sea route remained in confirmed-strike mode even though the latest retrieved evidence only supports elevated risk.');
    }
  }

  return { claims: finalClaims, issues };
}

function buildFinalState(params: FinalizeParams): FinalClaimState {
  const raw = buildRawClaims(params);
  const guarded = applySignalGuardrails(raw.rawClaims);
  const sources = raw.sources.list();
  const issues = [...raw.issues, ...guarded.issues];

  for (const claim of guarded.claims) {
    if (!hasSourceEvidence(claim)) {
      issues.push(`Final claim ${claim.claim_id} has no source evidence attached.`);
    }
  }

  return {
    topic: raw.topic,
    sources,
    claims: guarded.claims,
    issues: [...new Set(issues)],
  };
}

function sourceNote(
  sourceMap: Map<string, NormalizedReportSource>,
  sourceIds: string[],
  timeRef?: string,
): string {
  const source = sourceIds[0] ? sourceMap.get(sourceIds[0]) : undefined;
  return source ? `${source.name}${timeRef ? `, ${timeRef}` : ''}` : '';
}

function buildExecutiveSummary(
  claims: NormalizedClaim[],
  sourceMap: Map<string, NormalizedReportSource>,
): string {
  const sentences: string[] = [];
  const conflict = claims.find((claim) => claim.claim_id.includes('reconciled::broader-conflict'));
  const hormuz = claims.find((claim) => claim.claim_id.includes('reconciled::hormuz'));
  const redSea = claims.find((claim) => claim.claim_id.includes('reconciled::red-sea'));

  if (conflict) {
    const note = sourceNote(sourceMap, conflict.evidence_source_ids, conflict.time_ref);
    sentences.push(
      sentence(
        `${conflict.summary.replace(/\.$/, '')}${note ? ` (${note})` : ''}`,
      ),
    );
  }
  if (hormuz) sentences.push(sentence(hormuz.summary));
  if (redSea) sentences.push(sentence(redSea.summary));

  return sentences.length
    ? sentences.join(' ')
    : 'The latest retrieved source set is too thin to support a confident executive summary.';
}

function buildCurrentStatusSection(
  claims: NormalizedClaim[],
  sourceMap: Map<string, NormalizedReportSource>,
): string {
  const preferred = claims
    .filter((claim) => claim.section === 'current_status' && claim.claim_id.includes('reconciled::'))
    .slice(0, 5);

  return preferred.length
    ? preferred
        .map((claim) => {
          const note = sourceNote(sourceMap, claim.evidence_source_ids, claim.time_ref);
          return `- ${claim.summary.replace(/\.$/, '')}${note ? ` (${note})` : ''}`;
        })
        .join('\n')
    : '- The current retrieved source set did not produce enough dated status evidence to render this section confidently.';
}

function buildReportedDevelopmentsSection(
  claims: NormalizedClaim[],
  sourceMap: Map<string, NormalizedReportSource>,
): string {
  const developments = claims
    .filter((claim) => claim.section === 'reported_developments')
    .slice(0, 3);

  if (!developments.length) {
    return 'The latest retrieved source set does not provide enough dated developments to expand this section confidently.';
  }

  return developments
    .map((claim) => {
      const source = claim.evidence_source_ids[0]
        ? sourceMap.get(claim.evidence_source_ids[0])
        : undefined;
      return sentence(
        `${source?.name || 'A current source'} reported${claim.time_ref ? ` on ${claim.time_ref}` : ''} that ${claim.summary
          .replace(/\.$/, '')
          .charAt(0)
          .toLowerCase()}${claim.summary.replace(/\.$/, '').slice(1)}`,
      );
    })
    .join(' ');
}

function buildMetricsSection(
  claims: NormalizedClaim[],
  sourceMap: Map<string, NormalizedReportSource>,
  primaryTopicLabel?: string | null,
): string {
  const metrics = claims
    .filter(
      (claim) =>
        claim.status_type === 'metric' &&
        isRelevantToPrimaryTopic(primaryTopicLabel ?? null, claim.entity),
    )
    .slice(0, 5);
  if (!metrics.length) {
    return '- Exact quantitative metrics are limited in the current retrieved source set.';
  }

  return metrics
    .map((claim) => {
      const note = sourceNote(sourceMap, claim.evidence_source_ids, claim.time_ref);
      return `- **${claim.entity}**: ${claim.status}${note ? ` (${note})` : ''}`;
    })
    .join('\n');
}

function buildAnalysisSection(claims: NormalizedClaim[]): string {
  const sentences: string[] = [];
  const conflict = claims.find((claim) => claim.claim_id.includes('reconciled::broader-conflict'));
  const hormuz = claims.find((claim) => claim.claim_id.includes('reconciled::hormuz'));
  const redSea = claims.find((claim) => claim.claim_id.includes('reconciled::red-sea'));
  const insuranceMetric = claims.some(
    (claim) => claim.status_type === 'metric' && /insurance/i.test(claim.entity),
  );
  const hasRouteRiskContext = Boolean(conflict || hormuz || redSea);

  if (conflict && hormuz) {
    sentences.push(
      'The current source set supports separating broader conflict status from route status: the broader conflict is active, while Hormuz is best described as severely disrupted with limited successful transit rather than either fully normal or fully blocked.',
    );
  }

  if (redSea) {
    sentences.push(
      /not confirmed/i.test(redSea.summary)
        ? 'For the Red Sea, the strongest investor-grade framing is elevated route risk and renewed concern, not a confirmed fresh wave of commercial-shipping strikes.'
        : 'For the Red Sea, the current retrieved reporting supports direct commercial-shipping attack language.',
    );
  }

  if (hasRouteRiskContext && !insuranceMetric) {
    sentences.push(
      'The current retrieved source set does not quantify insurance spikes or broad freight dislocation, so those effects should be treated as plausible but unquantified rather than confirmed.',
    );
  }

  if (!sentences.length) {
    return 'Available evidence for this query is limited. The retrieved source set returned mostly background information and point-in-time metrics rather than current driver analysis. This report reflects what was retrievable, and a more confident causal explanation requires additional current sources.';
  }

  return sentences.map(sentence).join(' ');
}

function buildRisksSection(claims: NormalizedClaim[]): string {
  const lines: string[] = [];
  const hormuz = claims.find((claim) => claim.claim_id.includes('reconciled::hormuz'));
  const redSea = claims.find((claim) => claim.claim_id.includes('reconciled::red-sea'));
  const diplomatic = claims.find((claim) => claim.claim_id.includes('reconciled::diplomatic'));

  if (hormuz) {
    lines.push(
      '- The main Hormuz uncertainty is whether severe disruption persists or limited successful transits expand.',
    );
  }

  if (redSea) {
    lines.push(
      /not confirmed/i.test(redSea.summary)
        ? '- The main Red Sea uncertainty is whether elevated route risk turns into confirmed fresh attacks on commercial shipping.'
        : '- Red Sea route risk remains materially elevated because direct attacks on commercial shipping have been reported.',
    );
  }

  if (diplomatic?.disputed) {
    lines.push(
      '- Diplomatic claims remain contested, so de-escalation language should be treated cautiously.',
    );
  }

  return lines.length
    ? lines.join('\n')
    : '- The current retrieved source set remains mixed enough that status should be monitored closely for change.';
}

function buildConclusionSection(claims: NormalizedClaim[]): string {
  const sentences: string[] = [];
  const conflict = claims.find((claim) => claim.claim_id.includes('reconciled::broader-conflict'));
  const hormuz = claims.find((claim) => claim.claim_id.includes('reconciled::hormuz'));
  const redSea = claims.find((claim) => claim.claim_id.includes('reconciled::red-sea'));

  if (conflict) {
    sentences.push(
      conflict.status === 'reported_active_war'
        ? 'The broader conflict should be treated as active in the current public reporting set.'
        : 'The broader conflict should be described cautiously rather than overstated.',
    );
  }

  if (hormuz) {
    sentences.push(
      'Hormuz is best described as severely disrupted, with limited successful transits, rather than as fully normal or fully blocked.',
    );
  }

  if (redSea) {
    sentences.push(
      /not confirmed/i.test(redSea.summary)
        ? 'The biggest near-term uncertainty is whether elevated Red Sea risk becomes confirmed fresh commercial-shipping disruption.'
        : 'The biggest near-term uncertainty is how long direct Red Sea shipping-attack risk remains elevated.',
    );
  }

  if (!sentences.length) {
    return 'The strongest honest takeaway is that the current retrieved evidence is directionally useful but still too thin for a confident, complete conclusion.';
  }

  return sentences.map(sentence).join(' ');
}

function extractStructuredSummary(research: Obj | null): string | null {
  const summary = asString(research?.executive_summary);
  return summary ? sentence(shortenText(summary, 320)) : null;
}

function extractStructuredKeyEvidence(analysis: Obj | null): string[] {
  const insights = asArray(analysis?.key_insights)
    .map((entry) => asObject(entry))
    .filter((entry): entry is Obj => Boolean(entry))
    .map((entry) => asString(entry.insight))
    .filter((value): value is string => Boolean(value))
    .map((value) => `- ${sentence(shortenText(value, 220))}`)
    .slice(0, 4);

  return insights;
}

function extractStructuredDevelopments(research: Obj | null, primaryTopicLabel: string | null): string | null {
  const developments = asArray(research?.recent_developments)
    .map((entry) => asObject(entry))
    .filter((entry): entry is Obj => Boolean(entry))
    .map((entry) => {
      const event = asString(entry.event);
      const date = asString(entry.date_or_period);
      if (!event) return null;
      if (!isRelevantToPrimaryTopic(primaryTopicLabel, event)) return null;
      return `- ${shortenText(event, 200)}${date ? ` (${date})` : ''}`;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);

  return developments.length ? developments.join('\n') : null;
}

function extractStructuredRisks(research: Obj | null): string | null {
  const risks = asArray(research?.risks_or_caveats)
    .map((entry) => asString(entry))
    .filter((value): value is string => Boolean(value))
    .map((value) => `- ${sentence(shortenText(value, 220))}`)
    .slice(0, 3);

  return risks.length ? risks.join('\n') : null;
}

function extractStructuredConclusion(analysis: Obj | null): string | null {
  const conclusion = asString(analysis?.decision_relevant_conclusion);
  return conclusion ? sentence(shortenText(conclusion, 320)) : null;
}

function formatSourceUsageForDisplay(
  usedFor?: string,
  primaryTopicLabel?: string | null,
): string | null {
  if (!usedFor) return null;

  const cleanedSegments = usedFor
    .split(/\s*;\s*/)
    .map((segment) =>
      stripHtmlTags(segment)
        .replace(/\bhttps?:\/\/\S+/gi, ' ')
        .replace(/\b(?:url|title|symbol|id):\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .filter((segment) => isRelevantToPrimaryTopic(primaryTopicLabel ?? null, segment));

  const cleaned = cleanedSegments.join('; ').trim();

  if (!cleaned) return null;
  if (/\bstatus active\b|\b24h volume\b|\boracle\b/i.test(cleaned)) {
    return null;
  }

  const normalized = cleaned.replace(/^(fact|metric|development):\s*/i, '').trim();
  if (!normalized) return null;
  if (normalized.length > 80 || normalized.split(/\s+/).length > 12) return null;

  return normalized;
}

function formatSourceNameForDisplay(name: string): string {
  const cleaned = stripHtmlTags(name).replace(/\s+/g, ' ').trim();
  const shortened = cleaned.length > 72 ? `${cleaned.slice(0, 69).trimEnd()}...` : cleaned;
  return shortened.replace(/([\\[\]])/g, '\\$1');
}

function buildSourcesSection(
  sources: NormalizedReportSource[],
  primaryTopicLabel?: string | null,
  fallbackAccessDate?: string,
): string {
  return sources.length
    ? sources
        .slice(0, 6)
        .map((source) => {
          const usage = formatSourceUsageForDisplay(source.usedFor, primaryTopicLabel);
          const publishedAt = asDate(source.publishedAt);
          const accessedAt = asDate(source.accessedAt) ?? fallbackAccessDate;
          const dateLabel = publishedAt
            ? `published ${publishedAt}`
            : accessedAt
              ? `accessed ${accessedAt}`
              : null;
          return `- [${formatSourceNameForDisplay(source.name)}](${source.url})${usage ? ` - ${usage}` : ''}${dateLabel ? ` (${dateLabel})` : ''}`;
        })
        .join('\n')
    : '- Source URLs were not available in the current retrieved set. This indicates a retrieval gap that should be reported.';
}

function buildFallbackSourcesFromLiveData(
  liveData: Obj | null,
  task: string,
  primaryTopicLabel?: string | null,
): NormalizedReportSource[] {
  const grounding = buildLiveDataSourceGrounding(liveData, task, primaryTopicLabel);
  const deduped = [...grounding.byUrl.values()]
    .sort((left, right) => sourcePriority(right.url, right.name) - sourcePriority(left.url, left.name))
    .slice(0, 6);

  return deduped.map((entry, index) => ({
    id: `fallback_source_${index + 1}`,
    name: normalizeSourceName(entry.name, entry.url),
    url: entry.url,
    usedFor: undefined,
    canonical: !isGoogleNewsRssUrl(entry.url),
    publishedAt: entry.publishedAt,
    accessedAt: entry.accessedAt,
  }));
}

function isSourcesHeadingLine(line: string): boolean {
  if (/^(?:[-*\u2022]\s+)?(?:#{1,6}\s+)?\*\*Sources:?\*\*:?\s*$/i.test(line.trim())) {
    return true;
  }
  return /^(?:[-*•]\s+)?(?:#{1,6}\s+)?(?:\*\*)?Sources(?:\*\*)?\s*:?\s*$/i.test(line.trim());
}

function isReportSectionHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isSourcesHeadingLine(trimmed)) return true;
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  if (/^(?:[-*\u2022]\s+)?\*\*[^*]+\*\*:?\s*$/.test(trimmed)) return true;
  if (/^\*\*[^*]+\*\*:?\s*$/.test(trimmed)) return true;
  return /^(?:[-*•]\s+)?(?:Summary|Overview|Executive Summary|Current Situation|Current State|Market Context|Ecosystem Overview|Key Evidence|What Changed|Evidence and Data|Data and Statistics|Why It Matters|Implications(?: for You)?|Catalysts and Constraints|Constraints|Risks(?: and (?:Tradeoffs|Unknowns|Watchpoints))?|Coverage Limits|What We Still Do Not Know|Portfolio Context|Action Options|Sources|Takeaway)\s*:?\s*$/i.test(
    trimmed,
  );
}

function replaceSourcesSection(markdown: string, renderedSources: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const hasSourcesHeading = lines.some((line) => isSourcesHeadingLine(line));

  if (!hasSourcesHeading) {
    return `${markdown.trim()}\n\n## Sources\n\n${renderedSources}`.trim();
  }

  const rebuilt: string[] = [];
  let insertedSources = false;

  for (let index = 0; index < lines.length;) {
    if (!isSourcesHeadingLine(lines[index])) {
      rebuilt.push(lines[index]);
      index += 1;
      continue;
    }

    if (!insertedSources) {
      rebuilt.push('## Sources', '', ...renderedSources.split('\n'));
      insertedSources = true;
    }

    index += 1;
    while (index < lines.length && !isReportSectionHeadingLine(lines[index])) {
      index += 1;
    }
  }

  return rebuilt.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeWriterMarkdown(markdown: string): string {
  const normalized = repairMojibake(markdown).replace(/\r\n/g, '\n').trim();
  if (!normalized || /writer agent returned no markdown output/i.test(normalized)) {
    return '';
  }

  const withoutBlockedQuotes = normalized
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>/gi, '$1')
    .replace(/<\/a>/gi, '')
    .replace(/<((?:https?:\/\/)[^>\s]+)>/gi, '$1')
    .replace(/\[source URL:\s*<?((?:https?:\/\/)[^\]\s>]+)>?\]/gi, 'source URL: $1')
    .replace(/\(\s*article available at:\s*<?((?:https?:\/\/)[^)>\s]+)>?\s*\)/gi, '(article available at: $1)')
    .replace(/\(\s*announcement available at:\s*<?((?:https?:\/\/)[^)>\s]+)>?\s*\)/gi, '(announcement available at: $1)')
    .replace(/\(\s*source URL:\s*<?((?:https?:\/\/)[^)>\s]+)>?\s*\)/gi, '(source URL: $1)')
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!withoutBlockedQuotes) {
    return '';
  }

  return withoutBlockedQuotes.trim();
}

function isLinkOnlySourceBullet(line: string): boolean {
  const trimmed = line.trim();
  if (!/^(?:[-*•]|\d+\.)\s+/.test(trimmed)) return false;
  const body = trimmed.replace(/^(?:[-*•]|\d+\.)\s+/, '').trim();
  return (
    /^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/.test(body) ||
    /^(?:https?:\/\/\S+)$/.test(body) ||
    /^(?:[A-Za-z][A-Za-z0-9 .&:+-]{1,80}):\s*(?:https?:\/\/\S+)$/.test(body)
  );
}

function isLooseSourceLinkBullet(line: string): boolean {
  if (isLinkOnlySourceBullet(line)) return true;
  const trimmed = line.trim();
  if (!/^(?:[-*\u2022]|\d+\.)\s+/.test(trimmed)) return false;
  const body = trimmed.replace(/^(?:[-*\u2022]|\d+\.)\s+/, '').trim();
  return (
    /^\[(https?:\/\/[^\]]+)\]$/.test(body) ||
    /^(?:[A-Za-z][A-Za-z0-9 .&:+-]{1,80}):\s*\[(?:https?:\/\/[^\]]+)\]$/.test(body) ||
    /^(?:[A-Za-z][A-Za-z0-9 .&:+-]{1,80}):\s*\[[^\]]+\]\((https?:\/\/[^)]+)\)$/.test(body)
  );
}

function removeRedundantPreSourcesLinkList(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sourceHeadingIndex = lines.findIndex((line) => isSourcesHeadingLine(line));
  if (sourceHeadingIndex <= 0) {
    return markdown.trim();
  }

  let blockEnd = sourceHeadingIndex - 1;
  while (blockEnd >= 0 && !lines[blockEnd].trim()) {
    blockEnd -= 1;
  }
  if (blockEnd < 0) {
    return markdown.trim();
  }

  let blockStart = blockEnd;
  while (blockStart >= 0 && isLooseSourceLinkBullet(lines[blockStart])) {
    blockStart -= 1;
  }
  blockStart += 1;

  const blockLines = lines.slice(blockStart, blockEnd + 1).filter((line) => line.trim());
  if (blockLines.length < 2 || blockLines.some((line) => !isLooseSourceLinkBullet(line))) {
    return markdown.trim();
  }

  const rebuilt = [...lines.slice(0, blockStart), ...lines.slice(blockEnd + 1)];
  return rebuilt.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildCurrentEventReportMarkdown(state: FinalClaimState): string {
  const sourceMap = new Map(state.sources.map((source) => [source.id, source]));

  return [
    `# ${state.topic}`,
    '',
    '## Summary',
    '',
    buildExecutiveSummary(state.claims, sourceMap),
    '',
    '## Current Situation',
    '',
    buildCurrentStatusSection(state.claims, sourceMap),
    '',
    '## Key Evidence',
    '',
    buildReportedDevelopmentsSection(state.claims, sourceMap),
    '',
    '## Evidence and Data',
    '',
    buildMetricsSection(state.claims, sourceMap),
    '',
    '## Implications',
    '',
    buildAnalysisSection(state.claims),
    '',
    '## Risks and Unknowns',
    '',
    buildRisksSection(state.claims),
    '',
    '## Sources',
    '',
    buildSourcesSection(state.sources, undefined, todayDateString()),
    '',
    '## Takeaway',
    '',
    buildConclusionSection(state.claims),
  ].join('\n').trim();
}

export function buildGeneralReportMarkdown(
  state: FinalClaimState,
  research: Obj | null,
  analysis: Obj | null,
): string {
  const sourceMap = new Map(state.sources.map((source) => [source.id, source]));
  const primaryTopicLabel = inferPrimaryTopicLabel(state.topic, research);
  const keyFacts = state.claims
    .filter(
      (claim) =>
        isRelevantToPrimaryTopic(primaryTopicLabel, claim.summary) &&
        (claim.section === 'reported_developments' || claim.section === 'data_and_statistics'),
    )
    .slice(0, 5);
  const structuredSummary = extractStructuredSummary(research);
  const structuredKeyEvidence = extractStructuredKeyEvidence(analysis);
  const structuredDevelopments = extractStructuredDevelopments(research, primaryTopicLabel);
  const structuredRisks = extractStructuredRisks(research);
  const structuredConclusion = extractStructuredConclusion(analysis);

  return [
    `# ${state.topic}`,
    '',
    '## Overview',
    '',
    structuredSummary || buildExecutiveSummary(state.claims, sourceMap),
    '',
    '## Key Evidence',
    '',
    structuredKeyEvidence.length
      ? structuredKeyEvidence.join('\n')
      : keyFacts.length
      ? keyFacts.map((claim) => `- ${claim.summary}`).join('\n')
      : '- Available evidence for this query is limited. The retrieved source set returned mostly background information and point-in-time metrics rather than current driver analysis.',
    '',
    '## What Changed',
    '',
    structuredDevelopments || buildReportedDevelopmentsSection(state.claims, sourceMap),
    '',
    '## Evidence and Data',
    '',
    buildMetricsSection(state.claims, sourceMap, primaryTopicLabel),
    '',
    '## Why It Matters',
    '',
    buildAnalysisSection(state.claims),
    '',
    '## Risks and Tradeoffs',
    '',
    structuredRisks || buildRisksSection(state.claims),
    '',
    '## Sources',
    '',
    buildSourcesSection(state.sources, primaryTopicLabel, todayDateString()),
    '',
    '## Takeaway',
    '',
    structuredConclusion || buildConclusionSection(state.claims),
  ].join('\n').trim();
}

function duplicateNarrativeIssues(markdown: string): string[] {
  const issues: string[] = [];
  const narrativeLines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^#/.test(line) &&
        !/^\*\*Prepared by:\*\*/.test(line) &&
        !/^- /.test(line) &&
        !/^## /.test(line),
    );

  const counts = new Map<string, number>();
  for (const line of narrativeLines) {
    const key = line.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [line, count] of counts.entries()) {
    if (count > 1) {
      issues.push(`Repeated narrative line detected: "${line}"`);
    }
  }

  return issues;
}

export function collectPreferredReportSources(params: {
  research: Obj | null;
  liveData: Obj | null;
}): NormalizedReportSource[] {
  return buildFinalState({
    task: asString(params.research?.topic) || 'AgentFlow',
    writerMarkdown: '',
    research: params.research,
    analysis: null,
    liveData: params.liveData,
  }).sources;
}

export function validateReportMarkdown(markdown: string, liveData: Obj | null): string[] {
  const framing = framingSignals(liveData);
  const issues: string[] = [];
  const futureMatches = [
    ...markdown.matchAll(/\b20\d{2}-\d{2}(?:-\d{2})?\b/g),
    ...markdown.matchAll(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/gi,
    ),
  ]
    .map((match) => match[0])
    .filter((value) => isFutureDateValue(value));

  for (const value of [...new Set(futureMatches)]) {
    issues.push(`Report references future date "${value}".`);
  }

  if (/\b(Firecrawl|GDELT|current_events Article|Google News RSS)\b/i.test(markdown)) {
    issues.push('Report cites retrieval tooling instead of public source names.');
  }

  if (!asObject(liveData?.coingecko) && /\bCoinGecko\b/i.test(markdown)) {
    issues.push('Report cites CoinGecko even though CoinGecko data was not retrieved.');
  }

  if (
    framing?.broader_conflict_status === 'reported_active_war' &&
    /\bno (?:active )?(?:direct )?(?:full[- ]scale )?(?:war|conflict) (?:is|was|exists|existed)?\s*(?:confirmed|according to|reported)?\b/i.test(markdown)
  ) {
    issues.push(
      'Report says the conflict is inactive even though current sources describe it as active.',
    );
  }

  if (
    framing?.red_sea_route_status ===
      'elevated_risk_latest_direct_shipping_strikes_not_confirmed' &&
    /\b(?:fresh|new|direct)\s+(?:shipping|commercial shipping)\s+strikes?\s+(?:are|were|remain)?\s*confirmed\b/i.test(
      markdown,
    )
  ) {
    issues.push(
      'Report confirms a shipping strike where sources only support elevated risk.',
    );
  }

  if (
    framing?.hormuz_route_status === 'severely_constrained_with_limited_passage' &&
    /\b(?:is|are|remains?)\s+(?:fully|completely)\s+(?:blocked|closed)\b/i.test(markdown)
  ) {
    issues.push(
      'Report says a route is fully blocked even though sources support severe disruption with limited transit.',
    );
  }

  if (/\bnot confirmed\b[^.\n]*\bbut confirmed\b/i.test(markdown)) {
    issues.push('Report contains a contradictory double-negation phrase.');
  }

  if (/\binsurance spikes?\s+(?:are|were|remain|have been)\b/i.test(markdown)) {
    issues.push('Report states insurance spikes as confirmed without checking source-backed metrics.');
  }

  return [...new Set([...issues, ...duplicateNarrativeIssues(markdown)])];
}

function isBlockingValidationIssue(issue: string): boolean {
  return (
    /future date/i.test(issue) ||
    /retrieval tooling/i.test(issue) ||
    /CoinGecko data was not retrieved/i.test(issue) ||
    /conflict is inactive/i.test(issue) ||
    /shipping strike/i.test(issue) ||
    /fully blocked/i.test(issue) ||
    /insurance spikes/i.test(issue)
  );
}

export function finalizeReportMarkdown(params: FinalizeParams): {
  markdown: string;
  sources: NormalizedReportSource[];
  validationIssues: string[];
  claims: NormalizedClaim[];
} {
  const state = buildFinalState(params);
  const fallbackMarkdown = currentEvents(params.liveData)
    ? buildCurrentEventReportMarkdown(state)
    : buildGeneralReportMarkdown(state, params.research, params.analysis);
  const writerMarkdown = sanitizeWriterMarkdown(params.writerMarkdown);
  const writerValidationIssues = writerMarkdown
    ? validateReportMarkdown(writerMarkdown, params.liveData)
    : [];
  const shouldUseFallback =
    !writerMarkdown || writerValidationIssues.some(isBlockingValidationIssue);
  const markdown = shouldUseFallback ? fallbackMarkdown : writerMarkdown;
  const repairedMarkdown = hasMojibakeMarkers(markdown) ? repairMojibake(markdown) : markdown;
  const primaryTopicLabel = inferPrimaryTopicLabel(state.topic, params.research);
  const effectiveSources =
    state.sources.length > 0
      ? state.sources
      : buildFallbackSourcesFromLiveData(params.liveData, params.task, primaryTopicLabel);
  const renderedSources = buildSourcesSection(
    effectiveSources,
    primaryTopicLabel,
    todayDateString(),
  );
  const markdownWithDeterministicSources = replaceSourcesSection(repairedMarkdown, renderedSources);
  const cleanedMarkdown = removeRedundantPreSourcesLinkList(markdownWithDeterministicSources);
  if (repairedMarkdown !== markdown) {
    console.warn('[reportPipeline] repaired mojibake in final markdown');
  }
  const validationIssues = shouldUseFallback
    ? [
        ...new Set([
          ...state.issues,
          ...validateReportMarkdown(cleanedMarkdown, params.liveData),
        ]),
      ]
    : [
        ...new Set([
          ...state.issues,
          ...writerValidationIssues,
          ...validateReportMarkdown(cleanedMarkdown, params.liveData),
        ]),
      ];

  return {
    markdown: cleanedMarkdown,
    sources: effectiveSources,
    validationIssues,
    claims: state.claims,
  };
}
