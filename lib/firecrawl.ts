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
  options?: { timeoutMs?: number },
): Promise<FirecrawlSearchResult[]> {
  const base = deriveSearxngBaseUrl();
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL('/search', base.endsWith('/') ? base : `${base}/`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

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

    return [...deduped.values()];
  } finally {
    clearTimeout(timer);
  }
}

export async function searchFirecrawlNews(
  query: string,
  limit = 3,
  options?: { recency?: 'week' | 'month' | 'year' | 'all' },
): Promise<FirecrawlSearchResult[]> {
  const base = (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev').replace(/\/+$/, '');
  const apiKey = process.env.FIRECRAWL_API_KEY || '';
  const response = await fetch(`${base}/v2/search`, {
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
  });

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

  return [...deduped.values()];
}
