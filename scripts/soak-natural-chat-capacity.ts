import { randomUUID } from 'node:crypto';

import { generateJWT } from '../lib/auth';

const BASE = (process.env.AGENTFLOW_API_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const DEFAULT_WALLET = '0x1111111111111111111111111111111111111111';
const concurrencyArg = process.argv.find((arg) => arg.startsWith('--levels='));
const timeoutArg = process.argv.find((arg) => arg.startsWith('--timeout-ms='));
const repeatArg = process.argv.find((arg) => arg.startsWith('--repeat='));
const LEVELS = (concurrencyArg?.split('=')[1] || '1,3,5,8,10,15,20,30,40')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);
const TIMEOUT_MS = Math.max(5_000, Number.parseInt(timeoutArg?.split('=')[1] || '90000', 10));
const REPEAT = Math.max(1, Number.parseInt(repeatArg?.split('=')[1] || '1', 10));

type ChatResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  chars: number;
  error?: string;
};

const prompts = [
  'hey, answer in one short friendly sentence',
  'say hello back in a natural way',
  'rewrite this in a calmer tone: the launch check needs another pass',
  'make this sentence shorter: we should verify the chat flow before showing users',
  'give me one concise UX rule for error messages',
  'say this more politely: please retry in a moment',
  'write one supportive sentence for a teammate before launch',
  'what can you do here? answer briefly',
];

function parseSseDeltas(raw: string): string {
  let output = '';
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as { delta?: unknown; error?: unknown };
      if (typeof parsed.delta === 'string') output += parsed.delta;
      if (typeof parsed.error === 'string') output += ` ERROR:${parsed.error}`;
    } catch {
      // Ignore malformed chunks; raw length is still reflected in the result.
    }
  }
  return output.trim();
}

async function postChat(index: number, level: number, round: number): Promise<ChatResult> {
  const wallet = DEFAULT_WALLET;
  const prompt = prompts[index % prompts.length];
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE}/api/chat/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${generateJWT(wallet)}`,
        'x-session-id': `soak-natural-${round}-${level}-${index}-${randomUUID()}`,
      },
      body: JSON.stringify({
        message: prompt,
        messages: [{ role: 'user', content: prompt }],
        walletAddress: wallet,
        executionTarget: 'EOA',
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    const text = parseSseDeltas(raw);
    return {
      ok: response.ok && text.length > 0 && !/ERROR:/i.test(text),
      status: response.status,
      latencyMs: Date.now() - started,
      chars: text.length || raw.length,
      error: response.ok ? undefined : raw.slice(0, 240),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      chars: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function runLevel(level: number, round: number) {
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: level }, (_, index) => postChat(index, level, round)),
  );
  const ok = results.filter((result) => result.ok).length;
  const failed = results.length - ok;
  const latencies = results.filter((result) => result.ok).map((result) => result.latencyMs);
  const statuses = new Map<number, number>();
  for (const result of results) {
    statuses.set(result.status, (statuses.get(result.status) || 0) + 1);
  }
  const errors = results
    .filter((result) => !result.ok)
    .slice(0, 3)
    .map((result) => result.error || `status=${result.status}`);

  return {
    round,
    level,
    ok,
    failed,
    totalMs: Date.now() - started,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.length ? Math.max(...latencies) : 0,
    statuses: Object.fromEntries([...statuses.entries()].sort((a, b) => a[0] - b[0])),
    errors,
  };
}

async function main() {
  console.log(
    JSON.stringify({
      base: BASE,
      levels: LEVELS,
      repeat: REPEAT,
      timeoutMs: TIMEOUT_MS,
    }),
  );

  let bestClean = 0;
  for (let round = 1; round <= REPEAT; round++) {
    for (const level of LEVELS) {
      const summary = await runLevel(level, round);
      if (summary.failed === 0) bestClean = Math.max(bestClean, level);
      console.log(JSON.stringify(summary));
      if (summary.failed > 0) {
        console.log(JSON.stringify({ stopReason: 'first_failure_level', bestClean }));
        return;
      }
    }
  }
  console.log(JSON.stringify({ stopReason: 'completed_all_levels', bestClean }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
