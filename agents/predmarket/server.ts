import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { formatUnits, getAddress, isAddress, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { getOrCreateUserAgentWallet } from '../../lib/dcw';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import { executionGuardMiddleware } from '../../lib/execution-guard';
import {
  executeBuy,
  executeRedeem,
  executeRefund,
  executeSell,
  getMarketDetail,
  getProviderPosition,
  getUserPositionsAcrossProviders,
  listAllMarkets,
  previewBuy,
  previewRedeem,
  previewRefund,
  previewSell,
} from '../../lib/predmarket/router';
import { stageFromContract } from '../../lib/predmarket/types';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.PREDMARKET_AGENT_PORT || 3013);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.PREDMARKET_AGENT_PRICE
  ? `$${process.env.PREDMARKET_AGENT_PRICE}`
  : '$0.012';
const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';
const PREDMARKET_LOGICAL_DECIMALS = 18;
const DEFAULT_PREDMARKET_SLIPPAGE_BPS = 500;
// Predmarket stays in 18-dec native USDC from chat input through execution.
// This differs from swap, which uses a 6-dec logical chat boundary.

type RawMarket = Awaited<ReturnType<typeof listAllMarkets>>[number];
type RawDetail = Awaited<ReturnType<typeof getMarketDetail>>;

type SerializedMarket = Omit<RawMarket, 'deadline'> & {
  deadline: string;
};

type SerializedDetail = Omit<RawDetail, 'deadline' | 'resolutionDeadline'> & {
  deadline: string;
  resolutionDeadline: string;
};

function serializeMarkets(markets: Awaited<ReturnType<typeof listAllMarkets>>): SerializedMarket[] {
  return markets.map((market) => ({
    ...market,
    deadline: market.deadline.toISOString(),
  }));
}

function serializeDetail(detail: Awaited<ReturnType<typeof getMarketDetail>>): SerializedDetail {
  return {
    ...detail,
    deadline: detail.deadline.toISOString(),
    resolutionDeadline: detail.resolutionDeadline.toISOString(),
  };
}

function parseStageFilter(input: unknown):
  | 'active'
  | 'suspended'
  | 'resolved'
  | 'cancelled'
  | 'expired'
  | undefined {
  if (typeof input === 'string' && input.trim()) {
    const normalized = input.trim().toLowerCase();
    if (
      normalized === 'active' ||
      normalized === 'suspended' ||
      normalized === 'resolved' ||
      normalized === 'cancelled' ||
      normalized === 'expired'
    ) {
      return normalized;
    }
  }
  if (typeof input === 'number' && Number.isInteger(input)) {
    return stageFromContract(input);
  }
  if (typeof input === 'string' && /^\d+$/.test(input.trim())) {
    return stageFromContract(Number(input.trim()));
  }
  return undefined;
}

function parseMarketAddress(value: unknown): `0x${string}` | null {
  return typeof value === 'string' && isAddress(value)
    ? (getAddress(value) as `0x${string}`)
    : null;
}

function parseOptionalBigInt(value: unknown): bigint | null {
  return typeof value === 'string' && value.trim() ? BigInt(value) : null;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveExecutionWalletAddress(
  userWalletAddress: `0x${string}`,
  executionTarget: string,
): Promise<`0x${string}`> {
  if (executionTarget === 'EOA') {
    return userWalletAddress;
  }
  const executionWallet = await getOrCreateUserAgentWallet(userWalletAddress);
  return getAddress(executionWallet.address) as `0x${string}`;
}

async function ensureSupportedMarket(
  providerName: string,
  marketAddress: `0x${string}`,
): Promise<void> {
  const markets = await listAllMarkets();
  const selected = markets.find(
    (market) => market.provider === providerName && market.address === marketAddress,
  );
  if (!selected) {
    throw new Error('marketAddress/provider pair is not a known supported market');
  }
}

async function estimateBuyPreview(input: {
  providerName: string;
  marketAddress: `0x${string}`;
  outcomeIdx: number;
  amount: number;
  slippageBps: number;
}): Promise<{
  provider: string;
  preview: Awaited<ReturnType<typeof previewBuy>> & {
    requestedBudgetRaw: string;
    requestedBudgetFormatted: string;
    note: string;
    executionPayload: {
      provider: string;
      marketAddress: `0x${string}`;
      outcomeIdx: number;
      sharesWadRaw: string;
      maxCostRaw: string;
      slippageBps: number;
    };
  };
}> {
  const detail = await getMarketDetail(input.providerName, input.marketAddress);
  const outcome = detail.outcomes[input.outcomeIdx];
  if (!outcome) {
    throw new Error('outcomeIdx is out of range for this market');
  }

  const probability = outcome.impliedProbability;
  if (!Number.isFinite(probability) || probability <= 0) {
    throw new Error('implied probability is not usable for buy preview');
  }

  const targetSpendRaw = parseUnits(String(input.amount), PREDMARKET_LOGICAL_DECIMALS);
  const impliedProbabilityWadRaw = BigInt(
    Math.max(1, Math.round(probability * 1_000_000_000_000_000_000)),
  );

  // First-pass approximation: spend / probability ~= shares for small LMSR trades.
  let sharesWadRaw = (targetSpendRaw * 10n ** 18n) / impliedProbabilityWadRaw;
  if (sharesWadRaw <= 0n) {
    sharesWadRaw = 1n;
  }

  let preview = await previewBuy(
    input.providerName,
    input.marketAddress,
    input.outcomeIdx,
    sharesWadRaw,
    input.slippageBps,
  );

  const firstCostRaw = BigInt(preview.costRaw);
  const firstDiffRaw = firstCostRaw > targetSpendRaw
    ? firstCostRaw - targetSpendRaw
    : targetSpendRaw - firstCostRaw;

  // One proportional correction pass keeps preview stable while reducing budget drift.
  if (targetSpendRaw > 0n && firstCostRaw > 0n && firstDiffRaw * 100n > targetSpendRaw * 5n) {
    const adjustedSharesWadRaw = (sharesWadRaw * targetSpendRaw) / firstCostRaw;
    if (adjustedSharesWadRaw > 0n) {
      sharesWadRaw = adjustedSharesWadRaw;
      preview = await previewBuy(
        input.providerName,
        input.marketAddress,
        input.outcomeIdx,
        sharesWadRaw,
        input.slippageBps,
      );
    }
  }

  return {
    provider: input.providerName,
    preview: {
      ...preview,
      requestedBudgetRaw: targetSpendRaw.toString(),
      requestedBudgetFormatted: `${input.amount} USDC`,
      note: `LMSR pricing: actual cost ~${preview.costFormatted} for ${preview.sharesFormatted} shares. May differ slightly from your ${input.amount} USDC budget due to probability-weighted pricing.`,
      executionPayload: {
        provider: input.providerName,
        marketAddress: input.marketAddress,
        outcomeIdx: input.outcomeIdx,
        sharesWadRaw: preview.sharesWadRaw,
        maxCostRaw: preview.maxCostRaw,
        slippageBps: preview.slippageBps,
      },
    },
  };
}

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'predmarket' });
});

const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  console.log('[predmarket.mw.rateLimitMiddleware]', { action: req.body?.action });
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const amount = Number(req.body?.amount ?? 0);
    const action = String(req.body?.action ?? 'predmarket_action');
    const result = await checkRateLimit({
      walletAddress: auth.walletAddress,
      agentSlug: 'predmarket',
      actionType: action,
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

const executionGuardIfConfirmed = (req: Request, res: Response, next: NextFunction) => {
  console.log('[predmarket.mw.executionGuardIfConfirmed]', { action: req.body?.action });
  if (req.body?.confirmed === true) {
    executionGuardMiddleware(req, res, next);
    return;
  }
  next();
};

const paymentIfConfirmed = (req: Request, res: Response, next: NextFunction) => {
  console.log('[predmarket.mw.paymentIfConfirmed]', {
    action: req.body?.action,
    confirmed: req.body?.confirmed === true,
  });
  if (
    req.body?.action === 'list' ||
    req.body?.action === 'detail' ||
    req.body?.action === 'position' ||
    req.body?.confirmed !== true
  ) {
    return next();
  }

  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const reqKey = (req.headers['x-agentflow-paid-internal'] as string | undefined)?.trim();
  if (internalKey && reqKey === internalKey) {
    return next();
  }

  return gateway.require(price)(req, res, next);
};

app.post(
  '/run',
  (req: Request, res: Response, next: NextFunction) => {
    console.log(
      '[predmarket.req.in]',
      JSON.stringify({
        ts: Date.now(),
        action: req.body?.action,
        hasAuth: !!req.headers.authorization,
        hasInternal: !!req.headers['x-agentflow-paid-internal'],
        ip: req.ip,
      }),
    );
    res.on('finish', () =>
      console.log('[predmarket.req.out]', {
        status: res.statusCode,
      }),
    );
    res.on('close', () =>
      console.log('[predmarket.req.close]', {
        status: res.statusCode,
        finished: res.writableEnded,
      }),
    );
    next();
  },
  (req: Request, res: Response, next: NextFunction) => {
    console.log('[predmarket.mw.paidInternalOrAuthMiddleware.before]', {
      action: req.body?.action,
    });
    paidInternalOrAuthMiddleware(req, res, next);
  },
  rateLimitMiddleware,
  executionGuardIfConfirmed,
  paymentIfConfirmed,
  async (req, res) => {
    try {
      const auth = (req as any).auth as JWTPayload;
      const action = String(req.body?.action || '').toLowerCase();
      const amount = Number(req.body?.amount ?? 0);
      const walletAddress = String(req.body?.walletAddress || auth.walletAddress);
      const executionTarget = String(req.body?.executionTarget || 'DCW').toUpperCase();

      if (!walletAddress || walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
        return res.status(400).json({ error: 'walletAddress must match authenticated wallet' });
      }

      if (action === 'list') {
        const rawFilter = req.body?.filter ?? {};
        const normalizedCategory =
          typeof rawFilter.category === 'string' && rawFilter.category.trim().toLowerCase() === 'all'
            ? undefined
            : typeof rawFilter.category === 'string'
              ? rawFilter.category
              : undefined;
        const filter = {
          ...rawFilter,
          category: normalizedCategory,
          stage: parseStageFilter(rawFilter.stage) ?? 'active',
        };
        const markets = await listAllMarkets({
          category: typeof filter.category === 'string' ? filter.category : undefined,
          stage: parseStageFilter(filter.stage),
          minVolumeRaw:
            typeof filter.minVolumeRaw === 'string' && filter.minVolumeRaw.trim()
              ? BigInt(filter.minVolumeRaw)
              : undefined,
          searchTerm: typeof filter.searchTerm === 'string' ? filter.searchTerm : undefined,
        });
        return res.json({
          success: true,
          action,
          markets: serializeMarkets(markets),
        });
      }

      if (action === 'detail') {
        const providerName =
          typeof req.body?.provider === 'string' && req.body.provider.trim()
            ? req.body.provider.trim()
            : 'achmarket';
        const marketAddress = parseMarketAddress(req.body?.marketAddress);
        if (!marketAddress) {
          return res.status(400).json({ success: false, error: 'marketAddress is required' });
        }

        const detail = await getMarketDetail(providerName, marketAddress);
        return res.json({
          success: true,
          action,
          detail: serializeDetail(detail),
        });
      }

      if (action === 'position') {
        const normalizedUserWallet = getAddress(walletAddress) as `0x${string}`;
        const queryWallet = await resolveExecutionWalletAddress(
          normalizedUserWallet,
          executionTarget,
        );
        const positions = await getUserPositionsAcrossProviders(queryWallet);
        return res.json({
          success: true,
          action,
          positions,
          queriedWallet: queryWallet,
          userWallet: normalizedUserWallet,
        });
      }

      if (!['buy', 'sell', 'redeem', 'refund'].includes(action)) {
        return res.status(400).json({
          error: 'action must be list|detail|position|buy|sell|redeem|refund',
        });
      }

      const providerName =
        typeof req.body?.provider === 'string' && req.body.provider.trim()
          ? req.body.provider.trim()
          : 'achmarket';
      const marketAddress = parseMarketAddress(req.body?.marketAddress);

      if (!marketAddress) {
        return res.status(400).json({ success: false, error: 'marketAddress is required' });
      }

      if (action === 'buy') {
        const outcomeIdx = Number(req.body?.outcomeIdx);
        const slippageBps = Number(
          req.body?.slippageBps ?? DEFAULT_PREDMARKET_SLIPPAGE_BPS,
        );

        if (!Number.isInteger(outcomeIdx) || outcomeIdx < 0) {
          return res.status(400).json({
            success: false,
            error: 'outcomeIdx must be a non-negative integer',
          });
        }

        if (req.body?.confirmed !== true) {
          if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
              success: false,
              error: 'amount must be a positive number',
            });
          }

          const result = await estimateBuyPreview({
            providerName,
            marketAddress,
            outcomeIdx,
            amount,
            slippageBps,
          });

          return res.json({
            success: true,
            action: 'preview',
            provider: result.provider,
            preview: result.preview,
          });
        }

        await ensureSupportedMarket(providerName, marketAddress);

        const confirmedProvider =
          typeof req.body?.executionPayload?.provider === 'string'
            ? req.body.executionPayload.provider
            : providerName;
        const confirmedMarketAddress = parseMarketAddress(
          req.body?.executionPayload?.marketAddress ?? req.body?.marketAddress,
        );
        const confirmedOutcomeIdx = Number(
          req.body?.executionPayload?.outcomeIdx ?? outcomeIdx,
        );
        const sharesWadRaw = parseOptionalBigInt(
          req.body?.executionPayload?.sharesWadRaw ?? req.body?.sharesWadRaw,
        );
        const maxCostRaw = parseOptionalBigInt(
          req.body?.executionPayload?.maxCostRaw ?? req.body?.maxCostRaw,
        );

        if (
          !confirmedMarketAddress ||
          !Number.isInteger(confirmedOutcomeIdx) ||
          confirmedOutcomeIdx < 0 ||
          sharesWadRaw === null ||
          maxCostRaw === null
        ) {
          return res.status(400).json({
            success: false,
            error:
              'confirmed buy requires executionPayload with provider, marketAddress, outcomeIdx, sharesWadRaw, and maxCostRaw from preview',
          });
        }

        if (
          confirmedProvider !== providerName ||
          confirmedMarketAddress !== marketAddress ||
          confirmedOutcomeIdx !== outcomeIdx
        ) {
          return res.status(400).json({
            success: false,
            error: 'confirmed buy executionPayload must match the requested provider, marketAddress, and outcomeIdx',
          });
        }

        const executionWallet = await getOrCreateUserAgentWallet(getAddress(walletAddress));

        try {
          const result = await executeBuy(providerName, {
            walletId: executionWallet.wallet_id,
            walletAddress: getAddress(executionWallet.address) as `0x${string}`,
            marketAddress,
            outcomeIdx,
            sharesWadRaw,
            maxCostRaw,
          });
          return res.json({
            success: true,
            action,
            provider: result.provider,
            txId: result.txId,
            txHash: result.txHash,
            outcomeIdx: result.outcomeIdx,
            sharesReceivedRaw: result.sharesReceivedRaw.toString(),
            sharesReceivedFormatted: formatUnits(
              result.sharesReceivedRaw,
              PREDMARKET_LOGICAL_DECIMALS,
            ),
            costPaidRaw: result.costPaidRaw.toString(),
            costPaidFormatted: `${formatUnits(result.costPaidRaw, PREDMARKET_LOGICAL_DECIMALS)} USDC`,
            receipt: {
              explorerLink: `${explorerBase}${result.txHash}`,
            },
          });
        } catch (error) {
          return res.status(502).json({ success: false, error: toMessage(error) });
        }
      }

      if (action === 'sell') {
        const outcomeIdx = Number(req.body?.outcomeIdx);
        const slippageBps = Number(
          req.body?.slippageBps ?? DEFAULT_PREDMARKET_SLIPPAGE_BPS,
        );
        const sharesWad = typeof req.body?.sharesWad === 'string' ? req.body.sharesWad : null;

        if (!Number.isInteger(outcomeIdx) || outcomeIdx < 0) {
          return res.status(400).json({
            success: false,
            error: 'outcomeIdx must be a non-negative integer',
          });
        }
        if (!sharesWad) {
          return res.status(400).json({ success: false, error: 'sharesWad is required' });
        }

        await ensureSupportedMarket(providerName, marketAddress);
        const sharesWadRaw = parseUnits(sharesWad, PREDMARKET_LOGICAL_DECIMALS);

        if (req.body?.confirmed !== true) {
          const result = await previewSell(
            providerName,
            marketAddress,
            outcomeIdx,
            sharesWadRaw,
            slippageBps,
          );
          return res.json({
            success: true,
            action: 'preview',
            provider: providerName,
            preview: {
              ...result,
              executionPayload: {
                provider: providerName,
                marketAddress,
                outcomeIdx,
                sharesWadRaw: result.sharesWadRaw,
                minReceiveRaw: result.minReceiveRaw,
                slippageBps: result.slippageBps,
              },
            },
          });
        }

        const confirmedProvider =
          typeof req.body?.executionPayload?.provider === 'string'
            ? req.body.executionPayload.provider
            : providerName;
        const confirmedMarketAddress = parseMarketAddress(
          req.body?.executionPayload?.marketAddress ?? req.body?.marketAddress,
        );
        const confirmedOutcomeIdx = Number(
          req.body?.executionPayload?.outcomeIdx ?? outcomeIdx,
        );
        const confirmedSharesWadRaw = parseOptionalBigInt(
          req.body?.executionPayload?.sharesWadRaw ?? req.body?.sharesWadRaw,
        );
        const minReceiveRaw = parseOptionalBigInt(
          req.body?.executionPayload?.minReceiveRaw ?? req.body?.minReceiveRaw,
        );

        if (
          !confirmedMarketAddress ||
          !Number.isInteger(confirmedOutcomeIdx) ||
          confirmedOutcomeIdx < 0 ||
          confirmedSharesWadRaw === null ||
          minReceiveRaw === null
        ) {
          return res.status(400).json({
            success: false,
            error:
              'confirmed sell requires executionPayload with provider, marketAddress, outcomeIdx, sharesWadRaw, and minReceiveRaw from preview',
          });
        }

        if (
          confirmedProvider !== providerName ||
          confirmedMarketAddress !== marketAddress ||
          confirmedOutcomeIdx !== outcomeIdx
        ) {
          return res.status(400).json({
            success: false,
            error: 'confirmed sell executionPayload must match the requested provider, marketAddress, and outcomeIdx',
          });
        }

        const executionWallet = await getOrCreateUserAgentWallet(getAddress(walletAddress));

        try {
          const result = await executeSell(providerName, {
            walletId: executionWallet.wallet_id,
            walletAddress: getAddress(executionWallet.address) as `0x${string}`,
            marketAddress,
            outcomeIdx,
            sharesWadRaw: confirmedSharesWadRaw,
            minReceiveRaw,
          });
          return res.json({
            success: true,
            action,
            provider: result.provider,
            txId: result.txId,
            txHash: result.txHash,
            outcomeIdx: result.outcomeIdx,
            sharesSoldRaw: result.sharesSoldRaw.toString(),
            sharesSoldFormatted: formatUnits(
              result.sharesSoldRaw,
              PREDMARKET_LOGICAL_DECIMALS,
            ),
            proceedsReceivedRaw: result.proceedsReceivedRaw.toString(),
            proceedsReceivedFormatted: `${formatUnits(result.proceedsReceivedRaw, PREDMARKET_LOGICAL_DECIMALS)} USDC`,
            receipt: {
              explorerLink: `${explorerBase}${result.txHash}`,
            },
          });
        } catch (error) {
          return res.status(502).json({ success: false, error: toMessage(error) });
        }
      }

      if (action === 'redeem') {
        await ensureSupportedMarket(providerName, marketAddress);
        const normalizedUserWallet = getAddress(walletAddress) as `0x${string}`;
        const queryWallet = await resolveExecutionWalletAddress(
          normalizedUserWallet,
          executionTarget,
        );

        if (req.body?.confirmed !== true) {
          const result = await previewRedeem(providerName, marketAddress, queryWallet);
          return res.json({
            success: true,
            action: 'preview',
            provider: providerName,
            preview: result,
          });
        }

        const executionWallet = await getOrCreateUserAgentWallet(normalizedUserWallet);

        try {
          const result = await executeRedeem(providerName, {
            walletId: executionWallet.wallet_id,
            walletAddress: getAddress(executionWallet.address) as `0x${string}`,
            marketAddress,
          });
          return res.json({
            success: true,
            action,
            provider: result.provider,
            txId: result.txId,
            txHash: result.txHash,
            payoutReceivedRaw: result.payoutReceivedRaw.toString(),
            payoutReceivedFormatted: `${formatUnits(result.payoutReceivedRaw, PREDMARKET_LOGICAL_DECIMALS)} USDC`,
            receipt: {
              explorerLink: `${explorerBase}${result.txHash}`,
            },
          });
        } catch (error) {
          return res.status(502).json({ success: false, error: toMessage(error) });
        }
      }

      await ensureSupportedMarket(providerName, marketAddress);
      const normalizedUserWallet = getAddress(walletAddress) as `0x${string}`;
      const queryWallet = await resolveExecutionWalletAddress(
        normalizedUserWallet,
        executionTarget,
      );

      if (req.body?.confirmed !== true) {
        const result = await previewRefund(providerName, marketAddress, queryWallet);
        return res.json({
          success: true,
          action: 'preview',
          provider: providerName,
          preview: result,
        });
      }

      const executionWallet = await getOrCreateUserAgentWallet(normalizedUserWallet);

      try {
        const result = await executeRefund(providerName, {
          walletId: executionWallet.wallet_id,
          walletAddress: getAddress(executionWallet.address) as `0x${string}`,
          marketAddress,
        });
        return res.json({
          success: true,
          action,
          provider: result.provider,
          txId: result.txId,
          txHash: result.txHash,
          refundReceivedRaw: result.refundReceivedRaw.toString(),
          refundReceivedFormatted: `${formatUnits(result.refundReceivedRaw, PREDMARKET_LOGICAL_DECIMALS)} USDC`,
          receipt: {
            explorerLink: `${explorerBase}${result.txHash}`,
          },
        });
      } catch (error) {
        return res.status(502).json({ success: false, error: toMessage(error) });
      }
    } catch (error) {
      console.error('[predmarket.handler.error]', {
        action: req.body?.action,
        message: error instanceof Error ? error.message : String(error),
        stack:
          error instanceof Error
            ? error.stack?.split('\n').slice(0, 5)
            : undefined,
      });
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
);

app.listen(port, () => {
  console.log(`Predmarket agent running on :${port}`);
});
