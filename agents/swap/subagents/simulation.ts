import { formatUnits, parseUnits } from 'viem';
import { getOrCreateUserAgentWallet } from '../../../lib/dcw';
import { evaluateSwapSanity } from '../../../lib/swap-sanity';
import { fetchSwapQuote } from './price';
import { calculateOptimalSlippage } from './slippage';
import { preflightSwapExecution } from './execute';

const DEFAULT_SLIPPAGE = Number(process.env.TELEGRAM_SWAP_DEFAULT_SLIPPAGE ?? '1');

/** Same min-out math as runners / swap server. */
export function applySwapSlippage(amountOut: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round(slippagePercent * 100));
  const scale = BigInt(10_000);
  return (amountOut * (scale - bps)) / scale;
}

/**
 * Compare implied output-per-input at full size vs a tiny probe size.
 * Large divergence suggests price impact from moving the pool (constant-product style).
 * Returns null if not computable (zero tiny quote, etc.).
 */
export async function computeSwapPriceImpactPercent(input: {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInFull: bigint;
  quoteFullOut: bigint;
}): Promise<number | null> {
  const probeIn = choosePriceImpactProbeAmount(input.amountInFull);
  if (probeIn === null) {
    return null;
  }
  try {
    const tinyQuote = await fetchSwapQuote({
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: probeIn,
    });
    if (tinyQuote.amountOut === 0n) {
      return null;
    }
    const outPerInFull = Number(input.quoteFullOut) / Number(input.amountInFull);
    const outPerInTiny = Number(tinyQuote.amountOut) / Number(probeIn);
    if (!Number.isFinite(outPerInFull) || !Number.isFinite(outPerInTiny) || outPerInTiny <= 0) {
      return null;
    }
    return (Math.abs(outPerInFull - outPerInTiny) / outPerInTiny) * 100;
  } catch {
    return null;
  }
}

function choosePriceImpactProbeAmount(amountInFull: bigint): bigint | null {
  if (amountInFull <= 1n) {
    return null;
  }

  const minProbe = 10_000n; // 0.01 token at 6 decimals, avoids fee-rounding-to-zero probes.
  const maxProbe = 1_000_000n; // 1 token at 6 decimals.
  let probe = amountInFull / 100n; // 1% of trade size.

  if (probe < minProbe) {
    probe = minProbe;
  }
  if (probe > maxProbe) {
    probe = maxProbe;
  }
  if (probe >= amountInFull) {
    probe = amountInFull / 2n;
  }
  return probe > 0n ? probe : null;
}

export interface SwapSimulationExecutionPayload {
  walletAddress: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amount: number;
  amountRaw: string;
  minAmountOutRaw: string;
  requestedSlippage: number;
  optimalSlippage: number;
  priceImpactPct: number | null;
  quoteAmountOutRaw: string;
  quoteFeeRaw: string | null;
  quoteSource: string;
  fromSym: string;
  toSym: string;
}

export interface SwapSimulationResult {
  ok: boolean;
  blockReason?: string;
  warnings: string[];
  /** Telegram-ready block (without outer wrapper). */
  summaryLines: string[];
  payload?: SwapSimulationExecutionPayload;
}

export async function simulateSwapExecution(input: {
  walletAddress: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amount: number;
  fromSym: string;
  toSym: string;
  requestedSlippage?: number;
}): Promise<SwapSimulationResult> {
  const requestedSlippage =
    Number.isFinite(input.requestedSlippage) && (input.requestedSlippage ?? 0) > 0
      ? Number(input.requestedSlippage)
      : DEFAULT_SLIPPAGE;

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, blockReason: 'Amount must be positive.', warnings: [], summaryLines: [] };
  }

  const amountRaw = parseUnits(input.amount.toFixed(6), 6);
  const userAgentWallet = await getOrCreateUserAgentWallet(input.walletAddress);

  await preflightSwapExecution({
    userAgentWalletAddress: userAgentWallet.address,
    tokenIn: input.tokenIn,
    amountInRaw: amountRaw,
  });

  const quote = await fetchSwapQuote({
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: amountRaw,
  });

  if (quote.amountOut === 0n) {
    return {
      ok: false,
      blockReason:
        'Quoted output is zero — the swap would revert on-chain. Try a smaller amount or check liquidity.',
      warnings: [],
      summaryLines: [],
    };
  }

  const slippageResult = await calculateOptimalSlippage({
    walletAddress: input.walletAddress,
    tokenPair: `${input.tokenIn}/${input.tokenOut}`,
    requestedSlippage,
  });

  const minAmountOutRaw = applySwapSlippage(quote.amountOut, slippageResult.optimalSlippage);

  const priceImpactPct = await computeSwapPriceImpactPercent({
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountInFull: amountRaw,
    quoteFullOut: quote.amountOut,
  });

  const sanity = evaluateSwapSanity({
    amountInRaw: amountRaw,
    amountOutRaw: quote.amountOut,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    priceImpactPct,
  });
  if (!sanity.ok) {
    return { ok: false, blockReason: sanity.reason, warnings: [], summaryLines: [] };
  }

  const warnings: string[] = [];
  if (slippageResult.optimalSlippage > 3) {
    warnings.push(
      `Slippage tolerance is ${slippageResult.optimalSlippage.toFixed(2)}% (> 3%).`,
    );
  }
  if (priceImpactPct !== null && priceImpactPct > 5) {
    warnings.push(`Price impact ~${priceImpactPct.toFixed(2)}% (> 5%).`);
  }

  const outFormatted = formatUnits(quote.amountOut, 6);
  const minOutFormatted = formatUnits(minAmountOutRaw, 6);
  const feeLine =
    quote.feeRaw !== undefined && quote.feeRaw !== null
      ? `${formatTokenAmount(formatUnits(quote.feeRaw, 6))} USDC`
      : '—';

  const impactLine = formatPercentForTelegram(priceImpactPct);

  const checksLine =
    warnings.length === 0
      ? 'Simulation passed all checks'
      : 'Simulation passed with warnings (see above)';

  const summaryLines = [
    '📊 Simulation result:',
    '',
    `Input:  ${input.amount.toFixed(2)} ${input.fromSym.toUpperCase()}`,
    `Output: ${formatTokenAmount(outFormatted)} ${input.toSym.toUpperCase()} (guaranteed minimum ${formatTokenAmount(minOutFormatted)} ${input.toSym.toUpperCase()})`,
    `Fee:    ${feeLine}`,
    `Price impact: ${impactLine}`,
    `Slippage: ${slippageResult.optimalSlippage.toFixed(2)}%`,
    '',
    warnings.length > 0 ? `⚠️ ${warnings.join(' ')}` : `✅ ${checksLine}`,
    '',
    'Execute? Reply YES or NO.',
  ];

  const payload: SwapSimulationExecutionPayload = {
    walletAddress: input.walletAddress,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amount,
    amountRaw: amountRaw.toString(),
    minAmountOutRaw: minAmountOutRaw.toString(),
    requestedSlippage,
    optimalSlippage: slippageResult.optimalSlippage,
    priceImpactPct,
    quoteAmountOutRaw: quote.amountOut.toString(),
    quoteFeeRaw: quote.feeRaw?.toString() ?? null,
    quoteSource: quote.source,
    fromSym: input.fromSym,
    toSym: input.toSym,
  };

  return { ok: true, warnings, summaryLines, payload };
}

function formatTokenAmount(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  if (numeric === 0) {
    return '0';
  }
  if (numeric >= 1) {
    return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function formatPercentForTelegram(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }
  if (value > 0 && value < 0.01) {
    return '<0.01%';
  }
  return `${value.toFixed(2)}%`;
}
