import { createPublicClient, defineChain, http, parseAbiItem } from 'viem';
import { ARC } from '../../../lib/arc-config';

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

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

export async function fetchSwapQuote(input: SwapQuoteInput): Promise<SwapQuoteResult> {
  const contractAddress = ARC.swapContract?.trim() as `0x${string}`;
  if (!contractAddress) {
    throw new Error('[swap/price] SWAP_CONTRACT_ADDRESS is required');
  }

  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  const candidates = [
    {
      signature:
        'function getQuote(address tokenIn,address tokenOut,uint256 amountIn) view returns (uint256 amountOut, uint256 fee)',
      functionName: 'getQuote',
      args: [input.tokenIn, input.tokenOut, input.amountIn] as const,
      source: 'getQuote',
    },
    {
      signature:
        'function getQuote(address tokenIn,address tokenOut,uint256 amountIn) view returns (uint256 amountOut)',
      functionName: 'getQuote',
      args: [input.tokenIn, input.tokenOut, input.amountIn] as const,
      source: 'getQuote',
    },
    {
      signature:
        'function quote(address tokenIn,address tokenOut,uint256 amountIn) view returns (uint256 amountOut)',
      functionName: 'quote',
      args: [input.tokenIn, input.tokenOut, input.amountIn] as const,
      source: 'quote',
    },
    {
      signature:
        'function getAmountOut(address tokenIn,address tokenOut,uint256 amountIn) view returns (uint256 amountOut)',
      functionName: 'getAmountOut',
      args: [input.tokenIn, input.tokenOut, input.amountIn] as const,
      source: 'getAmountOut',
    },
  ] as const;

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const out = (await client.readContract({
        address: contractAddress,
        abi: [parseAbiItem(candidate.signature)],
        functionName: candidate.functionName,
        args: candidate.args,
      })) as unknown;
      const parsed = normalizeQuoteOutput(out);
      return {
        amountOut: parsed.amountOut,
        feeRaw: parsed.feeRaw,
        source: candidate.source,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`[swap/price] Unable to fetch quote from swap contract: ${String(lastError)}`);
}

function normalizeQuoteOutput(
  output: unknown,
): { amountOut: bigint; feeRaw?: bigint } {
  if (typeof output === 'bigint') {
    return { amountOut: output };
  }

  if (Array.isArray(output) && typeof output[0] === 'bigint') {
    return {
      amountOut: output[0],
      feeRaw: typeof output[1] === 'bigint' ? output[1] : undefined,
    };
  }

  if (output && typeof output === 'object') {
    const candidate = output as Record<string, unknown>;
    const amountOut = candidate.amountOut;
    const fee = candidate.fee;
    if (typeof amountOut === 'bigint') {
      return {
        amountOut,
        feeRaw: typeof fee === 'bigint' ? fee : undefined,
      };
    }
  }

  throw new Error(`[swap/price] Unexpected quote output: ${String(output)}`);
}
