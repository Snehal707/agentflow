/**
 * Automates the three "fast" A2A checks (same flows as manual plan):
 * 1) Chat swap 1 USDC to EURC + YES (DCW)
 * 2) Chat invoice preview + POST /api/invoice/confirm (Create Invoice button)
 * 3) POST /api/batch/preview + /api/batch/confirm with pasted CSV
 *
 * Requires: .env with TEST_WALLET_ADDRESS (valid EOA), JWT_SECRET, Supabase keys,
 * BACKEND_URL optional, stack up (4000, batch 3020, swap, portfolio, …).
 */
import '../lib/loadEnv';
import { getAddress, isAddress } from 'viem';
import { generateJWT } from '../lib/auth';
import { adminDb } from '../db/client';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const SLEEP_MS = Number(process.env.A2A_TEST_SLEEP_MS || 12_000);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function probe(label: string): Promise<void> {
  const { data, error } = await adminDb
    .from('transactions')
    .select('buyer_agent, seller_agent, amount, remark, created_at')
    .eq('action_type', 'agent_to_agent_payment')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.log(`[probe:${label}] error:`, error.message);
    return;
  }
  console.log(`\n--- PROBE after ${label} ---`);
  console.log(JSON.stringify(data, null, 2));
}

function extractConfirmIdFromSse(raw: string): string | null {
  const m = raw.match(/"confirmId"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function sseSnippet(raw: string, max = 1200): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

async function chatRespond(
  message: string,
  wallet: `0x${string}`,
  executionTarget: 'DCW' | 'EOA',
): Promise<string> {
  const res = await fetch(`${BASE}/api/chat/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      walletAddress: wallet,
      executionTarget,
    }),
  });
  return res.text();
}

async function postJson(
  path: string,
  body: unknown,
  auth: 'jwt' | 'none',
  wallet: `0x${string}`,
): Promise<{ status: number; json: unknown; text: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth === 'jwt') {
    headers.Authorization = `Bearer ${generateJWT(wallet, 'free')}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json, text };
}

async function main(): Promise<void> {
  const raw = process.env.TEST_WALLET_ADDRESS?.trim();
  if (!raw || !isAddress(raw)) {
    throw new Error('Set TEST_WALLET_ADDRESS to a valid Arc testnet EOA (same as UI wallet).');
  }
  const wallet = getAddress(raw as `0x${string}`);

  console.log('[run-a2a-three] wallet=', wallet);

  // --- Test 1: swap + YES ---
  console.log('\n[Test1] swap preview…');
  const preview = await chatRespond('swap 1 USDC to EURC', wallet, 'DCW');
  console.log('[Test1] preview SSE snippet:', sseSnippet(preview, 800));
  console.log('[Test1] sending YES…');
  const yesBody = await chatRespond('YES', wallet, 'DCW');
  console.log('[Test1] YES SSE snippet:', sseSnippet(yesBody, 800));
  await sleep(SLEEP_MS);
  await probe('Test1 swap→portfolio');

  // --- Test 2: invoice chat + confirm ---
  console.log('\n[Test2] invoice preview…');
  const invPreview = await chatRespond(
    'create invoice for jack.arc 50 USDC for consulting',
    wallet,
    'DCW',
  );
  console.log('[Test2] preview snippet:', sseSnippet(invPreview, 800));
  const confirmId = extractConfirmIdFromSse(invPreview);
  if (!confirmId) {
    console.error('[Test2] could not parse confirmId from SSE; skip confirm');
  } else {
    console.log('[Test2] confirmId=', confirmId);
    const conf = await postJson(
      `/api/invoice/confirm/${encodeURIComponent(confirmId)}`,
      {},
      'jwt',
      wallet,
    );
    console.log('[Test2] confirm status=', conf.status, JSON.stringify(conf.json));
  }
  await sleep(SLEEP_MS);
  await probe('Test2 invoice (chat confirm path)');

  // --- Test 3: batch ---
  const csvText = `jack.arc, 1, test
0x4C37a02d40F3Ce6D4753D5E0622bAF1643DBE65c, 1, test`;
  console.log('\n[Test3] batch preview…');
  const prev = await postJson('/api/batch/preview', { csvText }, 'jwt', wallet);
  console.log('[Test3] preview status=', prev.status, JSON.stringify(prev.json));
  const confirmIdBatch = (prev.json as { confirmId?: string })?.confirmId;
  if (!confirmIdBatch) {
    console.error('[Test3] no confirmId from preview; skip confirm');
  } else {
    console.log('[Test3] confirmId=', confirmIdBatch);
    const c = await postJson(
      `/api/batch/confirm/${encodeURIComponent(confirmIdBatch)}`,
      {},
      'jwt',
      wallet,
    );
    console.log('[Test3] confirm status=', c.status, JSON.stringify(c.json));
  }
  await sleep(SLEEP_MS);
  await probe('Test3 batch→portfolio');

  console.log('\n[run-a2a-three] Done.');
  console.log(
    '[run-a2a-three] Note: invoice→research is scheduled from POST /api/invoice/confirm and chat YES (server scheduleChatInvoiceResearchFollowup) when amount > 10 USDC; agents/invoice /run is a separate path.',
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
