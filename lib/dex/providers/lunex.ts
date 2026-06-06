import {
  createPublicClient,
  decodeFunctionData,
  formatUnits,
  getAddress,
  http,
  parseAbi,
} from 'viem';
import { ARC } from '../../arc-config';
import { executeTransaction, waitForTransaction } from '../../dcw';
import { lunexFetch, LunexRateLimitError } from '../../lunex-client';
import type {
  DexProvider,
  QuoteParams,
  QuoteResult,
  RouteSegment,
  SwapParams,
  SwapResult,
} from '../types';

export { LunexRateLimitError } from '../../lunex-client';

export const LUNEX_CHAIN_ID = 5_042_002;
export const LUNEX_USDC = getAddress(
  '0x3600000000000000000000000000000000000000',
) as `0x${string}`;
export const LUNEX_EURC = getAddress(
  '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
) as `0x${string}`;
export const LUNEX_DEFAULT_POOL = getAddress(
  '0xC24BFc8e4b10500a72A63Bec98CCC989CbDA41d8',
) as `0x${string}`;

const SUPPORTED_TOKENS = new Set<string>([LUNEX_USDC, LUNEX_EURC]);

const erc20ReadAbi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
]);

// Lunex pool uses a Curve-style variant whose exchange selector is
// 0x5b41b908 = exchange(uint256,uint256,uint256,uint256), not the
// canonical int128-based signature.
const stableSwapAbi = parseAbi([
  'function exchange(uint256 i, uint256 j, uint256 dx, uint256 min_dy) returns (uint256)',
]);
const LUNEX_EXCHANGE_SELECTOR = '0x5b41b908';

const publicClient = createPublicClient({
  transport: http(ARC.alchemyRpc || ARC.rpc),
});

type LunexRouteEntry = {
  protocol?: string;
  pool?: string;
  tokenIn?: string;
  tokenOut?: string;
};

type LunexQuoteApiResponse = {
  success?: boolean;
  data?: {
    amountOut?: string;
    priceImpact?: number;
    route?: LunexRouteEntry[];
    estimatedGas?: string;
    fees?: unknown;
  };
  meta?: {
    protocol?: string;
    chainId?: string | number | bigint;
    chainName?: string;
    timestamp?: string;
  };
};

type LunexSwapTx = {
  to: string;
  data: `0x${string}`;
  value?: string | number | bigint | null;
  gasLimit?: string | number | bigint | null;
  chainId: string | number | bigint;
};

type LunexSwapApiResponse =
  | {
      success?: boolean;
      data?: {
        approveTransaction?: LunexSwapTx;
        swapTransaction?: LunexSwapTx;
        expectedOutput?: string;
        minimumOutput?: string;
        slippagePercent?: number;
        tokenIn?: {
          address?: string;
          symbol?: string;
          decimals?: number;
        };
        tokenOut?: {
          address?: string;
          symbol?: string;
          decimals?: number;
        };
      };
      meta?: {
        protocol?: string;
        chainId?: string | number | bigint;
        chainName?: string;
        pool?: string;
        timestamp?: string;
      };
    }
  | {
      tx?: LunexSwapTx;
      transaction?: LunexSwapTx;
      data?: LunexSwapTx;
      meta?: {
        chainId?: string | number | bigint;
        chainName?: string;
        timestamp?: string;
      };
    }
  | LunexSwapTx;

type LunexSwapResponseData = {
  approveTransaction?: LunexSwapTx;
  swapTransaction?: LunexSwapTx;
  expectedOutput?: string;
  minimumOutput?: string;
  slippagePercent?: number;
  tokenIn?: {
    address?: string;
    symbol?: string;
    decimals?: number;
  };
  tokenOut?: {
    address?: string;
    symbol?: string;
    decimals?: number;
  };
};

function lunexPercentFromBps(slippageBps: number): number {
  return slippageBps / 100;
}

function computeMinOutFromBps(expectedOutRaw: bigint, slippageBps: number): bigint {
  return (expectedOutRaw * BigInt(10_000 - slippageBps)) / 10_000n;
}

function assertLunexSwapMinimumOutput(input: {
  expectedOutput: string;
  minimumOutput: string;
  slippageBps: number;
}): bigint {
  const expected = BigInt(input.expectedOutput);
  const actualMin = BigInt(input.minimumOutput);
  const expectedMinFloor = computeMinOutFromBps(expected, input.slippageBps);
  const toleratedFloor = (expectedMinFloor * 95n) / 100n;

  if (actualMin < toleratedFloor) {
    throw new Error(
      `Lunex returned minimumOutput ${actualMin} but expected ~${expectedMinFloor} for ${input.slippageBps} bps slippage. Refusing to sign - Lunex slippage semantics may have changed.`,
    );
  }

  return actualMin;
}

function assertSupportedToken(address: `0x${string}`): `0x${string}` {
  const normalized = getAddress(address);
  if (!SUPPORTED_TOKENS.has(normalized)) {
    throw new Error(`[lunex] unsupported token for Lunex: ${normalized}`);
  }
  return normalized as `0x${string}`;
}

function parseRouteData(route: LunexRouteEntry[] | undefined): string {
  return JSON.stringify(route ?? []);
}

function getAllowedLunexPools(): Set<string> {
  const configured = process.env.LUNEX_POOL_WHITELIST?.trim();
  const rawEntries = configured ? configured.split(',') : [LUNEX_DEFAULT_POOL];
  return new Set(
    rawEntries
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => getAddress(entry)),
  );
}

function parseRouteSegments(routeData: string): RouteSegment[] {
  const parsed = JSON.parse(routeData) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('[lunex] route data must decode to an array');
  }

  return parsed.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('[lunex] route entries must be objects');
    }

    const routeEntry = entry as LunexRouteEntry;
    if (!routeEntry.tokenIn || !routeEntry.tokenOut) {
      throw new Error('[lunex] route entry missing tokenIn or tokenOut');
    }

    return {
      isV3: false,
      path: [
        getAddress(routeEntry.tokenIn) as `0x${string}`,
        getAddress(routeEntry.tokenOut) as `0x${string}`,
      ],
      fees: [],
      bps: 10_000,
    };
  });
}

function extractSwapTx(payload: LunexSwapApiResponse): LunexSwapTx {
  if ('to' in payload && typeof payload.to === 'string') {
    return payload;
  }

  const nestedPayload = payload as {
    data?: {
      swapTransaction?: LunexSwapTx;
    };
  };
  if (nestedPayload.data?.swapTransaction) {
    return nestedPayload.data.swapTransaction;
  }

  const wrappedPayload = payload as {
    tx?: LunexSwapTx;
    transaction?: LunexSwapTx;
    data?: LunexSwapTx;
  };
  const candidate =
    wrappedPayload.tx ?? wrappedPayload.transaction ?? wrappedPayload.data;

  if (!candidate?.to || !candidate.data) {
    throw new Error('[lunex] swap response did not include a transaction payload');
  }

  return candidate;
}

function extractLunexSwapResponseData(
  payload: LunexSwapApiResponse,
): LunexSwapResponseData | undefined {
  if (!('data' in payload)) {
    return undefined;
  }

  const candidate = payload.data;
  if (!candidate || typeof candidate !== 'object' || 'to' in candidate) {
    return undefined;
  }

  return candidate as LunexSwapResponseData;
}

export const lunexProvider: DexProvider = {
  name: 'lunex',

  async quote(params: QuoteParams): Promise<QuoteResult> {
    const startedAt = Date.now();
    const tokenIn = assertSupportedToken(params.tokenIn);
    const tokenOut = assertSupportedToken(params.tokenOut);
    const slippagePercent = lunexPercentFromBps(params.slippageBps);

    const query = new URLSearchParams({
      tokenIn,
      tokenOut,
      amountIn: params.amountInRaw.toString(),
      slippage: String(slippagePercent),
    });

    const response = await lunexFetch<LunexQuoteApiResponse>(
      `/dex-quote?${query.toString()}`,
    );

    const responseChainId = Number(response.meta?.chainId);
    if (responseChainId !== LUNEX_CHAIN_ID) {
      throw new Error(
        `Lunex quote response chainId ${responseChainId}, expected 5042002 (Arc Testnet)`,
      );
    }

    const amountOut = response.data?.amountOut;
    if (!amountOut) {
      throw new Error('[lunex] quote response missing data.amountOut');
    }

    const expectedOutRaw = BigInt(amountOut);
    if (expectedOutRaw <= 0n) {
      throw new Error('no swap route available for this pair on Lunex');
    }

    const amountOutMinRaw = computeMinOutFromBps(expectedOutRaw, params.slippageBps);
    const routeData = parseRouteData(response.data?.route);

    return {
      provider: this.name,
      expectedOutRaw,
      amountOutMinRaw,
      routeData,
      segments: parseRouteSegments(routeData),
      tokenInDecimals: 6,
      tokenOutDecimals: 6,
      latencyMs: Date.now() - startedAt,
    };
  },

  async swap(params: SwapParams): Promise<SwapResult> {
    const tokenIn = assertSupportedToken(params.tokenIn);
    const tokenOut = assertSupportedToken(params.tokenOut);
    const slippagePercent = lunexPercentFromBps(params.slippageBps);

    const response = await lunexFetch<LunexSwapApiResponse>('/dex-swap', {
      method: 'POST',
      body: JSON.stringify({
        walletAddress: params.walletAddress,
        tokenIn,
        tokenOut,
        amountIn: params.amountInRaw.toString(),
        slippage: slippagePercent,
      }),
    });

    const responseChainId = Number(
      'meta' in response && response.meta ? response.meta.chainId : undefined,
    );
    if (Number.isFinite(responseChainId) && responseChainId !== LUNEX_CHAIN_ID) {
      throw new Error(
        `Lunex swap response chainId ${responseChainId}, expected 5042002. Refusing to sign.`,
      );
    }

    const nestedData = extractLunexSwapResponseData(response);
    if (!nestedData?.expectedOutput || !nestedData.minimumOutput) {
      throw new Error('[lunex] swap response missing expectedOutput or minimumOutput');
    }

    const guardedMinimumOutput = assertLunexSwapMinimumOutput({
      expectedOutput: nestedData.expectedOutput,
      minimumOutput: nestedData.minimumOutput,
      slippageBps: params.slippageBps,
    });

    const tx = extractSwapTx(response);
    const chainId = Number(tx.chainId);
    if (chainId !== LUNEX_CHAIN_ID) {
      throw new Error(
        `Lunex returned chainId ${chainId}, expected 5042002. Refusing to sign.`,
      );
    }

    const allowedPools = getAllowedLunexPools();
    const spender = getAddress(tx.to) as `0x${string}`;
    if (!allowedPools.has(spender)) {
      throw new Error(
        `[lunex] swap target ${spender} is not in LUNEX_POOL_WHITELIST. Refusing to sign.`,
      );
    }

    const allowance = (await publicClient.readContract({
      address: params.tokenIn,
      abi: erc20ReadAbi,
      functionName: 'allowance',
      args: [params.walletAddress, spender],
    })) as bigint;

    let approvalTxId: string | undefined;
    let approvalTxHash: `0x${string}` | undefined;
    let approvalSkipped = true;

    if (allowance < params.amountInRaw) {
      approvalSkipped = false;
      const approval = (await executeTransaction({
        walletId: params.walletId,
        contractAddress: params.tokenIn,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [spender, params.amountInRaw.toString()],
        feeLevel: 'HIGH',
        usdcAmount: Number(formatUnits(params.amountInRaw, 6)),
      })) as { data?: { id?: string; transaction?: { id?: string } } };

      approvalTxId = approval.data?.transaction?.id || approval.data?.id;
      if (!approvalTxId) {
        throw new Error('[lunex] Circle approval did not return a transaction id');
      }

      const approvalReceipt = await waitForTransaction(approvalTxId, 'lunex-approval');
      if (approvalReceipt.state !== 'COMPLETE' || !approvalReceipt.txHash) {
        throw new Error(
          `[lunex] approval failed: ${approvalReceipt.errorReason || approvalReceipt.state || 'unknown'}`,
        );
      }
      approvalTxHash = approvalReceipt.txHash as `0x${string}`;
    }

    const selector = tx.data.slice(0, 10).toLowerCase();
    if (selector !== LUNEX_EXCHANGE_SELECTOR) {
      throw new Error(
        `Lunex returned unexpected function selector ${selector} - expected ${LUNEX_EXCHANGE_SELECTOR}. Refusing to sign.`,
      );
    }

    const decoded = decodeFunctionData({
      abi: stableSwapAbi,
      data: tx.data,
    });

    if (decoded.functionName !== 'exchange') {
      throw new Error(`[lunex] unsupported swap calldata: ${decoded.functionName}`);
    }

    const [i, j, dx, minDy] = decoded.args;
    const valueRaw = BigInt(tx.value ?? 0);

    const swap = (await executeTransaction({
      walletId: params.walletId,
      amount: valueRaw > 0n ? formatUnits(valueRaw, 18) : undefined,
      contractAddress: spender,
      abiFunctionSignature: 'exchange(uint256,uint256,uint256,uint256)',
      abiParameters: [i.toString(), j.toString(), dx.toString(), minDy.toString()],
      feeLevel: 'HIGH',
      usdcAmount: Number(formatUnits(params.amountInRaw, 6)),
    })) as { data?: { id?: string; transaction?: { id?: string } } };

    const txId = swap.data?.transaction?.id || swap.data?.id;
    if (!txId) {
      throw new Error('[lunex] Circle swap execution did not return a transaction id');
    }

    const swapReceipt = await waitForTransaction(txId, 'lunex-swap');
    if (swapReceipt.state !== 'COMPLETE' || !swapReceipt.txHash) {
      throw new Error(
        `[lunex] swap failed: ${swapReceipt.errorReason || swapReceipt.state || 'unknown'}`,
      );
    }

    return {
      provider: this.name,
      txId,
      approvalTxId,
      approvalTxHash,
      approvalSkipped,
      amountOutMinRaw: guardedMinimumOutput,
    };
  },

  async decodeRoute(routeData: string): Promise<RouteSegment[]> {
    return parseRouteSegments(routeData);
  },
};
