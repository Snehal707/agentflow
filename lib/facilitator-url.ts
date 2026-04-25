/**
 * Canonical facilitator base URL for Circle x402 batching.
 * API (`server.ts`), `payProtectedResourceServer` health checks, and all paid agents must use the same value.
 */
export function getFacilitatorBaseUrl(): string {
  const fromEnv = process.env.FACILITATOR_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '');
  }
  const port = process.env.FACILITATOR_PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}`;
}
