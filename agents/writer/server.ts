import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { callHermesDeep } from '../../lib/hermes';
import { WRITER_SYSTEM_PROMPT } from '../../lib/agentPrompts';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { resolveAgentSellerAddress } from '../../lib/agentSellerAddress';
import { buildWriterModelInput } from '../../lib/reportInputs';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.WRITER_AGENT_PORT || 3003);
const HERMES_TIMEOUT_MS = Number(
  process.env.WRITER_HERMES_TIMEOUT_MS ||
  process.env.WRITER_AGENT_TIMEOUT_MS ||
  process.env.AGENT_TIMEOUT_MS ||
  80_000,
);
const account = privateKeyToAccount(resolveAgentPrivateKey());

const price =
  process.env.WRITER_AGENT_PRICE !== undefined
    ? `$${process.env.WRITER_AGENT_PRICE}`
    : '$0.008';

const facilitatorUrl = getFacilitatorBaseUrl();
const internalBrainKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim() || '';
let gateway: ReturnType<typeof createGatewayMiddleware>;

type InternalRequest = Request & { _internalAuth?: boolean };

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'writer' });
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
      console.log('[benchmark] writer short-circuit');
      return res.json({
        ok: true,
        benchmark: true,
        agent: 'writer',
        result: 'Benchmark mode - payment logged',
      });
    }
    const research =
      (req.body?.research as string) ?? (req.query.research as string) ?? '';
    const analysis =
      (req.body?.analysis as string) ?? (req.query.analysis as string) ?? '';
    const task = (req.body?.task as string) ?? (req.query.task as string) ?? '';
    const researchJson =
      (req.body?.researchJson as Record<string, unknown> | undefined) ??
      safeParseObject(research);
    const analysisJson =
      (req.body?.analysisJson as Record<string, unknown> | undefined) ??
      safeParseObject(analysis);
    const liveData =
      (req.body?.liveData as Record<string, unknown> | undefined) ?? null;
    const combinedInput = buildWriterModelInput({
      task,
      researchText: research,
      analysisText: analysis,
      research: researchJson,
      analysis: analysisJson,
      liveData,
    });

    const result = await withTimeout(
      callHermesDeep(WRITER_SYSTEM_PROMPT, combinedInput),
      HERMES_TIMEOUT_MS,
      `Writer Hermes timed out after ${HERMES_TIMEOUT_MS / 1000}s`,
    );
    res.json({ research, analysis, result });
  } catch (err) {
    console.error('Writer agent error:', err);
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('timed out') ? 504 : 500;
    res.status(statusCode).json({ error: 'Writer agent failed', details: message });
  }
};

app.get('/run', internalKeyMiddleware, maybeRequirePayment, runHandler);
app.post('/run', internalKeyMiddleware, maybeRequirePayment, runHandler);

async function start(): Promise<void> {
  const sellerAddress = await resolveAgentSellerAddress({
    agentSlug: 'writer',
    preferredEnvKeys: ['WRITER_SELLER_ADDRESS'],
    fallbackEnvKeys: ['SELLER_ADDRESS'],
    fallbackAddress: account.address,
  });
  gateway = createGatewayMiddleware({
    sellerAddress,
    facilitatorUrl,
  });

  app.listen(port, () => {
    console.log(`Writer agent running on :${port} seller=${sellerAddress}`);
  });
}

void start().catch((err) => {
  console.error('Writer agent failed to start:', err);
  process.exit(1);
});
