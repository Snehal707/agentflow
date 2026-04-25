import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { ARC } from '../../lib/arc-config';
import { adminDb } from '../../db/client';
import { getOrCreateAgentWallets, getOrCreateUserAgentWallet, waitForTransaction } from '../../lib/dcw';
import { calculateScore, recordReputationSafe } from '../../lib/reputation';
import { fetchSwapQuote } from './subagents/price';
import { calculateOptimalSlippage } from './subagents/slippage';
import { computeSwapPriceImpactPercent } from './subagents/simulation';
import { evaluateSwapSanity } from '../../lib/swap-sanity';
import { executeSwap } from './subagents/execute';
import { verifyTokenTransfer } from './subagents/verify';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.SWAP_AGENT_PORT || 3011);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.SWAP_AGENT_PRICE ? `$${process.env.SWAP_AGENT_PRICE}` : '$0.010';
const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'swap' });
});

const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const amount = Number(req.body?.amount ?? 0);
    const result = await checkRateLimit({
      walletAddress: auth.walletAddress,
      agentSlug: 'swap',
      actionType: 'swap',
      amountUsd: Number.isFinite(amount) ? amount : 0,
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

const spendingLimitCheck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const amount = Number(req.body?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' });
      return;
    }
    // Uses shared limit logic from DCW layer.
    const { checkSpendingLimits } = await import('../../lib/dcw');
    await checkSpendingLimits(auth.walletAddress, amount);
    next();
  } catch (error) {
    res.status(400).json({ error: toMessage(error) });
  }
};

const preflightMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const walletAddress = req.body?.walletAddress as string;
    const tokenPairRaw = req.body?.tokenPair;
    const amount = Number(req.body?.amount);
    const requestedSlippage = Number(req.body?.slippage);
    const executionTargetRaw = String(req.body?.executionTarget ?? 'DCW').trim().toUpperCase();
    const isBenchmark = req.body?.benchmark === true;

    if (!walletAddress || walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
      return res.status(400).json({ error: 'walletAddress must match authenticated wallet' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (!Number.isFinite(requestedSlippage) || requestedSlippage <= 0) {
      return res.status(400).json({ error: 'slippage must be a positive number' });
    }
    if (executionTargetRaw !== 'DCW') {
      return res.status(400).json({
        error: 'Swap execution currently supports only DCW on the backend',
      });
    }

    const tokenPair = parseTokenPair(tokenPairRaw);
    if (!tokenPair) {
      return res.status(400).json({
        error: 'tokenPair must be "0xTokenIn/0xTokenOut" or { tokenIn, tokenOut }',
      });
    }

    if (isBenchmark) {
      next();
      return;
    }

    const amountRaw = parseUnits(amount.toFixed(6), 6);
    const userAgentWallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    (req as any).swapInput = {
      walletAddress,
      tokenPair,
      amount,
      requestedSlippage,
      executionTarget: executionTargetRaw as 'DCW',
      amountRaw,
      userAgentWallet,
    };
    const { preflightSwapExecution } = await import('./subagents/execute');
    await preflightSwapExecution({
      userAgentWalletAddress: userAgentWallet.address,
      tokenIn: tokenPair.tokenIn,
      amountInRaw: amountRaw,
    });
    next();
  } catch (error) {
    const message = toMessage(error);
    const executionWalletAddress = (req as any).swapInput?.userAgentWallet?.address;
    return res.status(400).json({
      success: false,
      error: message,
      executionWalletAddress,
    });
  }
};

app.post(
  '/run',
  paidInternalOrAuthMiddleware,
  rateLimitMiddleware,
  spendingLimitCheck,
  (req: Request, res: Response, next: NextFunction) => {
    const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
    const reqKey = (req.headers['x-agentflow-paid-internal'] as string | undefined)?.trim();
    if (internalKey && reqKey === internalKey) {
      next();
      return;
    }
    return gateway.require(price)(req, res, next);
  },
  preflightMiddleware,
  async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;
    if (req.body?.benchmark === true) {
      console.log('[benchmark] swap short-circuit');
      return res.json({
        ok: true,
        benchmark: true,
        agent: 'swap',
        result: 'Benchmark mode - payment logged',
      });
    }

    const startedAt = Date.now();
    const prepared = (req as any).swapInput as {
      walletAddress: string;
      tokenPair: { tokenIn: `0x${string}`; tokenOut: `0x${string}` };
      amount: number;
      requestedSlippage: number;
      executionTarget: 'DCW';
      amountRaw: bigint;
      userAgentWallet: { wallet_id: string; address: string };
    };
    const { walletAddress, tokenPair, amount, requestedSlippage, executionTarget, amountRaw, userAgentWallet } =
      prepared;
    let txHash = '';
    let reason = 'unknown';
    let reputation: { success: boolean; txHash?: string } | null = null;

    try {
      const quote = await fetchSwapQuote({
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        amountIn: amountRaw,
      });

      const priceImpactPct = await computeSwapPriceImpactPercent({
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        amountInFull: amountRaw,
        quoteFullOut: quote.amountOut,
      });
      const sanity = evaluateSwapSanity({
        amountInRaw: amountRaw,
        amountOutRaw: quote.amountOut,
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        priceImpactPct,
      });
      if (!sanity.ok) {
        return res.status(400).json({ success: false, error: sanity.reason });
      }

      const slippageResult = await calculateOptimalSlippage({
        walletAddress: auth.walletAddress,
        tokenPair: `${tokenPair.tokenIn}/${tokenPair.tokenOut}`,
        requestedSlippage,
      });

      const minAmountOutRaw = applySlippage(quote.amountOut, slippageResult.optimalSlippage);

      const simulation = {
        quoteOutRaw: quote.amountOut.toString(),
        minAmountOutRaw: minAmountOutRaw.toString(),
        requestedSlippage,
        optimalSlippage: slippageResult.optimalSlippage,
        quoteSource: quote.source,
        quoteFeeRaw: quote.feeRaw?.toString() ?? null,
        memoryExecutions: slippageResult.memoryExecutions,
        averageObservedSlippage: slippageResult.averageObservedSlippage,
      };

      reason = 'deterministic_swap_after_simulation';
      const submitted = await executeSwap({
        userWalletAddress: auth.walletAddress,
        userAgentWalletId: userAgentWallet.wallet_id,
        userAgentWalletAddress: userAgentWallet.address as `0x${string}`,
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        amountInRaw: amountRaw,
        minAmountOutRaw,
      });

      const polled = await waitForTransaction(submitted.txId, 'swap');
      if (polled.state !== 'COMPLETE' || !polled.txHash) {
        throw new Error(`[swap] Circle tx failed: ${polled.errorReason || polled.state}`);
      }

      const verified = await verifyTokenTransfer({
        tokenAddress: tokenPair.tokenOut,
        recipient: userAgentWallet.address,
        minValueRaw: minAmountOutRaw,
        txHash: polled.txHash as `0x${string}`,
        timeoutMs: 30_000,
      });
      txHash = verified.txHash;

      const trace = {
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        executionTarget,
        quoteOutRaw: quote.amountOut.toString(),
        minAmountOutRaw: minAmountOutRaw.toString(),
        requestedSlippage,
        optimalSlippage: slippageResult.optimalSlippage,
        observedSlippage: slippageResult.optimalSlippage,
        reason,
        swapTxId: submitted.txId,
        approvalTxId: submitted.approvalTxId ?? null,
        approvalSkipped: submitted.approvalSkipped,
        quoteSource: quote.source,
        quoteFeeRaw: quote.feeRaw?.toString() ?? null,
      };

      await adminDb.from('transactions').insert({
        from_wallet: auth.walletAddress,
        to_wallet: ARC.swapContract || tokenPair.tokenOut,
        amount,
        arc_tx_id: txHash,
        agent_slug: 'swap',
        action_type: 'swap',
        status: 'complete',
      });

      await adminDb.from('agent_interactions').insert({
        wallet_address: auth.walletAddress,
        agent_slug: 'swap',
        user_input: JSON.stringify({ tokenPair, amount, slippage: requestedSlippage }),
        agent_output: JSON.stringify({
          simulation,
          txHash,
          executionTarget,
          explorerLink: `${explorerBase}${txHash}`,
        }),
        subagent_trace: trace,
        execution_ms: Date.now() - startedAt,
      });

      const { ownerWallet, validatorWallet } = await getOrCreateAgentWallets('swap');
      if (ownerWallet.erc8004_token_id) {
        const score = calculateScore('swap', {
          slippage: slippageResult.optimalSlippage,
          expectedSlippage: requestedSlippage,
        });
        await recordReputationSafe(
          ownerWallet.erc8004_token_id,
          score,
          'successful_swap',
          validatorWallet.address,
        );
      }

      return res.json({
        success: true,
        executionMode: executionTarget,
        txId: submitted.txId,
        txHash,
        simulation,
        receipt: {
          explorerLink: `${explorerBase}${txHash}`,
          amountIn: amount,
          executionTarget,
          tokenPair,
          optimalSlippage: slippageResult.optimalSlippage,
          quoteOutRaw: quote.amountOut.toString(),
          quoteFeeRaw: quote.feeRaw?.toString() ?? null,
          approvalTxId: submitted.approvalTxId ?? null,
        },
        reputation,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: toMessage(error),
      });
    }
  },
);

app.listen(port, () => {
  console.log(`Swap agent running on :${port}`);
});

function parseTokenPair(
  input: unknown,
): { tokenIn: `0x${string}`; tokenOut: `0x${string}` } | null {
  if (typeof input === 'string') {
    const [tokenIn, tokenOut] = input.split('/').map((v) => v.trim());
    if (isHexAddress(tokenIn) && isHexAddress(tokenOut)) {
      return { tokenIn: tokenIn as `0x${string}`, tokenOut: tokenOut as `0x${string}` };
    }
    return null;
  }
  if (typeof input === 'object' && input !== null) {
    const tokenIn = (input as any).tokenIn as string;
    const tokenOut = (input as any).tokenOut as string;
    if (isHexAddress(tokenIn) && isHexAddress(tokenOut)) {
      return { tokenIn: tokenIn as `0x${string}`, tokenOut: tokenOut as `0x${string}` };
    }
  }
  return null;
}

function applySlippage(amountOut: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round(slippagePercent * 100));
  const scale = BigInt(10_000);
  return (amountOut * (scale - bps)) / scale;
}

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
