/**
 * One-shot A2A demo proof (optional managed stack on Windows):
 * - Cleans stale listeners (Windows PowerShell) unless PROOF_A2A_SKIP_STACK=1
 * - Starts minimal embedded API + swap/portfolio/invoice/batch unless skip
 * - Runs scripts/run-a2a-three-user-tests.ts
 * - Probes Redis x402 attempt records + Supabase ledger rows for three required pairs
 * - Writes .proof-a2a-output/proof-summary.json and proof-summary.md
 * - Exits 1 if any required pair is missing in DB after the run window
 *
 * Usage:
 *   npm run proof:a2a
 *   PROOF_A2A_SKIP_STACK=1 npm run proof:a2a   # stack already running (also typical on macOS/Linux)
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { concurrently } from 'concurrently';
import '../lib/loadEnv';
import { adminDb, closeRedisPool, getRedis } from '../db/client';
import type { X402AttemptRecord } from '../lib/x402AttemptLedger';

const repoRoot = process.cwd();

const OUTPUT_DIR = path.join(repoRoot, '.proof-a2a-output');
const SUMMARY_JSON = path.join(OUTPUT_DIR, 'proof-summary.json');
const SUMMARY_MD = path.join(OUTPUT_DIR, 'proof-summary.md');

const REQUIRED_FLOWS: Array<{
  name: string;
  buyer: string;
  seller: string;
}> = [
  { name: 'swap→portfolio', buyer: 'swap', seller: 'portfolio' },
  { name: 'invoice→research', buyer: 'invoice', seller: 'research' },
  { name: 'batch→portfolio', buyer: 'batch', seller: 'portfolio' },
];

const PUBLIC_PORT = Number(process.env.PORT || 4000);
const SWAP_PORT = Number(process.env.SWAP_AGENT_PORT || 3011);
const PORTFOLIO_PORT = Number(process.env.PORTFOLIO_AGENT_PORT || 3014);
const INVOICE_PORT = Number(process.env.INVOICE_AGENT_PORT || 3015);
const BATCH_PORT = Number(process.env.BATCH_AGENT_PORT || 3020);
const FACILITATOR_PORT = process.env.FACILITATOR_PORT?.trim() || '3010';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(url: string, label: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        console.log(`[proof-a2a] ${label} ok (${url})`);
        return;
      }
    } catch {
      /* retry */
    }
    await sleep(1500);
  }
  throw new Error(`[proof-a2a] health timeout for ${label}: ${url}`);
}

async function collectSucceededX402Since(sinceMs: number, maxKeys = 500): Promise<X402AttemptRecord[]> {
  const redis = getRedis();
  const matches: X402AttemptRecord[] = [];
  let cursor = '0';
  let scanned = 0;
  do {
    const reply = await redis.scan(cursor, 'MATCH', 'x402:attempt:*', 'COUNT', '80');
    cursor = reply[0];
    const keys = reply[1];
    for (const key of keys) {
      scanned += 1;
      if (scanned > maxKeys) {
        return matches;
      }
      const raw = await redis.get(key);
      if (!raw) continue;
      let rec: X402AttemptRecord;
      try {
        rec = JSON.parse(raw) as X402AttemptRecord;
      } catch {
        continue;
      }
      if (rec.stage !== 'succeeded') continue;
      const t = Date.parse(rec.updatedAt);
      if (Number.isFinite(t) && t >= sinceMs) {
        matches.push(rec);
      }
    }
  } while (cursor !== '0' && scanned <= maxKeys);
  return matches;
}

function runWindowsStackCleanup(): void {
  if (process.platform !== 'win32') {
    console.warn(
      '[proof-a2a] Automatic port/process cleanup uses PowerShell (Windows). On other OSes, start the stack yourself and set PROOF_A2A_SKIP_STACK=1.',
    );
    return;
  }
  console.log('[proof-a2a] running stack-cleanup.js …');
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'stack-cleanup.js')], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

async function startManagedStack(): Promise<{ commands: { kill: (s?: string) => void }[] }> {
  const env = {
    ...process.env,
    EMBEDDED_AGENT_SERVERS: 'true',
    FACILITATOR_PORT,
  };
  const { commands, result } = concurrently(
    [
      { name: 'api', command: 'tsx server.ts', env },
      { name: 'swap', command: 'tsx agents/swap/server.ts', env },
      { name: 'portfolio', command: 'tsx agents/portfolio/server.ts', env },
      { name: 'invoice', command: 'tsx agents/invoice/server.ts', env },
      { name: 'batch', command: 'tsx agents/batch/server.ts', env },
    ],
    {
      cwd: repoRoot,
      prefix: 'name',
    },
  );
  void result.catch(() => undefined);
  await sleep(2500);
  await waitForHealth(`http://127.0.0.1:${PUBLIC_PORT}/health`, 'API', 120_000);
  await waitForHealth(`http://127.0.0.1:${SWAP_PORT}/health`, 'swap', 60_000);
  await waitForHealth(`http://127.0.0.1:${PORTFOLIO_PORT}/health`, 'portfolio', 60_000);
  await waitForHealth(`http://127.0.0.1:${INVOICE_PORT}/health`, 'invoice', 60_000);
  await waitForHealth(`http://127.0.0.1:${BATCH_PORT}/health`, 'batch', 60_000);
  const facilitatorUrl = `http://127.0.0.1:${FACILITATOR_PORT}/health`;
  await waitForHealth(facilitatorUrl, 'facilitator (embedded)', 60_000);
  return { commands };
}

function runThreeUserTests(): void {
  console.log('[proof-a2a] running run-a2a-three-user-tests …');
  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  execFileSync(
    process.execPath,
    [tsxCli, '--env-file=.env', path.join(repoRoot, 'scripts', 'run-a2a-three-user-tests.ts')],
    { cwd: repoRoot, stdio: 'inherit' },
  );
}

type DbRow = {
  id: string;
  buyer_agent: string | null;
  seller_agent: string | null;
  amount: number | null;
  arc_tx_id: string | null;
  gateway_transfer_id: string | null;
  payment_rail: string | null;
  request_id: string | null;
  created_at: string;
};

/** Latest `created_at` for this buyer/seller pair before the proof run (exclusive upper bound for "new" rows). */
async function fetchPairWaterline(buyer: string, seller: string): Promise<string | null> {
  const { data, error } = await adminDb
    .from('transactions')
    .select('created_at')
    .eq('action_type', 'agent_to_agent_payment')
    .eq('status', 'complete')
    .eq('buyer_agent', buyer)
    .eq('seller_agent', seller)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`[proof-a2a] DB waterline failed: ${error.message}`);
  }
  const row = data?.[0] as { created_at?: string } | undefined;
  return row?.created_at ?? null;
}

/** Latest ledger row for this pair strictly after `waterlineIso` (Postgres `gt`; if null, latest row overall). */
async function fetchPairRowNewerThan(
  buyer: string,
  seller: string,
  waterlineIso: string | null,
): Promise<DbRow | null> {
  let q = adminDb
    .from('transactions')
    .select(
      'id, buyer_agent, seller_agent, amount, arc_tx_id, gateway_transfer_id, payment_rail, request_id, created_at',
    )
    .eq('action_type', 'agent_to_agent_payment')
    .eq('status', 'complete')
    .eq('buyer_agent', buyer)
    .eq('seller_agent', seller)
    .order('created_at', { ascending: false })
    .limit(1);

  if (waterlineIso) {
    q = q.gt('created_at', waterlineIso);
  }

  const { data, error } = await q;

  if (error) {
    throw new Error(`[proof-a2a] DB query failed: ${error.message}`);
  }
  return (data?.[0] as DbRow | undefined) ?? null;
}

function settlementIdFromRow(row: DbRow | null): string | null {
  if (!row) return null;
  return row.arc_tx_id || row.gateway_transfer_id || row.request_id || null;
}

function formatMdTable(flows: ReturnType<typeof buildFlowSummaries>): string {
  const lines = [
    '| Flow | Hook | x402 OK | Settlement | Ledger | DB id | Amount | Created |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const f of flows) {
    lines.push(
      `| ${f.name} | ${f.hookTriggered ? 'Y' : 'N'} | ${f.x402Succeeded ? 'Y' : 'N'} | ${f.settlementId ?? '—'} | ${f.ledgerInserted ? 'Y' : 'N'} | ${f.dbRowId ?? '—'} | ${f.amount ?? '—'} | ${f.createdAt ?? '—'} |`,
    );
  }
  return lines.join('\n');
}

function pairKey(buyer: string, seller: string): string {
  return `${buyer}|${seller}`;
}

function buildFlowSummaries(
  captures: Map<string, DbRow | null>,
  x402Succeeded: X402AttemptRecord[],
): Array<{
  name: string;
  buyer: string;
  seller: string;
  hookTriggered: boolean;
  x402Succeeded: boolean;
  settlementId: string | null;
  ledgerInserted: boolean;
  dbRowId: string | null;
  amount: number | null;
  createdAt: string | null;
  x402RequestIdsSample: string[];
}> {
  return REQUIRED_FLOWS.map((spec) => {
    const row = captures.get(pairKey(spec.buyer, spec.seller)) ?? null;
    const ledgerInserted = Boolean(row);
    const settlementId = settlementIdFromRow(row);
    const relatedX402 = x402Succeeded.filter((r) => {
      const route = (r.route || '').toLowerCase();
      const rid = (r.requestId || '').toLowerCase();
      if (spec.seller === 'portfolio') {
        const hitsPortfolio = route.includes('portfolio') || route.includes(String(PORTFOLIO_PORT));
        if (!hitsPortfolio) return false;
        if (spec.buyer === 'batch') return rid.startsWith('a2a_batch');
        if (spec.buyer === 'swap') return rid.startsWith('a2a_swap');
        return rid.startsWith(`a2a_${spec.buyer}`);
      }
      if (spec.seller === 'research') {
        return (
          (route.includes('research') || route.includes('3001')) &&
          (rid.startsWith('a2a_invoice') || rid.startsWith(`a2a_${spec.buyer}`))
        );
      }
      return false;
    });
    const x402Ok = relatedX402.length > 0 || ledgerInserted;
    const hookOk = relatedX402.length > 0 || ledgerInserted;
    return {
      name: spec.name,
      buyer: spec.buyer,
      seller: spec.seller,
      hookTriggered: hookOk,
      x402Succeeded: x402Ok,
      settlementId,
      ledgerInserted,
      dbRowId: row?.id ?? null,
      amount: row?.amount ?? null,
      createdAt: row?.created_at ?? null,
      x402RequestIdsSample: relatedX402.slice(0, 3).map((r) => r.requestId),
    };
  });
}

async function main(): Promise<void> {
  const skipStack = String(process.env.PROOF_A2A_SKIP_STACK || '').toLowerCase() === '1' ||
    String(process.env.PROOF_A2A_SKIP_STACK || '').toLowerCase() === 'true';

  let stackCommands: { kill: (s?: string) => void }[] | null = null;

  try {
    if (!skipStack) {
      runWindowsStackCleanup();
      const started = await startManagedStack();
      stackCommands = started.commands;
    } else {
      console.log('[proof-a2a] PROOF_A2A_SKIP_STACK set — assuming API + agents already running.');
    }

    const sinceIso = new Date(Date.now() - 2000).toISOString();
    const waterlines = new Map<string, string | null>();
    for (const spec of REQUIRED_FLOWS) {
      waterlines.set(pairKey(spec.buyer, spec.seller), await fetchPairWaterline(spec.buyer, spec.seller));
    }

    runThreeUserTests();

    await sleep(Number(process.env.PROOF_A2A_POST_TEST_GRACE_MS || 20_000));

    const pollMs = Number(process.env.PROOF_A2A_LEDGER_POLL_MS || 120_000);
    const stepMs = Number(process.env.PROOF_A2A_LEDGER_POLL_STEP_MS || 2000);
    const captures = new Map<string, DbRow | null>();
    const pollStart = Date.now();
    while (Date.now() - pollStart < pollMs) {
      let allFound = true;
      for (const spec of REQUIRED_FLOWS) {
        const key = pairKey(spec.buyer, spec.seller);
        const wm = waterlines.get(key) ?? null;
        const row = await fetchPairRowNewerThan(spec.buyer, spec.seller, wm);
        captures.set(key, row);
        if (!row) {
          allFound = false;
        }
      }
      if (allFound) break;
      await sleep(stepMs);
    }
    const sinceMs = Date.parse(sinceIso);
    const x402Succeeded = Number.isFinite(sinceMs)
      ? await collectSucceededX402Since(sinceMs - 5000)
      : [];

    const flows = buildFlowSummaries(captures, x402Succeeded);
    const missing = flows.filter((f) => !f.ledgerInserted);
    const overallOk = missing.length === 0;

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const jsonOut = {
      generatedAt: new Date().toISOString(),
      proofWindowSince: sinceIso,
      pairWaterlines: Object.fromEntries(waterlines),
      overallOk,
      missingFlows: missing.map((m) => m.name),
      flows,
      x402Probe: {
        succeededCountInWindow: x402Succeeded.length,
        sampleRequestIds: x402Succeeded.slice(0, 8).map((r) => ({
          requestId: r.requestId,
          stage: r.stage,
          route: r.route,
          transaction: r.transaction,
        })),
      },
    };

    fs.writeFileSync(SUMMARY_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');

    const md = [
      '# A2A demo proof summary',
      '',
      `- Generated: ${jsonOut.generatedAt}`,
      `- Overall OK: **${overallOk ? 'yes' : 'no'}**`,
      `- DB window: \`${sinceIso}\` → now`,
      '',
      '## Flows',
      '',
      formatMdTable(flows),
      '',
      '## x402 Redis (succeeded in window)',
      '',
      '```json',
      JSON.stringify(jsonOut.x402Probe, null, 2),
      '```',
      '',
    ].join('\n');
    fs.writeFileSync(SUMMARY_MD, md, 'utf8');

    console.log(`[proof-a2a] Wrote ${SUMMARY_JSON}`);
    console.log(`[proof-a2a] Wrote ${SUMMARY_MD}`);

    if (!overallOk) {
      console.error('[proof-a2a] FAILED — missing ledger rows for:', missing.map((m) => m.name).join(', '));
      process.exitCode = 1;
    } else {
      console.log('[proof-a2a] All three required A2A pairs present in DB.');
    }
  } finally {
    if (stackCommands) {
      console.log('[proof-a2a] stopping managed stack processes…');
      for (const cmd of stackCommands) {
        try {
          cmd.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
      await sleep(1500);
    }
    await closeRedisPool().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
