/**
 * Smoke-test public funds list (always) and optional authenticated plans (VERIFY_JWT).
 *
 *   npx tsx --env-file=.env scripts/verify-funds-smoke.ts
 *   VERIFY_JWT=eyJ... npx tsx --env-file=.env scripts/verify-funds-smoke.ts
 */
import '../lib/loadEnv';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const JWT = (process.env.VERIFY_JWT || '').trim();

async function main(): Promise<void> {
  const fundsRes = await fetch(`${BASE}/api/funds`);
  if (!fundsRes.ok) {
    const t = await fundsRes.text();
    throw new Error(`GET /api/funds failed: ${fundsRes.status} ${t.slice(0, 200)}`);
  }
  const fundsBody = await fundsRes.json();
  if (!Array.isArray(fundsBody)) {
    throw new Error('GET /api/funds: expected JSON array');
  }
  console.log(`[verify-funds] GET /api/funds ok (${fundsBody.length} rows)`);

  if (!JWT) {
    console.log('[verify-funds] VERIFY_JWT unset — skipping GET /api/funds/plans and plan mutations');
    return;
  }

  const plansRes = await fetch(`${BASE}/api/funds/plans`, {
    headers: { Authorization: `Bearer ${JWT}` },
  });
  if (!plansRes.ok) {
    const t = await plansRes.text();
    throw new Error(`GET /api/funds/plans failed: ${plansRes.status} ${t.slice(0, 200)}`);
  }
  console.log('[verify-funds] GET /api/funds/plans ok');
  console.log(
    '[verify-funds] GET /api/subscription/status skipped (route removed; use /api/funds/plans only).',
  );

  console.log(
    '[verify-funds] POST /api/funds/plans/start and .../stop are not run automatically (mutating); exercise from UI or curl when needed.',
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
