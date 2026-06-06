export type RouteSegment = {
  isV3: boolean;
  path: `0x${string}`[];
  fees: number[];
  bps: number;
};

export type QuoteParams = {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInRaw: bigint;
  slippageBps: number;
};

export type QuoteResult = {
  provider: string;
  expectedOutRaw: bigint;
  amountOutMinRaw: bigint;
  routeData: string;
  segments: RouteSegment[];
  tokenInDecimals: number;
  tokenOutDecimals: number;
  latencyMs: number;
};

export type SwapParams = {
  walletId: string;
  walletAddress: `0x${string}`;
  recipient: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInRaw: bigint;
  slippageBps: number;
  routeData: string;
  expectedOutRaw: bigint;
};

export type SwapResult = {
  provider: string;
  txId: string;
  approvalTxId?: string;
  approvalTxHash?: `0x${string}`;
  approvalSkipped: boolean;
  amountOutMinRaw: bigint;
};

export interface DexProvider {
  name: string;
  quote(params: QuoteParams): Promise<QuoteResult>;
  swap(params: SwapParams): Promise<SwapResult>;
  decodeRoute(routeData: string): Promise<RouteSegment[]>;
}
