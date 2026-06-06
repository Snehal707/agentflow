/**
 * Launch soak: parallel chat research requests through the same user-facing route.
 *
 * Verifies:
 * - cap 10 admits the first 10 active research runs
 * - request 11 queues via /api/chat/respond
 * - queued job later completes with report + x402 receipt
 */
import '../lib/loadEnv';
import { getAddress, isAddress } from 'viem';
import { generateJWT } from '../lib/auth';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const USER = process.env.TEST_WALLET_ADDRESS?.trim();
const TOTAL = Math.max(1, Number.parseInt(process.env.SOAK_RESEARCH_TOTAL || '11', 10) || 11);
const TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.SOAK_RESEARCH_TIMEOUT_MS || '1200000', 10) || 1_200_000,
);
const POLL_MS = Math.max(
  2_000,
  Number.parseInt(process.env.SOAK_RESEARCH_POLL_MS || '10000', 10) || 10_000,
);

type ChatRunResult = {
  index: number;
  sessionId: string;
  ok: boolean;
  status: number;
  durationMs: number;
  queuedJobId?: string;
  queuedPosition?: number;
  sawReport: boolean;
  receiptPipelineId?: string;
  receiptEntries: number;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSsePayload(raw: string): Record<string, any> | null {
  if (!raw || raw === '[DONE]') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function postChatResearch(index: number, wallet: `0x${string}`): Promise<ChatRunResult> {
  const startedAt = Date.now();
  const sessionId = `soak-cap10-${Date.now()}-${index}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

  const result: ChatRunResult = {
    index,
    sessionId,
    ok: false,
    status: 0,
    durationMs: 0,
    sawReport: false,
    receiptEntries: 0,
  };

  try {
    const response = await fetch(`${BASE}/api/chat/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
      },
      body: JSON.stringify({
        message: `research report smoke ${index}: summarize x402 stablecoin payment rails in one short paragraph`,
        messages: [],
        walletAddress: wallet,
        executionTarget: 'DCW',
        browserTimeZone: 'Asia/Calcutta',
        browserLocale: 'en-IN',
      }),
      signal: ac.signal,
    });

    result.status = response.status;
    if (!response.ok || !response.body) {
      result.error = await response.text().catch(() => `HTTP ${response.status}`);
      return result;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = parseSsePayload(trimmed.slice(5).trim());
      if (!payload) return;

      if (payload.meta?.researchQueued?.jobId) {
        result.queuedJobId = String(payload.meta.researchQueued.jobId);
        result.queuedPosition = Number(payload.meta.researchQueued.position) || undefined;
      }
      if (payload.meta?.paymentMeta?.entries && Array.isArray(payload.meta.paymentMeta.entries)) {
        result.receiptEntries = Math.max(result.receiptEntries, payload.meta.paymentMeta.entries.length);
      }
      if (payload.type === 'report') {
        result.sawReport = true;
      }
      if (payload.type === 'error') {
        result.error = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
      if (done) break;
    }
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) handleLine(line);
    }

    result.ok = !result.error && (result.sawReport || Boolean(result.queuedJobId));
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    clearTimeout(timer);
    result.durationMs = Date.now() - startedAt;
  }
}

async function pollQueuedJob(
  jobId: string,
  wallet: `0x${string}`,
): Promise<{ status?: string; receiptEntries?: number; hasReport?: boolean; error?: string }> {
  const token = generateJWT(wallet);
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/api/research/status/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await response.json().catch(() => null)) as any;
    if (!response.ok) {
      return { error: body?.error || `HTTP ${response.status}` };
    }
    if (body?.status === 'done' || body?.status === 'failed') {
      return {
        status: body.status,
        receiptEntries: Array.isArray(body.receipt?.entries) ? body.receipt.entries.length : 0,
        hasReport: typeof body.result === 'string' && body.result.trim().length > 0,
        error: body.error,
      };
    }
    await sleep(POLL_MS);
  }
  return { error: `Timed out polling queued job ${jobId}` };
}

async function main(): Promise<void> {
  if (!USER || !isAddress(USER)) {
    throw new Error('TEST_WALLET_ADDRESS must be set to a valid wallet address');
  }
  const wallet = getAddress(USER as `0x${string}`);
  console.log(
    `[soak] starting ${TOTAL} chat research requests against ${BASE}; expected immediate cap=10, expected queued=1`,
  );

  const startedAt = Date.now();
  const runs = await Promise.all(
    Array.from({ length: TOTAL }, (_, index) => postChatResearch(index + 1, wallet)),
  );
  const queued = runs.filter((run) => run.queuedJobId);

  console.log('[soak] initial results');
  console.log(
    JSON.stringify(
      runs.map((run) => ({
        index: run.index,
        ok: run.ok,
        status: run.status,
        durationMs: run.durationMs,
        queuedJobId: run.queuedJobId,
        queuedPosition: run.queuedPosition,
        sawReport: run.sawReport,
        receiptEntries: run.receiptEntries,
        error: run.error,
      })),
      null,
      2,
    ),
  );

  const queuedResults: Record<string, unknown>[] = [];
  for (const run of queued) {
    const polled = await pollQueuedJob(run.queuedJobId!, wallet);
    queuedResults.push({ index: run.index, jobId: run.queuedJobId, ...polled });
  }

  const reports = runs.filter((run) => run.sawReport).length;
  const failures = runs.filter((run) => run.error || (!run.sawReport && !run.queuedJobId));
  const receipts = runs.filter((run) => run.receiptEntries >= 3).length;

  console.log('[soak] queued results');
  console.log(JSON.stringify(queuedResults, null, 2));
  console.log(
    JSON.stringify(
      {
        total: TOTAL,
        reportsImmediate: reports,
        queuedInitial: queued.length,
        receiptMetaImmediate: receipts,
        failures: failures.length,
        durationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );

  if (queued.length !== Math.max(0, TOTAL - 10)) {
    throw new Error(`Expected ${Math.max(0, TOTAL - 10)} queued request(s), got ${queued.length}`);
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} initial request(s) failed or returned without report/queue`);
  }
  const badQueued = queuedResults.filter((item: any) => item.status !== 'done' || !item.hasReport || item.receiptEntries < 3);
  if (badQueued.length > 0) {
    throw new Error(`Queued job(s) did not finish cleanly: ${JSON.stringify(badQueued)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
