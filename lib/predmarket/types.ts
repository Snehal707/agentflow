/**
 * Predmarket runs in 18-decimal native USDC throughout. Unlike swap (which uses
 * logical 6-dec at chat boundary), predmarket is 18-dec from chat input through
 * DCW signing because Arc AchMarket markets are natively 18-dec and
 * unit-consistent across shares/cost/probability. See AchMarket docs and
 * Asif's clarification.
 */

export type MarketStage = 'active' | 'suspended' | 'resolved' | 'cancelled' | 'expired';

/**
 * Maps to PredictionMarket contract's stage uint8:
 * 0=Active, 1=Suspended, 2=Resolved, 3=Cancelled, 4=Expired
 */
export function stageFromContract(stage: number): MarketStage {
  switch (stage) {
    case 0:
      return 'active';
    case 1:
      return 'suspended';
    case 2:
      return 'resolved';
    case 3:
      return 'cancelled';
    case 4:
      return 'expired';
    default:
      throw new Error(`[predmarket/types] unknown contract stage: ${stage}`);
  }
}

export function stageToContract(stage: MarketStage): number {
  switch (stage) {
    case 'active':
      return 0;
    case 'suspended':
      return 1;
    case 'resolved':
      return 2;
    case 'cancelled':
      return 3;
    case 'expired':
      return 4;
    default: {
      const exhaustive: never = stage;
      throw new Error(`[predmarket/types] unknown market stage: ${exhaustive}`);
    }
  }
}

export type MarketOutcome = {
  label: string;
  impliedProbability: number;
  totalSharesRaw: string;
};

export type MarketSummary = {
  provider: string;
  address: `0x${string}`;
  marketId: string;
  title: string;
  category: string;
  imageUri: string;
  outcomes: MarketOutcome[];
  stage: MarketStage;
  winningOutcome: number | null;
  deadline: Date;
  totalVolumeRaw: string;
  totalVolumeFormatted: string;
  participantCount: number;
  bWadRaw: string;
  network: 'testnet' | 'mainnet';
  experimental: boolean;
  notes: string[];
};

export type MarketDetail = MarketSummary & {
  description: string;
  proofUri: string;
  resolvedPoolRaw: string;
  resolutionDeadline: Date;
  cancelReason: string;
  cancelProofUri: string;
};

export type UserMarketPosition = {
  provider: string;
  market: {
    address: `0x${string}`;
    title: string;
    category: string;
  };
  outcomes: Array<{
    label: string;
    sharesRaw: string;
    sharesFormatted: string;
  }>;
  netDepositedRaw: string;
  netDepositedFormatted: string;
  canRedeem: boolean;
  canRefund: boolean;
  hasRedeemed: boolean;
  hasRefunded: boolean;
  stage: MarketStage;
};

export type BuyPreview = {
  marketAddress: `0x${string}`;
  outcomeIdx: number;
  outcomeLabel: string;
  sharesWadRaw: string;
  sharesFormatted: string;
  costRaw: string;
  costFormatted: string;
  slippageBps: number;
  maxCostRaw: string;
  maxCostFormatted: string;
  currentImpliedProbability: number;
};

export type SellPreview = {
  marketAddress: `0x${string}`;
  outcomeIdx: number;
  outcomeLabel: string;
  sharesWadRaw: string;
  sharesFormatted: string;
  proceedsRaw: string;
  proceedsFormatted: string;
  slippageBps: number;
  minReceiveRaw: string;
  minReceiveFormatted: string;
};

export type RedeemPreview = {
  marketAddress: `0x${string}`;
  expectedPayoutRaw: string;
  expectedPayoutFormatted: string;
  canRedeem: boolean;
  reason?: string;
};

export type RefundPreview = {
  marketAddress: `0x${string}`;
  expectedRefundRaw: string;
  expectedRefundFormatted: string;
  canRefund: boolean;
  reason?: string;
};

export type BuyParams = {
  walletId: string;
  walletAddress: `0x${string}`;
  marketAddress: `0x${string}`;
  outcomeIdx: number;
  sharesWadRaw: bigint;
  maxCostRaw: bigint;
};

export type BuyResult = {
  provider: string;
  txId: string;
  txHash: `0x${string}`;
  outcomeIdx: number;
  sharesReceivedRaw: bigint;
  costPaidRaw: bigint;
};

export type SellParams = {
  walletId: string;
  walletAddress: `0x${string}`;
  marketAddress: `0x${string}`;
  outcomeIdx: number;
  sharesWadRaw: bigint;
  minReceiveRaw: bigint;
};

export type SellResult = {
  provider: string;
  txId: string;
  txHash: `0x${string}`;
  outcomeIdx: number;
  sharesSoldRaw: bigint;
  proceedsReceivedRaw: bigint;
};

export type RedeemParams = {
  walletId: string;
  walletAddress: `0x${string}`;
  marketAddress: `0x${string}`;
};

export type RedeemResult = {
  provider: string;
  txId: string;
  txHash: `0x${string}`;
  payoutReceivedRaw: bigint;
};

export type RefundParams = {
  walletId: string;
  walletAddress: `0x${string}`;
  marketAddress: `0x${string}`;
};

export type RefundResult = {
  provider: string;
  txId: string;
  txHash: `0x${string}`;
  refundReceivedRaw: bigint;
};

export type MarketFilter = {
  category?: string;
  stage?: MarketStage;
  minVolumeRaw?: bigint;
  searchTerm?: string;
};

export interface PredictionMarketProvider {
  name: string;

  listMarkets(filter?: MarketFilter): Promise<MarketSummary[]>;
  getMarketDetail(marketAddress: `0x${string}`): Promise<MarketDetail>;
  getUserPositions(walletAddress: `0x${string}`): Promise<UserMarketPosition[]>;

  previewBuy(
    marketAddress: `0x${string}`,
    outcomeIdx: number,
    sharesWadRaw: bigint,
    slippageBps: number,
  ): Promise<BuyPreview>;

  previewSell(
    marketAddress: `0x${string}`,
    outcomeIdx: number,
    sharesWadRaw: bigint,
    slippageBps: number,
  ): Promise<SellPreview>;

  previewRedeem(
    marketAddress: `0x${string}`,
    walletAddress: `0x${string}`,
  ): Promise<RedeemPreview>;

  previewRefund(
    marketAddress: `0x${string}`,
    walletAddress: `0x${string}`,
  ): Promise<RefundPreview>;

  buy(params: BuyParams): Promise<BuyResult>;
  sell(params: SellParams): Promise<SellResult>;
  redeem(params: RedeemParams): Promise<RedeemResult>;
  refund(params: RefundParams): Promise<RefundResult>;
}
