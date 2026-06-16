import '../lib/loadEnv';
import { mkdir, writeFile } from 'node:fs/promises';
import { getAddress } from 'viem';
import { buildPrimaryFirecrawlQueryVariants } from '../lib/live-data';
import { understandMarketResearch } from '../lib/market-understanding';

type SoakCase = {
  id: string;
  kind: 'active' | 'ambiguous' | 'fake';
  title: string;
  outcomes: string[];
  category: string;
  provider: string;
  address?: `0x${string}`;
};

type SseRunResult = {
  elapsedMs: number;
  reportMarkdown: string;
  reportSources: Array<{ name?: string; url?: string }>;
  liveSources: Array<{ publisher?: string; url?: string; title?: string }>;
  deltas: string[];
  rawReportPayload: Record<string, unknown> | null;
};

type CaseSummary = {
  id: string;
  kind: SoakCase['kind'];
  title: string;
  category: string;
  elapsedMs: number;
  understandingWorked: boolean;
  understandingSubject?: string | null;
  understandingUnderlying?: string | null;
  queryVariants: string[];
  finalSourceDomains: string[];
  liveSourceDomains: string[];
  failureSignals: string[];
  weaknessSignals: string[];
  reportPreview: string;
  liveSourceLabels: string[];
  error?: string;
};

const API_BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const INTERNAL_KEY = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
const TEST_WALLET_ADDRESS = process.env.TEST_WALLET_ADDRESS?.trim()
  ? getAddress(process.env.TEST_WALLET_ADDRESS.trim() as `0x${string}`)
  : null;
const OUT_DIR = 'tmp/predmarket-research-soak';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.PREDMARKET_SOAK_TIMEOUT_MS || '240000', 10);
const CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.PREDMARKET_SOAK_CONCURRENCY || '3', 10) || 3,
);

const CASES: SoakCase[] = [
  {
    id: 'active-gta6',
    kind: 'active',
    title: 'Will GTA 6 launch before November 30, 2026?',
    outcomes: ['Yes', 'No'],
    category: 'Games',
    provider: 'achmarket',
    address: '0x5Cf866D334b9bF0e007433b1022aeCf58b37F1B9',
  },
  {
    id: 'active-arc-mainnet',
    kind: 'active',
    title: 'Will ARC launch its Mainnet before June 30, 2026?',
    outcomes: ['Yes', 'No'],
    category: 'Crypto',
    provider: 'achmarket',
    address: '0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96',
  },
  {
    id: 'active-xaut',
    kind: 'active',
    title: 'Will Tether Gold (XAUT) reach $4,750 by July 31st?',
    outcomes: ['Yes', 'No'],
    category: 'Crypto',
    provider: 'achmarket',
  },
  {
    id: 'active-world-cup',
    kind: 'active',
    title: 'Who Will Win the FIFA World Cup 2026?',
    outcomes: ['France', 'Argentina', 'Brazil', 'Other'],
    category: 'Sports',
    provider: 'achmarket',
  },
  {
    id: 'ambiguous-arc-short',
    kind: 'ambiguous',
    title: 'Will ARC hit before June 30, 2026?',
    outcomes: ['Yes', 'No'],
    category: 'Crypto',
    provider: 'achmarket',
  },
  {
    id: 'ambiguous-vi-short',
    kind: 'ambiguous',
    title: 'Will VI launch before November 30, 2026?',
    outcomes: ['Yes', 'No'],
    category: 'Games',
    provider: 'achmarket',
  },
  {
    id: 'fake-zynq-mainnet',
    kind: 'fake',
    title: 'Will ZYNQ Protocol launch QuantumNet before September 30, 2026?',
    outcomes: ['Yes', 'No'],
    category: 'Crypto',
    provider: 'achmarket',
  },
  {
    id: 'fake-mgld-price',
    kind: 'fake',
    title: 'Will MoonGold (MGLD) reach $9,000 by July 31, 2026?',
    outcomes: ['Yes', 'No'],
    category: 'Crypto',
    provider: 'achmarket',
  },
];

function buildPrompt(testCase: SoakCase): string {
  return [
    `research the prediction market topic: ${testCase.title}`,
    testCase.outcomes.length
      ? `Listed outcomes in AgentFlow: ${testCase.outcomes.join(' / ')}.`
      : null,
    `Prediction market category in AgentFlow: ${testCase.category}.`,
    `Prediction market provider in AgentFlow: ${testCase.provider}.`,
    testCase.address ? `AgentFlow market address reference: ${testCase.address}.` : null,
    'Use the market category to disambiguate the subject before searching. For example: crypto markets should be researched as crypto/blockchain topics, sports markets as teams/tournaments, and macro/commodity markets by their real-world underlying drivers.',
    'Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseSseEvents(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  return { events: parts, rest };
}

function sourceDomainsFromUrls(urls: Array<string | undefined>): string[] {
  const domains = new Set<string>();
  for (const rawUrl of urls) {
    if (!rawUrl) continue;
    try {
      domains.add(new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase());
    } catch {
      // ignore malformed urls
    }
  }
  return [...domains].sort();
}

function sourceLooksLowValue(url: string): boolean {
  return /\b(?:arc\.net|chip\.de|de\.wikipedia\.org|dict\.leo\.org|speisekartenweb\.de|grandcityproperty\.de|getjar\.com|firstinternetmarketing\.com|gamermarkt\.com|in-game\.news)\b/i.test(
    url,
  );
}

function hasPromptLeak(markdown: string): boolean {
  return /\bresearch the prediction market topic:|Prediction market category in AgentFlow:|Prediction market provider in AgentFlow:|AgentFlow market address reference:/i.test(
    markdown,
  );
}

function hasPipelineLeak(markdown: string): boolean {
  return /\bResearch Pipeline\b|\bresearch agent started\b|\banalyst agent started\b/i.test(
    markdown,
  );
}

function looksSparse(markdown: string): boolean {
  return /\btoo thin\b|\blimited evidence\b|\bnot enough dated source evidence\b|\binsufficient public evidence\b/i.test(
    markdown,
  );
}

function includesAmbiguityDrift(markdown: string): boolean {
  return /\bArc browser\b|\bweb browser\b|\bbrowser\b|\bclinic\b|\bdownload arc\b|\bwebbrowser\b/i.test(
    markdown,
  );
}

function outputSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function runPrompt(prompt: string): Promise<SseRunResult> {
  if (!TEST_WALLET_ADDRESS) {
    throw new Error('TEST_WALLET_ADDRESS is required');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${API_BASE}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(INTERNAL_KEY ? { 'X-Agentflow-Brain-Internal': INTERNAL_KEY } : {}),
      },
      body: JSON.stringify({
        task: prompt,
        userAddress: TEST_WALLET_ADDRESS,
        reasoningMode: 'fast',
        deepResearch: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reportPayload: Record<string, unknown> | null = null;
    const deltas: string[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.rest;

      for (const eventBlock of parsed.events) {
        for (const line of eventBlock.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          const payload = JSON.parse(raw) as Record<string, unknown>;
          if (payload.type === 'delta' && typeof payload.delta === 'string') {
            deltas.push(payload.delta);
          }
          if (payload.type === 'report') {
            reportPayload = payload;
          }
          if (payload.type === 'error' && typeof payload.message === 'string') {
            throw new Error(payload.message);
          }
        }
      }
    }

    const liveData = (reportPayload?.liveData as Record<string, unknown> | undefined) ?? {};
    const dynamicSources =
      ((liveData.dynamic_sources as Record<string, unknown> | undefined)?.articles as Array<
        Record<string, unknown>
      > | undefined) ?? [];
    const reportSources =
      (reportPayload?.sources as Array<Record<string, unknown>> | undefined) ?? [];

    return {
      elapsedMs: Date.now() - startedAt,
      reportMarkdown: typeof reportPayload?.markdown === 'string' ? reportPayload.markdown : '',
      reportSources: reportSources.map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name : undefined,
        url: typeof entry.url === 'string' ? entry.url : undefined,
      })),
      liveSources: dynamicSources.map((entry) => ({
        publisher: typeof entry.publisher === 'string' ? entry.publisher : undefined,
        url: typeof entry.url === 'string' ? entry.url : undefined,
        title: typeof entry.title === 'string' ? entry.title : undefined,
      })),
      deltas,
      rawReportPayload: reportPayload,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeCase(testCase: SoakCase): Promise<CaseSummary> {
  const prompt = buildPrompt(testCase);
  const understanding = await understandMarketResearch(prompt).catch(() => null);
  const queryVariants = buildPrimaryFirecrawlQueryVariants(prompt, prompt, understanding);
  const run = await runPrompt(prompt);
  const finalSourceDomains = sourceDomainsFromUrls(run.reportSources.map((source) => source.url));
  const liveSourceDomains = sourceDomainsFromUrls(run.liveSources.map((source) => source.url));
  const weaknessSignals: string[] = [];
  const failureSignals: string[] = [];
  const markdown = run.reportMarkdown;

  if (!markdown.trim()) failureSignals.push('missing_markdown');
  if (hasPromptLeak(markdown)) failureSignals.push('prompt_leak');
  if (hasPipelineLeak(markdown)) failureSignals.push('pipeline_leak');
  if (finalSourceDomains.length < 2) failureSignals.push('low_source_diversity');
  if (run.reportSources.some((source) => source.url && sourceLooksLowValue(source.url))) {
    failureSignals.push('low_value_source_leak');
  }
  if (looksSparse(markdown)) weaknessSignals.push('sparse_or_thin_conclusion');
  if (includesAmbiguityDrift(markdown)) weaknessSignals.push('ambiguity_drift_in_report');
  if (liveSourceDomains.length === 0) weaknessSignals.push('no_dynamic_live_sources');
  if (!understanding) weaknessSignals.push('understanding_step_failed');
  if (queryVariants.some((query) => /long term forecast|future outlook|growth potential/i.test(query))) {
    weaknessSignals.push('generic_forecast_queries_present');
  }
  if (
    /\b(xaut|tether gold)\b/i.test(testCase.title) &&
    !finalSourceDomains.some((domain) => /\b(?:kitco\.com|lbma\.org\.uk|reuters\.com|cmegroup\.com|bullion|gold)\b/i.test(domain))
  ) {
    weaknessSignals.push('missing_underlying_gold_sources');
  }
  if (
    /\b(world cup|fifa)\b/i.test(testCase.title) &&
    !/\b(odds|favorite|probability|implied)\b/i.test(markdown)
  ) {
    weaknessSignals.push('missing_probability_language');
  }
  if (testCase.kind === 'fake' && finalSourceDomains.length > 0 && !looksSparse(markdown)) {
    weaknessSignals.push('fake_market_still_received_confident_report');
  }
  if (testCase.kind === 'ambiguous' && finalSourceDomains.length > 0 && !understanding) {
    weaknessSignals.push('ambiguous_market_depends_on_fallback_only');
  }

  const reportPreview = markdown.replace(/\s+/g, ' ').slice(0, 700);
  const liveSourceLabels = run.liveSources
    .map((source) => source.publisher || source.title || source.url || '')
    .filter(Boolean)
    .slice(0, 8);

  return {
    id: testCase.id,
    kind: testCase.kind,
    title: testCase.title,
    category: testCase.category,
    elapsedMs: run.elapsedMs,
    understandingWorked: Boolean(understanding),
    understandingSubject: understanding?.subject ?? null,
    understandingUnderlying: understanding?.underlying ?? null,
    queryVariants,
    finalSourceDomains,
    liveSourceDomains,
    failureSignals,
    weaknessSignals,
    reportPreview,
    liveSourceLabels,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!);
      }
    }),
  );

  return results;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const results = await mapWithConcurrency(
    CASES,
    async (testCase) => {
      console.log(`[predmarket-soak] start ${testCase.id} (${testCase.kind})`);
      try {
        const result = await analyzeCase(testCase);
        console.log(
          `[predmarket-soak] done ${testCase.id} failures=${result.failureSignals.length} weaknesses=${result.weaknessSignals.length} sources=${result.finalSourceDomains.length} latency=${result.elapsedMs}ms`,
        );
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[predmarket-soak] error ${testCase.id}: ${message}`);
        return {
          id: testCase.id,
          kind: testCase.kind,
          title: testCase.title,
          category: testCase.category,
          elapsedMs: 0,
          understandingWorked: false,
          understandingSubject: null,
          understandingUnderlying: null,
          queryVariants: [],
          finalSourceDomains: [],
          liveSourceDomains: [],
          failureSignals: ['request_failed'],
          weaknessSignals: [],
          reportPreview: '',
          liveSourceLabels: [],
          error: message,
        } satisfies CaseSummary;
      }
    },
    CONCURRENCY,
  );

  const weaknessHistogram = results
    .flatMap((entry) => entry.weaknessSignals)
    .reduce<Record<string, number>>((acc, signal) => {
      acc[signal] = (acc[signal] ?? 0) + 1;
      return acc;
    }, {});
  const failureHistogram = results
    .flatMap((entry) => entry.failureSignals)
    .reduce<Record<string, number>>((acc, signal) => {
      acc[signal] = (acc[signal] ?? 0) + 1;
      return acc;
    }, {});

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    caseCount: results.length,
    failureHistogram,
    weaknessHistogram,
    results,
  };

  await writeFile(`${OUT_DIR}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  for (const result of results) {
    await writeFile(
      `${OUT_DIR}/${outputSlug(result.id)}.txt`,
      [
        `id: ${result.id}`,
        `kind: ${result.kind}`,
        `title: ${result.title}`,
        `category: ${result.category}`,
        `elapsedMs: ${result.elapsedMs}`,
        `understandingWorked: ${result.understandingWorked}`,
        `understandingSubject: ${result.understandingSubject ?? ''}`,
        `understandingUnderlying: ${result.understandingUnderlying ?? ''}`,
        `failureSignals: ${result.failureSignals.join(', ')}`,
        `weaknessSignals: ${result.weaknessSignals.join(', ')}`,
        `queryVariants: ${result.queryVariants.join(' | ')}`,
        `finalSourceDomains: ${result.finalSourceDomains.join(', ')}`,
        `liveSourceDomains: ${result.liveSourceDomains.join(', ')}`,
        `liveSourceLabels: ${result.liveSourceLabels.join(' | ')}`,
        '',
        result.reportPreview,
      ].join('\n'),
      'utf8',
    );
  }

  console.log('\n[predmarket-soak] summary');
  console.log(JSON.stringify({ failureHistogram, weaknessHistogram }, null, 2));
  console.log(`[predmarket-soak] output: ${OUT_DIR}/summary.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
