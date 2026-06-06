export function getLunexConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.LUNEX_API_BASE_URL?.trim();
  const apiKey = process.env.LUNEX_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error(
      'Lunex env missing: set LUNEX_API_BASE_URL and LUNEX_API_KEY before using the Lunex provider.',
    );
  }
  return { baseUrl, apiKey };
}

function sanitizeLunexErrorPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'unknown Lunex error';
  }

  const errorPayload = payload as Record<string, unknown>;
  const candidate = [
    errorPayload.error,
    errorPayload.message,
    errorPayload.details,
  ]
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    )
    .join(' | ');

  return candidate || 'unknown Lunex error';
}

export class LunexRateLimitError extends Error {
  constructor(message = 'Lunex rate limited, falling back') {
    super(message);
    this.name = 'LunexRateLimitError';
  }
}

export async function lunexFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { baseUrl, apiKey } = getLunexConfig();
  const response = await fetch(`${baseUrl}/functions/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Lunex auth failed, check LUNEX_API_KEY');
    }
    if (response.status === 429) {
      throw new LunexRateLimitError();
    }
    if (response.status >= 500) {
      throw new Error('Lunex API unavailable, falling back');
    }

    throw new Error(
      `[lunex] ${response.status} ${sanitizeLunexErrorPayload(payload)}`,
    );
  }

  return payload as T;
}
