import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { getScheduledPayments, cancelScheduledPayment } from '../../lib/scheduled-payments';
import {
  handleScheduleTask,
  handleScheduleConfirm,
} from './schedule-agent';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.SCHEDULE_AGENT_PORT || 3018);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.SCHEDULE_AGENT_PRICE ? `$${process.env.SCHEDULE_AGENT_PRICE}` : '$0.005';

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'schedule' });
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
      agentSlug: 'schedule',
      actionType: 'schedule_task',
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

// Internal key middleware — accepts requests from server.ts brain chat handler
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
  if ((req as any)._internalAuth) { next(); return; }
  authMiddleware(req, res, next);
};

/** Rate limit middleware that skips for internal key requests. */
const guardRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) { next(); return; }
  await rateLimitMiddleware(req, res, next);
};

/**
 * POST /run
 * Body: { task: string, walletAddress: string }
 * Returns ScheduleAgentResponse
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
    const task = String(req.body?.task ?? '').trim();
    const walletAddress = String(req.body?.walletAddress ?? auth.walletAddress ?? '').trim();

    if (!task) {
      return res.status(400).json({ action: 'error', message: 'task is required' });
    }
    if (!walletAddress) {
      return res.status(400).json({ action: 'error', message: 'walletAddress is required' });
    }
    if (walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
      return res.status(400).json({ action: 'error', message: 'walletAddress must match authenticated wallet' });
    }

    if (req.body?.benchmark === true) {
      console.log('[benchmark] schedule short-circuit');
      return res.json({
        ok: true,
        benchmark: true,
        agent: 'schedule',
        result: 'Benchmark mode - payment logged',
      });
    }

    try {
      const result = await handleScheduleTask(task, walletAddress);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ action: 'error', message: toMessage(error) });
    }
  },
);

/**
 * POST /confirm/:confirmId
 * Body: { walletAddress: string }
 * Returns { success: boolean, message: string }
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

  if (!confirmId) {
    return res.status(400).json({ success: false, message: 'confirmId is required' });
  }
  if (!walletAddress) {
    return res.status(400).json({ success: false, message: 'walletAddress is required' });
  }

  try {
    const result = await handleScheduleConfirm(confirmId, walletAddress);
    const status = result.success ? 200 : 400;
    return res.status(status).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: toMessage(error) });
  }
});

/**
 * GET /list
 * Returns active scheduled payments for the authenticated wallet
 */
app.get('/list', internalKeyMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const auth = (req as any).auth as JWTPayload;
  const walletAddress = String(req.query.walletAddress ?? auth.walletAddress ?? '').trim();

  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  try {
    const payments = await getScheduledPayments(walletAddress);
    return res.json({ payments });
  } catch (error) {
    return res.status(500).json({ error: toMessage(error) });
  }
});

/**
 * DELETE /cancel/:id
 * Cancels a specific scheduled payment
 */
app.delete('/cancel/:id', internalKeyMiddleware, authMiddleware, async (req: Request, res: Response) => {
  const auth = (req as any).auth as JWTPayload;
  const { id } = req.params;
  const walletAddress = String(req.body?.walletAddress ?? auth.walletAddress ?? '').trim();

  if (!id) {
    return res.status(400).json({ success: false, message: 'id is required' });
  }
  if (!walletAddress) {
    return res.status(400).json({ success: false, message: 'walletAddress is required' });
  }

  try {
    await cancelScheduledPayment(id, walletAddress);
    return res.json({ success: true, message: `Scheduled payment ${id} cancelled.` });
  } catch (error) {
    return res.status(500).json({ success: false, message: toMessage(error) });
  }
});

app.listen(port, () => {
  console.log(`Schedule agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
