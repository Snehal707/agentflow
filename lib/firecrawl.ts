/**
 * Scrape a URL via Firecrawl (markdown). Used by extension + invoice PDF URL flow.
 * Env: FIRECRAWL_API_URL (default https://api.firecrawl.dev), FIRECRAWL_API_KEY.
 */
export async function fetchUrlViaFirecrawl(url: string): Promise<string> {
  const base = (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev').replace(/\/+$/, '');
  const apiKey = process.env.FIRECRAWL_API_KEY || '';

  const response = await fetch(`${base}/v2/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { markdown?: string };
    markdown?: string;
    error?: string;
  };

  if (!response.ok || json.success === false) {
    throw new Error(`Firecrawl scrape failed: ${json.error ?? response.status}`);
  }

  return json.data?.markdown ?? json.markdown ?? '';
}

export type FirecrawlSearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
  date?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
};

export type SearchBackendDiagnostic = {
  provider: 'firecrawl' | 'searxng';
  base: string;
  explicitConfig: boolean;
  status: 'unknown' | 'healthy' | 'degraded' | 'unavailable';
  lastError?: string;
  backoffUntil?: string | null;
};

type SearchBackendState = {
  lastError?: string;
  lastSuccessAt?: number;
  unavailableUntil?: number;
};

const SEARCH_BACKEND_BACKOFF_MS = 60_000;
const FIRECRAWL_FETCH_TIMEOUT_MS = 20_000;
const searchBackendState = new Map<string, SearchBackendState>();

function searchBackendKey(provider: 'firecrawl' | 'searxng', base: string): string {
  return `${provider}:${base}`;
}

function explicitSearxngConfigPresent(): boolean {
  return Boolean(
    (process.env.SEARXNG_API_URL || process.env.SEARXNG_SEARCH_URL || process.env.SEARXNG_ENDPOINT || '')
      .trim(),
  );
}

function formatBackendError(error: unknown, provider: 'firecrawl' | 'searxng'): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') {
      const code =
        'code' in cause && typeof (cause as { code?: unknown }).code === 'string'
          ? (cause as { code: string }).code
          : '';
      const message =
        'message' in cause && typeof (cause as { message?: unknown }).message === 'string'
          ? (cause as { message: string }).message
          : '';
      if (code || message) {
        return `${provider} search failed: ${error.message}${code ? ` [${code}]` : ''}${message ? ` ${message}` : ''}`.trim();
      }
    }
    return `${provider} search failed: ${error.message}`;
  }
  return `${provider} search failed: ${String(error)}`;
}

function noteBackendSuccess(provider: 'firecrawl' | 'searxng', base: string): void {
  searchBackendState.set(searchBackendKey(provider, base), {
    lastSuccessAt: Date.now(),
  });
}

function noteBackendFailure(provider: 'firecrawl' | 'searxng', base: string, error: unknown): Error {
  const message = formatBackendError(error, provider);
  searchBackendState.set(searchBackendKey(provider, base), {
    lastError: message,
    unavailableUntil: Date.now() + SEARCH_BACKEND_BACKOFF_MS,
  });
  return new Error(message);
}

function getBackendBackoffError(provider: 'firecrawl' | 'searxng', base: string): Error | null {
  const state = searchBackendState.get(searchBackendKey(provider, base));
  if (!state?.unavailableUntil || state.unavailableUntil <= Date.now()) {
    return null;
  }
  const retryAt = new Date(state.unavailableUntil).toISOString();
  return new Error(
    state.lastError
      ? `${state.lastError} (cached until ${retryAt})`
      : `${provider} search temporarily unavailable until ${retryAt}`,
  );
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function getSearchBackendDiagnostics(): SearchBackendDiagnostic[] {
  const firecrawlBase = (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev').replace(/\/+$/, '');
  const searxngBase = deriveSearxngBaseUrl();
  const diagnostics: SearchBackendDiagnostic[] = [];

  for (const [provider, base, explicitConfig] of [
    ['firecrawl', firecrawlBase, Boolean((process.env.FIRECRAWL_API_URL || '').trim())],
    ['searxng', searxngBase, explicitSearxngConfigPresent()],
  ] as const) {
    const state = searchBackendState.get(searchBackendKey(provider, base));
    diagnostics.push({
      provider,
      base,
      explicitConfig,
      status: state?.unavailableUntil
        ? state.unavailableUntil > Date.now()
          ? 'unavailable'
          : state.lastSuccessAt
            ? 'healthy'
            : 'degraded'
        : state?.lastSuccessAt
          ? 'healthy'
          : state?.lastError
            ? 'degraded'
            : 'unknown',
      lastError: state?.lastError,
      backoffUntil: state?.unavailableUntil ? new Date(state.unavailableUntil).toISOString() : null,
    });
  }

  return diagnostics;
}

function deriveSearxngBaseUrl(): string {
  const configured =
    process.env.SEARXNG_API_URL ||
    process.env.SEARXNG_SEARCH_URL ||
    process.env.SEARXNG_ENDPOINT ||
    '';
  if (configured.trim()) {
    return configured.replace(/\/+$/, '');
  }

  const firecrawlBase = (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev').replace(
    /\/+$/,
    '',
  );

  try {
    const url = new URL(firecrawlBase);
    if (!url.port || url.port === '3002') {
      url.port = '8080';
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return firecrawlBase.replace(/:3002(?=\/?$)/, ':8080');
  }
}

export async function searchSearxng(
  query: string,
  limit = 3,
  options?: { timeoutMs?: number; categories?: string[] },
): Promise<FirecrawlSearchResult[]> {
  const base = deriveSearxngBaseUrl();
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const backoffError = getBackendBackoffError('searxng', base);
  if (backoffError) {
    throw backoffError;
  }

  try {
    const url = new URL('/search', base.endsWith('/') ? base : `${base}/`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    // Bias prediction-market retrieval toward English-language results so broad
    // sports / gaming queries do not drift into localized low-signal pages.
    url.searchParams.set('language', 'en-US');
    if (options?.categories?.length) {
      url.searchParams.set('categories', options.categories.join(','));
    }

    const response = await fetchJsonWithTimeout(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    }, timeoutMs);

    const json = (await response.json().catch(() => ({}))) as {
      results?: Array<{
        url?: string;
        title?: string;
        content?: string;
        publishedDate?: string | null;
        engine?: string;
        engines?: string[];
      }>;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(`SearXNG search failed: ${json.error ?? response.status}`);
    }

    const deduped = new Map<string, FirecrawlSearchResult>();
    for (const result of json.results ?? []) {
      const resultUrl = result.url?.trim();
      if (!resultUrl || deduped.has(resultUrl)) continue;
      deduped.set(resultUrl, {
        title: result.title?.trim(),
        url: resultUrl,
        date: result.publishedDate?.trim() || undefined,
        description: result.content?.trim(),
        metadata: {
          sourceURL: resultUrl,
          publishedTime: result.publishedDate ?? undefined,
          engines: result.engines ?? (result.engine ? [result.engine] : undefined),
        },
      });
      if (deduped.size >= limit) break;
    }

    noteBackendSuccess('searxng', base);
    return [...deduped.values()];
  } catch (error) {
    throw noteBackendFailure('searxng', base, error);
  }
}

export async function searchFirecrawlNews(
  query: string,
  limit = 3,
  options?: { recency?: 'week' | 'month' | 'year' | 'all' },
): Promise<FirecrawlSearchResult[]> {
  const base = (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev').replace(/\/+$/, '');
  const apiKey = process.env.FIRECRAWL_API_KEY || '';
  const backoffError = getBackendBackoffError('firecrawl', base);
  if (backoffError) {
    throw backoffError;
  }

  try {
    const response = await fetchJsonWithTimeout(
      `${base}/v2/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          query,
          limit,
          sources: ['news', 'web'],
          ignoreInvalidURLs: true,
          ...(options?.recency === 'all'
            ? {}
            : { tbs: options?.recency === 'year' ? 'qdr:y' : options?.recency === 'month' ? 'qdr:m' : 'qdr:w' }),
          timeout: 30_000,
          scrapeOptions: {
            formats: ['markdown'],
            onlyMainContent: true,
          },
        }),
      },
      FIRECRAWL_FETCH_TIMEOUT_MS,
    );

    const json = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      data?: {
        news?: FirecrawlSearchResult[];
        web?: FirecrawlSearchResult[];
      };
      error?: string;
    };

    if (!response.ok || json.success === false) {
      throw new Error(`Firecrawl search failed: ${json.error ?? response.status}`);
    }

    const merged = [...(json.data?.news ?? []), ...(json.data?.web ?? [])];
    const deduped = new Map<string, FirecrawlSearchResult>();
    for (const result of merged) {
      const url = result.url?.trim();
      if (!url) continue;
      if (!deduped.has(url)) {
        deduped.set(url, result);
      }
    }

    noteBackendSuccess('firecrawl', base);
    return [...deduped.values()];
  } catch (error) {
    throw noteBackendFailure('firecrawl', base, error);
  }
}
