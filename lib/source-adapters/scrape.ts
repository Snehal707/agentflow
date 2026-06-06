import { emptyResult, sourceId, type AdapterOptions, type ExtractedQuery, type Source, type SourceResult } from './types';
import { normalizeSourceText } from '../text-normalization';

const DEFAULT_FIRECRAWL_URL = 'http://178.104.240.191:3002';
const lastFetchBySource = new Map<string, number>();

function applyTemplate(template: string, source: Source, query: ExtractedQuery): string {
  return template
    .replace(/\{baseUrl\}/g, source.baseUrl)
    .replace(/\{query\}/g, encodeURIComponent(query.text))
    .replace(/\{q\}/g, encodeURIComponent(query.text));
}

function buildScrapeUrl(source: Source, query: ExtractedQuery): string {
  if (source.scrape_url_template) {
    return applyTemplate(source.scrape_url_template, source, query);
  }

  return source.baseUrl;
}

async function respectRateLimit(source: Source): Promise<void> {
  const key = sourceId(source);
  const windowMs = Math.ceil((source.rate_limit.window_seconds * 1000) / source.rate_limit.calls);
  const lastFetch = lastFetchBySource.get(key) ?? 0;
  const waitMs = Math.max(0, windowMs - (Date.now() - lastFetch));

  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  lastFetchBySource.set(key, Date.now());
}

function firecrawlBaseUrl(): string {
  return (process.env.FIRECRAWL_URL || process.env.FIRECRAWL_API_URL || DEFAULT_FIRECRAWL_URL).replace(
    /\/+$/,
    '',
  );
}

export async function fetch(
  source: Source,
  query: ExtractedQuery,
  options?: AdapterOptions,
): Promise<SourceResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const targetUrl = buildScrapeUrl(source, query);
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await respectRateLimit(source);

    const response = await globalThis.fetch(`${firecrawlBaseUrl()}/v2/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.FIRECRAWL_API_KEY ? { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        url: targetUrl,
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: timeoutMs,
      }),
      signal: controller.signal,
    });

    const json = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: {
        markdown?: string;
        metadata?: Record<string, unknown>;
      };
      markdown?: string;
      error?: string;
    };
    const markdown = normalizeSourceText(json.data?.markdown ?? json.markdown ?? '', {
      stripChrome: true,
    });

    if (!response.ok || json.success === false) {
      return emptyResult(source, startedAt, `firecrawl_${response.status}:${json.error ?? 'scrape_failed'}`, fetchedAt);
    }

    if (!markdown.trim()) {
      return emptyResult(source, startedAt, 'empty_markdown', fetchedAt);
    }

    return {
      source_id: sourceId(source),
      success: true,
      items: [
        {
          title: source.name,
          url: targetUrl,
          content: markdown,
          metadata: {
            adapter: 'scrape',
            firecrawl_url: firecrawlBaseUrl(),
            ...(json.data?.metadata ?? {}),
          },
        },
      ],
      latency_ms: Date.now() - startedAt,
      fetched_at: fetchedAt,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'timeout'
      : error instanceof Error
        ? error.message
        : String(error);
    return emptyResult(source, startedAt, message, fetchedAt);
  } finally {
    clearTimeout(timeout);
  }
}
