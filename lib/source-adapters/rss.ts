import Parser from 'rss-parser';
import { emptyResult, sourceId, type AdapterOptions, type ContentItem, type ExtractedQuery, type Source, type SourceResult } from './types';
import { decodeTextResponse, normalizeSourceText } from '../text-normalization';

type FeedItem = {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  description?: string;
  isoDate?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
  categories?: string[];
  guid?: string;
};

const parser = new Parser<Record<string, unknown>, FeedItem>();
const lastFetchBySource = new Map<string, number>();

function feedUrl(source: Source): string | undefined {
  return source.feed_url ?? source.rssUrls?.[0];
}

async function respectRateLimit(source: Source): Promise<void> {
  const key = sourceId(source);
  const windowMs = Math.ceil((source.rate_limit.window_seconds * 1000) / source.rate_limit.calls);
  const lastFetch = lastFetchBySource.get(key) ?? 0;
  const waitMs = Math.max(0, windowMs - (Date.now() - lastFetch));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastFetchBySource.set(key, Date.now());
}

function queryTerms(query: ExtractedQuery): string[] {
  return [...(query.entities ?? []), ...(query.topics ?? [])]
    .flatMap((term) => term.split(/\s+/))
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 2);
}

function scoreItem(item: ContentItem, terms: string[]): number {
  const title = (item.title ?? '').toLowerCase();
  const content = item.content.toLowerCase();
  return terms.reduce((score, term) => {
    const titleHits = title.includes(term) ? 2 : 0;
    const contentHits = content.includes(term) ? 1 : 0;
    return score + titleHits + contentHits;
  }, 0);
}

function mapItem(item: FeedItem): ContentItem | null {
  const url = item.link?.trim();
  if (!url) return null;
  const content = normalizeSourceText(
    item.contentSnippet?.trim() ||
      item.content?.trim() ||
      item.summary?.trim() ||
      item.description?.trim() ||
      '',
    { stripChrome: true, collapseWhitespace: true },
  );
  const title = normalizeSourceText(item.title?.trim() || '', { stripChrome: true });

  return {
    ...(title ? { title } : {}),
    url,
    content,
    ...(item.isoDate || item.pubDate ? { published_at: item.isoDate ?? item.pubDate } : {}),
    metadata: {
      author: item.creator ?? item.author,
      categories: item.categories,
      guid: item.guid,
    },
  };
}

async function fetchFeedXml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await globalThis.fetch(url, {
      headers: { 'User-Agent': 'AgentFlow-Research/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return await decodeTextResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetch(
  source: Source,
  query: ExtractedQuery,
  options?: AdapterOptions,
): Promise<SourceResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const url = feedUrl(source);
  if (!url) return emptyResult(source, startedAt, 'no_feed_url', fetchedAt);

  try {
    await respectRateLimit(source);
    const xml = await fetchFeedXml(url, options?.timeoutMs ?? 10_000);
    const feed = await parser.parseString(xml);
    const mapped = (feed.items ?? []).map(mapItem).filter((item): item is ContentItem => item !== null);
    const terms = queryTerms(query);
    const ranked = terms.length
      ? mapped
          .map((item, index) => ({ item, index, score: scoreItem(item, terms) }))
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .map((rankedItem) => rankedItem.item)
      : mapped;

    return {
      source_id: sourceId(source),
      success: true,
      items: ranked.slice(0, options?.maxItems ?? 10),
      latency_ms: Date.now() - startedAt,
      fetched_at: fetchedAt,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'timeout'
      : error instanceof Error
        ? error.message
        : String(error);
    return emptyResult(source, startedAt, message.includes('Non-whitespace') ? 'feed_parse_error' : message, fetchedAt);
  }
}
