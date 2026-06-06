import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { callHermesFast } from '../../lib/hermes';
import { RESEARCH_SYSTEM_PROMPT } from '../../lib/agentPrompts';
import {
  detectForecastingIntent,
  fetchLiveData,
  shouldGatherCurrentEvents,
} from '../../lib/live-data';
import { isCreatorAudienceMetricTask } from '../../lib/source-policy';
import {
  detectInternalCapabilities,
  detectInternalEntities,
} from '../../lib/internal-capability-detection';
import { buildInternalCapabilityContext } from '../../lib/internal-capability-retrieval';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { resolveAgentSellerAddress } from '../../lib/agentSellerAddress';
import {
  detectPortfolioImpactIntent,
  stripPortfolioImpactPhrasing,
} from '../../lib/portfolio-impact-intent';
import { inferResearchReasoningMode } from '../../lib/researchMode';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import {
  formatCounterpartyRiskReport,
  type CounterpartyRiskAssessment,
} from '../../lib/counterparty-risk';
import { detectProtocolQueryShape } from '../../lib/protocol-query-shape';

dotenv.config();

const app = express();
app.use(express.json());
const HERMES_TIMEOUT_MS = Number(process.env.RESEARCH_HERMES_TIMEOUT_MS || 140_000);
const LIVE_DATA_TIMEOUT_MS_DEFAULT = Number(process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS || 45_000);
const LIVE_DATA_TIMEOUT_MS_FORECASTING = Number(
  process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS_FORECASTING || 120_000,
);
const LIVE_DATA_TIMEOUT_MS_NICHE_PROTOCOL = Number(
  process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS_NICHE_PROTOCOL || 90_000,
);
const LIVE_DATA_TIMEOUT_MS_CREATOR_AUDIENCE = Number(
  process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS_CREATOR_AUDIENCE || 90_000,
);
const LIVE_DATA_TIMEOUT_MS_CURRENT_EVENTS = Number(
  process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS_CURRENT_EVENTS || 60_000,
);
const RESEARCH_TIMING_TRACE = /^(1|true|yes|on)$/i.test(
  String(process.env.RESEARCH_TIMING_TRACE || '').trim(),
);

const port = Number(process.env.RESEARCH_AGENT_PORT || 3001);
const account = privateKeyToAccount(resolveAgentPrivateKey());

const price =
  process.env.RESEARCH_AGENT_PRICE !== undefined
    ? `$${process.env.RESEARCH_AGENT_PRICE}`
    : '$0.005';

const facilitatorUrl = getFacilitatorBaseUrl();
let gateway: ReturnType<typeof createGatewayMiddleware>;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function parseLiveDataPayload(liveData: string): Record<string, unknown> | null {
  if (!liveData.trim()) return null;
  try {
    return JSON.parse(liveData) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeInternalContext(
  upstream: Record<string, unknown> | null,
  generated: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!upstream && !generated) return null;
  if (!upstream) return generated;
  if (!generated) return upstream;
  return {
    ...upstream,
    capability_context: generated,
  };
}

function getCurrentEventSnapshotCount(payload: Record<string, unknown> | null): number {
  const currentEvents = payload?.current_events;
  if (!currentEvents || typeof currentEvents !== 'object') {
    return 0;
  }

  const snapshots = (currentEvents as { article_snapshots?: unknown }).article_snapshots;
  return Array.isArray(snapshots) ? snapshots.length : 0;
}

type LiveDataTimeoutClass = 'forecasting' | 'niche_protocol' | 'creator_audience' | 'current_events' | 'default';

function classifyLiveDataTimeout(task: string): { timeoutMs: number; queryClass: LiveDataTimeoutClass } {
  if (detectForecastingIntent(task).forecasting) {
    return {
      timeoutMs: LIVE_DATA_TIMEOUT_MS_FORECASTING,
      queryClass: 'forecasting',
    };
  }

  const protocolShape = detectProtocolQueryShape(task);
  if (protocolShape === 'strong_crypto' || protocolShape === 'weak_status') {
    return {
      timeoutMs: LIVE_DATA_TIMEOUT_MS_NICHE_PROTOCOL,
      queryClass: 'niche_protocol',
    };
  }

  if (isCreatorAudienceMetricTask(task)) {
    return {
      timeoutMs: LIVE_DATA_TIMEOUT_MS_CREATOR_AUDIENCE,
      queryClass: 'creator_audience',
    };
  }

  if (shouldGatherCurrentEvents(task)) {
    return {
      timeoutMs: LIVE_DATA_TIMEOUT_MS_CURRENT_EVENTS,
      queryClass: 'current_events',
    };
  }

  return {
    timeoutMs: LIVE_DATA_TIMEOUT_MS_DEFAULT,
    queryClass: 'default',
  };
}

function parseCounterpartyRisk(value: unknown): CounterpartyRiskAssessment | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Partial<CounterpartyRiskAssessment>;
  if (
    typeof obj.counterparty === 'string' &&
    typeof obj.score === 'number' &&
    (obj.level === 'low' || obj.level === 'medium' || obj.level === 'high') &&
    Array.isArray(obj.factors) &&
    obj.evidence &&
    typeof obj.evidence === 'object'
  ) {
    return obj as CounterpartyRiskAssessment;
  }
  return null;
}

type TimingTracePoint = {
  label: string;
  at_ms: number;
  delta_ms: number;
  meta?: Record<string, unknown>;
};

type PaymentTraceStore = {
  push: (label: string, meta?: Record<string, unknown>) => void;
};

const paymentTraceStorage = new AsyncLocalStorage<PaymentTraceStore>();
const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const store = paymentTraceStorage.getStore();
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : 'url' in input && typeof input.url === 'string'
          ? input.url
          : '';
  const isVerify = /\/v1\/x402\/verify(?:\?|$)/.test(url);
  const isSettle = /\/v1\/x402\/settle(?:\?|$)/.test(url);
  if (!store || (!isVerify && !isSettle)) {
    return originalFetch(input as any, init);
  }
  const labelBase = isVerify ? 'research_payment_verify' : 'research_payment_settle';
  store.push(`${labelBase}_start`, {
    method: init?.method ?? (typeof input !== 'string' && 'method' in input ? input.method : 'GET'),
    url,
  });
  try {
    const response = await originalFetch(input as any, init);
    store.push(`${labelBase}_complete`, {
      status: response.status,
      ok: response.ok,
      url,
    });
    return response;
  } catch (error) {
    store.push(`${labelBase}_failed`, {
      error: getErrorMessage(error),
      url,
    });
    throw error;
  }
}) as typeof fetch;

function pushTimingTrace(
  trace: TimingTracePoint[],
  traceStart: number,
  label: string,
  meta?: Record<string, unknown>,
): void {
  if (!RESEARCH_TIMING_TRACE) return;
  const atMs = Date.now() - traceStart;
  const prev = trace[trace.length - 1];
  trace.push({
    label,
    at_ms: atMs,
    delta_ms: prev ? atMs - prev.at_ms : atMs,
    ...(meta ? { meta } : {}),
  });
}

function expandQuery(task: string): string {
  const queries: string[] = [];
  const addQuery = (query: string) => {
    const value = query.trim();
    if (!value || queries.includes(value)) return;
    queries.push(value);
  };

  const searchTask = cleanPredictionMarketResearchTaskForSearch(task);
  addQuery(searchTask);

  const lowerTask = `${task}\n${searchTask}`.toLowerCase();
  if (lowerTask.includes('arc network') || lowerTask.includes('arc blockchain')) {
    addQuery('arc.network Circle L1 blockchain 2026');
    addQuery('Arc testnet Circle stablecoin blockchain news');
    addQuery('site:arc.network OR site:circle.com arc blockchain');

    if (/\becosystem\b|\bdefi\b|\bprojects?\b/i.test(task)) {
      addQuery('Arc Network ecosystem DeFi projects stablecoin');
      addQuery('Arc Network DeFi ecosystem builders apps');
    }
  }

  return queries.join(' | ');
}

function cleanPredictionMarketResearchTaskForSearch(task: string): string {
  if (!/\bprediction\s+market\b/i.test(task) || !/\b0x[a-fA-F0-9]{40}\b/.test(task)) {
    return task;
  }

  const cleaned = task
    .split(/\r?\n/)
    .filter((line) => !/\bMarket address for AgentFlow trade routing only\b/i.test(line))
    .filter((line) => !/\bDo not research the contract address itself\b/i.test(line))
    .filter((line) => !/\bFocus on the real-world event\b/i.test(line))
    .join(' ')
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, ' ')
    .replace(/^research\s+(?:the\s+)?(?:prediction\s+)?market(?:\s+topic)?[:\s-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || task;
}

function requiresLiveEvidence(task: string): boolean {
  return (
    /\b(current|latest|today|right now|ongoing|war|conflict|ceasefire|strike|iran|israel|russia|ukraine|hormuz|red sea|geopolitical)\b/i.test(
      task,
    ) ||
    /\bprediction\s+market\b/i.test(task) ||
    (/\b(subscribers?|followers?|views?|audience|reach)\b/i.test(task) &&
      /\b(youtube|channel|creator|streamer|influencer|tiktok|instagram|x|twitter|mrbeast)\b/i.test(task)) ||
    /\bwill\b[\s\S]{0,80}\breach\b[\s\S]{0,80}\b(subscribers?|followers?|views?)\b/i.test(task)
  );
}

function buildSparseEvidenceResearch(task: string, asOf: string): string {
  return JSON.stringify({
    topic: task,
    scope: {
      timeframe: `as of ${asOf.slice(0, 10)}`,
      entities: [],
      questions: ['Current source-backed status', 'Portfolio implications'],
    },
    executive_summary:
      'Live retrieval did not return enough dated source evidence in this run to support a current-event report. No conflict status, market move, or portfolio impact should be asserted from this empty snapshot.',
    facts: [],
    recent_developments: [],
    metrics: [],
    comparisons: [],
    risks_or_caveats: [
      'Live public evidence is required for current-event, prediction-market, and audience-milestone claims.',
      'Retry with live retrieval or deep mode before making portfolio decisions.',
    ],
    open_questions: ['Which dated public sources currently support the user premise?'],
    sources: [],
  });
}

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const internalKeyMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const reqKey = (req.headers['x-agentflow-brain-internal'] as string | undefined)?.trim();
  if (internalKey && reqKey === internalKey) {
    (req as any)._internalAuth = true;
  }
  next();
};

const guardPayment: express.RequestHandler = (req, res, next) => {
  if ((req as any)._internalAuth) {
    next();
    return;
  }
  const traceStart = Date.now();
  const timingTraceId =
    typeof req.body?.timingTraceId === 'string' && req.body.timingTraceId.trim()
      ? req.body.timingTraceId.trim()
      : '';
  const trace: TimingTracePoint[] = [];
  const pushGuardTrace = (label: string, meta?: Record<string, unknown>) => {
    pushTimingTrace(trace, traceStart, label, meta);
  };
  const flushGuardTrace = async () => {
    if (!RESEARCH_TIMING_TRACE || !timingTraceId) return;
    try {
      const outDir = path.join(process.cwd(), 'tmp', 'latency-fast-research-diagnostic');
      await mkdir(outDir, { recursive: true });
      await writeFile(
        path.join(outDir, `${timingTraceId}.research-payment.json`),
        `${JSON.stringify(
          {
            timingTraceId,
            requestMethod: req.method,
            requestUrl: req.url,
            trace,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch (error) {
      console.warn('[timing-trace] failed to write research payment trace:', getErrorMessage(error));
    }
  };
  const paymentHeader = req.headers['payment-signature'];
  pushGuardTrace('research_endpoint_request_received', {
    hasPaymentSignature:
      typeof paymentHeader === 'string'
        ? paymentHeader.length > 0
        : Array.isArray(paymentHeader)
          ? paymentHeader.length > 0
          : false,
  });
  pushGuardTrace('research_payment_middleware_start');
  const middleware = gateway.require(price);
  const wrappedNext: NextFunction = (err?: any) => {
    if (err) {
      pushGuardTrace('research_payment_middleware_error', {
        error: getErrorMessage(err),
      });
      void flushGuardTrace();
      next(err);
      return;
    }
    pushGuardTrace('research_payment_middleware_complete');
    pushGuardTrace('research_handler_invoked');
    void flushGuardTrace();
    next();
  };
  res.on('finish', () => {
    pushGuardTrace('research_response_sent', {
      statusCode: res.statusCode,
    });
    void flushGuardTrace();
  });
  paymentTraceStorage.run(
    {
      push: pushGuardTrace,
    },
    () => middleware(req, res, wrappedNext),
  );
};

const runHandler = async (req: express.Request, res: express.Response) => {
  const requestId = `research_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const start = Date.now();
  const traceStart = Date.now();
  const timingTrace: TimingTracePoint[] = [];
  try {
    const rawTask = (req.body?.task as string) ?? (req.query.task as string) ?? '';
    const portfolioImpact =
      req.body?.portfolioImpact === true ||
      req.query.portfolioImpact === 'true' ||
      detectPortfolioImpactIntent(rawTask);
    const task = portfolioImpact ? stripPortfolioImpactPhrasing(rawTask) : rawTask;
    const timingTraceId =
      typeof req.body?.timingTraceId === 'string' && req.body.timingTraceId.trim()
        ? req.body.timingTraceId.trim()
        : '';
    pushTimingTrace(timingTrace, traceStart, 'fast_handler_start', {
      requestId,
      taskLength: task.length,
    });
    if (!task.trim()) {
      return res.status(400).json({ error: 'Task is required', requestId });
    }
    const researchContext =
      typeof req.body?.researchContext === 'string' && req.body.researchContext.trim()
        ? req.body.researchContext.trim()
        : '';
    const upstreamInternalContext = parseLiveDataPayload(researchContext);
    const counterpartyRisk = parseCounterpartyRisk(req.body?.counterpartyRisk);
    if (counterpartyRisk || req.body?.internalOnly === true) {
      const parsedContext = counterpartyRisk
        ? counterpartyRisk
        : (parseLiveDataPayload(researchContext)?.counterparty
            ? parseLiveDataPayload(researchContext)
            : parseLiveDataPayload(researchContext)) as CounterpartyRiskAssessment | null;
      if (parsedContext) {
        const result = formatCounterpartyRiskReport(parsedContext);
        return res.json({
          task,
          reasoningMode: 'internal',
          result,
          liveData: { internal_context: parsedContext, public_web_used: false },
        });
      }
    }
    const expandedTask = expandQuery(task);
    const reasoningMode = inferResearchReasoningMode({
      task,
      explicitMode: req.body?.reasoningMode ?? req.query.reasoningMode,
      deepResearch: req.body?.deepResearch ?? req.query.deepResearch,
      defaultMode: 'fast',
    });
    const requestedDeep =
      reasoningMode === 'deep' ||
      req.query.deep === 'true' ||
      req.body?.deepResearch === true ||
      req.body?.deepResearch === 'true';
    const walletContext =
      req.body?.walletContext && typeof req.body.walletContext === 'object'
        ? (req.body.walletContext as Record<string, unknown>)
        : null;

    if (requestedDeep) {
      const { runDeepResearch, runDeepResearchCore } = await import('./deepPipeline');
      const wantsSse =
        req.query.stream === 'true' ||
        String(req.headers.accept || '').includes('text/event-stream');

      if (req.query.deep === 'true' && wantsSse) {
        return runDeepResearch(req, res);
      }

      console.log(
        `[Research ${requestId}] ${req.method} /run taskLength=${task.length} reasoningMode=deep retrieval=source-registry+firecrawl-scrape`,
      );
      try {
        const deep = await withTimeout(
          runDeepResearchCore({
            task,
            walletContext: portfolioImpact ? (walletContext ?? undefined) : undefined,
          }),
          HERMES_TIMEOUT_MS,
          `Deep research timed out after ${HERMES_TIMEOUT_MS / 1000}s`,
        );
        console.log(
          `[Research ${requestId}] Deep research completed in ${Date.now() - start}ms sources=${deep.sources.length}`,
        );
        if (deep.sources.length > 0) {
          return res.json({
            task,
            queryExpansion: expandedTask,
            reasoningMode: 'deep',
            result: deep.markdownReport,
            structuredResearch: deep.structuredResearch,
            liveData: {
              source: 'Source registry plus targeted Firecrawl scrape',
              source_count: deep.sources.length,
              sources: deep.sources.slice(0, 25),
              liveFacts: deep.liveFacts,
              research_brief: deep.brief,
              source_diagnostics: deep.sourceDiagnostics,
              portfolio_impact: portfolioImpact,
              ...(walletContext && portfolioImpact ? { wallet_context: walletContext } : {}),
            },
          });
        }
        console.warn(
          `[Research ${requestId}] Source registry returned zero relevant sources; falling back to live data/API research.`,
        );
      } catch (deepError) {
        console.warn(
          `[Research ${requestId}] Deep retrieval failed; falling back to live data/API research:`,
          getErrorMessage(deepError),
        );
      }
    }

    console.log(
      `[Research ${requestId}] ${req.method} /run taskLength=${task.length} reasoningMode=${reasoningMode}`,
    );

    let liveData = '';
    const liveDataTimeout = classifyLiveDataTimeout(task);
    let generatedInternalContext: Record<string, unknown> | null = null;
    try {
      const capabilityMatches = detectInternalCapabilities(task);
      if (capabilityMatches.length > 0) {
        const entityMatches = detectInternalEntities(task, capabilityMatches);
        pushTimingTrace(timingTrace, traceStart, 'before_internal_capability_retrieval', {
          capabilities: capabilityMatches.map((match) => match.capability),
          entityCount: entityMatches.length,
        });
        // Internal capability/entity detection runs AFTER chat fast-paths, capability-aware routing,
        // and research classification. The hasActionSignal guard is defensive only -- the primary
        // protection against transactional interception happens upstream.
        generatedInternalContext = await buildInternalCapabilityContext({
          query: task,
          capabilities: capabilityMatches,
          entities: entityMatches,
          walletContext,
        }) as unknown as Record<string, unknown>;
        liveData = JSON.stringify({
          internal_context: mergeInternalContext(upstreamInternalContext, generatedInternalContext),
          public_web_used: false,
        });
        pushTimingTrace(timingTrace, traceStart, 'after_internal_capability_retrieval', {
          liveDataChars: liveData.length,
          capabilities: capabilityMatches.map((match) => match.capability),
        });
      } else {
        pushTimingTrace(timingTrace, traceStart, 'before_fetch_live_data');
        liveData = await withTimeout(
          fetchLiveData(expandedTask),
          liveDataTimeout.timeoutMs,
          `Live data timed out after ${liveDataTimeout.timeoutMs / 1000}s`,
        );
        pushTimingTrace(timingTrace, traceStart, 'after_fetch_live_data', {
          liveDataChars: liveData.length,
          timeoutMs: liveDataTimeout.timeoutMs,
          queryClass: liveDataTimeout.queryClass,
        });
      }
    } catch (liveDataError) {
      pushTimingTrace(timingTrace, traceStart, 'fetch_live_data_failed', {
        error: getErrorMessage(liveDataError),
        timeoutMs: liveDataTimeout.timeoutMs,
        queryClass: liveDataTimeout.queryClass,
      });
      console.warn(`[Research ${requestId}] Live data enrichment skipped:`, getErrorMessage(liveDataError));
    }
    const asOf = new Date().toISOString();
    if (!liveData.trim() && requiresLiveEvidence(task)) {
      pushTimingTrace(timingTrace, traceStart, 'return_sparse_evidence');
      return res.json({
        task,
        queryExpansion: expandedTask,
        reasoningMode,
        result: buildSparseEvidenceResearch(task, asOf),
        liveData: {
          portfolio_impact: portfolioImpact,
          ...(walletContext && portfolioImpact ? { wallet_context: walletContext } : {}),
        },
      });
    }

    const mergedInternalContext = mergeInternalContext(upstreamInternalContext, generatedInternalContext);
    const contextBlock = mergedInternalContext
      ? `\n\nINTERNAL AGENTFLOW CONTEXT JSON:\n${JSON.stringify(mergedInternalContext, null, 2)}\n\nUse this internal context as primary evidence for private AgentFlow handles, wallets, invoices, payment requests, transactions, contacts, and reputation cache. Public web evidence is enrichment only. If public web evidence is limited, say so and still produce a risk assessment from internal evidence.`
      : '';
    const walletContextBlock = walletContext && portfolioImpact
      ? `\n\nPORTFOLIO_CONTEXT JSON:\n${JSON.stringify(walletContext, null, 2)}\n\nThe user asked about their portfolio. Use this AgentFlow DCW snapshot as private first-party exposure context. Classify what the user holds (stablecoins, volatile crypto, DeFi, Gateway, mixed) and explain impact through those asset classes. Do not expose full wallet addresses, raw balances, or PnL unless the user explicitly asks for a balance/portfolio breakdown. If the snapshot has an error or empty holdings, say that the DCW scan was unavailable or empty instead of inventing holdings.`
      : '';
    const liveDataPayload = parseLiveDataPayload(liveData);
    const currentEventsPayload =
      liveDataPayload?.current_events &&
      typeof liveDataPayload.current_events === 'object'
        ? liveDataPayload.current_events as Record<string, unknown>
        : null;
    const hasCurrentEventEvidence = Boolean(
      currentEventsPayload &&
        (Array.isArray(currentEventsPayload.articles) ||
          Array.isArray(currentEventsPayload.article_snapshots) ||
          currentEventsPayload.framing_signals),
    );
    const geopoliticalEvidenceInstruction = hasCurrentEventEvidence
      ? ' Verify the user\'s premise before accepting it. If the evidence supports only tensions, reported planning, isolated strikes, or older background context, say that plainly instead of repeating the user\'s framing. If LIVE DATA current_events framing_signals are present, follow them exactly for broader conflict status, Strait of Hormuz route status, and Red Sea route status.'
      : '';
    pushTimingTrace(timingTrace, traceStart, 'before_user_message_construction');
    const userMessage = liveData
      ? `AS OF ${asOf}\nCURRENT DATE: ${asOf.slice(0, 10)}\n\nLIVE DATA JSON:\n${liveData}${contextBlock}${walletContextBlock}\n\nUSER TASK:\n${task}\n\nSEARCH QUERY VARIANTS:\n${expandedTask}\n\nUse the LIVE DATA JSON above for current figures and dated evidence. Do not cite or mention any date after CURRENT DATE as if it has happened. When present, cite concrete titles and URLs from current_events.articles, current_events.article_snapshots, dynamic_sources.articles, wikipedia.pages, coingecko, defillama, and bitcoin_onchain; do not invent outlets. Retrieval layers are not evidence and must not be cited as sources.${geopoliticalEvidenceInstruction} When creator_audience_metrics is present, treat current_subscribers/current_subscribers_display and observed_at as direct evidence for the latest available audience count and mention that figure explicitly in the answer. When bitcoin_onchain is present, treat it as primary evidence for Bitcoin network transaction counts, block counts, fees, and on-chain activity windows; do not substitute market trading volume for on-chain transaction volume. When PORTFOLIO_CONTEXT is present, classify the user's exposure and explain impact through that exposure profile without revealing raw balances, full addresses, or PnL unless explicitly requested. Prefer official APIs, reputable publishers, Mempool.space for Bitcoin block/on-chain metrics, CoinGecko for token market data, DefiLlama for chain TVL and stablecoin liquidity, current-event article snapshots for recent developments, and Wikipedia for factual background. Use the SEARCH QUERY VARIANTS as additional source-planning angles when the topic is broad or ecosystem-focused.`
      : `${task}${contextBlock}${walletContextBlock}`;
    pushTimingTrace(timingTrace, traceStart, 'after_user_message_construction', {
      userMessageChars: userMessage.length,
      systemPromptChars: RESEARCH_SYSTEM_PROMPT.length,
    });
    console.log(
      `[Research ${requestId}] liveDataCurrentEventSnapshots=${getCurrentEventSnapshotCount(liveDataPayload)}`,
    );
    pushTimingTrace(timingTrace, traceStart, 'before_call_hermes_fast');
    const result = await withTimeout(
      callHermesFast(RESEARCH_SYSTEM_PROMPT, userMessage),
      HERMES_TIMEOUT_MS,
      `Hermes timed out after ${HERMES_TIMEOUT_MS / 1000}s`,
    );
    pushTimingTrace(timingTrace, traceStart, 'after_call_hermes_fast', {
      resultChars: result.length,
    });
    pushTimingTrace(timingTrace, traceStart, 'before_response_parsing');
    const parsedResult = parseLiveDataPayload(result);
    pushTimingTrace(timingTrace, traceStart, 'after_response_parsing', {
      parseSucceeded: !!parsedResult,
    });
    pushTimingTrace(timingTrace, traceStart, 'before_return_fast_response');
    console.log(
      `[Research ${requestId}] Completed in ${Date.now() - start}ms`,
    );
    if (RESEARCH_TIMING_TRACE && timingTraceId) {
      const outDir = path.join(process.cwd(), 'tmp', 'latency-fast-research-diagnostic');
      await mkdir(outDir, { recursive: true });
      await writeFile(
        path.join(outDir, `${timingTraceId}.research.json`),
        `${JSON.stringify(
          {
            requestId,
            timingTraceId,
            task,
            reasoningMode,
            trace: timingTrace,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }
    res.json({
      task,
      queryExpansion: expandedTask,
      reasoningMode,
      result,
      liveData: researchContext
        ? {
            ...(liveDataPayload ?? {}),
            ...(mergedInternalContext ? { internal_context: mergedInternalContext } : {}),
            portfolio_impact: portfolioImpact,
            ...(walletContext && portfolioImpact ? { wallet_context: walletContext } : {}),
          }
        : {
            ...(liveDataPayload ?? {}),
            ...(mergedInternalContext ? { internal_context: mergedInternalContext } : {}),
            portfolio_impact: portfolioImpact,
            ...(walletContext && portfolioImpact ? { wallet_context: walletContext } : {}),
          },
    });
  } catch (err) {
    const message = getErrorMessage(err);
    const statusCode = message.includes('timed out') ? 504 : 500;
    console.error(`[Research ${requestId}] Failed`, err);
    res.status(statusCode).json({
      error: 'Research agent failed',
      details: message,
      requestId,
    });
  }
};

app.get('/run', internalKeyMiddleware, guardPayment, runHandler);
app.post('/run', internalKeyMiddleware, guardPayment, runHandler);

async function start(): Promise<void> {
  const sellerAddress = await resolveAgentSellerAddress({
    agentSlug: 'research',
    preferredEnvKeys: ['RESEARCH_SELLER_ADDRESS'],
    fallbackEnvKeys: ['SELLER_ADDRESS'],
    fallbackAddress: account.address,
  });
  gateway = createGatewayMiddleware({
    sellerAddress,
    facilitatorUrl,
  });

  app.listen(port, () => {
    console.log(`Research agent running on :${port} seller=${sellerAddress}`);
  });
}

void start().catch((err) => {
  console.error('Research agent failed to start:', err);
  process.exit(1);
});
