import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { transcribeAudioForChat, validateAudioPayloadForTranscription } from '../../lib/mediaAgentUtils';
import { getOrCreateAgentWallets } from '../../lib/dcw';
import { recordReputationSafe } from '../../lib/reputation';
import { incrementDailyUsageCap, readDailyUsageCap } from '../../lib/usageCaps';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json({ limit: process.env.AGENT_JSON_LIMIT?.trim() || '20mb' }));

const port = Number(process.env.TRANSCRIBE_AGENT_PORT || 3017);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.TRANSCRIBE_AGENT_PRICE
  ? `$${process.env.TRANSCRIBE_AGENT_PRICE}`
  : '$0.002';
const dailyLimit = Number(process.env.TRANSCRIBE_DAILY_LIMIT || 5);

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

function classifyTranscribeScore(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 20;
  }
  if (normalized.length < 12) {
    return 60;
  }
  return 90;
}

async function recordTranscribeReputation(score: number): Promise<void> {
  try {
    const { ownerWallet, validatorWallet } = await getOrCreateAgentWallets('transcribe');
    if (!ownerWallet.erc8004_token_id) {
      return;
    }
    await recordReputationSafe(
      ownerWallet.erc8004_token_id,
      score,
      'transcribe_audio',
      validatorWallet.address,
    );
  } catch (error) {
    console.warn('[transcribe] reputation skipped:', toMessage(error));
  }
}

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'transcribe' });
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
      agentSlug: 'transcribe',
      actionType: 'analysis',
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
    const walletAddress = String(req.body?.walletAddress || '').trim();
    if (!isAddress(walletAddress)) {
      res.status(400).json({ error: 'walletAddress is required for internal transcribe calls' });
      return;
    }
    (req as any).auth = {
      walletAddress,
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
  paidInternalOrAuthMiddleware(req, res, next);
};

const guardRateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    next();
    return;
  }
  await rateLimitMiddleware(req, res, next);
};

const preflightMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.body?.audio || typeof req.body.audio !== 'object') {
      return res.status(400).json({ error: 'audio is required' });
    }
    validateAudioPayloadForTranscription(req.body.audio);

    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const usage = await readDailyUsageCap({
      scope: 'transcribe',
      walletAddress: auth.walletAddress,
      limit: dailyLimit,
    });
    if (usage.used >= dailyLimit) {
      return res.status(429).json({
        error: `Daily voice transcription cap reached (${dailyLimit}/${dailyLimit}).`,
      });
    }

    next();
  } catch (error) {
    return res.status(400).json({ error: toMessage(error) });
  }
};

const guardPreflightMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    const benchmarkText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (benchmarkText) {
      next();
      return;
    }
    if (!req.body?.audio || typeof req.body.audio !== 'object') {
      res.status(400).json({ error: 'audio is required' });
      return;
    }
    next();
    return;
  }
  await preflightMiddleware(req, res, next);
};

const guardGatewayMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    next();
    return;
  }
  return gateway.require(price)(req, res, next);
};

app.post(
  '/run',
  internalKeyMiddleware,
  guardAuthMiddleware,
  guardRateLimitMiddleware,
  guardPreflightMiddleware,
  guardGatewayMiddleware,
  async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    try {
      if (req.body?.benchmark === true) {
        console.log('[benchmark] transcribe short-circuit');
        return res.json({
          ok: true,
          benchmark: true,
          agent: 'transcribe',
          result: 'Benchmark mode - payment logged',
        });
      }
      const benchmarkText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const result = benchmarkText && (req as any)._internalAuth
        ? {
            text: benchmarkText,
            model: 'benchmark-text',
          }
        : await transcribeAudioForChat({
            audio: req.body.audio,
          });

      const cap = await incrementDailyUsageCap({
        scope: 'transcribe',
        walletAddress: auth.walletAddress,
        limit: dailyLimit,
      });

      await recordTranscribeReputation(classifyTranscribeScore(result.text));

      return res.json({
        success: true,
        text: result.text,
        model: result.model,
        usage: {
          usedToday: cap.used,
          dailyLimit: cap.limit,
        },
      });
    } catch (error) {
      await recordTranscribeReputation(20);
      const message = toMessage(error);
      const status = message.includes('Mic captured near-silence') ? 400 : 500;
      return res.status(status).json({
        success: false,
        error: message,
      });
    }
  },
);

app.listen(port, () => {
  console.log(`Transcribe agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
