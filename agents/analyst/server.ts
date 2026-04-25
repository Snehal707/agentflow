import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { callHermesDeep, callHermesFast } from '../../lib/hermes';
import { ANALYST_SYSTEM_PROMPT } from '../../lib/agentPrompts';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { resolveAgentSellerAddress } from '../../lib/agentSellerAddress';
import { buildAnalystModelInput } from '../../lib/reportInputs';
import { inferResearchReasoningMode } from '../../lib/researchMode';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.ANALYST_AGENT_PORT || 3002);
const HERMES_TIMEOUT_MS = Number(
  process.env.ANALYST_HERMES_TIMEOUT_MS ||
  process.env.ANALYST_AGENT_TIMEOUT_MS ||
  process.env.AGENT_TIMEOUT_MS ||
  80_000,
);
const account = privateKeyToAccount(resolveAgentPrivateKey());

const price =
  process.env.ANALYST_AGENT_PRICE !== undefined
    ? `$${process.env.ANALYST_AGENT_PRICE}`
    : '$0.003';

const facilitatorUrl = getFacilitatorBaseUrl();
const internalBrainKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
let gateway: ReturnType<typeof createGatewayMiddleware>;

type InternalRequest = Request & { _internalAuth?: boolean };

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'analyst' });
});

function safeParseObject(value: string): Record<string, unknown> | null {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

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

const internalKeyMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const reqKey =
    typeof req.headers['x-agentflow-brain-internal'] === 'string'
      ? req.headers['x-agentflow-brain-internal'].trim()
      : '';
  if (internalBrainKey && reqKey === internalBrainKey) {
    (req as InternalRequest)._internalAuth = true;
  }
  next();
};

const maybeRequirePayment = (req: Request, res: Response, next: NextFunction) => {
  if ((req as InternalRequest)._internalAuth) {
    next();
    return;
  }
  return gateway.require(price)(req, res, next);
};

const runHandler = async (req: Request, res: Response) => {
  try {
    if (req.body?.benchmark === true || req.query?.benchmark === 'true') {
      console.log('[benchmark] analyst short-circuit');
      return res.json({
        ok: true,
        benchmark: true,
        agent: 'analyst',
        result: 'Benchmark mode - payment logged',
      });
    }
    const research =
      (req.body?.research as string) ?? (req.query.research as string) ?? '';
    const task = (req.body?.task as string) ?? (req.query.task as string) ?? '';
    const researchJson =
      (req.body?.researchJson as Record<string, unknown> | undefined) ??
      safeParseObject(research);
    const liveData =
      (req.body?.liveData as Record<string, unknown> | undefined) ?? null;
    const reasoningMode = inferResearchReasoningMode({
      task,
      explicitMode: req.body?.reasoningMode ?? req.query.reasoningMode,
      deepResearch: req.body?.deepResearch ?? req.query.deepResearch,
      defaultMode: 'fast',
    });
    const analystInput = buildAnalystModelInput({
      task,
      researchText: research,
      research: researchJson,
      liveData,
    });
    const result = await withTimeout(
      reasoningMode === 'deep'
        ? callHermesDeep(ANALYST_SYSTEM_PROMPT, analystInput)
        : callHermesFast(ANALYST_SYSTEM_PROMPT, analystInput),
      HERMES_TIMEOUT_MS,
      `Analyst Hermes timed out after ${HERMES_TIMEOUT_MS / 1000}s`,
    );
    res.json({ research, reasoningMode, result });
  } catch (err) {
    console.error('Analyst agent error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('timed out') ? 504 : 500;
    res.status(statusCode).json({ error: 'Analyst agent failed', details: message });
  }
};
app.get('/run', internalKeyMiddleware, maybeRequirePayment, runHandler);
app.post('/run', internalKeyMiddleware, maybeRequirePayment, runHandler);

async function start(): Promise<void> {
  const sellerAddress = await resolveAgentSellerAddress({
    agentSlug: 'analyst',
    preferredEnvKeys: ['ANALYST_SELLER_ADDRESS'],
    fallbackEnvKeys: ['SELLER_ADDRESS'],
    fallbackAddress: account.address,
  });
  gateway = createGatewayMiddleware({
    sellerAddress,
    facilitatorUrl,
  });

  app.listen(port, () => {
    console.log(`Analyst agent running on :${port} seller=${sellerAddress}`);
  });
}

void start().catch((err) => {
  console.error('Analyst agent failed to start:', err);
  process.exit(1);
});
