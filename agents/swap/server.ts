import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { createPublicClient, formatUnits, getAddress, http, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { toClientMessage } from '../../lib/http-errors';
import { checkRateLimit } from '../../lib/ratelimit';
import { ARC } from '../../lib/arc-config';
import { adminDb } from '../../db/client';
import { getOrCreateAgentWallets, getOrCreateUserAgentWallet, waitForTransaction } from '../../lib/dcw';
import { calculateScore, recordReputationSafe } from '../../lib/reputation';
import { getBestQuote } from '../../lib/dex/router';
import { calculateOptimalSlippage } from './subagents/slippage';
import { computeSwapPriceImpactPercent } from './subagents/simulation';
import { evaluateSwapSanity } from '../../lib/swap-sanity';
import { executeSwap } from './subagents/execute';
import { verifyTokenTransfer } from './subagents/verify';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import { executionGuardMiddleware } from '../../lib/execution-guard';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.SWAP_AGENT_PORT || 3011);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.SWAP_AGENT_PRICE ? `$${process.env.SWAP_AGENT_PRICE}` : '$0.010';
const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';
const ARC_USDC = getAddress(
  process.env.ARC_USDC_ADDRESS?.trim() || '0x3600000000000000000000000000000000000000',
) as `0x${string}`;
const readClient = createPublicClient({
  transport: http(ARC.alchemyRpc || ARC.rpc),
});
const erc20MetadataAbi = parseAbi([
  'function decimals() view returns (uint8)',
]);
const SWAP_LOGICAL_DECIMALS = 6;
const ARC_EURC = getAddress(
  process.env.ARC_EURC_ADDRESS?.trim() || '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
) as `0x${string}`;

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
    const amount = Number(req.body?.amount ?? req.body?.amountIn ?? 0);
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
    res.status(500).json({ error: toClientMessage('swap', error) });
  }
};

const preflightMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const walletAddress = req.body?.walletAddress as string;
    const tokenPairRaw = req.body?.tokenPair ?? {
      tokenIn: req.body?.tokenIn,
      tokenOut: req.body?.tokenOut,
    };
    const executionTargetRaw = String(req.body?.executionTarget ?? 'DCW').trim().toUpperCase();

    if (!walletAddress || walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
      return res.status(400).json({ error: 'walletAddress must match authenticated wallet' });
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

    const { requestedSlippage, slippageBps } = resolveSlippage(req.body);
    const { amount, amountRaw, tokenInDecimals } = await resolveSwapAmount(
      tokenPair.tokenIn,
      req.body,
    );
    const userAgentWallet = await getOrCreateUserAgentWallet(auth.walletAddress);
    const tokenOutDecimals = await readSwapTokenDecimals(tokenPair.tokenOut);
    (req as any).swapInput = {
      walletAddress,
      tokenPair,
      amount,
      requestedSlippage,
      slippageBps,
      executionTarget: executionTargetRaw as 'DCW',
      amountRaw,
      tokenInDecimals,
      tokenOutDecimals,
      provider:
        typeof req.body?.provider === 'string' && req.body.provider.trim()
          ? req.body.provider.trim()
          : null,
      routeData:
        typeof req.body?.routeData === 'string' && req.body.routeData.trim()
          ? req.body.routeData
          : null,
      expectedOutRaw:
        req.body?.expectedOutRaw != null && String(req.body.expectedOutRaw).trim()
          ? BigInt(String(req.body.expectedOutRaw))
          : null,
      fromSym:
        typeof req.body?.fromSym === 'string' && req.body.fromSym.trim()
          ? req.body.fromSym.trim()
          : null,
      toSym:
        typeof req.body?.toSym === 'string' && req.body.toSym.trim()
          ? req.body.toSym.trim()
          : null,
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

const previewMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if (req.body?.confirmed === true) {
    next();
    return;
  }

  try {
    const prepared = (req as any).swapInput as {
      walletAddress: string;
      tokenPair: { tokenIn: `0x${string}`; tokenOut: `0x${string}` };
      amount: number;
      requestedSlippage: number;
      slippageBps: number;
      executionTarget: 'DCW';
      amountRaw: bigint;
      tokenInDecimals: number;
      tokenOutDecimals: number;
      fromSym: string | null;
      toSym: string | null;
    };

    const quote = await getBestQuote({
      tokenIn: prepared.tokenPair.tokenIn,
      tokenOut: prepared.tokenPair.tokenOut,
      amountInRaw: prepared.amountRaw,
      slippageBps: prepared.slippageBps,
    });

    const priceImpactPct = await computeSwapPriceImpactPercent({
      tokenIn: prepared.tokenPair.tokenIn,
      tokenOut: prepared.tokenPair.tokenOut,
      amountInFull: prepared.amountRaw,
      quoteFullOut: quote.expectedOutRaw,
      tokenInDecimals: prepared.tokenInDecimals,
    });

    const sanity = evaluateSwapSanity({
      amountInRaw: prepared.amountRaw,
      amountOutRaw: quote.expectedOutRaw,
      tokenIn: prepared.tokenPair.tokenIn,
      tokenOut: prepared.tokenPair.tokenOut,
      priceImpactPct,
      tokenInDecimals: prepared.tokenInDecimals,
      tokenOutDecimals: quote.tokenOutDecimals,
      provider: quote.provider,
    });
    if (!sanity.ok) {
      return res.status(400).json({ success: false, error: sanity.reason });
    }

    return res.json({
      success: true,
      action: 'preview',
      provider: quote.provider,
      expectedOutRaw: quote.expectedOutRaw.toString(),
      expectedOutFormatted: formatUnits(quote.expectedOutRaw, quote.tokenOutDecimals),
      route: quote.segments,
      payload: {
        walletAddress: prepared.walletAddress,
        provider: quote.provider,
        tokenIn: prepared.tokenPair.tokenIn,
        tokenOut: prepared.tokenPair.tokenOut,
        tokenInDecimals: quote.tokenInDecimals,
        tokenOutDecimals: quote.tokenOutDecimals,
        amount: prepared.amount,
        amountRaw: prepared.amountRaw.toString(),
        minAmountOutRaw: quote.amountOutMinRaw.toString(),
        requestedSlippage: prepared.requestedSlippage,
        optimalSlippage: prepared.requestedSlippage,
        priceImpactPct,
        quoteAmountOutRaw: quote.expectedOutRaw.toString(),
        quoteFeeRaw: null,
        quoteSource: quote.provider,
        routeData: quote.routeData,
        routeSegments: quote.segments,
        fromSym: prepared.fromSym ?? 'USDC',
        toSym: prepared.toSym ?? 'EURC',
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: toMessage(error),
    });
  }
};

const executionGuardIfConfirmed = (req: Request, res: Response, next: NextFunction) => {
  if (req.body?.confirmed === true) {
    executionGuardMiddleware(req, res, next);
    return;
  }
  next();
};

const paymentIfConfirmed = (req: Request, res: Response, next: NextFunction) => {
  if (req.body?.confirmed !== true) {
    next();
    return;
  }
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const reqKey = (req.headers['x-agentflow-paid-internal'] as string | undefined)?.trim();
  if (internalKey && reqKey === internalKey) {
    next();
    return;
  }
  return gateway.require(price)(req, res, next);
};

app.post(
  '/run',
  paidInternalOrAuthMiddleware,
  rateLimitMiddleware,
  preflightMiddleware,
  previewMiddleware,
  executionGuardIfConfirmed,
  paymentIfConfirmed,
  async (req: Request, res: Response) => {
    const auth = (req as any).auth as JWTPayload;

    const startedAt = Date.now();
    const prepared = (req as any).swapInput as {
      walletAddress: string;
      tokenPair: { tokenIn: `0x${string}`; tokenOut: `0x${string}` };
      amount: number;
      requestedSlippage: number;
      slippageBps: number;
      executionTarget: 'DCW';
      amountRaw: bigint;
      tokenInDecimals: number;
      tokenOutDecimals: number;
      provider: string | null;
      routeData: string | null;
      expectedOutRaw: bigint | null;
      userAgentWallet: { wallet_id: string; address: string };
    };
    const {
      walletAddress,
      tokenPair,
      amount,
      requestedSlippage,
      slippageBps,
      executionTarget,
      amountRaw,
      tokenInDecimals,
      tokenOutDecimals,
      provider,
      routeData,
      expectedOutRaw,
      userAgentWallet,
    } =
      prepared;
    let txHash = '';
    let reason = 'unknown';
    let reputation: { success: boolean; txHash?: string } | null = null;

    try {
      const quote =
        provider && routeData && expectedOutRaw
          ? {
              provider,
              routeData,
              expectedOutRaw,
              amountOutMinRaw: applySlippage(expectedOutRaw, requestedSlippage),
              tokenInDecimals,
              tokenOutDecimals,
              latencyMs: 0,
              segments: [] as Array<{
                isV3: boolean;
                path: `0x${string}`[];
                fees: number[];
                bps: number;
              }>,
            }
          : await getBestQuote({
              tokenIn: tokenPair.tokenIn,
              tokenOut: tokenPair.tokenOut,
              amountInRaw: amountRaw,
              slippageBps,
            });

      const priceImpactPct = await computeSwapPriceImpactPercent({
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        amountInFull: amountRaw,
        quoteFullOut: quote.expectedOutRaw,
        tokenInDecimals,
      });
      const sanity = evaluateSwapSanity({
        amountInRaw: amountRaw,
        amountOutRaw: quote.expectedOutRaw,
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        priceImpactPct,
        tokenInDecimals,
        tokenOutDecimals: quote.tokenOutDecimals,
        provider: quote.provider,
      });
      if (!sanity.ok) {
        return res.status(400).json({ success: false, error: sanity.reason });
      }

      const slippageResult = await calculateOptimalSlippage({
        walletAddress: auth.walletAddress,
        tokenPair: `${tokenPair.tokenIn}/${tokenPair.tokenOut}`,
        requestedSlippage,
      });

      const minAmountOutRaw = applySlippage(
        quote.expectedOutRaw,
        slippageResult.optimalSlippage,
      );

      const simulation = {
        quoteOutRaw: quote.expectedOutRaw.toString(),
        minAmountOutRaw: minAmountOutRaw.toString(),
        requestedSlippage,
        optimalSlippage: slippageResult.optimalSlippage,
        quoteSource: quote.provider,
        quoteFeeRaw: null,
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
        provider: quote.provider,
        routeData: quote.routeData,
        expectedOutRaw: quote.expectedOutRaw,
        slippageBps,
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
      console.info(
        '[swap.telemetry]',
        JSON.stringify({
          provider: quote.provider,
          expectedOutRaw: quote.expectedOutRaw.toString(),
          actualOutRaw: verified.valueRaw?.toString() ?? null,
          latencyMs: Date.now() - startedAt,
          txHash,
        }),
      );

      const trace = {
        tokenIn: tokenPair.tokenIn,
        tokenOut: tokenPair.tokenOut,
        provider: quote.provider,
        executionTarget,
        quoteOutRaw: quote.expectedOutRaw.toString(),
        minAmountOutRaw: minAmountOutRaw.toString(),
        requestedSlippage,
        optimalSlippage: slippageResult.optimalSlippage,
        observedSlippage: slippageResult.optimalSlippage,
        reason,
        swapTxId: submitted.txId,
        approvalTxId: submitted.approvalTxId ?? null,
        approvalTxHash: submitted.approvalTxHash ?? null,
        approvalSkipped: submitted.approvalSkipped,
        quoteSource: quote.provider,
        quoteFeeRaw: null,
      };

      await adminDb.from('transactions').insert({
        from_wallet: auth.walletAddress,
        to_wallet: tokenPair.tokenOut,
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
        approvalTxId: submitted.approvalTxId ?? null,
        approvalTxHash: submitted.approvalTxHash ?? null,
        txHash,
        simulation,
        receipt: {
          explorerLink: `${explorerBase}${txHash}`,
          approvalExplorerLink: submitted.approvalTxHash
            ? `${explorerBase}${submitted.approvalTxHash}`
            : null,
          amountIn: amount,
          executionTarget,
          tokenPair,
          provider: quote.provider,
          optimalSlippage: slippageResult.optimalSlippage,
          quoteOutRaw: quote.expectedOutRaw.toString(),
          quoteFeeRaw: null,
          approvalTxId: submitted.approvalTxId ?? null,
          approvalTxHash: submitted.approvalTxHash ?? null,
        },
        reputation,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: toClientMessage('swap', error),
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

async function readSwapTokenDecimals(token: `0x${string}`): Promise<number> {
  const normalized = getAddress(token);
  if (normalized === ARC_USDC || normalized === ARC_EURC) {
    return SWAP_LOGICAL_DECIMALS;
  }
  return Number(
    await readClient.readContract({
      address: token,
      abi: erc20MetadataAbi,
      functionName: 'decimals',
    }),
  );
}

async function resolveSwapAmount(
  tokenIn: `0x${string}`,
  body: Record<string, unknown>,
): Promise<{ amount: number; amountRaw: bigint; tokenInDecimals: number }> {
  const tokenInDecimals = await readSwapTokenDecimals(tokenIn);
  const amountInRawValue = body?.amountInRaw;
  if (amountInRawValue != null && String(amountInRawValue).trim()) {
    const amountRaw = BigInt(String(amountInRawValue));
    return {
      amount: Number(formatUnits(amountRaw, tokenInDecimals)),
      amountRaw,
      tokenInDecimals,
    };
  }

  const amountValue = body?.amountIn ?? body?.amount;
  const amountText =
    typeof amountValue === 'number' ? String(amountValue) : String(amountValue ?? '').trim();
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number');
  }

  return {
    amount,
    amountRaw: parseUnits(amountText, tokenInDecimals),
    tokenInDecimals,
  };
}

function resolveSlippage(body: Record<string, unknown>): {
  requestedSlippage: number;
  slippageBps: number;
} {
  const rawBps = Number(body?.slippageBps);
  if (Number.isFinite(rawBps) && rawBps > 0) {
    return {
      requestedSlippage: rawBps / 100,
      slippageBps: Math.round(rawBps),
    };
  }

  const requestedSlippage = Number(body?.slippage);
  if (!Number.isFinite(requestedSlippage) || requestedSlippage <= 0) {
    throw new Error('slippage must be a positive number');
  }
  return {
    requestedSlippage,
    slippageBps: Math.round(requestedSlippage * 100),
  };
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
