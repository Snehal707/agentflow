import { searchFirecrawlNews, type FirecrawlSearchResult } from '../../lib/firecrawl';
import { fetchLiveData } from '../../lib/live-data';
import type { ResearchBrief, Source } from './types';

export async function retrieveSources(
  brief: ResearchBrief,
  queries: string[],
  onProgress?: (progress: { fetched: number; total: number }) => void,
): Promise<Source[]> {
  const deduped = Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
  const collected: Source[] = [];
  const seenUrls = new Set<string>();

  for (let index = 0; index < deduped.length; index += 5) {
    const batch = deduped.slice(index, index + 5);
    const batchResults = await Promise.all(
      batch.map((query) =>
        searchFirecrawlNews(query, 5, { recency: 'all' }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[research] Firecrawl search failed for "${query.slice(0, 80)}": ${message}`);
          return [] as FirecrawlSearchResult[];
        }),
      ),
    );

    for (const results of batchResults) {
      for (const item of results) {
        const source = normalizeSource(item);
        if (!source) continue;
        if (seenUrls.has(source.url)) continue;
        if (isAvoidedDomain(source.domain, brief.domains_avoid)) continue;
        if (!isRelevantToBrief(source, brief)) continue;

        seenUrls.add(source.url);
        collected.push(source);
      }
    }

    onProgress?.({
      fetched: Math.min(collected.length, 25),
      total: deduped.length,
    });
  }

  if (collected.length === 0) {
    const fallbackSources = await retrieveFallbackSources(brief, seenUrls);
    collected.push(...fallbackSources);
  }
  if (collected.length === 0) {
    const liveDataSources = await retrieveLiveDataFallbackSources(brief, seenUrls);
    collected.push(...liveDataSources);
  }

  return collected
    .sort((a, b) => scoreSource(b, brief) - scoreSource(a, brief))
    .slice(0, 25);
}

async function retrieveLiveDataFallbackSources(
  brief: ResearchBrief,
  seenUrls: Set<string>,
): Promise<Source[]> {
  try {
    const raw = await fetchLiveData(brief.query);
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

async function retrieveFallbackSources(brief: ResearchBrief, seenUrls: Set<string>): Promise<Source[]> {
  const fallbackQueries = Array.from(
    new Set([
      brief.query,
      ...brief.domains_priority.slice(0, 3).map((domain) => `${brief.query} site:${domain}`),
      ...(isArcNetworkQuery(brief.query)
        ? [
            'Arc Network Circle stablecoin blockchain',
            'site:arc.network Arc Network',
            'site:circle.com Arc Network blockchain',
          ]
        : []),
    ].map((query) => query.trim()).filter(Boolean)),
  );
  const collected: Source[] = [];

  for (const query of fallbackQueries.slice(0, 8)) {
    const results = await searchFirecrawlNews(query, 5, { recency: 'all' }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[research] Firecrawl fallback failed for "${query.slice(0, 80)}": ${message}`);
      return [] as FirecrawlSearchResult[];
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

function normalizeSource(item: FirecrawlSearchResult): Source | null {
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
  const date = typeof item.date === 'string' ? item.date : '';

  return {
    url,
    title,
    date,
    snippet,
    domain,
    reliability: inferReliability(domain),
  };
}

function inferReliability(domain: string): 'high' | 'medium' | 'low' {
  if (
    domain.endsWith('.gov') ||
    domain.endsWith('.org') ||
    domain.includes('reuters.com') ||
    domain.includes('apnews.com')
  ) {
    return 'high';
  }
  if (
    domain.includes('coindesk.com') ||
    domain.includes('cointelegraph.com') ||
    domain.includes('bloomberg.com') ||
    domain.includes('theblock.co')
  ) {
    return 'medium';
  }
  return 'low';
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
  return [...new Set(tokens.filter((token) => token.length > 2 && !STOPWORDS.has(token)))].slice(
    0,
    10,
  );
}

function sourceSearchText(source: Source): string {
  return `${source.title} ${source.snippet} ${source.domain} ${source.url}`.toLowerCase();
}

function isArcNetworkQuery(query: string): boolean {
  return /\barc network\b|\barc blockchain\b|\barc testnet\b|\barc ecosystem\b/i.test(query);
}

function isRelevantToBrief(source: Source, brief: ResearchBrief): boolean {
  const haystack = sourceSearchText(source);

  if (isArcNetworkQuery(brief.query)) {
    return (
      /\barc\b/.test(haystack) ||
      haystack.includes('arc.network') ||
      haystack.includes('circle.com')
    );
  }

  const terms = tokenizeRelevanceTerms(
    [brief.query, ...brief.sub_questions.slice(0, 3)].join(' '),
  );
  if (terms.length === 0) {
    return true;
  }

  return terms.some((term) => new RegExp(`\\b${term}\\b`, 'i').test(haystack));
}

function isPrioritySource(source: Source, brief: ResearchBrief): boolean {
  return brief.domains_priority.some((item) => {
    const domain = item.trim().toLowerCase();
    return domain && (source.domain.includes(domain) || source.url.toLowerCase().includes(domain));
  });
}

function scoreSource(source: Source, brief: ResearchBrief): number {
  let score = 0;
  if (source.reliability === 'high') score += 30;
  if (source.reliability === 'medium') score += 15;

  if (brief.domains_priority.some((item) => source.domain.includes(item.toLowerCase()))) {
    score += 50;
  }

  if (source.date) {
    const ts = Date.parse(source.date);
    if (Number.isFinite(ts)) {
      const ageDays = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
      score += Math.max(0, 20 - ageDays);
    }
  }

  return score;
}
