import type { SourceConfig, SourceMethod } from '../source-registry-loader';

export type Source = SourceConfig & {
  endpoint?: string;
  scrape_url_template?: string;
};

export type Method = SourceMethod;

export type ExtractedQuery = {
  text: string;
  entities?: string[];
  topics?: string[];
};

export type ContentItem = {
  title?: string;
  url: string;
  content: string;
  published_at?: string;
  metadata?: Record<string, unknown>;
};

export type SourceResult = {
  source_id: string;
  success: boolean;
  items: ContentItem[];
  error?: string;
  latency_ms: number;
  fetched_at: string;
};

export type AdapterOptions = {
  maxItems?: number;
  timeoutMs?: number;
  scrapeTimeoutMs?: number;
};

export type AdapterFunction = (
  source: Source,
  query: ExtractedQuery,
  options?: AdapterOptions,
) => Promise<SourceResult>;

export function sourceId(source: Pick<Source, 'name'>): string {
  return source.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function emptyResult(
  source: Source,
  startedAt: number,
  error: string,
  fetchedAt = new Date().toISOString(),
): SourceResult {
  return {
    source_id: sourceId(source),
    success: false,
    items: [],
    error,
    latency_ms: Date.now() - startedAt,
    fetched_at: fetchedAt,
  };
}
