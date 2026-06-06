import { createPublicClient, formatUnits, getAddress, http, parseAbi, zeroAddress } from 'viem';
import { ARC } from '../../arc-config';
import { executeTransaction } from '../../dcw';
import type {
  DexProvider,
  QuoteParams,
  QuoteResult,
  RouteSegment,
  SwapParams,
  SwapResult,
} from '../types';

export const ACHSWAP_ADAPTER =
  '0xF82c88FbF46E109a3865647E5c4d4834b31f8AFB' as const;

const ARC_USDC = getAddress(
  process.env.ARC_USDC_ADDRESS?.trim() || '0x3600000000000000000000000000000000000000',
) as `0x${string}`;

const erc20ReadAbi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

const adapterAbi = parseAbi([
  'function quote(address tokenIn,address tokenOut,uint256 amountIn) view returns (uint256 amountOut, bytes routeData)',
  'function swap(address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOutMin,address recipient,bytes routeData) payable returns (uint256 amountOut)',
  'function minOut(uint256 amountOut,uint16 slippageBps) pure returns (uint256)',
  'function decodeRoute(bytes routeData) pure returns ((bool isV3,address[] path,uint24[] fees,uint16 bps)[])',
]);

const publicClient = createPublicClient({
  transport: http(ARC.alchemyRpc || ARC.rpc),
});

const LOGICAL_STABLE_DECIMALS = 6;
const NATIVE_USDC_SCALE_FACTOR = 10n ** 12n;

type RawRouteSegment = {
  isV3: boolean;
  path: readonly `0x${string}`[];
  fees: readonly number[];
  bps: number;
};

function normalizeAdapterToken(token: `0x${string}`): `0x${string}` {
  return getAddress(token) === ARC_USDC ? zeroAddress : getAddress(token);
}

function isArcNativeUsdc(token: `0x${string}`): boolean {
  const normalized = getAddress(token);
  return normalized === ARC_USDC || normalized === zeroAddress;
}

function scaleAmountForAchSwap(
  token: `0x${string}`,
  amountInRaw: bigint,
): bigint {
  return isArcNativeUsdc(token) ? amountInRaw * NATIVE_USDC_SCALE_FACTOR : amountInRaw;
}

async function readTokenDecimals(token: `0x${string}`): Promise<number> {
  if (getAddress(token) === zeroAddress) {
    return 18;
  }
  return Number(
    await publicClient.readContract({
      address: token,
      abi: erc20ReadAbi,
      functionName: 'decimals',
    }),
  );
}

function mapRouteSegments(segments: readonly RawRouteSegment[]): RouteSegment[] {
  return segments.map((segment) => ({
    isV3: segment.isV3,
    path: segment.path.map((address) => getAddress(address)) as `0x${string}`[],
    fees: segment.fees.map((fee) => Number(fee)),
    bps: Number(segment.bps),
  }));
}

export const achswapProvider: DexProvider = {
  name: 'achswap',

  async quote(params: QuoteParams): Promise<QuoteResult> {
    const startedAt = Date.now();
    const tokenIn = normalizeAdapterToken(params.tokenIn);
    const tokenOut = normalizeAdapterToken(params.tokenOut);
    const amountInRaw = scaleAmountForAchSwap(tokenIn, params.amountInRaw);

    const [tokenInDecimals, tokenOutDecimals, quoteResult] = await Promise.all([
      Promise.resolve(
        isArcNativeUsdc(tokenIn) ? LOGICAL_STABLE_DECIMALS : readTokenDecimals(tokenIn),
      ),
      readTokenDecimals(tokenOut),
      publicClient.readContract({
        address: ACHSWAP_ADAPTER,
        abi: adapterAbi,
        functionName: 'quote',
        args: [tokenIn, tokenOut, amountInRaw],
      }) as unknown as Promise<readonly [bigint, `0x${string}`]>,
    ]);

    const [expectedOutRaw, routeData] = quoteResult;
    if (expectedOutRaw <= 0n) {
      throw new Error('no swap route available for this pair on AchSwap');
    }

    const [amountOutMinRaw, segments] = await Promise.all([
      publicClient.readContract({
        address: ACHSWAP_ADAPTER,
        abi: adapterAbi,
        functionName: 'minOut',
        args: [expectedOutRaw, params.slippageBps],
      }) as Promise<bigint>,
      this.decodeRoute(routeData),
    ]);

    return {
      provider: this.name,
      expectedOutRaw,
      amountOutMinRaw,
      routeData,
      segments,
      tokenInDecimals,
      tokenOutDecimals,
      latencyMs: Date.now() - startedAt,
    };
  },

  async swap(params: SwapParams): Promise<SwapResult> {
    const tokenIn = normalizeAdapterToken(params.tokenIn);
    const tokenOut = normalizeAdapterToken(params.tokenOut);
    const tokenInDecimals = isArcNativeUsdc(tokenIn)
      ? LOGICAL_STABLE_DECIMALS
      : await readTokenDecimals(tokenIn);
    const amountInRaw = scaleAmountForAchSwap(tokenIn, params.amountInRaw);
    const amountOutMinRaw = (await publicClient.readContract({
      address: ACHSWAP_ADAPTER,
      abi: adapterAbi,
      functionName: 'minOut',
      args: [params.expectedOutRaw, params.slippageBps],
    })) as bigint;

    let approvalTxId: string | undefined;
    let approvalSkipped = true;

    if (!isArcNativeUsdc(tokenIn)) {
      const allowance = (await publicClient.readContract({
        address: tokenIn,
        abi: erc20ReadAbi,
        functionName: 'allowance',
        args: [params.walletAddress, ACHSWAP_ADAPTER],
      })) as bigint;

      if (allowance < amountInRaw) {
        approvalSkipped = false;
        const approval = (await executeTransaction({
          walletId: params.walletId,
          contractAddress: tokenIn,
          abiFunctionSignature: 'approve(address,uint256)',
          abiParameters: [ACHSWAP_ADAPTER, amountInRaw.toString()],
          feeLevel: 'HIGH',
          usdcAmount: Number(formatUnits(params.amountInRaw, tokenInDecimals)),
        })) as { data?: { id?: string; transaction?: { id?: string } } };
        approvalTxId = approval.data?.transaction?.id || approval.data?.id;
      }
    }

    const swap = (await executeTransaction({
      walletId: params.walletId,
      amount: isArcNativeUsdc(tokenIn)
        ? formatUnits(amountInRaw, 18)
        : undefined,
      contractAddress: ACHSWAP_ADAPTER,
      abiFunctionSignature: 'swap(address,address,uint256,uint256,address,bytes)',
      abiParameters: [
        tokenIn,
        tokenOut,
        amountInRaw.toString(),
        amountOutMinRaw.toString(),
        params.recipient,
        params.routeData,
      ],
      feeLevel: 'HIGH',
      usdcAmount: Number(formatUnits(params.amountInRaw, tokenInDecimals)),
    })) as { data?: { id?: string; transaction?: { id?: string } } };

    const txId = swap.data?.transaction?.id || swap.data?.id;
    if (!txId) {
      throw new Error('[achswap] Circle contract execution did not return a transaction id');
    }

    return {
      provider: this.name,
      txId,
      approvalTxId,
      approvalSkipped,
      amountOutMinRaw,
    };
  },

  async decodeRoute(routeData: string): Promise<RouteSegment[]> {
    const segments = (await publicClient.readContract({
      address: ACHSWAP_ADAPTER,
      abi: adapterAbi,
      functionName: 'decodeRoute',
      args: [routeData as `0x${string}`],
    })) as readonly RawRouteSegment[];

    return mapRouteSegments(segments);
  },
};
