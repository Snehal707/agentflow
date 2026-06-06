import fs from 'node:fs/promises';
import path from 'node:path';

type IntentDispatchRecord = {
  raw_message: string | null;
  layer_used: string | null;
  intent: string | null;
  validator_severity: string | null;
  tool_called: string | null;
  confidence: number | null;
  latency_ms: number | null;
  error?: string | null;
};

type BrainTelemetryUpdate = {
  id?: string;
  intent_source?: string | null;
  final_intent?: string | null;
  layer_used?: string | null;
  final_response_summary?: string | null;
  outcome?: string | null;
  total_latency_ms?: number | null;
  failure_reason?: string | null;
};

type Report = {
  sourceFile: string;
  generatedAt: string;
  totals: {
    dispatches: number;
    intentRouter: number;
    hermesFallback: number;
    timeoutFallbacks: number;
    explicitGeneralChatToHermes: number;
  };
  rates: {
    hermesFallbackRate: number;
    timeoutFallbackRate: number;
  };
  errorCounts: Record<string, number>;
  layerCounts: Record<string, number>;
  intentCounts: Record<string, number>;
  topFallbackPrompts: Array<{
    prompt: string;
    count: number;
    reasons: string[];
    lastIntent: string | null;
  }>;
  slowestDispatches: Array<{
    prompt: string;
    layer: string | null;
    intent: string | null;
    latency_ms: number | null;
    error?: string | null;
  }>;
  hermesFinalResponses: Array<{
    prompt: string;
    summary: string | null;
    outcome: string | null;
    total_latency_ms: number | null;
  }>;
};

function increment(map: Map<string, number>, key: string | null | undefined): void {
  const normalized = key && key.trim() ? key.trim() : '(none)';
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function extractBalancedBlock(
  text: string,
  startIndex: number,
  openChar: string,
  closeChar: string,
): { block: string; endIndex: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];
    if (!started) {
      if (char !== openChar) {
        continue;
      }
      started = true;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === "'") {
        inString = false;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          block: text.slice(startIndex, i + 1),
          endIndex: i + 1,
        };
      }
    }
  }

  return null;
}

function toJsonish(block: string): string {
  return block
    .replace(/^\[[^\]\r\n]+\]\s?/gm, '')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'/g, '"')
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bNaN\b/g, 'null');
}

function parseObjectBlock<T>(block: string): T | null {
  try {
    return JSON.parse(toJsonish(block)) as T;
  } catch {
    return null;
  }
}

function roundRate(value: number): number {
  return Number(value.toFixed(3));
}

async function main(): Promise<void> {
  const argPath = process.argv[2]?.trim();
  const sourceFile = argPath
    ? path.resolve(process.cwd(), argPath)
    : path.resolve(process.cwd(), 'tmp/dev-stack.out.log');

  const raw = await fs.readFile(sourceFile, 'utf8');

  const dispatches: IntentDispatchRecord[] = [];
  const telemetryUpdates: BrainTelemetryUpdate[] = [];

  let cursor = 0;
  while (cursor < raw.length) {
    const dispatchIdx = raw.indexOf('[INTENT_DISPATCH]', cursor);
    const telemetryIdx = raw.indexOf('[BRAIN_TELEMETRY]', cursor);

    let nextIdx = -1;
    let kind: 'dispatch' | 'telemetry' | null = null;

    if (dispatchIdx !== -1 && (telemetryIdx === -1 || dispatchIdx < telemetryIdx)) {
      nextIdx = dispatchIdx;
      kind = 'dispatch';
    } else if (telemetryIdx !== -1) {
      nextIdx = telemetryIdx;
      kind = 'telemetry';
    }

    if (nextIdx === -1 || kind === null) {
      break;
    }

    if (kind === 'dispatch') {
      const braceIdx = raw.indexOf('{', nextIdx);
      if (braceIdx === -1) break;
      const block = extractBalancedBlock(raw, braceIdx, '{', '}');
      if (!block) break;
      const parsed = parseObjectBlock<IntentDispatchRecord>(block.block);
      if (parsed) dispatches.push(parsed);
      cursor = block.endIndex;
      continue;
    }

    const lineEnd = raw.indexOf('\n', nextIdx);
    const line = raw.slice(nextIdx, lineEnd === -1 ? raw.length : lineEnd);
    const jsonStart = line.indexOf('{');
    if (jsonStart !== -1) {
      try {
        const parsed = JSON.parse(line.slice(jsonStart)) as BrainTelemetryUpdate & { action?: string };
        if (parsed.action === 'update') {
          telemetryUpdates.push(parsed);
        }
      } catch {
        // ignore noisy lines
      }
    }
    cursor = lineEnd === -1 ? raw.length : lineEnd + 1;
  }

  const layerCounts = new Map<string, number>();
  const intentCounts = new Map<string, number>();
  const errorCounts = new Map<string, number>();
  const fallbackByPrompt = new Map<
    string,
    { count: number; reasons: Set<string>; lastIntent: string | null }
  >();

  const slowestDispatches = [...dispatches]
    .sort((a, b) => (b.latency_ms ?? 0) - (a.latency_ms ?? 0))
    .slice(0, 10)
    .map((entry) => ({
      prompt: entry.raw_message ?? '(none)',
      layer: entry.layer_used,
      intent: entry.intent,
      latency_ms: entry.latency_ms,
      error: entry.error ?? null,
    }));

  let hermesFallback = 0;
  let timeoutFallbacks = 0;
  let explicitGeneralChatToHermes = 0;

  for (const dispatch of dispatches) {
    increment(layerCounts, dispatch.layer_used);
    increment(intentCounts, dispatch.intent);
    if (dispatch.error) {
      increment(errorCounts, dispatch.error);
    }

    const isHermes = dispatch.layer_used === 'hermes';
    if (!isHermes) continue;

    hermesFallback += 1;
    if (dispatch.intent === 'general.chat') {
      explicitGeneralChatToHermes += 1;
    }
    if (dispatch.error?.includes('Timeout')) {
      timeoutFallbacks += 1;
    }

    const prompt = dispatch.raw_message ?? '(none)';
    const existing = fallbackByPrompt.get(prompt) ?? {
      count: 0,
      reasons: new Set<string>(),
      lastIntent: dispatch.intent,
    };
    existing.count += 1;
    if (dispatch.error) existing.reasons.add(dispatch.error);
    if (dispatch.intent) existing.reasons.add(`intent:${dispatch.intent}`);
    existing.lastIntent = dispatch.intent;
    fallbackByPrompt.set(prompt, existing);
  }

  const hermesSummaries = telemetryUpdates
    .filter((entry) => entry.layer_used === 'hermes_agent')
    .slice(-10)
    .map((entry) => ({
      prompt: '(see source log context)',
      summary: entry.final_response_summary ?? null,
      outcome: entry.outcome ?? null,
      total_latency_ms: entry.total_latency_ms ?? null,
    }));

  const report: Report = {
    sourceFile,
    generatedAt: new Date().toISOString(),
    totals: {
      dispatches: dispatches.length,
      intentRouter: dispatches.filter((d) => d.layer_used === 'intent_router').length,
      hermesFallback,
      timeoutFallbacks,
      explicitGeneralChatToHermes,
    },
    rates: {
      hermesFallbackRate: dispatches.length ? roundRate(hermesFallback / dispatches.length) : 0,
      timeoutFallbackRate: dispatches.length ? roundRate(timeoutFallbacks / dispatches.length) : 0,
    },
    errorCounts: Object.fromEntries([...errorCounts.entries()].sort((a, b) => b[1] - a[1])),
    layerCounts: Object.fromEntries([...layerCounts.entries()].sort((a, b) => b[1] - a[1])),
    intentCounts: Object.fromEntries([...intentCounts.entries()].sort((a, b) => b[1] - a[1])),
    topFallbackPrompts: [...fallbackByPrompt.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([prompt, stats]) => ({
        prompt,
        count: stats.count,
        reasons: [...stats.reasons],
        lastIntent: stats.lastIntent,
      })),
    slowestDispatches,
    hermesFinalResponses: hermesSummaries,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.resolve(process.cwd(), `tmp/intent-routing-report-${stamp}.json`);
  await fs.writeFile(outFile, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Intent routing report written to ${outFile}`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
