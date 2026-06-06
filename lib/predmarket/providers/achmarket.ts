import { createPublicClient, formatUnits, getAddress, http, parseAbi } from 'viem';
import { ARC } from '../../arc-config';
import { executeTransaction, waitForTransaction } from '../../dcw';
import type {
  BuyParams,
  BuyPreview,
  BuyResult,
  MarketDetail,
  MarketFilter,
  MarketStage,
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
} from '../types';
import { stageFromContract } from '../types';

export const ACHMARKET_FACTORY =
  getAddress('0xd7b122B12caCB299249f89be7F241a47f762f283') as `0x${string}`;
export const ACHMARKET_LENS =
  getAddress('0x8241ACa87D4Dee4CA167b1e172Ed955522599e70') as `0x${string}`;
export const ACHMARKET_NETWORK = 'testnet' as const;
export const ACHMARKET_LIST_PAGE_SIZE = 50;
export const PREDMARKET_DECIMALS = 18;
export const DEFAULT_SLIPPAGE_BPS = 500;

export const RESOLUTION_DISCLAIMER =
  'Markets are resolved manually by the AchMarket admin (factory owner) with a public proofUri for transparency. After deadline + 3-day grace period, anyone can trigger expiry refunds if the admin does not resolve.';
export const FEE_DISCLAIMER =
  '0.25% protocol fee taken from winning pool at resolution. Buy/sell trades have zero fees.';

export const FACTORY_ABI = parseAbi([
  'function totalMarkets() view returns (uint256)',
  'function getMarkets(uint256 offset, uint256 limit) view returns (address[])',
]);

export const LENS_ABI = parseAbi([
  'function getMarketSummaries(uint256 offset, uint256 limit) view returns ((address market, uint256 marketId, string title, string category, string imageUri, string[] outcomeLabels, int256[] impliedProbabilitiesWad, uint8 stage, uint256 winningOutcome, uint256 marketDeadline, uint256 totalVolumeWei, uint256 participants, int256 bWad)[])',
  'function getMarketDetail(address market) view returns ((address market, string title, string description, string category, string imageUri, string proofUri, string[] outcomeLabels, int256[] totalSharesWad, int256[] impliedProbabilitiesWad, uint8 stage, uint256 winningOutcome, uint256 createdAt, uint256 marketDeadline, int256 bWad, uint256 totalVolumeWei, uint256 participants, uint256 resolvedPoolWei, uint256 resolutionDeadline, string cancelReason, string cancelProofUri))',
  'function getUserPortfolio(address user) view returns ((address market, string title, string category, string[] outcomeLabels, uint256[] sharesPerOutcome, uint256 netDepositedWei, bool canRedeem, bool canRefund, bool hasRedeemed, bool hasRefunded, uint8 stage)[])',
]);

export const MARKET_ABI = parseAbi([
  'function previewBuy(uint256 outcomeIdx, uint256 sharesWad) view returns (uint256 costWei)',
  'function previewSell(uint256 outcomeIdx, uint256 sharesWad) view returns (uint256 proceedsWei)',
  'function getUserInfo(address user) view returns (uint256[] _shares, uint256 _netDeposited, bool _redeemed, bool _refunded, bool _canRedeem, bool _canRefund)',
  'function buy(uint256 outcomeIdx, uint256 sharesWad, uint256 maxCostWei) payable',
  'function sell(uint256 outcomeIdx, uint256 sharesWad, uint256 minReceiveWei)',
  'function redeem()',
  'function refund()',
]);

const publicClient = createPublicClient({
  transport: http(ARC.alchemyRpc || ARC.rpc),
});

type LensMarketSummary = {
  market: `0x${string}`;
  marketId: bigint;
  title: string;
  category: string;
  imageUri: string;
  outcomeLabels: string[];
  impliedProbabilitiesWad: bigint[];
  stage: number;
  winningOutcome: bigint;
  marketDeadline: bigint;
  totalVolumeWei: bigint;
  participants: bigint;
  bWad: bigint;
};

type LensMarketDetail = {
  market: `0x${string}`;
  title: string;
  description: string;
  category: string;
  imageUri: string;
  proofUri: string;
  outcomeLabels: string[];
  totalSharesWad: bigint[];
  impliedProbabilitiesWad: bigint[];
  stage: number;
  winningOutcome: bigint;
  createdAt: bigint;
  marketDeadline: bigint;
  bWad: bigint;
  totalVolumeWei: bigint;
  participants: bigint;
  resolvedPoolWei: bigint;
  resolutionDeadline: bigint;
  cancelReason: string;
  cancelProofUri: string;
};

type LensUserPortfolioRow = {
  market: `0x${string}`;
  title: string;
  category: string;
  outcomeLabels: string[];
  sharesPerOutcome: bigint[];
  netDepositedWei: bigint;
  canRedeem: boolean;
  canRefund: boolean;
  hasRedeemed: boolean;
  hasRefunded: boolean;
  stage: number;
};

function probabilityFromWad(wad: bigint): number {
  return Number(wad) / 1e18;
}

function formatUsdc(raw: bigint): string {
  return `${formatUnits(raw, PREDMARKET_DECIMALS)} USDC`;
}

function applySlippageBuy(costRaw: bigint, slippageBps: number): bigint {
  return (costRaw * BigInt(10000 + slippageBps)) / 10000n;
}

function applySlippageSell(proceedsRaw: bigint, slippageBps: number): bigint {
  return (proceedsRaw * BigInt(10000 - slippageBps)) / 10000n;
}

function normalizeSlippageBps(slippageBps?: number): number {
  if (slippageBps === undefined) {
    return DEFAULT_SLIPPAGE_BPS;
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10000) {
    throw new Error(`[predmarket/achmarket] invalid slippage bps: ${slippageBps}`);
  }
  return slippageBps;
}

function extractTxId(result: unknown): string {
  const tx = result as { data?: { id?: string; transaction?: { id?: string } } };
  const txId = tx.data?.transaction?.id || tx.data?.id;
  if (!txId) {
    throw new Error('[predmarket/achmarket] Circle contract execution did not return a transaction id');
  }
  return txId;
}

function toDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1000);
}

function noteSet(): string[] {
  return [RESOLUTION_DISCLAIMER, FEE_DISCLAIMER];
}

function matchesFilter(market: MarketSummary, filter?: MarketFilter): boolean {
  if (!filter) {
    return true;
  }

  if (
    filter.category &&
    market.category.toLowerCase() !== filter.category.trim().toLowerCase()
  ) {
    return false;
  }

  if (filter.stage && market.stage !== filter.stage) {
    return false;
  }

  if (filter.minVolumeRaw !== undefined && BigInt(market.totalVolumeRaw) < filter.minVolumeRaw) {
    return false;
  }

  if (
    filter.searchTerm &&
    !market.title.toLowerCase().includes(filter.searchTerm.trim().toLowerCase())
  ) {
    return false;
  }

  return true;
}

function mapSummaryRow(row: LensMarketSummary): MarketSummary {
  const stage = stageFromContract(Number(row.stage));

  return {
    provider: 'achmarket',
    address: getAddress(row.market) as `0x${string}`,
    marketId: row.marketId.toString(),
    title: row.title,
    category: row.category,
    imageUri: row.imageUri,
    outcomes: row.outcomeLabels.map((label, index) => ({
      label,
      impliedProbability: probabilityFromWad(row.impliedProbabilitiesWad[index] ?? 0n),
      totalSharesRaw: '0',
    })),
    stage,
    winningOutcome: stage === 'resolved' ? Number(row.winningOutcome) : null,
    deadline: toDate(row.marketDeadline),
    totalVolumeRaw: row.totalVolumeWei.toString(),
    totalVolumeFormatted: formatUsdc(row.totalVolumeWei),
    participantCount: Number(row.participants),
    bWadRaw: row.bWad.toString(),
    network: ACHMARKET_NETWORK,
    experimental: true,
    notes: noteSet(),
  };
}

function mapDetailRow(row: LensMarketDetail): MarketDetail {
  const stage = stageFromContract(Number(row.stage));

  return {
    provider: 'achmarket',
    address: getAddress(row.market) as `0x${string}`,
    // Lens detail does not return marketId, so we use the unique market address as a stable v1 fallback.
    marketId: getAddress(row.market).toLowerCase(),
    title: row.title,
    category: row.category,
    imageUri: row.imageUri,
    outcomes: row.outcomeLabels.map((label, index) => ({
      label,
      impliedProbability: probabilityFromWad(row.impliedProbabilitiesWad[index] ?? 0n),
      totalSharesRaw: (row.totalSharesWad[index] ?? 0n).toString(),
    })),
    stage,
    winningOutcome: stage === 'resolved' ? Number(row.winningOutcome) : null,
    deadline: toDate(row.marketDeadline),
    totalVolumeRaw: row.totalVolumeWei.toString(),
    totalVolumeFormatted: formatUsdc(row.totalVolumeWei),
    participantCount: Number(row.participants),
    bWadRaw: row.bWad.toString(),
    network: ACHMARKET_NETWORK,
    experimental: true,
    notes: noteSet(),
    description: row.description,
    proofUri: row.proofUri,
    resolvedPoolRaw: row.resolvedPoolWei.toString(),
    resolutionDeadline: toDate(row.resolutionDeadline),
    cancelReason: row.cancelReason,
    cancelProofUri: row.cancelProofUri,
  };
}

async function readMarketDetail(marketAddress: `0x${string}`): Promise<MarketDetail> {
  const detail = (await publicClient.readContract({
    address: ACHMARKET_LENS,
    abi: LENS_ABI,
    functionName: 'getMarketDetail',
    args: [getAddress(marketAddress) as `0x${string}`],
  })) as LensMarketDetail;

  return mapDetailRow(detail);
}

function assertPositiveRaw(name: string, value: bigint): void {
  if (value <= 0n) {
    throw new Error(`[predmarket/achmarket] ${name} must be greater than zero`);
  }
}

export const achmarketProvider: PredictionMarketProvider = {
  name: 'achmarket',

  async listMarkets(filter?: MarketFilter): Promise<MarketSummary[]> {
    const allMarkets: MarketSummary[] = [];
    let offset = 0n;

    while (allMarkets.length < 200) {
      const page = (await publicClient.readContract({
        address: ACHMARKET_LENS,
        abi: LENS_ABI,
        functionName: 'getMarketSummaries',
        args: [offset, BigInt(ACHMARKET_LIST_PAGE_SIZE)],
      })) as LensMarketSummary[];

      if (page.length === 0) {
        break;
      }

      allMarkets.push(...page.map(mapSummaryRow));

      if (page.length < ACHMARKET_LIST_PAGE_SIZE) {
        break;
      }

      offset += BigInt(ACHMARKET_LIST_PAGE_SIZE);
    }

    return allMarkets.slice(0, 200).filter((market) => matchesFilter(market, filter));
  },

  async getMarketDetail(marketAddress: `0x${string}`): Promise<MarketDetail> {
    return readMarketDetail(marketAddress);
  },

  async getUserPositions(walletAddress: `0x${string}`): Promise<UserMarketPosition[]> {
    let portfolio: LensUserPortfolioRow[];
    try {
      portfolio = (await publicClient.readContract({
        address: ACHMARKET_LENS,
        abi: LENS_ABI,
        functionName: 'getUserPortfolio',
        args: [getAddress(walletAddress) as `0x${string}`],
      })) as LensUserPortfolioRow[];
    } catch {
      return [];
    }

    return portfolio
      .map((position) => ({
        provider: 'achmarket',
        market: {
          address: getAddress(position.market) as `0x${string}`,
          title: position.title,
          category: position.category,
        },
        outcomes: position.outcomeLabels.map((label, index) => {
          const sharesRaw = position.sharesPerOutcome[index] ?? 0n;
          return {
            label,
            sharesRaw: sharesRaw.toString(),
            sharesFormatted: formatUnits(sharesRaw, PREDMARKET_DECIMALS),
          };
        }),
        netDepositedRaw: position.netDepositedWei.toString(),
        netDepositedFormatted: formatUsdc(position.netDepositedWei),
        canRedeem: position.canRedeem,
        canRefund: position.canRefund,
        hasRedeemed: position.hasRedeemed,
        hasRefunded: position.hasRefunded,
        stage: stageFromContract(Number(position.stage)),
      }))
      .filter(
        (position) =>
          position.canRefund || position.outcomes.some((outcome) => BigInt(outcome.sharesRaw) > 0n),
      );
  },

  async previewBuy(
    marketAddress: `0x${string}`,
    outcomeIdx: number,
    sharesWadRaw: bigint,
    slippageBps = DEFAULT_SLIPPAGE_BPS,
  ): Promise<BuyPreview> {
    assertPositiveRaw('sharesWadRaw', sharesWadRaw);
    const effectiveSlippageBps = normalizeSlippageBps(slippageBps);

    const [costRaw, detail] = await Promise.all([
      publicClient.readContract({
        address: getAddress(marketAddress) as `0x${string}`,
        abi: MARKET_ABI,
        functionName: 'previewBuy',
        args: [BigInt(outcomeIdx), sharesWadRaw],
      }) as Promise<bigint>,
      readMarketDetail(marketAddress),
    ]);

    const outcome = detail.outcomes[outcomeIdx];
    if (!outcome) {
      throw new Error(`[predmarket/achmarket] invalid outcome index: ${outcomeIdx}`);
    }

    const maxCostRaw = applySlippageBuy(costRaw, effectiveSlippageBps);

    return {
      marketAddress: getAddress(marketAddress) as `0x${string}`,
      outcomeIdx,
      outcomeLabel: outcome.label,
      sharesWadRaw: sharesWadRaw.toString(),
      sharesFormatted: formatUnits(sharesWadRaw, PREDMARKET_DECIMALS),
      costRaw: costRaw.toString(),
      costFormatted: formatUsdc(costRaw),
      slippageBps: effectiveSlippageBps,
      maxCostRaw: maxCostRaw.toString(),
      maxCostFormatted: formatUsdc(maxCostRaw),
      currentImpliedProbability: outcome.impliedProbability,
    };
  },

  async previewSell(
    marketAddress: `0x${string}`,
    outcomeIdx: number,
    sharesWadRaw: bigint,
    slippageBps = DEFAULT_SLIPPAGE_BPS,
  ): Promise<SellPreview> {
    assertPositiveRaw('sharesWadRaw', sharesWadRaw);
    const effectiveSlippageBps = normalizeSlippageBps(slippageBps);

    const [proceedsRaw, detail] = await Promise.all([
      publicClient.readContract({
        address: getAddress(marketAddress) as `0x${string}`,
        abi: MARKET_ABI,
        functionName: 'previewSell',
        args: [BigInt(outcomeIdx), sharesWadRaw],
      }) as Promise<bigint>,
      readMarketDetail(marketAddress),
    ]);

    const outcome = detail.outcomes[outcomeIdx];
    if (!outcome) {
      throw new Error(`[predmarket/achmarket] invalid outcome index: ${outcomeIdx}`);
    }

    const minReceiveRaw = applySlippageSell(proceedsRaw, effectiveSlippageBps);

    return {
      marketAddress: getAddress(marketAddress) as `0x${string}`,
      outcomeIdx,
      outcomeLabel: outcome.label,
      sharesWadRaw: sharesWadRaw.toString(),
      sharesFormatted: formatUnits(sharesWadRaw, PREDMARKET_DECIMALS),
      proceedsRaw: proceedsRaw.toString(),
      proceedsFormatted: formatUsdc(proceedsRaw),
      slippageBps: effectiveSlippageBps,
      minReceiveRaw: minReceiveRaw.toString(),
      minReceiveFormatted: formatUsdc(minReceiveRaw),
    };
  },

  async previewRedeem(
    marketAddress: `0x${string}`,
    walletAddress: `0x${string}`,
  ): Promise<RedeemPreview> {
    const userInfo = (await publicClient.readContract({
      address: getAddress(marketAddress) as `0x${string}`,
      abi: MARKET_ABI,
      functionName: 'getUserInfo',
      args: [getAddress(walletAddress) as `0x${string}`],
    })) as readonly [bigint[], bigint, boolean, boolean, boolean, boolean];

    const [_shares, _netDeposited, _redeemed, _refunded, _canRedeem] = userInfo;

    if (!_canRedeem) {
      return {
        marketAddress: getAddress(marketAddress) as `0x${string}`,
        expectedPayoutRaw: '0',
        expectedPayoutFormatted: '0 USDC',
        canRedeem: false,
        reason: 'Market not resolved or user has no winning position',
      };
    }

    const detail = await readMarketDetail(marketAddress);
    const winningOutcome = detail.winningOutcome;
    if (winningOutcome === null) {
      return {
        marketAddress: getAddress(marketAddress) as `0x${string}`,
        expectedPayoutRaw: '0',
        expectedPayoutFormatted: '0 USDC',
        canRedeem: false,
        reason: 'Market not resolved or user has no winning position',
      };
    }

    const userWinningShares = _shares[winningOutcome] ?? 0n;
    const totalWinningShares = BigInt(detail.outcomes[winningOutcome]?.totalSharesRaw ?? '0');
    if (totalWinningShares <= 0n) {
      return {
        marketAddress: getAddress(marketAddress) as `0x${string}`,
        expectedPayoutRaw: '0',
        expectedPayoutFormatted: '0 USDC',
        canRedeem: false,
        reason: 'Winning share supply is zero',
      };
    }

    const expectedPayoutRaw =
      (BigInt(detail.resolvedPoolRaw) * userWinningShares) / totalWinningShares;

    return {
      marketAddress: getAddress(marketAddress) as `0x${string}`,
      expectedPayoutRaw: expectedPayoutRaw.toString(),
      expectedPayoutFormatted: formatUsdc(expectedPayoutRaw),
      canRedeem: true,
    };
  },

  async previewRefund(
    marketAddress: `0x${string}`,
    walletAddress: `0x${string}`,
  ): Promise<RefundPreview> {
    const userInfo = (await publicClient.readContract({
      address: getAddress(marketAddress) as `0x${string}`,
      abi: MARKET_ABI,
      functionName: 'getUserInfo',
      args: [getAddress(walletAddress) as `0x${string}`],
    })) as readonly [bigint[], bigint, boolean, boolean, boolean, boolean];

    const [, netDepositedRaw, , , , canRefund] = userInfo;

    if (!canRefund) {
      return {
        marketAddress: getAddress(marketAddress) as `0x${string}`,
        expectedRefundRaw: '0',
        expectedRefundFormatted: '0 USDC',
        canRefund: false,
        reason: 'Market not cancelled or expired, or already refunded',
      };
    }

    return {
      marketAddress: getAddress(marketAddress) as `0x${string}`,
      expectedRefundRaw: netDepositedRaw.toString(),
      expectedRefundFormatted: formatUsdc(netDepositedRaw),
      canRefund: true,
    };
  },

  async buy(params: BuyParams): Promise<BuyResult> {
    assertPositiveRaw('sharesWadRaw', params.sharesWadRaw);
    assertPositiveRaw('maxCostRaw', params.maxCostRaw);

    const tx = await executeTransaction({
      walletId: params.walletId,
      contractAddress: getAddress(params.marketAddress),
      abiFunctionSignature: 'buy(uint256,uint256,uint256)',
      abiParameters: [
        String(params.outcomeIdx),
        params.sharesWadRaw.toString(),
        params.maxCostRaw.toString(),
      ],
      amount: formatUnits(params.maxCostRaw, PREDMARKET_DECIMALS),
      feeLevel: 'HIGH',
      usdcAmount: Number(formatUnits(params.maxCostRaw, PREDMARKET_DECIMALS)),
    });

    const txId = extractTxId(tx);
    const receipt = await waitForTransaction(txId, 'achmarket-buy');
    if (receipt.state !== 'COMPLETE' || !receipt.txHash) {
      throw new Error(
        `[predmarket/achmarket] buy failed: ${receipt.errorReason || receipt.errorDetails || receipt.state || 'unknown'}`,
      );
    }

    return {
      provider: this.name,
      txId,
      txHash: receipt.txHash as `0x${string}`,
      outcomeIdx: params.outcomeIdx,
      sharesReceivedRaw: params.sharesWadRaw,
      costPaidRaw: params.maxCostRaw,
    };
  },

  async sell(params: SellParams): Promise<SellResult> {
    assertPositiveRaw('sharesWadRaw', params.sharesWadRaw);

    const tx = await executeTransaction({
      walletId: params.walletId,
      contractAddress: getAddress(params.marketAddress),
      abiFunctionSignature: 'sell(uint256,uint256,uint256)',
      abiParameters: [
        String(params.outcomeIdx),
        params.sharesWadRaw.toString(),
        params.minReceiveRaw.toString(),
      ],
      feeLevel: 'HIGH',
    });

    const txId = extractTxId(tx);
    const receipt = await waitForTransaction(txId, 'achmarket-sell');
    if (receipt.state !== 'COMPLETE' || !receipt.txHash) {
      throw new Error(
        `[predmarket/achmarket] sell failed: ${receipt.errorReason || receipt.errorDetails || receipt.state || 'unknown'}`,
      );
    }

    return {
      provider: this.name,
      txId,
      txHash: receipt.txHash as `0x${string}`,
      outcomeIdx: params.outcomeIdx,
      sharesSoldRaw: params.sharesWadRaw,
      proceedsReceivedRaw: params.minReceiveRaw,
    };
  },

  async redeem(params: RedeemParams): Promise<RedeemResult> {
    const tx = await executeTransaction({
      walletId: params.walletId,
      contractAddress: getAddress(params.marketAddress),
      abiFunctionSignature: 'redeem()',
      abiParameters: [],
      feeLevel: 'HIGH',
    });

    const txId = extractTxId(tx);
    const receipt = await waitForTransaction(txId, 'achmarket-redeem');
    if (receipt.state !== 'COMPLETE' || !receipt.txHash) {
      throw new Error(
        `[predmarket/achmarket] redeem failed: ${receipt.errorReason || receipt.errorDetails || receipt.state || 'unknown'}`,
      );
    }

    return {
      provider: this.name,
      txId,
      txHash: receipt.txHash as `0x${string}`,
      payoutReceivedRaw: 0n,
    };
  },

  async refund(params: RefundParams): Promise<RefundResult> {
    const tx = await executeTransaction({
      walletId: params.walletId,
      contractAddress: getAddress(params.marketAddress),
      abiFunctionSignature: 'refund()',
      abiParameters: [],
      feeLevel: 'HIGH',
    });

    const txId = extractTxId(tx);
    const receipt = await waitForTransaction(txId, 'achmarket-refund');
    if (receipt.state !== 'COMPLETE' || !receipt.txHash) {
      throw new Error(
        `[predmarket/achmarket] refund failed: ${receipt.errorReason || receipt.errorDetails || receipt.state || 'unknown'}`,
      );
    }

    return {
      provider: this.name,
      txId,
      txHash: receipt.txHash as `0x${string}`,
      refundReceivedRaw: 0n,
    };
  },
};
