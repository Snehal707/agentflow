import { achmarketProvider } from './providers/achmarket';
import type {
  BuyParams,
  BuyPreview,
  BuyResult,
  MarketDetail,
  MarketFilter,
  MarketSummary,
  PredictionMarketProvider,
  RedeemParams,
  RedeemPreview,
  RedeemResult,
  RefundParams,
  RefundPreview,
  RefundResult,
  SellParams,
  SellPreview,
  SellResult,
  UserMarketPosition,
} from './types';

const providers: PredictionMarketProvider[] = [achmarketProvider];

function sanitizeErrorReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Defense-in-depth: future predmarket providers may use API keys.
  return raw;
}

function requireProvider(name: string): PredictionMarketProvider {
  const provider = providers.find((p) => p.name === name);
  if (!provider) {
    throw new Error(`[predmarket/router] unknown provider: ${name}`);
  }
  return provider;
}

export async function listAllMarkets(filter?: MarketFilter): Promise<MarketSummary[]> {
  const attempts = await Promise.allSettled(
    providers.map(async (provider) => {
      const markets = await provider.listMarkets(filter);
      return { provider: provider.name, markets };
    }),
  );

  const allMarkets: MarketSummary[] = [];

  for (let index = 0; index < attempts.length; index++) {
    const providerName = providers[index]?.name ?? 'unknown';
    const attempt = attempts[index];

    if (attempt.status === 'fulfilled') {
      console.info(
        '[PREDMARKET_ROUTER_LIST]',
        JSON.stringify({
          provider: providerName,
          success: true,
          marketCount: attempt.value.markets.length,
          errorReason: null,
        }),
      );
      allMarkets.push(...attempt.value.markets);
    } else {
      console.info(
        '[PREDMARKET_ROUTER_LIST]',
        JSON.stringify({
          provider: providerName,
          success: false,
          marketCount: 0,
          errorReason: sanitizeErrorReason(attempt.reason),
        }),
      );
    }
  }

  return allMarkets;
}

export async function getMarketDetail(
  providerName: string,
  address: `0x${string}`,
): Promise<MarketDetail> {
  const provider = requireProvider(providerName);

  try {
    const detail = await provider.getMarketDetail(address);
    console.info(
      '[PREDMARKET_DETAIL]',
      JSON.stringify({
        provider: providerName,
        marketAddress: address,
        success: true,
        stage: detail.stage,
        errorReason: null,
      }),
    );
    return detail;
  } catch (error) {
    console.info(
      '[PREDMARKET_DETAIL]',
      JSON.stringify({
        provider: providerName,
        marketAddress: address,
        success: false,
        errorReason: sanitizeErrorReason(error),
      }),
    );
    throw error;
  }
}

export async function getProviderPosition(
  providerName: string,
  walletAddress: `0x${string}`,
  marketAddress: `0x${string}`,
): Promise<UserMarketPosition | null> {
  const provider = requireProvider(providerName);
  const positions = await provider.getUserPositions(walletAddress);
  return positions.find((position) => position.market.address === marketAddress) ?? null;
}

export async function getUserPositionsAcrossProviders(
  walletAddress: `0x${string}`,
): Promise<UserMarketPosition[]> {
  const attempts = await Promise.allSettled(
    providers.map(async (provider) => ({
      provider: provider.name,
      positions: await provider.getUserPositions(walletAddress),
    })),
  );

  const allPositions: UserMarketPosition[] = [];

  for (let index = 0; index < attempts.length; index++) {
    const providerName = providers[index]?.name ?? 'unknown';
    const attempt = attempts[index];

    if (attempt.status === 'fulfilled') {
      allPositions.push(...attempt.value.positions);
    } else {
      console.info(
        '[PREDMARKET_POSITIONS]',
        JSON.stringify({
          provider: providerName,
          walletAddress,
          success: false,
          errorReason: sanitizeErrorReason(attempt.reason),
        }),
      );
    }
  }

  return allPositions;
}

export async function previewBuy(
  providerName: string,
  marketAddress: `0x${string}`,
  outcomeIdx: number,
  sharesWadRaw: bigint,
  slippageBps: number,
): Promise<BuyPreview> {
  const provider = requireProvider(providerName);
  return provider.previewBuy(marketAddress, outcomeIdx, sharesWadRaw, slippageBps);
}

export async function previewSell(
  providerName: string,
  marketAddress: `0x${string}`,
  outcomeIdx: number,
  sharesWadRaw: bigint,
  slippageBps: number,
): Promise<SellPreview> {
  const provider = requireProvider(providerName);
  return provider.previewSell(marketAddress, outcomeIdx, sharesWadRaw, slippageBps);
}

export async function previewRedeem(
  providerName: string,
  marketAddress: `0x${string}`,
  walletAddress: `0x${string}`,
): Promise<RedeemPreview> {
  const provider = requireProvider(providerName);
  return provider.previewRedeem(marketAddress, walletAddress);
}

export async function previewRefund(
  providerName: string,
  marketAddress: `0x${string}`,
  walletAddress: `0x${string}`,
): Promise<RefundPreview> {
  const provider = requireProvider(providerName);
  return provider.previewRefund(marketAddress, walletAddress);
}

export async function executeBuy(
  providerName: string,
  params: BuyParams,
): Promise<BuyResult> {
  const provider = requireProvider(providerName);

  try {
    const result = await provider.buy(params);
    console.info(
      '[PREDMARKET_BUY]',
      JSON.stringify({
        provider: providerName,
        marketAddress: params.marketAddress,
        outcomeIdx: params.outcomeIdx,
        sharesReceivedRaw: result.sharesReceivedRaw.toString(),
        costPaidRaw: result.costPaidRaw.toString(),
        txHash: result.txHash,
      }),
    );
    return result;
  } catch (error) {
    console.info(
      '[PREDMARKET_BUY]',
      JSON.stringify({
        provider: providerName,
        marketAddress: params.marketAddress,
        success: false,
        errorReason: sanitizeErrorReason(error),
      }),
    );
    throw error;
  }
}

export async function executeSell(
  providerName: string,
  params: SellParams,
): Promise<SellResult> {
  const provider = requireProvider(providerName);

  try {
    const result = await provider.sell(params);
    console.info(
      '[PREDMARKET_SELL]',
      JSON.stringify({
        provider: providerName,
        marketAddress: params.marketAddress,
        outcomeIdx: params.outcomeIdx,
        sharesSoldRaw: result.sharesSoldRaw.toString(),
        proceedsReceivedRaw: result.proceedsReceivedRaw.toString(),
        txHash: result.txHash,
      }),
    );
    return result;
  } catch (error) {
    console.info(
      '[PREDMARKET_SELL]',
      JSON.stringify({
        provider: providerName,
        marketAddress: params.marketAddress,
        success: false,
        errorReason: sanitizeErrorReason(error),
      }),
    );
    throw error;
  }
}

export async function executeRedeem(
  providerName: string,
  params: RedeemParams,
): Promise<RedeemResult> {
  const provider = requireProvider(providerName);

  try {
    const result = await provider.redeem(params);
    console.info(
      '[PREDMARKET_REDEEM]',
      JSON.stringify({
        provider: providerName,
        marketAddress: params.marketAddress,
        payoutReceivedRaw: result.payoutReceivedRaw.toString(),
        txHash: result.txHash,
      }),
    );
    return result;
  } catch (error) {
    console.info(
      '[PREDMARKET_REDEEM]',
      JSON.stringify({
        provider: providerName,
        marketAddress: params.marketAddress,
        success: false,
        errorReason: sanitizeErrorReason(error),
      }),
    );
    throw error;
  }
}

export async function executeRefund(
  providerName: string,
  params: RefundParams,
): Promise<RefundResult> {
  const provider = requireProvider(providerName);

  try {
    const result = await provider.refund(params);
    console.info(
      '[PREDMARKET_REFUND]',
      JSON.stringify({
        provider: providerName,
        marketAddress: params.marketAddress,
        refundReceivedRaw: result.refundReceivedRaw.toString(),
        txHash: result.txHash,
      }),
    );
    return result;
  } catch (error) {
    console.info(
      '[PREDMARKET_REFUND]',
      JSON.stringify({
        provider: providerName,
        marketAddress: params.marketAddress,
        success: false,
        errorReason: sanitizeErrorReason(error),
      }),
    );
    throw error;
  }
}
