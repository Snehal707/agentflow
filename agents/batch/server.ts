import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import { previewBatch, executeBatch } from './batch-agent';
import { resolveAgentRunUrl, runPortfolioFollowupAfterTool } from '../../lib/a2a-followups';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.BATCH_AGENT_PORT || 3020);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.BATCH_AGENT_PRICE ? `$${process.env.BATCH_AGENT_PRICE}` : '$0.01';

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

const portfolioPort = Number(process.env.PORTFOLIO_AGENT_PORT || 3014);
const portfolioRunUrl = resolveAgentRunUrl(
  process.env.PORTFOLIO_AGENT_URL?.trim(),
  `http://127.0.0.1:${portfolioPort}/run`,
);
const portfolioPriceLabel = (() => {
  const n = Number(process.env.PORTFOLIO_AGENT_PRICE ?? '0.015');
  return `$${Number.isFinite(n) ? n.toFixed(3) : '0.015'}`;
})();

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'batch', port });
});

const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await checkRateLimit({
      walletAddress: auth.walletAddress,
      agentSlug: 'batch',
      actionType: 'batch_run',
      amountUsd: 0,
    });
    if (!result.allowed) {
      res.status(429).json({ error: `Rate limited: ${result.reason}` });
      return;
    }
    next();
  } catch (error) {
    res.status(500).json({ error: toMessage(error) });
  }
};

const internalKeyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const reqKey = (req.headers['x-agentflow-brain-internal'] as string | undefined)?.trim();
  if (internalKey && reqKey === internalKey) {
    (req as any).auth = {
      walletAddress: req.body?.walletAddress || '',
      accessModel: 'pay_per_task',
      exp: 0,
    };
    (req as any)._internalAuth = true;
  }
  next();
};

const guardAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    next();
    return;
  }
  authMiddleware(req, res, next);
};

const guardRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    next();
    return;
  }
  await rateLimitMiddleware(req, res, next);
};

/**
 * POST /run
 * Body: { sessionId: string, walletAddress: string, payments: BatchPayment[] }
 * Returns BatchAgentResponse (action: 'preview' | 'error')
 */
app.post(
  '/run',
  internalKeyMiddleware,
  guardAuthMiddleware,
  guardRateLimitMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    if ((req as any)._internalAuth) { next(); return; }
    return gateway.require(price)(req, res, next);
  },
  async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    const sessionId = String(req.body?.sessionId ?? '').trim();
    const walletAddress = String(req.body?.walletAddress ?? auth.walletAddress ?? '').trim();
    const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];

    if (!walletAddress) {
      return res.status(400).json({ action: 'error', message: 'walletAddress is required' });
    }
    if (walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
      return res.status(403).json({ action: 'error', message: 'walletAddress must match authenticated wallet' });
    }
    if (!payments.length) {
      return res.status(400).json({ action: 'error', message: 'payments array is required' });
    }

    if (req.body?.benchmark === true) {
      console.log('[benchmark] batch short-circuit');
      return res.json({
        ok: true,
        benchmark: true,
        agent: 'batch',
        result: 'Benchmark mode - payment logged',
      });
    }

    try {
      const result = await previewBatch({ sessionId, walletAddress, payments });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ action: 'error', message: toMessage(error) });
    }
  },
);

/**
 * POST /confirm/:confirmId
 * Body: { walletAddress: string }
 * Returns BatchAgentResponse (action: 'success' | 'error')
 */
app.post(
  '/confirm/:confirmId',
  paidInternalOrAuthMiddleware,
  guardRateLimitMiddleware,
  gateway.require(price),
  async (req: Request, res: Response) => {
  const auth = (req as any).auth as JWTPayload;
  const { confirmId } = req.params;
  const walletAddress = String(req.body?.walletAddress ?? auth.walletAddress ?? '').trim();
  const suppressPortfolioFollowup = Boolean(req.body?.suppressPortfolioFollowup);

  if (!confirmId) {
    return res.status(400).json({ action: 'error', message: 'confirmId is required' });
  }
  if (!walletAddress) {
    return res.status(400).json({ action: 'error', message: 'walletAddress is required' });
  }

  try {
    const result = await executeBatch(confirmId, walletAddress);
    if (result.action === 'success' && !suppressPortfolioFollowup) {
      setImmediate(() => {
        void (async () => {
          try {
            await runPortfolioFollowupAfterTool({
              buyerAgentSlug: 'batch',
              userWalletAddress: walletAddress,
              portfolioRunUrl,
              portfolioPriceLabel,
              trigger: 'post_batch_confirm',
              details: { confirmId },
            });
          } catch (e) {
            console.warn('[a2a] batch→portfolio hook failed:', toMessage(e));
          }
        })();
      });
    }
    const status = result.action === 'error' ? 400 : 200;
    return res.status(status).json(result);
  } catch (error) {
    return res.status(500).json({ action: 'error', message: toMessage(error) });
  }
});

app.listen(port, () => {
  console.log(`Batch agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
