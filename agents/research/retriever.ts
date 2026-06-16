import { fetchLiveData } from '../../lib/live-data';
import {
  asksForCommunityEvidence,
  isCreatorAudienceMetricTask,
  isLowValueSourceForTask,
  isOfficialCreatorPlatformUrl,
} from '../../lib/source-policy';
import { selectSources } from '../../lib/source-registry';
import { getAdapter, type ContentItem, type ExtractedQuery, type SourceResult } from '../../lib/source-adapters';
import type { SourceConfig } from '../../lib/source-registry';
import { applyEntityRelevanceGate } from './entityRelevanceGate';
import type { ResearchBrief, Source } from './types';

const REGISTRY_FETCH_TIMEOUT_MS = Number(process.env.RESEARCH_TIMEOUT_MS || 30_000);
const DEEP_PRIMARY_SEARCH_QUERY_LIMIT = Number(process.env.DEEP_PRIMARY_SEARCH_QUERY_LIMIT || 10);
const DEEP_PRIMARY_SEARCH_RESULTS_PER_QUERY = Number(
  process.env.DEEP_PRIMARY_SEARCH_RESULTS_PER_QUERY || 8,
);
const DEEP_PRIMARY_SOURCE_TARGET = Number(process.env.DEEP_PRIMARY_SOURCE_TARGET || 24);
const DEEP_TOTAL_SOURCE_LIMIT = Number(process.env.DEEP_TOTAL_SOURCE_LIMIT || 40);
const REGISTRY_ADAPTER_OPTIONS = {
  timeoutMs: 10_000,
  scrapeTimeoutMs: 15_000,
  maxItems: 5,
} as const;

export async function retrieveSources(
  brief: ResearchBrief,
  queries: string[],
  onProgress?: (progress: { fetched: number; total: number }) => void,
): Promise<Source[]> {
  const deduped = Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
  const collected: Source[] = [];
  const seenUrls = new Set<string>();

  const primarySearchSources = await retrievePrimaryHybridSearchSources(brief, deduped, seenUrls);
  collected.push(...primarySearchSources);
  onProgress?.({
    fetched: Math.min(collected.length, DEEP_TOTAL_SOURCE_LIMIT),
    total: deduped.length,
  });

  const liveDataSources = await retrieveLiveDataFallbackSources(brief, seenUrls);
  collected.push(...liveDataSources);
  onProgress?.({
    fetched: Math.min(collected.length, DEEP_TOTAL_SOURCE_LIMIT),
    total: deduped.length,
  });

  const fallbackEligibleSources = collected
    .filter((source) => !isFutureDatedSource(source))
    .filter((source) => !isLowValueSearchSource(source, brief));
  const hasBroadTopicAuthorityGap =
    brief.scope === 'broad' &&
    fallbackEligibleSources.every((source) => source.reliability !== 'high');
  const shouldUseRegistryFallback =
    fallbackEligibleSources.length < DEEP_PRIMARY_SOURCE_TARGET ||
    distinctDomainCount(fallbackEligibleSources) < brief.minimum_source_diversity ||
    hasBroadTopicAuthorityGap;
  const registrySources = shouldUseRegistryFallback
    ? await retrieveRegistrySources(brief, seenUrls)
    : [];
  collected.push(...registrySources);
  onProgress?.({
    fetched: Math.min(collected.length, DEEP_TOTAL_SOURCE_LIMIT),
    total: deduped.length,
  });

  if (collected.length === 0 && process.env.AGENTFLOW_ENABLE_FIRECRAWL_SEARCH === 'true') {
    const legacySources = await retrieveLegacyFirecrawlSearchSources(brief, deduped, seenUrls);
    collected.push(...legacySources);
  }

  if (shouldUseRegistryFallback && registrySources.length < 2) {
    console.warn(
      `[research] registry fallback_used=true reason=content_sources_below_threshold count=${registrySources.length}`,
    );
    const fallbackSources = await retrieveRegistrySources(
      {
        ...brief,
        query: [brief.query, ...brief.domains_priority.slice(0, 3)].join(' '),
      },
      seenUrls,
    );
    collected.push(...fallbackSources);
  }

  const gateResult = applyEntityRelevanceGate(collected, brief);
  if (gateResult.gateMetadata.applied) {
    console.log(
      `[research] entity gate activated scope=${gateResult.gateMetadata.scope} entities=${gateResult.gateMetadata.derivedEntities.join(', ')} comparison=${gateResult.gateMetadata.comparisonMode} threshold=${gateResult.gateMetadata.mentionThreshold} domain_map_size=${gateResult.gateMetadata.entityDomainMapSize}`,
    );
    for (const decision of gateResult.decisions) {
      console.log(
        [
          '[research] entity gate decision',
          `source="${decision.source.title}"`,
          `domain=${decision.source.domain}`,
          `kept=${decision.kept}`,
          `reason=${decision.reason}`,
          decision.matchedEntity ? `entity=${decision.matchedEntity}` : '',
          typeof decision.mentionCount === 'number' ? `mentions=${decision.mentionCount}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
    console.log(
      `[research] entity gate summary total=${collected.length} kept=${gateResult.keptSources.length} filtered=${gateResult.filteredSources.length}`,
    );
  }

  return limitLowReliabilitySources(
    gateResult.keptSources
    .filter((source) => !isFutureDatedSource(source))
    .filter((source) => !isLowValueSearchSource(source, brief))
    .sort((a, b) => scoreSource(b, brief) - scoreSource(a, brief))
    .filter(limitPerDomain(2))
    .slice(0, DEEP_TOTAL_SOURCE_LIMIT),
  );
}

async function retrievePrimaryHybridSearchSources(
  brief: ResearchBrief,
  queries: string[],
  seenUrls: Set<string>,
): Promise<Source[]> {
  const { searchFirecrawlNews, searchSearxng } = await import('../../lib/firecrawl');
  const recency =
    brief.time_sensitivity === 'historical'
      ? 'all'
      : brief.time_sensitivity === 'live'
        ? 'week'
        : 'month';
  const collected: Source[] = [];

  for (const query of queries.slice(0, DEEP_PRIMARY_SEARCH_QUERY_LIMIT)) {
    const [firecrawlResults, searxngResults] = await Promise.allSettled([
      searchFirecrawlNews(query, DEEP_PRIMARY_SEARCH_RESULTS_PER_QUERY, { recency }),
      searchSearxng(query, DEEP_PRIMARY_SEARCH_RESULTS_PER_QUERY, { timeoutMs: 15_000 }),
    ]);

    const merged = new Map<string, {
      title?: string;
      url?: string;
      snippet?: string;
      description?: string;
      date?: string;
      markdown?: string;
    }>();

    const pushResult = (item: {
      title?: string;
      url?: string;
      snippet?: string;
      description?: string;
      date?: string;
      markdown?: string;
    }) => {
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (!url || merged.has(url)) return;
      merged.set(url, item);
    };

    if (firecrawlResults.status === 'fulfilled') {
      for (const item of firecrawlResults.value) pushResult(item);
    }
    if (searxngResults.status === 'fulfilled') {
      for (const item of searxngResults.value) pushResult(item);
    }

    if (firecrawlResults.status === 'rejected') {
      console.warn(
        `[research] primary Firecrawl search failed for "${query.slice(0, 80)}": ${firecrawlResults.reason instanceof Error ? firecrawlResults.reason.message : String(firecrawlResults.reason)}`,
      );
    }
    if (searxngResults.status === 'rejected') {
      console.warn(
        `[research] primary SearXNG search failed for "${query.slice(0, 80)}": ${searxngResults.reason instanceof Error ? searxngResults.reason.message : String(searxngResults.reason)}`,
      );
    }

    for (const item of merged.values()) {
      const source = normalizeSource(item);
      if (!source) continue;
      if (seenUrls.has(source.url)) continue;
      if (isAvoidedDomain(source.domain, brief.domains_avoid)) continue;
      if (isLowValueSearchSource(source, brief)) continue;
      if (!isRelevantToBrief(source, brief) && !isPrioritySource(source, brief)) continue;
      seenUrls.add(source.url);
      collected.push(source);
      if (collected.length >= DEEP_PRIMARY_SOURCE_TARGET) {
        return collected;
      }
    }
  }

  return collected;
}

async function retrieveRegistrySources(brief: ResearchBrief, seenUrls: Set<string>): Promise<Source[]> {
  const startedAt = Date.now();
  const adapterCounts = new Map<string, { success: number; failure: number; latency: number }>();
  const routingQuery = [
    brief.query,
    ...brief.sub_questions.slice(0, 3),
    ...brief.domains_priority.slice(0, 5),
  ].join(' ');
  const selected = selectSources(
    routingQuery,
    12,
  );
  console.log(
    `[research] registry selected: ${selected.map((source) => `${source.name}:${source.method}`).join(', ')}`,
  );

  const eligible = selected.filter((registrySource) => {
    const url = registrySource.baseUrl;
    if (!url || seenUrls.has(url)) return false;
    try {
      const domain = new URL(url).hostname.toLowerCase();
      return !isAvoidedDomain(domain, brief.domains_avoid);
    } catch {
      return false;
    }
  });

  const extractedQuery: ExtractedQuery = {
    text: routingQuery,
    entities: tokenizeRelevanceTerms(routingQuery),
    topics: brief.domains_priority.slice(0, 8),
  };
  const fetches = eligible.map((registrySource) => fetchRegistrySource(registrySource, extractedQuery));
  const settled = await settleWithTimeout(fetches, REGISTRY_FETCH_TIMEOUT_MS, eligible);
  const collected: Source[] = [];

  for (const outcome of settled) {
    const stats = adapterCounts.get(outcome.source.method) ?? { success: 0, failure: 0, latency: 0 };
    stats.latency += outcome.result?.latency_ms ?? 0;
    if (outcome.result?.success) stats.success += 1;
    else stats.failure += 1;
    adapterCounts.set(outcome.source.method, stats);

    if (!outcome.result) {
      console.warn(
        `[research] adapter timeout source=${registrySourceId(outcome.source)} name="${outcome.source.name}" method=${outcome.source.method}`,
      );
      continue;
    }

    console.log(
      `[research] adapter result source=${registrySourceId(outcome.source)} name="${outcome.source.name}" method=${outcome.source.method} success=${outcome.result.success} latency_ms=${outcome.result.latency_ms} items=${outcome.result.items.length}${outcome.result.error ? ` error=${outcome.result.error}` : ''}`,
    );

    const source = sourceFromAdapterResult(outcome.source, outcome.result);
    if (!source) {
      console.warn(
        `[research] adapter skip source=${registrySourceId(outcome.source)} name="${outcome.source.name}" method=${outcome.source.method} reason=${outcome.result.error ?? 'empty_items'}`,
      );
      continue;
    }
    if (!isRelevantToBrief(source, brief) && !isPrioritySource(source, brief)) continue;
    if (seenUrls.has(source.url)) continue;
    seenUrls.add(source.url);
    collected.push(source);
  }

  const adapterSummary = [...adapterCounts.entries()]
    .map(
      ([method, stats]) =>
        `${method}:success=${stats.success},failure=${stats.failure},latency_ms=${stats.latency}`,
    )
    .join(' ');
  console.log(
    `[research] registry retrieval completed latency_ms=${Date.now() - startedAt} sources=${collected.length} adapters=[${adapterSummary}]`,
  );

  return collected;
}

async function fetchRegistrySource(
  registrySource: SourceConfig,
  extractedQuery: ExtractedQuery,
): Promise<{ source: SourceConfig; result: SourceResult }> {
  console.log(
    `[research] calling ${registrySource.method} adapter for ${registrySourceId(registrySource)} (${registrySource.name})`,
  );
  const adapter = getAdapter(registrySource.method);
  const result = await adapter(registrySource, extractedQuery, REGISTRY_ADAPTER_OPTIONS);
  return { source: registrySource, result };
}

async function settleWithTimeout(
  promises: Array<Promise<{ source: SourceConfig; result: SourceResult }>>,
  timeoutMs: number,
  sources: SourceConfig[],
): Promise<Array<{ source: SourceConfig; result?: SourceResult }>> {
  const outcomes: Array<{ source: SourceConfig; result?: SourceResult } | undefined> = new Array(
    sources.length,
  );
  const wrapped = promises.map((promise, index) =>
    promise
      .then((value) => {
        outcomes[index] = value;
      })
      .catch((reason) => {
        const source = sources[index];
        const message = reason instanceof Error ? reason.message : String(reason);
        console.warn(
          `[research] adapter promise rejected source=${registrySourceId(source)} name="${source.name}" method=${source.method} error=${message}`,
        );
        outcomes[index] = { source };
      }),
  );
  const settledPromise = Promise.allSettled(wrapped).then(() =>
    sources.map((source, index) => outcomes[index] ?? { source }),
  );

  const timeoutPromise = new Promise<Array<{ source: SourceConfig; result?: SourceResult }>>((resolve) => {
    setTimeout(() => {
      resolve(sources.map((source, index) => outcomes[index] ?? { source }));
    }, timeoutMs);
  });

  return Promise.race([settledPromise, timeoutPromise]);
}

function registrySourceId(source: Pick<SourceConfig, 'name'> & { id?: string }): string {
  return (
    source.id ??
    source.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

function sourceFromAdapterResult(registrySource: SourceConfig, result: SourceResult): Source | null {
  if (!result.success || result.items.length === 0) return null;
  const topItems = result.items.slice(0, 3);
  const firstUrl = topItems[0]?.url || registrySource.baseUrl;
  let domain = '';
  try {
    domain = new URL(firstUrl).hostname.toLowerCase();
  } catch {
    try {
      domain = new URL(registrySource.baseUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  const snippet = buildRegistrySnippet(topItems);
  if (!snippet) return null;

  return {
    url: firstUrl,
    title: registrySource.name,
    date: topItems[0]?.published_at ?? '',
    snippet,
    domain,
    reliability: registryTrustToReliability(registrySource.trust),
  };
}

function buildRegistrySnippet(items: ContentItem[]): string {
  return items
    .map((item) => {
      const lines: string[] = [];
      if (item.title) lines.push(`Title: ${item.title}`);
      if (item.url) lines.push(`URL: ${item.url}`);
      if (item.published_at) lines.push(`Date: ${item.published_at}`);
      const summary = summarizeMarkdown(item.content);
      if (summary) lines.push(summary);
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n---\n\n')
    .slice(0, 2000);
}

async function retrieveLiveDataFallbackSources(
  brief: ResearchBrief,
  seenUrls: Set<string>,
): Promise<Source[]> {
  try {
    const raw = await fetchLiveData(brief.query);
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sources: Source[] = [];
    const currentEvents = parsed.current_events as
      | {
          article_snapshots?: Array<{
            title?: string;
            url?: string;
            publisher?: string;
            seen_at?: string;
            summary?: string;
          }>;
          articles?: Array<{
            title?: string;
            url?: string;
            domain?: string;
            publisher?: string;
            seen_at?: string;
          }>;
        }
      | undefined;

    for (const snapshot of currentEvents?.article_snapshots ?? []) {
      const url = typeof snapshot.url === 'string' ? snapshot.url : '';
      if (!url || seenUrls.has(url)) continue;
      const source = sourceFromLiveDataArticle({
        title: snapshot.title,
        url,
        snippet: snapshot.summary,
        date: snapshot.seen_at,
      });
      if (!source) continue;
      if (isAvoidedDomain(source.domain, brief.domains_avoid)) continue;
      if (!isRelevantToBrief(source, brief) && !isPrioritySource(source, brief)) continue;
      seenUrls.add(source.url);
      sources.push(source);
    }

    for (const article of currentEvents?.articles ?? []) {
      const url = typeof article.url === 'string' ? article.url : '';
      if (!url || seenUrls.has(url)) continue;
      const source = sourceFromLiveDataArticle({
        title: article.title,
        url,
        snippet: article.publisher,
        date: article.seen_at,
      });
      if (!source) continue;
      if (isAvoidedDomain(source.domain, brief.domains_avoid)) continue;
      if (!isRelevantToBrief(source, brief) && !isPrioritySource(source, brief)) continue;
      seenUrls.add(source.url);
      sources.push(source);
    }

    return sources.slice(0, 15);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[research] live-data fallback failed for "${brief.query.slice(0, 80)}": ${message}`);
    return [];
  }
}

function sourceFromLiveDataArticle(input: {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string;
}): Source | null {
  const url = typeof input.url === 'string' ? input.url : '';
  if (!url) return null;
  let domain = '';
  try {
    domain = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return {
    url,
    title: typeof input.title === 'string' && input.title.trim() ? input.title : domain,
    date: typeof input.date === 'string' ? input.date : '',
    snippet: typeof input.snippet === 'string' ? input.snippet : '',
    domain,
    reliability: inferReliability(domain),
  };
}

async function retrieveLegacyFirecrawlSearchSources(
  brief: ResearchBrief,
  queries: string[],
  seenUrls: Set<string>,
): Promise<Source[]> {
  const { searchFirecrawlNews } = await import('../../lib/firecrawl');
  const collected: Source[] = [];

  for (const query of queries.slice(0, 8)) {
    const results = await searchFirecrawlNews(query, 5, { recency: 'all' }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[research] legacy Firecrawl search failed for "${query.slice(0, 80)}": ${message}`);
      return [] as Array<{
        title?: string;
        url?: string;
        snippet?: string;
        description?: string;
        date?: string;
        markdown?: string;
      }>;
    });

    for (const item of results) {
      const source = normalizeSource(item);
      if (!source) continue;
      if (seenUrls.has(source.url)) continue;
      if (isAvoidedDomain(source.domain, brief.domains_avoid)) continue;
      if (!isRelevantToBrief(source, brief) && !isPrioritySource(source, brief)) continue;
      seenUrls.add(source.url);
      collected.push(source);
    }

    if (collected.length >= 10) break;
  }

  return collected;
}

function normalizeSource(item: {
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
  date?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
}): Source | null {
  const url = typeof item.url === 'string' ? item.url : '';
  if (!url) {
    return null;
  }

  let domain = '';
  try {
    domain = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  const title = typeof item.title === 'string' ? item.title : domain;
  const snippet =
    typeof item.snippet === 'string'
      ? item.snippet
      : typeof item.description === 'string'
        ? item.description
        : typeof item.markdown === 'string'
          ? item.markdown.slice(0, 280)
          : '';
  const date = extractSearchResultDate(item);

  return {
    url,
    title,
    date,
    snippet,
    domain,
    reliability: inferReliability(domain),
  };
}

function extractSearchResultDate(item: {
  url?: string;
  date?: string;
  metadata?: Record<string, unknown>;
}): string {
  const candidates = [
    item.date,
    metadataString(item.metadata, 'publishedTime'),
    metadataString(item.metadata, 'article:published_time'),
    metadataString(item.metadata, 'article_published_time'),
    metadataString(item.metadata, 'article:published'),
    metadataString(item.metadata, 'datePublished'),
    metadataString(item.metadata, 'og:updated_time'),
    metadataString(item.metadata, 'article:modified'),
    metadataString(item.metadata, 'modifiedTime'),
    metadataString(item.metadata, 'last_updated_date'),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }

  const urlDate = item.url?.match(/\/((?:19|20)\d{2})\/(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/|$)/);
  if (!urlDate) return '';
  const timestamp = Date.parse(`${urlDate[1]}-${urlDate[2].padStart(2, '0')}-${urlDate[3].padStart(2, '0')}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function summarizeMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, (match) => match.replace(/^\[|\]\([^)]+\)$/g, ''))
    .replace(/[#*_>`~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

function registryTrustToReliability(trust: 'high' | 'medium_high' | 'medium' | 'low_medium'): Source['reliability'] {
  if (trust === 'high') return 'high';
  if (trust === 'medium_high' || trust === 'medium') return 'medium';
  return 'low';
}

function inferReliability(domain: string): 'high' | 'medium' | 'low' {
  if (
    domain.endsWith('.gov') ||
    domain.endsWith('.edu') ||
    domain.includes('reuters.com') ||
    domain.includes('apnews.com') ||
    domain.includes('bbc.')
  ) {
    return 'high';
  }
  if (
    domain.includes('bloomberg.com') ||
    domain.includes('ft.com') ||
    domain.includes('wsj.com') ||
    domain.includes('economist.com') ||
    domain.includes('imf.org') ||
    domain.includes('worldbank.org') ||
    domain.includes('bis.org') ||
    domain.includes('oecd.org') ||
    domain.includes('github.com') ||
    domain.includes('docs.') ||
    domain.includes('coindesk.com') ||
    domain.includes('cointelegraph.com') ||
    domain.includes('theblock.co')
  ) {
    return 'medium';
  }
  if (
    domain.endsWith('.org') ||
    domain.includes('wikipedia.org') ||
    domain.includes('coinmarketcap.com') ||
    domain.includes('coingecko.com')
  ) {
    return 'medium';
  }
  return 'low';
}

function distinctDomainCount(sources: Source[]): number {
  return new Set(sources.map((source) => source.domain)).size;
}

function isAvoidedDomain(domain: string, avoidList: string[]): boolean {
  return avoidList.some((item) => {
    const needle = item.trim().toLowerCase();
    return needle.length > 0 && domain.includes(needle);
  });
}

const STOPWORDS = new Set([
  'about',
  'after',
  'analysis',
  'brief',
  'current',
  'deep',
  'does',
  'ecosystem',
  'from',
  'into',
  'latest',
  'market',
  'news',
  'official',
  'report',
  'research',
  'status',
  'summary',
  'that',
  'this',
  'what',
  'which',
  'with',
]);

function tokenizeRelevanceTerms(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  if (!tokens) return [];
  return [
    ...new Set(
      tokens.filter(
        (token) => token.length > 2 && !/^(?:19|20)\d{2}$/.test(token) && !STOPWORDS.has(token),
      ),
    ),
  ].slice(0, 10);
}

function sourceSearchText(source: Source): string {
  return `${source.title} ${source.snippet} ${source.domain} ${source.url}`.toLowerCase();
}

function isArcNetworkQuery(query: string): boolean {
  return /\barc network\b|\barc blockchain\b|\barc testnet\b|\barc ecosystem\b/i.test(query);
}

function isPaymentsAdoptionQuery(query: string): boolean {
  return (
    /\bx402\b/i.test(query) ||
    /\bmerchant\b/i.test(query) ||
    /\bcheckout\b/i.test(query) ||
    (/\bpayments?\b/i.test(query) && /\badoption\b/i.test(query))
  );
}

function hasPaymentsTopicMatch(haystack: string): boolean {
  return (
    /\bx402\b/i.test(haystack) ||
    /\bpayments?\b/i.test(haystack) ||
    /\bmerchant\b/i.test(haystack) ||
    /\bcheckout\b/i.test(haystack) ||
    /\bprocessor\b/i.test(haystack) ||
    /\bcommerce\b/i.test(haystack) ||
    /\bstablecoin\b/i.test(haystack) ||
    /\bapi\b/i.test(haystack) ||
    /\bmicro-?payments?\b/i.test(haystack) ||
    /\bbilling\b/i.test(haystack)
  );
}

function countRegexTermMatches(terms: string[], haystack: string): number {
  let matches = 0;
  for (const term of terms) {
    if (new RegExp(`\\b${term}\\b`, 'i').test(haystack)) {
      matches += 1;
    }
  }
  return matches;
}

function isRelevantToBrief(source: Source, brief: ResearchBrief): boolean {
  const haystack = sourceSearchText(source);
  if (!hasRequiredTopicAnchor(haystack, brief.query)) {
    return false;
  }

  if (isArcNetworkQuery(brief.query)) {
    return (
      haystack.includes('arc.network') ||
      haystack.includes('arc.io') ||
      haystack.includes('circle.com') ||
      (/\barc\b/.test(haystack) &&
        /\b(blockchain|mainnet|testnet|stablecoin|l1|layer 1|ecosystem|defi|circle|launch)\b/i.test(
          haystack,
        ))
    );
  }

  if (isPaymentsAdoptionQuery(brief.query)) {
    if (/\bx402\b/i.test(brief.query)) {
      return (
        /\bx402\b/i.test(haystack) &&
        /\b(protocol|payment required|internet-native|agentic payments?|foundation|http|ecosystem|adoption|commerce)\b/i.test(
          haystack,
        )
      );
    }
    if (!hasPaymentsTopicMatch(haystack)) {
      return false;
    }

    const anchorTerms = tokenizeRelevanceTerms(brief.query).filter((term) =>
      ['x402', 'payment', 'payments', 'merchant', 'checkout', 'commerce', 'adoption', 'stablecoin'].includes(term),
    );
    const anchorMatches = countRegexTermMatches(anchorTerms, haystack);
    return anchorMatches >= 2 || (anchorMatches >= 1 && /\bx402\b/i.test(brief.query));
  }

  const terms = tokenizeRelevanceTerms(
    [brief.query, ...brief.sub_questions.slice(0, 3)].join(' '),
  );
  if (terms.length === 0) {
    return true;
  }

  const matchCount = countRegexTermMatches(terms, haystack);
  if (brief.scope === 'narrow') {
    return matchCount >= Math.min(2, terms.length);
  }
  return matchCount >= 1;
}

function isPrioritySource(source: Source, brief: ResearchBrief): boolean {
  if (!hasRequiredTopicAnchor(sourceSearchText(source), brief.query)) {
    return false;
  }
  return brief.domains_priority.some((item) => {
    const domain = item.trim().toLowerCase();
    return domain && (source.domain.includes(domain) || source.url.toLowerCase().includes(domain));
  });
}

function hasRequiredTopicAnchor(haystack: string, query: string): boolean {
  const anchors: RegExp[] = [];
  if (/\bx402\b/i.test(query)) anchors.push(/\bx402\b/i);
  if (/\bopenai\b|\bchatgpt\b/i.test(query)) anchors.push(/\bopenai\b|\bchatgpt\b/i);
  if (/\bstablecoin\b|\busdc\b|\busd coin\b/i.test(query)) {
    anchors.push(/\bstablecoin\b|\busdc\b|\busd[- ]coin\b/i);
  }
  if (/\bbitcoin\b|\bbtc\b/i.test(query)) anchors.push(/\bbitcoin\b|\bbtc\b/i);
  if (/\bethereum\b|\beth\b/i.test(query)) anchors.push(/\bethereum\b|\beth\b/i);
  if (/\bsolana\b|\bsol\b/i.test(query)) anchors.push(/\bsolana\b|\bsol\b/i);
  if (/\biran\b/i.test(query)) anchors.push(/\biran\b/i);
  if (isArcNetworkQuery(query)) anchors.push(/\barc\b|\barc\.network\b/i);
  return anchors.length === 0 || anchors.some((anchor) => anchor.test(haystack));
}

function isFutureDatedSource(source: Source): boolean {
  if (!source.date) return false;
  const timestamp = Date.parse(source.date);
  return Number.isFinite(timestamp) && timestamp > Date.now() + 6 * 60 * 60 * 1000;
}

function isEnglishQuery(query: string): boolean {
  return !/\b(deutsch|german|deutschland|euro|eur)\b/i.test(query);
}

function isOfficialCreatorPlatformSource(source: Source): boolean {
  return /\b(?:youtube\.com|youtu\.be)\b/i.test(source.domain) && isOfficialCreatorPlatformUrl(source.url);
}

function isLowValueSearchSource(source: Source, brief: ResearchBrief): boolean {
  const haystack = sourceSearchText(source);
  const englishQuery = isEnglishQuery(brief.query);
  const asksForForecast = /\b(predict|prediction|forecast|outlook|price target|year-end target)\b/i.test(
    brief.query,
  );
  const asksCommunity = asksForCommunityEvidence(brief.query);
  const asksForCreatorMetrics = isCreatorAudienceMetricTask(brief.query);

  if (isLowValueSourceForTask(brief.query, source)) return true;

  if (/\byoutube\.com\b|\byoutu\.be\b/i.test(source.domain)) {
    if (asksForCreatorMetrics && isOfficialCreatorPlatformSource(source)) {
      return false;
    }
    return true;
  }
  if (!asksCommunity && /\breddit\.com\b/i.test(source.domain)) return true;
  if (/\/square\/post\//i.test(source.url)) return true;
  if (/pdf\.js\/web\/viewer\.html|(?:login|signout).*[?&](?:source|redirect|url)=/i.test(source.url)) {
    return true;
  }
  if (englishQuery && /^(?:de|fr|es|it)\./i.test(source.domain)) return true;
  if (englishQuery && /\/de(?:\/|$)|\bwas ist\b|\bkaufen\b|\bbörse\b|\bkurs\b/i.test(haystack)) {
    return true;
  }
  if (/\bbitcoin\.de\b|\bbisonapp\.com\b/i.test(source.domain)) return true;

  if (
    /\bbitcoin\b/i.test(brief.query) &&
    !asksForForecast &&
    /\b(?:predict(?:ion|ions|s|ed)?|forecast|outlook|price target|year-end target|total collapse)\b/i.test(haystack) &&
    !/\b(?:current|today|live|market cap|volume)\b/i.test(haystack)
  ) {
    return true;
  }

  return false;
}

function limitPerDomain(limit: number): (source: Source) => boolean {
  const counts = new Map<string, number>();
  return (source) => {
    const count = counts.get(source.domain) ?? 0;
    if (count >= limit) return false;
    counts.set(source.domain, count + 1);
    return true;
  };
}

function limitLowReliabilitySources(sources: Source[]): Source[] {
  const authorityCount = sources.filter((source) => source.reliability !== 'low').length;
  if (authorityCount < 3) return sources;

  let lowReliabilityCount = 0;
  return sources.filter((source) => {
    if (source.reliability !== 'low') return true;
    lowReliabilityCount += 1;
    return lowReliabilityCount <= 6;
  });
}

function scoreSource(source: Source, brief: ResearchBrief): number {
  let score = 0;
  if (source.reliability === 'high') score += 30;
  if (source.reliability === 'medium') score += 15;

  const haystack = sourceSearchText(source);
  const creatorMetricsQuery = isCreatorAudienceMetricTask(brief.query);
  if (/\b(coingecko|coinmarketcap|defillama)\b/i.test(haystack)) score += 25;
  if (/\b(reuters|apnews|bbc|cnbc|coindesk|theblock)\b/i.test(haystack)) score += 20;
  if (/\bwikipedia\.org\b/i.test(source.domain)) score -= 10;
  if (creatorMetricsQuery && isOfficialCreatorPlatformSource(source)) score += 55;
  if (creatorMetricsQuery && /\b(socialblade|viewstats)\b/i.test(haystack)) score += 30;

  if (brief.domains_priority.some((item) => source.domain.includes(item.toLowerCase()))) {
    score += 50;
  }

  if (source.date) {
    const ts = Date.parse(source.date);
    if (Number.isFinite(ts)) {
      const ageDays = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
      score += Math.max(0, 20 - ageDays);
      if (creatorMetricsQuery && ageDays > 21) score -= Math.min(45, ageDays - 21);
    }
  } else if (creatorMetricsQuery && !isOfficialCreatorPlatformSource(source)) {
    score -= 10;
  }

  return score;
}
