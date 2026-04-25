import { getFacilitatorBaseUrl } from './facilitator-url';

export type X402HealthCheckResult = {
  ok: boolean;
  url: string;
  status: number | null;
  error: string | null;
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function deriveHealthUrlFromRunUrl(runUrl: string): string {
  const trimmed = runUrl.trim();
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, '');
    url.pathname = pathname.endsWith('/run')
      ? `${pathname.slice(0, -4) || ''}/health`
      : `${pathname || ''}/health`;
    url.search = '';
    return url.toString();
  } catch {
    const normalized = normalizeBaseUrl(trimmed);
    return normalized.endsWith('/run')
      ? `${normalized.slice(0, -4) || ''}/health`
      : `${normalized}/health`;
  }
}

export function resolveFacilitatorHealthUrl(): string {
  return deriveHealthUrlFromRunUrl(getFacilitatorBaseUrl());
}

export async function checkHttpHealth(
  url: string,
  timeoutMs = 1500,
): Promise<X402HealthCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      url,
      status: response.status,
      error: response.ok ? null : `${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      url,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
