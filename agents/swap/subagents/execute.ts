import { createPublicClient, defineChain, getAddress, http, parseAbi } from 'viem';
import { ARC } from '../../../lib/arc-config';
import { executeSwap as executeDexSwap, getBestQuote } from '../../../lib/dex/router';

export interface SwapExecuteInput {
  userWalletAddress: string;
  userAgentWalletId: string;
  userAgentWalletAddress: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInRaw: bigint;
  minAmountOutRaw: bigint;
  provider?: string;
  routeData?: string;
  expectedOutRaw?: bigint;
  slippageBps?: number;
}

export interface SwapExecuteResult {
  txId: string;
  approvalTxId?: string;
  approvalTxHash?: `0x${string}`;
  approvalSkipped: boolean;
}

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);
const ARC_USDC = getAddress(
  process.env.ARC_USDC_ADDRESS?.trim() || '0x3600000000000000000000000000000000000000',
) as `0x${string}`;

export async function preflightSwapExecution(input: {
  userAgentWalletAddress: string;
  tokenIn: `0x${string}`;
  amountInRaw: bigint;
}): Promise<void> {
  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  const balance =
    getAddress(input.tokenIn) === ARC_USDC
      ? await client.getBalance({
          address: input.userAgentWalletAddress as `0x${string}`,
        })
      : ((await client.readContract({
          address: input.tokenIn,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [input.userAgentWalletAddress as `0x${string}`],
        })) as bigint);

  if (balance < input.amountInRaw) {
    throw new Error(
      '[swap/execute] Your AgentFlow execution wallet has insufficient token balance for this swap. Fund the execution wallet first.',
    );
  }
}

export async function executeSwap(input: SwapExecuteInput): Promise<SwapExecuteResult> {
  const quote =
    input.provider && input.routeData && input.expectedOutRaw
      ? {
          provider: input.provider,
          routeData: input.routeData,
          expectedOutRaw: input.expectedOutRaw,
        }
      : await getBestQuote({
          tokenIn: input.tokenIn,
          tokenOut: input.tokenOut,
          amountInRaw: input.amountInRaw,
          slippageBps: input.slippageBps ?? 100,
        });

  const result = await executeDexSwap(quote.provider, {
    walletId: input.userAgentWalletId,
    walletAddress: input.userAgentWalletAddress as `0x${string}`,
    recipient: input.userAgentWalletAddress as `0x${string}`,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountInRaw: input.amountInRaw,
    slippageBps: input.slippageBps ?? 100,
    routeData: quote.routeData,
    expectedOutRaw: quote.expectedOutRaw,
  });

  return {
    txId: result.txId,
    approvalTxId: result.approvalTxId,
    approvalTxHash: result.approvalTxHash,
    approvalSkipped: result.approvalSkipped,
  };
}

export {
  simulateSwapExecution,
  type SwapSimulationExecutionPayload,
} from './simulation';
