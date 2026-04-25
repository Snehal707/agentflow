import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';

import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { type JWTPayload } from '../../lib/auth';
import { checkSpendingLimits } from '../../lib/dcw';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { checkRateLimit } from '../../lib/ratelimit';
import {
  bridgeTransferExecute,
  getArcSdkDomain,
  getSupportedSourceChains,
  simulateBridgeTransfer,
  type SupportedSourceChain,
} from './bridgeKit';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.BRIDGE_AGENT_PORT || 3013);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.BRIDGE_AGENT_PRICE ? `$${process.env.BRIDGE_AGENT_PRICE}` : '$0.009';

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

const supportedSources = getSupportedSourceChains();

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    agent: 'bridge',
    supportedSources,
    sdkArcCctpDomain: getArcSdkDomain(),
  });
});

app.post('/run', paidInternalOrAuthMiddleware, (req: Request, res: Response, next: NextFunction) => {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const reqKey = (req.headers['x-agentflow-paid-internal'] as string | undefined)?.trim();
  if (internalKey && reqKey === internalKey) {
    next();
    return;
  }
  return gateway.require(price)(req, res, next);
}, async (req: Request, res: Response) => {
  const auth = (req as any).auth as JWTPayload;
  const sourceChain = String(req.body?.sourceChain || '').toLowerCase() as SupportedSourceChain;
  const targetChain = String(req.body?.targetChain || 'arc-testnet').toLowerCase();
  const amount = Number(req.body?.amount ?? 0);
  const walletAddress = String(req.body?.walletAddress || auth.walletAddress);

  if (!supportedSources.includes(sourceChain)) {
    return res.status(400).json({
      error: 'Unsupported sourceChain',
      supported: supportedSources,
    });
  }
  if (targetChain !== 'arc-testnet') {
    return res.status(400).json({ error: 'targetChain must be arc-testnet for this phase' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be positive' });
  }
  if (!walletAddress || walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
    return res.status(400).json({ error: 'walletAddress must match authenticated wallet' });
  }

  if (req.body?.benchmark === true) {
    console.log('[benchmark] bridge short-circuit');
    return res.json({
      ok: true,
      benchmark: true,
      agent: 'bridge',
      result: 'Benchmark mode - payment logged',
    });
  }

  const limiter = await checkRateLimit({
    walletAddress: auth.walletAddress,
    agentSlug: 'bridge',
    actionType: 'bridge',
    amountUsd: amount,
  });
  if (!limiter.allowed) {
    return res.status(429).json({ error: `Rate limited: ${limiter.reason}` });
  }
  await checkSpendingLimits(auth.walletAddress, amount);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  // @ts-ignore
  res.flushHeaders?.();

  const send = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const sim = await simulateBridgeTransfer({
      sourceChain,
      recipientAddress: walletAddress,
      amount: amount.toString(),
      onEvent: ({ event, data }) => {
        send(event, data);
      },
    });

    if (!sim.ok) {
      send('done', {
        success: false,
        reason: sim.reason,
        preflight: sim.preflight,
        warnings: sim.warnings,
      });
      res.end();
      return;
    }

    send('simulation', {
      ok: true,
      preflight: sim.preflight,
      warnings: sim.warnings,
    });

    const transfer = await bridgeTransferExecute({
      sourceChain,
      recipientAddress: walletAddress,
      amount: amount.toString(),
      onEvent: ({ event, data }) => {
        send(event, data);
      },
    });

    if (!transfer.ok) {
      send('done', {
        success: false,
        reason: transfer.reason,
        preflight: transfer.preflight,
      });
      res.end();
      return;
    }

    send('done', {
      success: true,
      preflight: transfer.preflight,
      result: transfer.result,
      simulationWarnings: sim.warnings,
    });
    res.end();
  } catch (error) {
    send('error', {
      success: false,
      message: toMessage(error),
    });
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Bridge agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
