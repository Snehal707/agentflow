import { getAddress, isAddress } from 'viem';
import { adminDb, getRedis } from '../db/client';
import { sendTelegramText } from './telegram-notify';

export const QUEUE_KEY = 'research:queue';
export const PROCESSING_KEY = 'research:processing';
export const MAX_CONCURRENT = Math.max(
  1,
  Number.parseInt(process.env.RESEARCH_MAX_CONCURRENT || '10', 10) || 10,
);
export const ACTIVE_PIPELINE_COUNT_KEY = 'research:active:pipeline_count';
const JOB_TTL = 1800; // 30 minutes
const PROCESSING_HEARTBEAT_PREFIX = 'research:processing:heartbeat:';
const PROCESSING_HEARTBEAT_TTL_SECONDS = 900; // long enough for fast + deep reports, short enough to self-heal after crashes
const PROCESSING_JOB_STALE_MS = 30 * 60 * 1000;

const JOB_KEY_PREFIX = 'research:job:';

/** Atomic: if processing set size < max, SADD token. Returns 1 if acquired, 0 if not. */
const ACQUIRE_SLOT_LUA = `
local c = redis.call('SCARD', KEYS[1])
if c >= tonumber(ARGV[1]) then return 0 end
redis.call('SADD', KEYS[1], ARGV[2])
return 1
`;

/** Atomic: LPOP queue only if processing count < max; then SADD job id to processing. Returns job JSON string or false. */
const DEQUEUE_AND_RESERVE_LUA = `
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[1]) then return false end
local raw = redis.call('LPOP', KEYS[2])
if not raw then return false end
local ok, obj = pcall(cjson.decode, raw)
if not ok or type(obj) ~= 'table' or not obj['id'] then
  redis.call('RPUSH', KEYS[2], raw)
  return false
end
redis.call('SADD', KEYS[1], obj['id'])
return raw
`;

export interface ResearchJob {
  id: string;
  sessionId: string;
  walletAddress: string;
  query: string;
  mode: 'fast' | 'deep';
  /** Mirrors inferResearchReasoningMode output for POST /run */
  reasoningMode?: 'fast' | 'deep';
  createdAt: number;
  status: 'queued' | 'processing' | 'done' | 'failed';
  position?: number;
  result?: string;
  reportPayload?: Record<string, unknown> | null;
  receipt?: Record<string, unknown> | null;
  error?: string;
}

function jobKey(jobId: string): string {
  return `${JOB_KEY_PREFIX}${jobId}`;
}

export async function tryAcquireResearchSlot(token: string): Promise<boolean> {
  const redis = getRedis();
  await cleanupStaleProcessingSlots();
  const n = (await redis.eval(
    ACQUIRE_SLOT_LUA,
    1,
    PROCESSING_KEY,
    String(MAX_CONCURRENT),
    token,
  )) as number;
  if (n === 1) {
    await redis.set(
      `${PROCESSING_HEARTBEAT_PREFIX}${token}`,
      String(Date.now()),
      'EX',
      PROCESSING_HEARTBEAT_TTL_SECONDS,
    );
  }
  return n === 1;
}

export async function releaseResearchSlot(token: string): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.srem(PROCESSING_KEY, token),
    redis.del(`${PROCESSING_HEARTBEAT_PREFIX}${token}`),
  ]);
}

export async function enqueueResearch(
  job: Omit<ResearchJob, 'id' | 'createdAt' | 'status'>,
): Promise<{ jobId: string; position: number }> {
  const redis = getRedis();
  const jobId = `research-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const reasoningMode = 'fast';
  const fullJob: ResearchJob = {
    ...job,
    reasoningMode,
    id: jobId,
    createdAt: Date.now(),
    status: 'queued',
  };

  await redis.rpush(QUEUE_KEY, JSON.stringify(fullJob));
  await redis.set(jobKey(jobId), JSON.stringify(fullJob), 'EX', JOB_TTL);

  const position = await redis.llen(QUEUE_KEY);
  return { jobId, position };
}

export async function getJobStatus(jobId: string): Promise<ResearchJob | null> {
  const redis = getRedis();
  const raw = await redis.get(jobKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResearchJob;
  } catch {
    return null;
  }
}

export async function getQueueStats(): Promise<{
  queued: number;
  processing: number;
  activePipelines: number;
}> {
  const redis = getRedis();
  await cleanupStaleProcessingSlots();
  const [queued, processing, activePipelinesRaw] = await Promise.all([
    redis.llen(QUEUE_KEY),
    redis.scard(PROCESSING_KEY),
    redis.get(ACTIVE_PIPELINE_COUNT_KEY),
  ]);
  const activePipelines = Math.max(0, Number.parseInt(activePipelinesRaw || '0', 10) || 0);
  return { queued, processing, activePipelines };
}

export async function beginResearchPipelineRun(): Promise<void> {
  const redis = getRedis();
  await redis.incr(ACTIVE_PIPELINE_COUNT_KEY);
  await redis.expire(ACTIVE_PIPELINE_COUNT_KEY, PROCESSING_HEARTBEAT_TTL_SECONDS);
}

export async function endResearchPipelineRun(): Promise<void> {
  const redis = getRedis();
  const remaining = (await redis.decr(ACTIVE_PIPELINE_COUNT_KEY)) as number;
  if (remaining <= 0) {
    await redis.del(ACTIVE_PIPELINE_COUNT_KEY);
  } else {
    await redis.expire(ACTIVE_PIPELINE_COUNT_KEY, PROCESSING_HEARTBEAT_TTL_SECONDS);
  }
}

export async function cleanupStaleProcessingSlots(): Promise<number> {
  const redis = getRedis();
  const members = await redis.smembers(PROCESSING_KEY);
  if (members.length === 0) return 0;

  let removed = 0;
  const now = Date.now();
  for (const token of members) {
    let stale = false;
    if (token.startsWith('sync:')) {
      const heartbeat = await redis.get(`${PROCESSING_HEARTBEAT_PREFIX}${token}`);
      stale = !heartbeat;
    } else if (token.startsWith('research-')) {
      const raw = await redis.get(jobKey(token));
      if (!raw) {
        stale = true;
      } else {
        try {
          const job = JSON.parse(raw) as ResearchJob;
          stale =
            job.status !== 'processing' ||
            (Number.isFinite(job.createdAt) && now - job.createdAt > PROCESSING_JOB_STALE_MS);
        } catch {
          stale = true;
        }
      }
    }

    if (stale) {
      await redis.srem(PROCESSING_KEY, token);
      removed += 1;
    }
  }
  if (removed > 0) {
    console.warn(`[research-queue] cleaned ${removed} stale processing slot(s)`);
  }
  return removed;
}

async function updateJobStatus(jobId: string, updates: Partial<ResearchJob>): Promise<void> {
  const redis = getRedis();
  const raw = await redis.get(jobKey(jobId));
  if (!raw) return;
  let job: ResearchJob;
  try {
    job = JSON.parse(raw) as ResearchJob;
  } catch {
    return;
  }
  const updated = { ...job, ...updates };
  await redis.set(jobKey(jobId), JSON.stringify(updated), 'EX', JOB_TTL);
}

function publicBaseUrl(): string {
  const port = Number(process.env.PORT || 4000);
  return `http://127.0.0.1:${port}`;
}

/**
 * Parse SSE body from POST /run (same event types as chat fast-path in server.ts).
 */
async function consumeResearchPipelineSse(
  body: ReadableStream<Uint8Array> | null,
): Promise<{
  report: string;
  reportPayload?: Record<string, unknown> | null;
  receipt?: Record<string, unknown> | null;
  error?: string;
}> {
  if (!body) {
    return { report: '', error: 'Empty response body' };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let report = '';
  let reportPayload: Record<string, unknown> | null = null;
  let receipt: Record<string, unknown> | null = null;
  let pipelineErr = '';

  const applyParsed = (parsed: Record<string, unknown>) => {
    if (parsed.type === 'report' && typeof parsed.markdown === 'string') {
      report = parsed.markdown;
      reportPayload = parsed;
    } else if (parsed.type === 'receipt') {
      receipt = parsed;
    } else if (parsed.type === 'error' && typeof parsed.message === 'string') {
      pipelineErr = parsed.message;
    }
  };

  const handleEventBlock = (ev: string) => {
    if (!ev.trim()) return;
    for (const line of ev.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      applyParsed(parsed as Record<string, unknown>);
    }
  };

  const drainCompleteSseBlocks = () => {
    const normalized = buffer.replace(/\r\n/g, '\n');
    const events = normalized.split('\n\n');
    buffer = events.pop() ?? '';
    for (const ev of events) {
      handleEventBlock(ev);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    drainCompleteSseBlocks();
    if (done) {
      const tail = buffer.replace(/\r\n/g, '\n').trim();
      buffer = '';
      if (tail) {
        handleEventBlock(tail);
      }
      break;
    }
  }

  if (!report && pipelineErr) {
    return { report: '', error: pipelineErr };
  }
  if (!report) {
    return { report: '', error: 'Pipeline finished without a report payload' };
  }
  return { report, reportPayload, receipt };
}

export async function runResearchPipelineHttp(job: ResearchJob): Promise<{
  report: string;
  reportPayload?: Record<string, unknown> | null;
  receipt?: Record<string, unknown> | null;
  error?: string;
}> {
  const wallet = job.walletAddress?.trim();
  if (!wallet || !isAddress(wallet)) {
    return { report: '', error: 'Invalid walletAddress for research pipeline' };
  }
  const reasoningMode = 'fast';
  const res = await fetch(`${publicBaseUrl()}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: job.query,
      userAddress: getAddress(wallet as `0x${string}`),
      reasoningMode,
      deepResearch: false,
    }),
  });

  if (!res.ok) {
    return {
      report: '',
      error: `Research pipeline returned ${res.status} ${res.statusText}`,
    };
  }

  return consumeResearchPipelineSse(res.body);
}

async function notifyResearchCompleteTelegram(walletAddress: string, query: string, preview: string): Promise<void> {
  try {
    const normalizedWallet = getAddress(walletAddress as `0x${string}`);
    const { data: user } = await adminDb
      .from('users')
      .select('telegram_id')
      .eq('wallet_address', normalizedWallet)
      .maybeSingle();

    const chatId = user?.telegram_id ? String(user.telegram_id).trim() : '';
    if (!chatId) return;

    const head = preview.length > 500 ? `${preview.slice(0, 500)}…` : preview;
    await sendTelegramText(
      chatId,
      [
        '📊 Research complete!',
        '',
        `Query: ${query}`,
        '',
        head,
        '',
        'View the full report in AgentFlow chat.',
      ].join('\n'),
    );
  } catch (e) {
    console.warn('[research-queue] Telegram notify skipped:', e instanceof Error ? e.message : e);
  }
}

export async function processResearchQueue(): Promise<void> {
  const redis = getRedis();
  await cleanupStaleProcessingSlots();

  const raw = await redis.eval(
    DEQUEUE_AND_RESERVE_LUA,
    2,
    PROCESSING_KEY,
    QUEUE_KEY,
    String(MAX_CONCURRENT),
  );

  if (raw == null || raw === false) {
    return;
  }

  let job: ResearchJob;
  try {
    job = JSON.parse(String(raw)) as ResearchJob;
  } catch {
    console.error('[research-queue] Invalid job JSON after dequeue');
    return;
  }

  await updateJobStatus(job.id, { status: 'processing' });

  console.log(`[research-queue] processing ${job.id}: "${job.query.slice(0, 120)}"`);

  try {
    const { report, reportPayload, receipt, error } = await runResearchPipelineHttp(job);
    if (error) {
      throw new Error(error);
    }

    await updateJobStatus(job.id, {
      status: 'done',
      result: report,
      reportPayload: reportPayload ?? null,
      receipt: receipt ?? null,
    });

    await notifyResearchCompleteTelegram(job.walletAddress, job.query, report);

    console.log(`[research-queue] job ${job.id} done`);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    console.error(`[research-queue] job ${job.id} failed:`, e);
    await updateJobStatus(job.id, {
      status: 'failed',
      error: message,
    });
  } finally {
    await redis.srem(PROCESSING_KEY, job.id);
  }
}
