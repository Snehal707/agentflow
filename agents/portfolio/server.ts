import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { getAddress, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import { getOrCreateUserAgentWallet } from '../../lib/dcw';
import {
  buildPortfolioSnapshot,
  buildPortfolioQuickSummary,
  generatePortfolioAssessment,
} from './portfolio';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.PORTFOLIO_AGENT_PORT || 3014);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.PORTFOLIO_AGENT_PRICE ? `$${process.env.PORTFOLIO_AGENT_PRICE}` : '$0.015';

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'portfolio' });
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
      agentSlug: 'portfolio',
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
    (req as any).auth = {
      walletAddress: String(req.body?.walletAddress || '').trim(),
      accessModel: 'pay_per_task',
      exp: 0,
    };
    (req as any)._internalAuth = true;
  }
  next();
};

const a2aInternalMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const reqKey = (req.headers['x-agentflow-a2a'] as string | undefined)?.trim();
  if (internalKey && reqKey === internalKey) {
    (req as any)._a2aInternal = true;
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
  if ((req as any)._internalAuth || (req as any)._a2aInternal) {
    next();
    return;
  }
  await rateLimitMiddleware(req, res, next);
};

const guardGatewayMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if ((req as any)._internalAuth) {
    const wa = String(req.body?.walletAddress ?? '').trim();
    if (!isAddress(wa)) {
      res.status(400).json({ error: 'walletAddress is required for internal portfolio calls' });
      return;
    }
    next();
    return;
  }
  return gateway.require(price)(req, res, next);
};

app.post(
  '/run',
  internalKeyMiddleware,
  a2aInternalMiddleware,
  guardAuthMiddleware,
  guardRateLimitMiddleware,
  guardGatewayMiddleware,
  async (req, res) => {
  const auth = (req as any).auth as JWTPayload;
  try {
    const requestedWallet = String(req.body?.walletAddress || auth.walletAddress);
    const executionTarget = String(req.body?.executionTarget || '').toUpperCase();
    const isBenchmark =
      req.body?.benchmark === true ||
      String(req.body?.benchmark ?? req.query?.benchmark ?? '').trim().toLowerCase() === 'true';
    if (!isAddress(requestedWallet)) {
      return res.status(400).json({ error: 'walletAddress must be a valid EVM address' });
    }
    const executionWallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const normalizedAuthWallet = getAddress(auth.walletAddress);
    const normalizedExecutionWallet = getAddress(executionWallet.address);
    const normalizedRequestedWallet = getAddress(requestedWallet);
    const allowedWallets = new Set([normalizedAuthWallet.toLowerCase(), normalizedExecutionWallet.toLowerCase()]);

    let portfolioWalletAddress = normalizedRequestedWallet;
    if (executionTarget === 'EOA') {
      portfolioWalletAddress = normalizedAuthWallet;
    } else if (executionTarget === 'DCW') {
      portfolioWalletAddress = normalizedExecutionWallet;
    } else if (!allowedWallets.has(normalizedRequestedWallet.toLowerCase())) {
      return res.status(400).json({
        error: `walletAddress must match your connected EOA (${normalizedAuthWallet}) or your execution wallet (${normalizedExecutionWallet})`,
      });
    }

    if (isBenchmark) {
      console.log('[benchmark] portfolio short-circuit');
      return res.json({
        ok: true,
        benchmark: true,
        agent: 'portfolio',
        result: 'Benchmark mode - payment logged',
      });
    }

    const gatewayDepositors =
      executionTarget === 'DCW'
        ? [normalizedAuthWallet, normalizedExecutionWallet]
        : [portfolioWalletAddress];
    const snapshot = await buildPortfolioSnapshot(portfolioWalletAddress, {
      gatewayDepositors,
    });
    const responseStyle = String(req.body?.responseStyle || '').trim().toLowerCase();
    if (responseStyle === 'concise_post_action') {
      return res.json({
        success: true,
        holdings: snapshot.holdings,
        positions: snapshot.positions,
        pnl: snapshot.pnlSummary,
        diagnostics: snapshot.diagnostics,
        scannedWalletAddress: portfolioWalletAddress,
        summary: buildPortfolioQuickSummary(snapshot, { postAction: true }),
      });
    }
    const assessment = await generatePortfolioAssessment(snapshot, {
      walletAddress: auth.walletAddress,
      agentSlug: 'portfolio',
    });

    return res.json({
      success: true,
      holdings: snapshot.holdings,
      positions: snapshot.positions,
      transfers: snapshot.tokenTransfers,
      recentTransactions: snapshot.recentTransactions,
      pnl: snapshot.pnlSummary,
      riskScore: assessment.riskScore,
      recommendations: assessment.recommendations,
      notes: assessment.notes,
      report: assessment.report,
      diagnostics: snapshot.diagnostics,
      analysisRaw: assessment.report,
      scannedWalletAddress: portfolioWalletAddress,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: toMessage(error) });
  }
  },
);

app.listen(port, () => {
  console.log(`Portfolio agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
