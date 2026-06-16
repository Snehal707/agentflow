import '../lib/loadEnv';
import { mkdir, writeFile } from 'node:fs/promises';
import { getAddress } from 'viem';
import { listAllMarkets } from '../lib/predmarket/router';
import type { MarketOutcome, MarketSummary } from '../lib/predmarket/types';

type SseReportResult = {
  markdown: string;
  events: string[];
  elapsedMs: number;
};

type MarketSmokeResult = {
  title: string;
  address: string;
  category: string;
  provider: string;
  prompt: string;
  elapsedMs: number;
  ok: boolean;
  failureReasons: string[];
  warningReasons: string[];
  sourceDomains: string[];
  reportPreview: string;
  reportPath: string;
  error?: string;
};

const API_BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const INTERNAL_KEY = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
const TEST_WALLET_ADDRESS = process.env.TEST_WALLET_ADDRESS?.trim()
  ? getAddress(process.env.TEST_WALLET_ADDRESS.trim() as `0x${string}`)
  : null;
const OUT_DIR = 'tmp/predmarket-research-smoke';
const REQUEST_TIMEOUT_MS = Math.max(
  120_000,
  Number.parseInt(process.env.PREDMARKET_RESEARCH_SMOKE_TIMEOUT_MS || '240000', 10) || 240_000,
);

function buildPredmarketResearchPrompt(
  title: string,
  outcomes: MarketOutcome[] = [],
  options?: {
    category?: string | null;
    provider?: string | null;
  },
): string {
  const safeTitle = title.trim() || 'this prediction market';
  const outcomeLabels = outcomes
    .map((outcome) => outcome.label.trim())
    .filter(Boolean);
  const category =
    typeof options?.category === 'string' && options.category.trim()
      ? options.category.trim()
      : null;
  const provider =
    typeof options?.provider === 'string' && options.provider.trim()
      ? options.provider.trim()
      : null;

  return [
    `research the prediction market topic: ${safeTitle}`,
    outcomeLabels.length
      ? `Listed outcomes in AgentFlow: ${outcomeLabels.join(' / ')}.`
      : null,
    category ? `Prediction market category in AgentFlow: ${category}.` : null,
    provider ? `Prediction market provider in AgentFlow: ${provider}.` : null,
    'Use the market category to disambiguate the subject before searching.',
    'Focus on the real-world event, relevant stats/news, timing, outcome probabilities, and what evidence would help someone compare the listed outcomes.',
  ]
    .filter(Boolean)
    .join('\n');
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseSseEvents(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  return { events: parts, rest };
}

function parseDataPayload(eventBlock: string): unknown[] {
  const payloads: unknown[] = [];
  for (const line of eventBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const raw = trimmed.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      payloads.push(JSON.parse(raw) as unknown);
    } catch {
      // ignore non-JSON lines
    }
  }
  return payloads;
}

async function runMarketResearch(prompt: string): Promise<SseReportResult> {
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
        ...(TEST_WALLET_ADDRESS ? { userAddress: TEST_WALLET_ADDRESS } : {}),
        reasoningMode: 'fast',
        deepResearch: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    if (!response.body) {
      throw new Error('Empty SSE body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let markdown = '';
    const events: string[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseEvents(buffer);
      buffer = parsed.rest;

      for (const eventBlock of parsed.events) {
        const payloads = parseDataPayload(eventBlock);
        for (const payload of payloads) {
          if (!payload || typeof payload !== 'object') continue;
          const record = payload as Record<string, unknown>;
          if (typeof record.type === 'string') {
            events.push(record.type);
          }
          if (record.type === 'report' && typeof record.markdown === 'string') {
            markdown = record.markdown;
          }
          if (record.type === 'error' && typeof record.message === 'string') {
            throw new Error(record.message);
          }
        }
      }
    }

    return {
      markdown,
      events,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractSourceDomains(markdown: string): string[] {
  const domains = new Set<string>();
  const urlMatches = markdown.match(/https?:\/\/[^\s)]+/gi) || [];
  for (const rawUrl of urlMatches) {
    try {
      domains.add(new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase());
    } catch {
      // ignore malformed urls
    }
  }

  const sourceSection = markdown.match(/(?:^|\n)Sources\s*\n([\s\S]*)$/i)?.[1] ?? '';
  for (const line of sourceSection.split('\n')) {
    const clean = line.replace(/^[\s*-]+/, '').trim();
    const domainMatch = clean.match(/\b([a-z0-9-]+\.[a-z]{2,})(?:\b|\/)/i);
    if (domainMatch?.[1]) {
      domains.add(domainMatch[1].toLowerCase());
    }
  }

  return [...domains].sort();
}

function significantTitleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !['will', 'when', 'before', 'after', 'prediction', 'market', 'winner', 'this', 'reach'].includes(token))
    .slice(0, 6);
}

function evaluateReport(market: MarketSummary, markdown: string): { failures: string[]; warnings: string[]; domains: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  const domains = extractSourceDomains(markdown);
  const normalized = markdown.toLowerCase();

  if (!markdown.trim()) {
    failures.push('missing_report_markdown');
    return { failures, warnings, domains };
  }

  if (
    /live retrieval did not return enough dated source evidence|source urls were not available|insufficient public evidence|empty evidence retrieval/i.test(
      markdown,
    )
  ) {
    failures.push('empty_or_sparse_evidence_report');
  }

  if (/prediction\.achswap\.app/i.test(markdown)) {
    failures.push('circular_achswap_source_leak');
  }

  if (
    /instagram\.com|facebook\.com\/(?:groups|.*posts|permalink\.php|story\.php|photo\.php)|youtube\.com\/watch\?|instagram post|facebook post|facebook fan forum/i.test(
      markdown,
    )
  ) {
    failures.push('low_value_social_source_leak');
  }

  if (/tp-link|\/square\/post\//i.test(markdown)) {
    failures.push('irrelevant_or_low_value_source_leak');
  }

  if (/research is defined as systematic work|merriam-webster|dictionary/i.test(markdown)) {
    failures.push('researched_the_word_research_instead_of_market');
  }

  if (!/sources/i.test(markdown)) {
    failures.push('missing_sources_section');
  }

  if (domains.length === 0) {
    failures.push('no_source_domains_extracted');
  } else if (domains.length < 2) {
    warnings.push('only_one_source_domain');
  }

  const titleTokens = significantTitleTokens(market.title);
  const tokenHits = titleTokens.filter((token) => normalized.includes(token));
  if (titleTokens.length > 0 && tokenHits.length === 0) {
    failures.push('market_title_context_missing');
  } else if (titleTokens.length > 0 && tokenHits.length < Math.min(2, titleTokens.length)) {
    warnings.push('weak_market_context_overlap');
  }

  if (/coverage limits/i.test(markdown)) {
    warnings.push('coverage_limits_present');
  }

  if (/wikipedia\.org/i.test(markdown) && domains.length <= 2) {
    warnings.push('wikipedia_dominant_source_mix');
  }

  if (/no prediction markets available right now/i.test(markdown)) {
    failures.push('routed_back_to_market_listing');
  }

  if (/500 million subscribers/i.test(market.title)) {
    const countMatch = markdown.match(/(\d{1,3}(?:,\d{3}){2,}|\d+(?:\.\d+)?)\s*(?:million|m)\s+subscribers|\b(\d{3}(?:,\d{3}){2,})\b/i);
    const raw = countMatch?.[1] ?? countMatch?.[2];
    if (raw) {
      const normalizedCount = /million|m subscribers/i.test(countMatch?.[0] || '')
        ? Number(raw.replace(/,/g, '')) * 1_000_000
        : Number(raw.replace(/,/g, ''));
      if (Number.isFinite(normalizedCount) && normalizedCount < 300_000_000) {
        failures.push('implausible_creator_metric_count');
      }
    }
  }

  return { failures, warnings, domains };
}

async function main(): Promise<void> {
  if (!TEST_WALLET_ADDRESS) {
    throw new Error('TEST_WALLET_ADDRESS is required for predmarket research smoke tests');
  }

  const markets = await listAllMarkets({ stage: 'active' });
  const activeMarkets = markets.filter((market) => market.stage === 'active');
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[predmarket-research-smoke] active markets=${activeMarkets.length}`);

  const results: MarketSmokeResult[] = [];

  for (let index = 0; index < activeMarkets.length; index++) {
    const market = activeMarkets[index]!;
    const prompt = buildPredmarketResearchPrompt(market.title, market.outcomes, {
      category: market.category,
      provider: market.provider,
    });
    const fileBase = `${String(index + 1).padStart(2, '0')}-${slug(market.title) || slug(market.address)}`;
    const reportPath = `${OUT_DIR}/${fileBase}.md`;

    console.log(`[predmarket-research-smoke] ${index + 1}/${activeMarkets.length} ${market.title}`);

    try {
      const run = await runMarketResearch(prompt);
      await writeFile(reportPath, run.markdown || '', 'utf8');
      const evaluation = evaluateReport(market, run.markdown);
      const failureReasons = evaluation.failures;
      const warningReasons = evaluation.warnings;
      const ok = failureReasons.length === 0;

      console.log(
        `[predmarket-research-smoke] ${ok ? 'PASS' : 'FAIL'} elapsed=${run.elapsedMs}ms failures=${failureReasons.length} warnings=${warningReasons.length}`,
      );

      results.push({
        title: market.title,
        address: market.address,
        category: market.category,
        provider: market.provider,
        prompt,
        elapsedMs: run.elapsedMs,
        ok,
        failureReasons,
        warningReasons,
        sourceDomains: evaluation.domains,
        reportPreview: run.markdown.slice(0, 500),
        reportPath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[predmarket-research-smoke] ERROR ${message}`);
      results.push({
        title: market.title,
        address: market.address,
        category: market.category,
        provider: market.provider,
        prompt,
        elapsedMs: 0,
        ok: false,
        failureReasons: ['request_failed'],
        warningReasons: [],
        sourceDomains: [],
        reportPreview: '',
        reportPath,
        error: message,
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    marketCount: activeMarkets.length,
    passCount: results.filter((result) => result.ok).length,
    failCount: results.filter((result) => !result.ok).length,
    failureHistogram: results.flatMap((result) => result.failureReasons).reduce<Record<string, number>>((acc, reason) => {
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {}),
    warningHistogram: results.flatMap((result) => result.warningReasons).reduce<Record<string, number>>((acc, reason) => {
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {}),
    results,
  };

  await writeFile(`${OUT_DIR}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('\n[predmarket-research-smoke] summary');
  console.log(`- markets tested: ${summary.marketCount}`);
  console.log(`- pass: ${summary.passCount}`);
  console.log(`- fail: ${summary.failCount}`);
  console.log(`- output: ${OUT_DIR}/summary.json`);

  if (summary.failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
