import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { callHermesDeep, callHermesFast } from '../../lib/hermes';
import { RESEARCH_SYSTEM_PROMPT } from '../../lib/agentPrompts';
import { fetchLiveData } from '../../lib/live-data';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { resolveAgentSellerAddress } from '../../lib/agentSellerAddress';
import { inferResearchReasoningMode } from '../../lib/researchMode';
import { selectSources } from '../../lib/source-registry';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import {
  formatCounterpartyRiskReport,
  type CounterpartyRiskAssessment,
} from '../../lib/counterparty-risk';

dotenv.config();

const app = express();
app.use(express.json());
const HERMES_TIMEOUT_MS = Number(process.env.RESEARCH_HERMES_TIMEOUT_MS || 140_000);
const LIVE_DATA_TIMEOUT_MS = Number(process.env.RESEARCH_LIVE_DATA_TIMEOUT_MS || 45_000);

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

function getCurrentEventSnapshotCount(payload: Record<string, unknown> | null): number {
  const currentEvents = payload?.current_events;
  if (!currentEvents || typeof currentEvents !== 'object') {
    return 0;
  }

  const snapshots = (currentEvents as { article_snapshots?: unknown }).article_snapshots;
  return Array.isArray(snapshots) ? snapshots.length : 0;
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

function expandQuery(task: string): string {
  const queries: string[] = [];
  const addQuery = (query: string) => {
    const value = query.trim();
    if (!value || queries.includes(value)) return;
    queries.push(value);
  };

  addQuery(task);

  const lowerTask = task.toLowerCase();
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

function requiresLiveEvidence(task: string): boolean {
  return /\b(current|latest|today|right now|ongoing|war|conflict|ceasefire|strike|iran|israel|russia|ukraine|hormuz|red sea|geopolitical)\b/i.test(
    task,
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
      'Current-event evidence is required for war, geopolitics, and market-impact claims.',
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
  gateway.require(price)(req, res, next);
};

const runHandler = async (req: express.Request, res: express.Response) => {
  const requestId = `research_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const start = Date.now();
  try {
    const task = (req.body?.task as string) ?? (req.query.task as string) ?? '';
    if (!task.trim()) {
      return res.status(400).json({ error: 'Task is required', requestId });
    }
    if (req.body?.benchmark === true || req.query?.benchmark === 'true') {
      console.log('[benchmark] research short-circuit');
      return res.json({
        ok: true,
        benchmark: true,
        agent: 'research',
        result: 'Benchmark mode - payment logged',
      });
    }
    const researchContext =
      typeof req.body?.researchContext === 'string' && req.body.researchContext.trim()
        ? req.body.researchContext.trim()
        : '';
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
        `[Research ${requestId}] ${req.method} /run taskLength=${task.length} reasoningMode=deep retrieval=firecrawl`,
      );
      try {
        const deep = await withTimeout(
          runDeepResearchCore({
            task,
            walletContext: walletContext ?? undefined,
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
            result: deep.result,
            liveData: {
              source: 'Firecrawl search and scrape',
              source_count: deep.sources.length,
              sources: deep.sources.slice(0, 25),
              liveFacts: deep.liveFacts,
              ...(walletContext ? { wallet_context: walletContext } : {}),
            },
          });
        }
        console.warn(
          `[Research ${requestId}] Firecrawl returned zero relevant sources; falling back to live data/API research.`,
        );
      } catch (deepError) {
        console.warn(
          `[Research ${requestId}] Firecrawl deep retrieval failed; falling back to live data/API research:`,
          getErrorMessage(deepError),
        );
      }
    }

    console.log(
      `[Research ${requestId}] ${req.method} /run taskLength=${task.length} reasoningMode=${reasoningMode}`,
    );

    const selectedSources = selectSources(task, 5);
    console.log(
      `[research] sources: ${selectedSources.map((s) => s.name).join(', ')}`,
    );

    let liveData = '';
    try {
      liveData = await withTimeout(
        fetchLiveData(expandedTask),
        LIVE_DATA_TIMEOUT_MS,
        `Live data timed out after ${LIVE_DATA_TIMEOUT_MS / 1000}s`,
      );
    } catch (liveDataError) {
      console.warn(`[Research ${requestId}] Live data enrichment skipped:`, getErrorMessage(liveDataError));
    }
    const asOf = new Date().toISOString();
    if (!liveData.trim() && requiresLiveEvidence(task)) {
      return res.json({
        task,
        queryExpansion: expandedTask,
        reasoningMode,
        result: buildSparseEvidenceResearch(task, asOf),
        liveData: walletContext ? { wallet_context: walletContext } : null,
      });
    }

    const contextBlock = researchContext
      ? `\n\nINTERNAL AGENTFLOW CONTEXT JSON:\n${researchContext}\n\nUse this internal context as primary evidence for private AgentFlow handles, wallets, invoices, payment requests, transactions, contacts, and reputation cache. Public web evidence is enrichment only. If public web evidence is limited, say so and still produce a risk assessment from internal evidence.`
      : '';
    const walletContextBlock = walletContext
      ? `\n\nPORTFOLIO_CONTEXT JSON:\n${JSON.stringify(walletContext, null, 2)}\n\nThe user asked about their portfolio. Use this AgentFlow DCW snapshot as private first-party exposure context. Classify what the user holds (stablecoins, volatile crypto, DeFi, Gateway, mixed) and explain impact through those asset classes. Do not expose full wallet addresses, raw balances, or PnL unless the user explicitly asks for a balance/portfolio breakdown. If the snapshot has an error or empty holdings, say that the DCW scan was unavailable or empty instead of inventing holdings.`
      : '';
    const userMessage = liveData
      ? `AS OF ${asOf}\nCURRENT DATE: ${asOf.slice(0, 10)}\n\nLIVE DATA JSON:\n${liveData}${contextBlock}${walletContextBlock}\n\nUSER TASK:\n${task}\n\nSEARCH QUERY VARIANTS:\n${expandedTask}\n\nUse the LIVE DATA JSON above for current figures and dated evidence. Do not cite or mention any date after CURRENT DATE as if it has happened. When present, cite concrete titles and URLs from current_events.articles, current_events.article_snapshots, dynamic_sources.articles, wikipedia.pages, coingecko, and defillama; do not invent outlets. The source registry is only a search planner and must not be cited as evidence. Verify the user's premise before accepting it. If the evidence supports only tensions, reported planning, isolated strikes, or older background context, say that plainly instead of repeating the user's framing. If LIVE DATA current_events framing_signals are present, follow them exactly for broader conflict status, Strait of Hormuz route status, and Red Sea route status. When PORTFOLIO_CONTEXT is present, classify the user's exposure and explain impact through that exposure profile without revealing raw balances, full addresses, or PnL unless explicitly requested. Prefer CoinGecko for token market data, DefiLlama for chain TVL and stablecoin liquidity, current-event article snapshots for recent developments, Wikipedia for factual background, and DuckDuckGo for supporting context. Use the SEARCH QUERY VARIANTS as additional search angles when the topic is broad or ecosystem-focused.`
      : `${task}${contextBlock}${walletContextBlock}`;
    const liveDataPayload = parseLiveDataPayload(liveData);
    console.log(
      `[Research ${requestId}] liveDataCurrentEventSnapshots=${getCurrentEventSnapshotCount(liveDataPayload)}`,
    );
    const result = await withTimeout(
      callHermesFast(RESEARCH_SYSTEM_PROMPT, userMessage),
      HERMES_TIMEOUT_MS,
      `Hermes timed out after ${HERMES_TIMEOUT_MS / 1000}s`,
    );
    console.log(
      `[Research ${requestId}] Completed in ${Date.now() - start}ms`,
    );
    res.json({
      task,
      queryExpansion: expandedTask,
      reasoningMode,
      result,
      liveData: researchContext
        ? {
            ...(liveDataPayload ?? {}),
            internal_context: parseLiveDataPayload(researchContext),
            ...(walletContext ? { wallet_context: walletContext } : {}),
          }
        : {
            ...(liveDataPayload ?? {}),
            ...(walletContext ? { wallet_context: walletContext } : {}),
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
