/**
 * Lightweight checks before running the 7 manual A2A UI tests.
 *   npx tsx --env-file=.env scripts/verify-a2a-preconditions.ts
 *
 * - Required env for DB probe (same as db/client)
 * - Backend /health and /health/stack (set BACKEND_URL if not localhost:4000)
 *
 * Does not verify DCW mode (browser) or funded owner wallets — use fund:agent-wallets + UI.
 */
import '../lib/loadEnv';

const BACKEND = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const TIMEOUT_MS = 8000;

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing ${name} (required for A2A DB probes)`);
  }
  return v;
}

async function fetchJson(path: string): Promise<{ ok: boolean; body: unknown; status: number }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND}${path}`, { signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

async function main(): Promise<void> {
  need('SUPABASE_URL');
  need('SUPABASE_SECRET_KEY');
  need('SUPABASE_PUBLISHABLE_KEY');

  const health = await fetchJson('/health');
  if (!health.ok || (health.body as { status?: string })?.status !== 'ok') {
    console.error('[verify-a2a-preconditions] Backend /health failed:', health.status, health.body);
    process.exit(1);
  }
  console.log('[verify-a2a-preconditions] /health OK');

  const stack = await fetchJson('/health/stack');
  if (!stack.ok) {
    console.error('[verify-a2a-preconditions] /health/stack failed:', stack.status, stack.body);
    process.exit(1);
  }
  console.log('[verify-a2a-preconditions] /health/stack OK', JSON.stringify(stack.body));

  console.log('[verify-a2a-preconditions] Env for Supabase probe: OK');
  console.log(
    '[verify-a2a-preconditions] Reminder: use DCW execution mode in chat; run npm run fund:agent-wallets if x402 payers are dry.',
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
