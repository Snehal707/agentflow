import { createPublicClient, formatUnits, getAddress, http, parseAbi } from 'viem';
import { ARC } from '../../arc-config';
import { executeTransaction, waitForTransaction } from '../../dcw';
import type {
  DexProvider,
  QuoteParams,
  QuoteResult,
  RouteSegment,
  SwapParams,
  SwapResult,
} from '../types';

export const SWAPARC_POOL =
  '0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC' as const;

const ARC_USDC = getAddress(
  process.env.ARC_USDC_ADDRESS?.trim() || '0x3600000000000000000000000000000000000000',
) as `0x${string}`;

const ARC_EURC = getAddress(
  process.env.ARC_EURC_ADDRESS?.trim() || '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
) as `0x${string}`;

const ARC_SWPRC = getAddress(
  process.env.ARC_SWPRC_ADDRESS?.trim() || '0x0000000000000000000000000000000000000000',
) as `0x${string}`;

const poolAbi = parseAbi([
  'function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)',
  'function swap(uint256 i, uint256 j, uint256 dx) returns (uint256)',
  'function getBalances() view returns (uint256[])',
]);

const erc20ReadAbi = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
]);

const publicClient = createPublicClient({
  transport: http(ARC.alchemyRpc || ARC.rpc),
});

function tokenIndex(token: `0x${string}`): number {
  const normalized = getAddress(token);
  if (normalized === ARC_USDC) return 0;
  if (normalized === ARC_EURC) return 1;
  if (normalized === ARC_SWPRC) return 2;
  throw new Error(`[swaparc] unsupported token: ${token}`);
}

function tokenDecimals(token: `0x${string}`): number {
  const normalized = getAddress(token);
  if (normalized === ARC_USDC || normalized === ARC_EURC) return 6;
  if (normalized === ARC_SWPRC) return 18;
  throw new Error(`[swaparc] unsupported token decimals: ${token}`);
}

async function ensurePoolDepth(token: `0x${string}`, amountInRaw: bigint): Promise<void> {
  const balances = (await publicClient.readContract({
    address: SWAPARC_POOL,
    abi: poolAbi,
    functionName: 'getBalances',
  })) as readonly bigint[];

  const index = tokenIndex(token);
  const poolBalance = balances[index];
  if (!poolBalance || poolBalance <= 0n) {
    throw new Error('[swaparc] pool balance unavailable for input token');
  }

  if (amountInRaw * 10n >= poolBalance) {
    throw new Error('[swaparc] trade exceeds 10% of pool balance for this token');
  }
}

export const swaparcProvider: DexProvider = {
  name: 'swaparc',

  async quote(params: QuoteParams): Promise<QuoteResult> {
    const startedAt = Date.now();
    const i = tokenIndex(params.tokenIn);
    const j = tokenIndex(params.tokenOut);

    if (i === j) {
      throw new Error('[swaparc] tokenIn and tokenOut cannot be the same pool asset');
    }

    const expectedOutRaw = (await publicClient.readContract({
      address: SWAPARC_POOL,
      abi: poolAbi,
      functionName: 'get_dy',
      args: [BigInt(i), BigInt(j), params.amountInRaw],
    })) as bigint;

    if (expectedOutRaw <= 0n) {
      throw new Error('no swap route available for this pair on SwapArc');
    }

    const amountOutMinRaw =
      expectedOutRaw - (expectedOutRaw * BigInt(params.slippageBps)) / 10_000n;

    return {
      provider: this.name,
      expectedOutRaw,
      amountOutMinRaw,
      routeData: '0x',
      segments: [],
      tokenInDecimals: tokenDecimals(params.tokenIn),
      tokenOutDecimals: tokenDecimals(params.tokenOut),
      latencyMs: Date.now() - startedAt,
    };
  },

  async swap(params: SwapParams): Promise<SwapResult> {
    const i = tokenIndex(params.tokenIn);
    const j = tokenIndex(params.tokenOut);
    const tokenInDecimals = tokenDecimals(params.tokenIn);
    const amountOutMinRaw =
      params.expectedOutRaw - (params.expectedOutRaw * BigInt(params.slippageBps)) / 10_000n;

    await ensurePoolDepth(params.tokenIn, params.amountInRaw);

    const allowance = (await publicClient.readContract({
      address: params.tokenIn,
      abi: erc20ReadAbi,
      functionName: 'allowance',
      args: [params.walletAddress, SWAPARC_POOL],
    })) as bigint;

    let approvalTxId: string | undefined;
    let approvalTxHash: `0x${string}` | undefined;
    let approvalSkipped = allowance >= params.amountInRaw;

    if (!approvalSkipped) {
      const approval = (await executeTransaction({
        walletId: params.walletId,
        contractAddress: params.tokenIn,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [SWAPARC_POOL, params.amountInRaw.toString()],
        feeLevel: 'HIGH',
        usdcAmount: Number(formatUnits(params.amountInRaw, tokenInDecimals)),
      })) as { data?: { id?: string; transaction?: { id?: string } } };

      approvalTxId = approval.data?.transaction?.id || approval.data?.id;
      if (!approvalTxId) {
        throw new Error('[swaparc] approval did not return a transaction id');
      }

      const approvalReceipt = await waitForTransaction(approvalTxId, 'swaparc approval');
      approvalTxHash = approvalReceipt.txHash as `0x${string}` | undefined;
      if (approvalReceipt.state !== 'COMPLETE') {
        throw new Error(
          `[swaparc] approval failed: ${approvalReceipt.errorReason || approvalReceipt.errorDetails || approvalReceipt.state || 'unknown'}`
        );
      }
    }

    const swap = (await executeTransaction({
      walletId: params.walletId,
      contractAddress: SWAPARC_POOL,
      abiFunctionSignature: 'swap(uint256,uint256,uint256)',
      abiParameters: [i.toString(), j.toString(), params.amountInRaw.toString()],
      feeLevel: 'HIGH',
      usdcAmount: Number(formatUnits(params.amountInRaw, tokenInDecimals)),
    })) as { data?: { id?: string; transaction?: { id?: string } } };

    const txId = swap.data?.transaction?.id || swap.data?.id;
    if (!txId) {
      throw new Error('[swaparc] Circle contract execution did not return a transaction id');
    }

    const swapReceipt = await waitForTransaction(txId, 'swaparc swap');
    if (swapReceipt.state !== 'COMPLETE') {
      throw new Error(
        `[swaparc] swap failed: ${swapReceipt.errorReason || swapReceipt.errorDetails || swapReceipt.state || 'unknown'}`
      );
    }

    return {
      provider: this.name,
      txId,
      approvalTxId,
      approvalTxHash,
      approvalSkipped,
      amountOutMinRaw,
    };
  },

  async decodeRoute(_routeData: string): Promise<RouteSegment[]> {
    return [];
  },
};
