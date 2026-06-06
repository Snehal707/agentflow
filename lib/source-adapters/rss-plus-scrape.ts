import { fetch as fetchRss } from './rss';
import { fetch as fetchScrape } from './scrape';
import {
  sourceId,
  type AdapterOptions,
  type ContentItem,
  type ExtractedQuery,
  type Source,
  type SourceResult,
} from './types';

const DEFAULT_MAX_ITEMS = 3;
const HARD_MAX_ITEMS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SCRAPE_TIMEOUT_MS = 10_000;

type ScrapeOutcome = {
  index: number;
  item: ContentItem;
  result?: SourceResult;
  error?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function mergeMetadata(
  item: ContentItem,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(item.metadata ?? {}),
    ...extra,
  };
}

async function scrapeFeedItem(
  source: Source,
  query: ExtractedQuery,
  item: ContentItem,
  index: number,
  timeoutMs: number,
): Promise<ScrapeOutcome> {
  const scrapeSource: Source = {
    ...source,
    baseUrl: item.url,
    scrape_url_template: item.url,
  };
  const result = await fetchScrape(scrapeSource, query, { timeoutMs });
  return { index, item, result };
}

function timeoutOutcome(item: ContentItem, index: number): ScrapeOutcome {
  return { index, item, error: 'overall_timeout' };
}

function mergeItem(outcome: ScrapeOutcome): ContentItem {
  const scraped = outcome.result?.success ? outcome.result.items[0] : undefined;
  const scrapeError = outcome.error ?? outcome.result?.error ?? 'scrape_failed';

  if (scraped?.content) {
    return {
      ...outcome.item,
      content: scraped.content,
      metadata: mergeMetadata(outcome.item, {
        scrape_success: true,
        feed_summary: outcome.item.content,
        scrape_metadata: scraped.metadata,
      }),
    };
  }

  return {
    ...outcome.item,
    metadata: mergeMetadata(outcome.item, {
      scrape_success: false,
      scrape_error: scrapeError,
    }),
  };
}

function unselectedItem(item: ContentItem): ContentItem {
  return {
    ...item,
    metadata: mergeMetadata(item, {
      scrape_success: false,
      scrape_error: 'not_selected_for_scrape',
    }),
  };
}

export async function fetch(
  source: Source,
  query: ExtractedQuery,
  options?: AdapterOptions,
): Promise<SourceResult> {
  const startedAt = Date.now();
  const fetchedAt = nowIso();
  const overallTimeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scrapeTimeoutMs = options?.scrapeTimeoutMs ?? DEFAULT_SCRAPE_TIMEOUT_MS;
  const maxItems = Math.min(options?.maxItems ?? DEFAULT_MAX_ITEMS, HARD_MAX_ITEMS);

  const rssResult = await fetchRss(source, query, {
    maxItems: Math.max(maxItems, HARD_MAX_ITEMS),
    timeoutMs: Math.min(overallTimeoutMs, DEFAULT_SCRAPE_TIMEOUT_MS),
  });

  if (!rssResult.success) {
    return {
      ...rssResult,
      latency_ms: Date.now() - startedAt,
      fetched_at: fetchedAt,
    };
  }

  const feedItems = rssResult.items.filter((item) => item.url);
  const selectedItems = feedItems.slice(0, maxItems);
  if (feedItems.length === 0) {
    return {
      source_id: sourceId(source),
      success: true,
      items: [],
      latency_ms: Date.now() - startedAt,
      fetched_at: fetchedAt,
    };
  }

  const remainingMs = Math.max(1, overallTimeoutMs - (Date.now() - startedAt));
  const scrapePromises = selectedItems.map((item, index) =>
    scrapeFeedItem(source, query, item, index, Math.min(scrapeTimeoutMs, remainingMs)),
  );
  const timeoutPromise = new Promise<ScrapeOutcome[]>((resolve) => {
    setTimeout(() => {
      resolve(selectedItems.map((item, index) => timeoutOutcome(item, index)));
    }, remainingMs);
  });
  const settledPromise = Promise.allSettled(scrapePromises).then((settled) =>
    settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : {
            index,
            item: selectedItems[index],
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
    ),
  );

  const outcomes = await Promise.race([settledPromise, timeoutPromise]);
  const byIndex = new Map(outcomes.map((outcome) => [outcome.index, outcome]));
  const items = feedItems.map((item, index) => {
    if (index >= selectedItems.length) return unselectedItem(item);
    return mergeItem(byIndex.get(index) ?? timeoutOutcome(item, index));
  });

  return {
    source_id: sourceId(source),
    success: true,
    items,
    latency_ms: Date.now() - startedAt,
    fetched_at: fetchedAt,
  };
}
