import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import { getAddress, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { type JWTPayload } from '../../lib/auth';
import {
  BRIDGE_SOURCE_DOMAIN,
  type SupportedBridgeSourceChain,
} from '../../lib/bridge/supportedSources';
import { executionGuardMiddleware } from '../../lib/execution-guard';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import { checkRateLimit } from '../../lib/ratelimit';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.BRIDGE_AGENT_PORT || 3021);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.BRIDGE_AGENT_PRICE ? `$${process.env.BRIDGE_AGENT_PRICE}` : '$0.009';
const sellerAddress = requireSellerAddress();
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

const supportedSources = Object.keys(BRIDGE_SOURCE_DOMAIN) as SupportedBridgeSourceChain[];

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    agent: 'bridge',
    supportedSources,
  });
});

app.post(
  '/bridge/finalize',
  paidInternalOrAuthMiddleware,
  executionGuardMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
    const reqKey = (req.headers['x-agentflow-paid-internal'] as string | undefined)?.trim();
    if (internalKey && reqKey === internalKey) {
      next();
      return;
    }
    return gateway.require(price)(req, res, next);
  },
  async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    const sourceChain = String(req.body?.sourceChain || '').trim().toLowerCase();
    const amount = Number(req.body?.amount ?? 0);
    const sourceTxHash = String(req.body?.sourceTxHash || '').trim();
    const approvalTxHash = String(req.body?.approvalTxHash || '').trim();
    const mintTxHash = String(req.body?.mintTxHash || '').trim();
    const recipientAddress = String(req.body?.recipientAddress || '').trim();

    if (!isSupportedSourceChain(sourceChain)) {
      return res.status(400).json({ error: 'Unsupported sourceChain', supportedSources });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be positive' });
    }
    if (!isAddress(auth.walletAddress)) {
      return res.status(401).json({ error: 'Authenticated wallet is invalid' });
    }
    if (recipientAddress && !isAddress(recipientAddress)) {
      return res.status(400).json({ error: 'recipientAddress must be a valid 0x address' });
    }
    for (const [label, hash] of [
      ['sourceTxHash', sourceTxHash],
      ['approvalTxHash', approvalTxHash],
      ['mintTxHash', mintTxHash],
    ] as const) {
      if (hash && !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
        return res.status(400).json({ error: `${label} must be a valid 0x transaction hash` });
      }
    }

    const amountUsd = amount;
    const limiter = await checkRateLimit({
      walletAddress: getAddress(auth.walletAddress),
      agentSlug: 'bridge',
      actionType: 'bridge',
      amountUsd,
    });
    if (!limiter.allowed) {
      return res.status(429).json({ error: `Rate limited: ${limiter.reason}` });
    }

    return res.json({
      success: true,
      agent: 'bridge',
      sourceChain,
      amount,
      sourceTxHash: sourceTxHash || null,
      approvalTxHash: approvalTxHash || null,
      mintTxHash: mintTxHash || null,
      recipientAddress: recipientAddress ? getAddress(recipientAddress) : null,
      message: 'Bridge receipt recorded by AgentFlow bridge agent.',
    });
  },
);

app.listen(port, () => {
  console.log(`Bridge agent running on :${port}`);
});

function isSupportedSourceChain(value: string): value is SupportedBridgeSourceChain {
  return value in BRIDGE_SOURCE_DOMAIN;
}

function requireSellerAddress(): `0x${string}` {
  const sellerAddress = process.env.SELLER_ADDRESS?.trim();
  if (sellerAddress && isAddress(sellerAddress)) {
    return getAddress(sellerAddress) as `0x${string}`;
  }

  const privateKey =
    process.env.PRIVATE_KEY?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (privateKey) {
    const normalized = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
    const account = privateKeyToAccount(normalized);
    const src = process.env.PRIVATE_KEY?.trim() ? 'PRIVATE_KEY' : 'DEPLOYER_PRIVATE_KEY';
    console.warn(
      `[bridge] SELLER_ADDRESS is not set. Falling back to address derived from ${src} (${account.address}) for seller pay-to only.`,
    );
    return account.address;
  }

  throw new Error('SELLER_ADDRESS is required when neither PRIVATE_KEY nor DEPLOYER_PRIVATE_KEY is set for the bridge agent');
}
