import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import {
  previewSplit,
  executeSplit,
} from './split-agent';
import { resolveAgentRunUrl, runPortfolioFollowupAfterTool } from '../../lib/a2a-followups';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.SPLIT_AGENT_PORT || 3019);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.SPLIT_AGENT_PRICE ? `$${process.env.SPLIT_AGENT_PRICE}` : '$0.005';

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
  res.status(200).json({ status: 'ok', agent: 'split' });
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
      agentSlug: 'split',
      actionType: 'split_run',
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

/** Auth middleware that skips JWT check when internalKeyMiddleware already set auth. */
const guardAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    next();
    return;
  }
  authMiddleware(req, res, next);
};

/** Rate limit / x402 middleware that skips for internal key requests. */
const guardRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    next();
    return;
  }
  await rateLimitMiddleware(req, res, next);
};

/**
 * POST /run
 * Body: { sessionId: string, walletAddress: string, recipients: string[], totalAmount: string, perPerson?: string, remark?: string }
 * Returns SplitAgentResponse
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
    const recipients: string[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    const totalAmount = String(req.body?.totalAmount ?? '').trim();
    const remark = String(req.body?.remark ?? '').trim() || undefined;

    if (!walletAddress) {
      return res.status(400).json({ action: 'error', message: 'walletAddress is required' });
    }
    if (walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
      return res.status(403).json({ action: 'error', message: 'walletAddress must match authenticated wallet' });
    }
    if (!recipients.length) {
      return res.status(400).json({ action: 'error', message: 'recipients array is required' });
    }
    if (!totalAmount) {
      return res.status(400).json({ action: 'error', message: 'totalAmount is required' });
    }

    if (req.body?.benchmark === true) {
      console.log('[benchmark] split short-circuit');
      return res.json({
        ok: true,
        benchmark: true,
        agent: 'split',
        result: 'Benchmark mode - payment logged',
      });
    }

    try {
      const result = await previewSplit({ sessionId, walletAddress, recipients, totalAmount, remark });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ action: 'error', message: toMessage(error) });
    }
  },
);

/**
 * POST /confirm/:confirmId
 * Body: { walletAddress: string }
 * Returns SplitAgentResponse (action: 'success' | 'error')
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
    const result = await executeSplit(confirmId, walletAddress);
    if (result.action === 'success' && !suppressPortfolioFollowup) {
      setImmediate(() => {
        void (async () => {
          try {
            await runPortfolioFollowupAfterTool({
              buyerAgentSlug: 'split',
              userWalletAddress: walletAddress,
              portfolioRunUrl,
              portfolioPriceLabel,
              trigger: 'post_split_confirm',
              details: { confirmId },
            });
          } catch (e) {
            console.warn('[a2a] split→portfolio hook failed:', toMessage(e));
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
  console.log(`Split agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
