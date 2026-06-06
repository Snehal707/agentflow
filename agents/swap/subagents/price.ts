import { getBestQuote } from '../../../lib/dex/router';

export interface SwapQuoteInput {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
}

export interface SwapQuoteResult {
  amountOut: bigint;
  feeRaw?: bigint;
  source: string;
}

/**
 * Placeholder quote until 0x API integration replaces deprecated AgentFlowSwap.
 * No backend code should call AgentFlowSwap.sol.
 */
export async function fetchSwapQuote(input: SwapQuoteInput): Promise<SwapQuoteResult> {
  const quote = await getBestQuote({
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountInRaw: input.amountIn,
    slippageBps: 100,
  });
  return {
    amountOut: quote.expectedOutRaw,
    feeRaw: undefined,
    source: quote.provider,
  };
}
