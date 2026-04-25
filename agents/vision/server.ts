import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { analyzeAttachmentForChat } from '../../lib/mediaAgentUtils';
import { getOrCreateAgentWallets } from '../../lib/dcw';
import { recordReputationSafe } from '../../lib/reputation';
import { incrementDailyUsageCap, readDailyUsageCap } from '../../lib/usageCaps';
import { resolveAgentRunUrl, runResearchFollowupAfterRichContent } from '../../lib/a2a-followups';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json({ limit: process.env.AGENT_JSON_LIMIT?.trim() || '20mb' }));

const port = Number(process.env.VISION_AGENT_PORT || 3016);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.VISION_AGENT_PRICE ? `$${process.env.VISION_AGENT_PRICE}` : '$0.004';
const dailyLimit = Number(process.env.VISION_DAILY_LIMIT || 5);
const researchPort = Number(process.env.RESEARCH_AGENT_PORT || 3001);
const researchRunUrl = resolveAgentRunUrl(
  process.env.RESEARCH_AGENT_URL?.trim(),
  `http://127.0.0.1:${researchPort}/run`,
);
const researchPriceLabel = (() => {
  const n = Number(process.env.RESEARCH_AGENT_PRICE ?? '0.005');
  return `$${Number.isFinite(n) ? n.toFixed(3) : '0.005'}`;
})();

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

function classifyVisionScore(result: {
  answer: string;
  extractor: 'hermes' | 'hermes-text' | 'openai-fallback';
}): number {
  const answer = result.answer.trim();
  if (!answer) {
    return 20;
  }
  if (result.extractor === 'openai-fallback') {
    return 60;
  }
  return 90;
}

async function recordVisionReputation(score: number): Promise<void> {
  try {
    const { ownerWallet, validatorWallet } = await getOrCreateAgentWallets('vision');
    if (!ownerWallet.erc8004_token_id) {
      return;
    }
    await recordReputationSafe(
      ownerWallet.erc8004_token_id,
      score,
      'vision_analysis',
      validatorWallet.address,
    );
  } catch (error) {
    console.warn('[vision] reputation skipped:', toMessage(error));
  }
}

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'vision' });
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
      agentSlug: 'vision',
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
      res.status(400).json({ error: 'walletAddress is required for internal vision calls' });
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
    const attachment = req.body?.attachment;
    if (!attachment || typeof attachment !== 'object') {
      return res.status(400).json({ error: 'attachment is required' });
    }

    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const usage = await readDailyUsageCap({
      scope: 'vision',
      walletAddress: auth.walletAddress,
      limit: dailyLimit,
    });
    if (usage.used >= dailyLimit) {
      return res.status(429).json({
        error: `Daily attachment cap reached (${dailyLimit}/${dailyLimit}).`,
      });
    }

    next();
  } catch (error) {
    return res.status(400).json({ error: toMessage(error) });
  }
};

const guardPreflightMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    const attachment = req.body?.attachment;
    if (!attachment || typeof attachment !== 'object') {
      res.status(400).json({ error: 'attachment is required' });
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
        console.log('[benchmark] vision short-circuit');
        return res.json({
          ok: true,
          benchmark: true,
          agent: 'vision',
          result: 'Benchmark mode - payment logged',
        });
      }
      const prompt =
        typeof req.body?.prompt === 'string' && req.body.prompt.trim()
          ? req.body.prompt.trim()
          : undefined;

      const result = await analyzeAttachmentForChat({
        attachment: req.body.attachment,
        prompt,
      });
      let answer = result.answer;

      const cap = (req as any)._internalAuth
        ? await readDailyUsageCap({
            scope: 'vision',
            walletAddress: auth.walletAddress,
            limit: dailyLimit,
          })
        : await incrementDailyUsageCap({
            scope: 'vision',
            walletAddress: auth.walletAddress,
            limit: dailyLimit,
          });

      await recordVisionReputation(
        classifyVisionScore({
          answer: result.answer,
          extractor: result.extractor,
        }),
      );

      const wantsResearchInResponse =
        Boolean(prompt) && /\b(?:research|report|analysis|analyze|investigate|a2a|market|defi|crypto)\b/i.test(prompt || '');

      if (!(req as any)._internalAuth && wantsResearchInResponse) {
        try {
          const researchPayload = await runResearchFollowupAfterRichContent({
            buyerAgentSlug: 'vision',
            text: result.answer,
            researchRunUrl,
            researchPriceLabel,
          });
          if (researchPayload) {
            const task = typeof researchPayload.task === 'string' ? researchPayload.task.trim() : '';
            const report = typeof researchPayload.result === 'string' ? researchPayload.result.trim() : '';
            answer = [
              answer,
              '',
              '---',
              '',
              'A2A complete: Vision Agent -> Research Agent',
              task ? `Task: ${task}` : '',
              report ? ['', report].join('\n') : '',
            ].filter(Boolean).join('\n');
          }
        } catch (e) {
          answer = `${answer}\n\nA2A vision research failed: ${toMessage(e)}`;
          console.warn('[a2a] visionâ†’research hook failed:', toMessage(e));
        }
      } else if (!(req as any)._internalAuth) {
        setImmediate(() => {
          void (async () => {
            try {
              await runResearchFollowupAfterRichContent({
                buyerAgentSlug: 'vision',
                text: result.answer,
                researchRunUrl,
                researchPriceLabel,
              });
            } catch (e) {
              console.warn('[a2a] vision→research hook failed:', toMessage(e));
            }
          })();
        });
      }

      return res.json({
        success: true,
        answer,
        sourceType: result.sourceType,
        extractor: result.extractor,
        notes: result.notes,
        usage: {
          usedToday: cap.used,
          dailyLimit: cap.limit,
        },
      });
    } catch (error) {
      await recordVisionReputation(20);
      return res.status(500).json({
        success: false,
        error: toMessage(error),
      });
    }
  },
);

app.listen(port, () => {
  console.log(`Vision agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
