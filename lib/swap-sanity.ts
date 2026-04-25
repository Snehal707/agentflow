import { resolveArcTokenSymbol } from './swap-symbols';

export interface SwapSanityConfig {
  maxPriceImpactPct: number;
  stableMinOutRatioBps: bigint;
  stableMaxOutRatioBps: bigint;
}

function parsePositiveNumber(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Ratio bounds for USDC↔EURC (same decimals); adjustable via env. */
export function getSwapSanityConfig(): SwapSanityConfig {
  const minRatio = parsePositiveNumber('SWAP_STABLE_MIN_OUT_RATIO', 0.92);
  const maxRatio = parsePositiveNumber('SWAP_STABLE_MAX_OUT_RATIO', 1.08);
  const minBps = BigInt(Math.round(minRatio * 10_000));
  const maxBps = BigInt(Math.round(maxRatio * 10_000));
  return {
    maxPriceImpactPct: parsePositiveNumber('SWAP_MAX_PRICE_IMPACT_PCT', 15),
    stableMinOutRatioBps: minBps,
    stableMaxOutRatioBps: maxBps,
  };
}

function isArcStablePair(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
): boolean {
  const usdc = resolveArcTokenSymbol('USDC');
  const eurc = resolveArcTokenSymbol('EURC');
  if (!usdc || !eurc) return false;
  const a = tokenIn.toLowerCase();
  const b = tokenOut.toLowerCase();
  const s = new Set([usdc.toLowerCase(), eurc.toLowerCase()]);
  return s.has(a) && s.has(b);
}

const BPS = 10_000n;

/**
 * Block obviously unsafe swap quotes before execution (Telegram + HTTP swap agent).
 * - Price impact above SWAP_MAX_PRICE_IMPACT_PCT (default 15).
 * - For Arc USDC↔EURC: implied output/input must stay within stable ratio band (defaults 0.92–1.08).
 */
export function evaluateSwapSanity(input: {
  amountInRaw: bigint;
  amountOutRaw: bigint;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  priceImpactPct: number | null;
}): { ok: true } | { ok: false; reason: string } {
  const cfg = getSwapSanityConfig();

  if (input.amountInRaw <= 0n) {
    return { ok: false, reason: 'Invalid swap amount.' };
  }

  if (input.priceImpactPct !== null && input.priceImpactPct > cfg.maxPriceImpactPct) {
    return {
      ok: false,
      reason: `Price impact ~${input.priceImpactPct.toFixed(2)}% exceeds the safety limit (${cfg.maxPriceImpactPct}%). Try a smaller trade or add liquidity.`,
    };
  }

  if (input.amountOutRaw === 0n) {
    return {
      ok: false,
      reason:
        'Quoted output is zero — the swap would revert on-chain. Try a smaller amount or check liquidity.',
    };
  }

  if (isArcStablePair(input.tokenIn, input.tokenOut)) {
    if (input.amountOutRaw * BPS < input.amountInRaw * cfg.stableMinOutRatioBps) {
      return {
        ok: false,
        reason:
          'Quoted USDC/EURC rate is too far from parity (likely thin or imbalanced pool). Add liquidity or try a smaller amount.',
      };
    }
    if (input.amountOutRaw * BPS > input.amountInRaw * cfg.stableMaxOutRatioBps) {
      return {
        ok: false,
        reason:
          'Quoted USDC/EURC rate is outside the safe band. Pool state may be unhealthy — try again later.',
      };
    }
  }

  return { ok: true };
}
