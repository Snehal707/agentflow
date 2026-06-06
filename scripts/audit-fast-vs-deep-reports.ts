import '../lib/loadEnv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getAddress, isAddress } from 'viem';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const USER = process.env.TEST_WALLET_ADDRESS?.trim();
const TIMEOUT_MS = Math.max(
  120_000,
  Number.parseInt(process.env.REPORT_AUDIT_TIMEOUT_MS || '600000', 10) || 600_000,
);

const DEFAULT_TASKS = [
  'Bitcoin current price, market drivers, and key risks',
  'Latest stablecoin market trends, USDC position, and major risks',
  'Iran-US tensions and impact on global shipping routes',
  'OpenAI latest product and API developments with practical developer implications',
  'x402 payments ecosystem: current adoption, major projects, and constraints',
];
const TASKS =
  process.env.REPORT_AUDIT_TASKS?.split('||')
    .map((task) => task.trim())
    .filter(Boolean) ?? DEFAULT_TASKS;
const MODES = (process.env.REPORT_AUDIT_MODES?.split(',')
  .map((mode) => mode.trim())
  .filter((mode): mode is Mode => mode === 'fast' || mode === 'deep') ?? [
  'fast',
  'deep',
]) as Mode[];

type Mode = 'fast' | 'deep';

type RunArtifact = {
  task: string;
  mode: Mode;
  startedAt: string;
  durationMs: number;
  receiptTotal?: string;
  pipelineRequestId?: string;
  markdown: string;
  research: Record<string, unknown> | null;
  analysis: Record<string, unknown> | null;
  liveData: Record<string, unknown> | null;
  metrics: ReturnType<typeof buildMetrics>;
  error?: string;
};

function parseSsePayload(raw: string): Record<string, any> | null {
  if (!raw || raw === '[DONE]') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceSection(markdown: string): string {
  return markdown.match(/^## Sources\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1]?.trim() ?? '';
}

function buildMetrics(markdown: string, liveData: Record<string, unknown> | null) {
  const words = markdown.match(/\b[\w'-]+\b/g) ?? [];
  const headings = markdown.match(/^#{1,6}\s+.+$/gm) ?? [];
  const urls = markdown.match(/https?:\/\/[^\s)>]+/g) ?? [];
  const uniqueUrls = new Set(urls.map((url) => url.replace(/[.,;]+$/, '').toLowerCase()));
  const visibleSources = sourceSection(markdown);
  const liveSources = Array.isArray(liveData?.sources) ? liveData.sources : [];
  const diagnostics = asObject(liveData?.source_diagnostics);

  return {
    chars: markdown.length,
    words: words.length,
    headings: headings.length,
    sourceHeadings: (markdown.match(/^(?:[-*]\s+)?(?:#{1,6}\s+)?(?:\*\*)?Sources:?(?:\*\*)?:?\s*$/gim) ?? []).length,
    visibleSourceUrls: new Set(
      (visibleSources.match(/https?:\/\/[^\s)>]+/g) ?? []).map((url) =>
        url.replace(/[.,;]+$/, '').toLowerCase(),
      ),
    ).size,
    totalUniqueUrls: uniqueUrls.size,
    visibleViaApi: /\bvia API\b/i.test(markdown),
    liveSourceCount: liveSources.length,
    liveDistinctDomains:
      typeof diagnostics?.distinct_domains === 'number' ? diagnostics.distinct_domains : undefined,
    liveDriftRisk:
      typeof diagnostics?.drift_risk === 'string' ? diagnostics.drift_risk : undefined,
  };
}

async function runReport(task: string, mode: Mode, userAddress: `0x${string}`): Promise<RunArtifact> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let markdown = '';
  let research: Record<string, unknown> | null = null;
  let analysis: Record<string, unknown> | null = null;
  let liveData: Record<string, unknown> | null = null;
  let receiptTotal: string | undefined;
  let pipelineRequestId: string | undefined;

  try {
    const response = await fetch(`${BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        task,
        userAddress,
        reasoningMode: mode,
        deepResearch: mode === 'deep',
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`POST /run failed: ${response.status} ${await response.text()}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = parseSsePayload(trimmed.slice(5).trim());
      if (!payload) return;
      if (payload.type === 'error') {
        throw new Error(typeof payload.message === 'string' ? payload.message : JSON.stringify(payload));
      }
      if (payload.type === 'receipt') {
        receiptTotal = typeof payload.total === 'string' ? payload.total : undefined;
        pipelineRequestId =
          typeof payload.pipelineRequestId === 'string' ? payload.pipelineRequestId : undefined;
      }
      if (payload.type === 'report') {
        markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
        research = asObject(payload.research);
        analysis = asObject(payload.analysis);
        liveData = asObject(payload.liveData);
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
    if (buffer.trim()) handleLine(buffer);
    if (!markdown) throw new Error('Pipeline returned no report markdown');

    return {
      task,
      mode,
      startedAt,
      durationMs: Date.now() - started,
      receiptTotal,
      pipelineRequestId,
      markdown,
      research,
      analysis,
      liveData,
      metrics: buildMetrics(markdown, liveData),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      task,
      mode,
      startedAt,
      durationMs: Date.now() - started,
      receiptTotal,
      pipelineRequestId,
      markdown,
      research,
      analysis,
      liveData,
      metrics: buildMetrics(markdown, liveData),
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

async function main(): Promise<void> {
  if (!USER || !isAddress(USER)) {
    throw new Error('TEST_WALLET_ADDRESS must be set to a valid wallet address');
  }
  const userAddress = getAddress(USER as `0x${string}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.join(process.cwd(), 'tmp', `fast-vs-deep-audit-${stamp}`);
  await mkdir(outputDir, { recursive: true });

  const artifacts: RunArtifact[] = [];
  for (const task of TASKS) {
    for (const mode of MODES) {
      console.log(`[audit] starting mode=${mode} task="${task}"`);
      const artifact = await runReport(task, mode, userAddress);
      artifacts.push(artifact);
      await writeFile(
        path.join(outputDir, `${String(artifacts.length).padStart(2, '0')}-${mode}-${slug(task)}.md`),
        `${artifact.markdown}\n`,
        'utf8',
      );
      console.log(
        `[audit] completed mode=${mode} duration_ms=${artifact.durationMs} words=${artifact.metrics.words} visible_sources=${artifact.metrics.visibleSourceUrls} error=${artifact.error ?? 'none'}`,
      );
    }
  }

  await writeFile(
    path.join(outputDir, 'results.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, artifacts }, null, 2)}\n`,
    'utf8',
  );
  console.log(`[audit] wrote ${artifacts.length} artifacts to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
