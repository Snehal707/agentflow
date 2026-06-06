/**
 * Baseline / smoke: POST /run (SSE) research → analyst → writer paid pipeline.
 *
 *   npx tsx --env-file=.env scripts/verify-research-pipeline-run.ts
 *
 * Requires a running stack (API :4000, facilitator, research/analyst/writer agents) and
 * a wallet with DCW + Gateway funds for three x402 legs.
 *
 * Env:
 *   TEST_WALLET_ADDRESS — user EOA (required)
 *   BACKEND_URL — default http://127.0.0.1:4000
 *   PIPELINE_VERIFY_TASK — research topic (default short smoke string)
 *   PIPELINE_FETCH_TIMEOUT_MS — default 420000
 *   VERIFY_RESEARCH_SKIP_DB=1 — skip Supabase checks
 *   VERIFY_RESEARCH_SKIP_REDIS=1 — skip Redis x402 attempt record checks
 *
 * Facilitator verify/settle lines are not read from log files here; correlate Timestamps
 * with API process logs, or use VERIFY_RESEARCH_SKIP_REDIS=0 and Redis attempt `stage`.
 */
import '../lib/loadEnv';
import { getAddress } from 'viem';
import { adminDb } from '../db/client';
import { readX402AttemptRecord } from '../lib/x402AttemptLedger';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const USER = process.env.TEST_WALLET_ADDRESS?.trim();
const TASK =
  process.env.PIPELINE_VERIFY_TASK?.trim() ||
  'Brief smoke: one-sentence summary of stablecoin payment rails (no deep crawl).';
const TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.PIPELINE_FETCH_TIMEOUT_MS || '420000', 10) || 420_000,
);
const SKIP_DB = process.env.VERIFY_RESEARCH_SKIP_DB === '1';
const SKIP_REDIS = process.env.VERIFY_RESEARCH_SKIP_REDIS === '1';

type ReceiptEvent = {
  type: 'receipt';
  pipelineRequestId?: string;
  entries?: Array<{ requestId?: string; agent?: string }>;
};

function parseSseEvents(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return { events: parts, rest };
}

function parseDataPayload(eventBlock: string): unknown {
  for (const line of eventBlock.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const raw = t.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

async function main(): Promise<void> {
  if (!USER) {
    throw new Error('TEST_WALLET_ADDRESS is required');
  }
  const userAddress = getAddress(USER as `0x${string}`);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        task: TASK,
        userAddress,
        reasoningMode: 'fast',
        deepResearch: false,
      }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`POST /run failed: ${res.status} ${t.slice(0, 500)}`);
  }
  if (!res.body) {
    throw new Error('POST /run: empty body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let receipt: ReceiptEvent | null = null;
  let sawReport = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseEvents(buf);
    buf = rest;

    for (const ev of events) {
      const parsed = parseDataPayload(ev);
      if (!parsed || typeof parsed !== 'object') continue;
      const o = parsed as Record<string, unknown>;
      if (o.type === 'receipt') {
        receipt = o as ReceiptEvent;
        console.log('[verify-research-pipeline] receipt:', JSON.stringify(receipt, null, 2));
      }
      if (o.type === 'report') {
        sawReport = true;
        console.log('[verify-research-pipeline] report event received ok');
      }
      if (o.type === 'error') {
        throw new Error(
          `Pipeline SSE error: ${typeof o.message === 'string' ? o.message : JSON.stringify(o)}`,
        );
      }
    }
  }

  if (!receipt?.pipelineRequestId) {
    throw new Error('No receipt event with pipelineRequestId');
  }
  if (!Array.isArray(receipt.entries) || receipt.entries.length < 3) {
    throw new Error(`Expected receipt.entries length ≥ 3, got ${receipt.entries?.length ?? 0}`);
  }
  const requestIds = receipt.entries.map((e) => e.requestId).filter(Boolean) as string[];
  if (requestIds.length < 3) {
    throw new Error('Receipt entries missing requestId');
  }
  if (!sawReport) {
    throw new Error('No report event received');
  }

  console.log('[verify-research-pipeline] HTTP/SSE assertions passed');

  if (!SKIP_REDIS) {
    for (const rid of requestIds.slice(0, 3)) {
      const rec = await readX402AttemptRecord(rid);
      if (!rec) {
        console.warn(`[verify-research-pipeline] Redis: no attempt record for ${rid} (ttl or redis down)`);
        continue;
      }
      if (rec.idempotencyKey !== rid) {
        throw new Error(
          `Redis ${rid}: idempotencyKey should equal requestId, got "${rec.idempotencyKey}"`,
        );
      }
      if (rec.stage !== 'succeeded') {
        throw new Error(`Redis ${rid}: expected stage succeeded, got ${rec.stage}`);
      }
    }
    console.log('[verify-research-pipeline] Redis x402 attempt checks passed');
  }

  if (!SKIP_DB) {
    const expects: Array<{ requestId: string; buyer: string; seller: string }> = [
      {
        requestId: `${receipt.pipelineRequestId}:research`,
        buyer: 'user_dcw',
        seller: 'research',
      },
      {
        requestId: `${receipt.pipelineRequestId}:analyst`,
        buyer: 'research',
        seller: 'analyst',
      },
      {
        requestId: `${receipt.pipelineRequestId}:writer`,
        buyer: 'analyst',
        seller: 'writer',
      },
    ];

    for (const ex of expects) {
      const { data: tx, error: txErr } = await adminDb
        .from('transactions')
        .select('id,buyer_agent,seller_agent,request_id')
        .eq('request_id', ex.requestId)
        .maybeSingle();
      if (txErr) {
        throw new Error(`transactions lookup ${ex.requestId}: ${txErr.message}`);
      }
      if (!tx) {
        throw new Error(`transactions: missing row for request_id=${ex.requestId}`);
      }
      if (tx.buyer_agent !== ex.buyer || tx.seller_agent !== ex.seller) {
        throw new Error(
          `transactions ${ex.requestId}: expected buyer_agent=${ex.buyer} seller_agent=${ex.seller}, got ${tx.buyer_agent}/${tx.seller_agent}`,
        );
      }

      const { data: led, error: ledErr } = await adminDb
        .from('agent_economy_ledger')
        .select('id,request_id,buyer_agent,seller_agent')
        .eq('request_id', ex.requestId)
        .maybeSingle();
      if (ledErr) {
        throw new Error(`agent_economy_ledger lookup ${ex.requestId}: ${ledErr.message}`);
      }
      if (!led) {
        throw new Error(`agent_economy_ledger: missing row for request_id=${ex.requestId}`);
      }
      if (led.buyer_agent !== ex.buyer || led.seller_agent !== ex.seller) {
        throw new Error(
          `agent_economy_ledger ${ex.requestId}: expected buyer_agent=${ex.buyer} seller_agent=${ex.seller}, got ${led.buyer_agent}/${led.seller_agent}`,
        );
      }
    }
    console.log('[verify-research-pipeline] Supabase transactions + agent_economy_ledger checks passed');
  }

  console.log('[verify-research-pipeline] done');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
