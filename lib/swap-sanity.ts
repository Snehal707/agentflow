import { resolveArcTokenSymbol } from './swap-symbols';

export interface SwapSanityConfig {
  maxPriceImpactPct: number;
  defaultStableMinOutRatio: number;
  defaultStableMaxOutRatio: number;
  stableBands: Record<string, { min: number; max: number }>;
}

function parsePositiveNumber(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function stableBandFromEnv(
  prefix: string,
  fallbackMin: number,
  fallbackMax: number,
): { min: number; max: number } {
  const min = parsePositiveNumber(`${prefix}_MIN`, fallbackMin);
  const max = parsePositiveNumber(`${prefix}_MAX`, fallbackMax);
  if (min >= max) {
    return { min: fallbackMin, max: fallbackMax };
  }
  return { min, max };
}

export function getSwapSanityConfig(): SwapSanityConfig {
  const usdcUsdt = stableBandFromEnv('SWAP_SANITY_USDC_USDT', 0.95, 1.05);
  const usdcDai = stableBandFromEnv('SWAP_SANITY_USDC_DAI', 0.95, 1.05);
  const usdcEurc = stableBandFromEnv('SWAP_SANITY_USDC_EURC', 0.8, 1.2);
  const defaultBand = stableBandFromEnv('SWAP_SANITY_DEFAULT', 0.85, 1.15);

  return {
    maxPriceImpactPct: parsePositiveNumber('SWAP_MAX_PRICE_IMPACT_PCT', 15),
    defaultStableMinOutRatio: defaultBand.min,
    defaultStableMaxOutRatio: defaultBand.max,
    stableBands: {
      'USDC-USDT': usdcUsdt,
      'USDT-USDC': usdcUsdt,
      'USDC-DAI': usdcDai,
      'DAI-USDC': usdcDai,
      'USDC-EURC': usdcEurc,
      'EURC-USDC': usdcEurc,
    },
  };
}

function stableSymbolForToken(token: `0x${string}`): string | null {
  const usdc = resolveArcTokenSymbol('USDC');
  const eurc = resolveArcTokenSymbol('EURC');
  const usdt = resolveArcTokenSymbol('USDT');
  const dai = resolveArcTokenSymbol('DAI');
  const normalized = token.toLowerCase();

  if (usdc && normalized === usdc.toLowerCase()) return 'USDC';
  if (eurc && normalized === eurc.toLowerCase()) return 'EURC';
  if (usdt && normalized === usdt.toLowerCase()) return 'USDT';
  if (dai && normalized === dai.toLowerCase()) return 'DAI';
  return null;
}

const NORMALIZED_STABLE_DECIMALS = 6;

function normalizeStableAmount(amountRaw: bigint, decimals: number): bigint {
  if (decimals === NORMALIZED_STABLE_DECIMALS) return amountRaw;
  if (decimals < NORMALIZED_STABLE_DECIMALS) {
    return amountRaw * 10n ** BigInt(NORMALIZED_STABLE_DECIMALS - decimals);
  }
  return amountRaw / 10n ** BigInt(decimals - NORMALIZED_STABLE_DECIMALS);
}

function formatRatio(value: number): string {
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function getStablePairKey(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
): string | null {
  const inSym = stableSymbolForToken(tokenIn);
  const outSym = stableSymbolForToken(tokenOut);
  if (!inSym || !outSym || inSym === outSym) {
    return null;
  }
  return `${inSym}-${outSym}`;
}

export function getStableBandForPair(pairKey: string): { min: number; max: number } {
  const cfg = getSwapSanityConfig();
  return (
    cfg.stableBands[pairKey] ?? {
      min: cfg.defaultStableMinOutRatio,
      max: cfg.defaultStableMaxOutRatio,
    }
  );
}

export function evaluateStableRateBand(input: {
  pairKey: string;
  quotedRate: number;
}): { ok: true } | { ok: false; min: number; max: number } {
  const band = getStableBandForPair(input.pairKey);
  if (input.quotedRate < band.min || input.quotedRate > band.max) {
    return { ok: false, min: band.min, max: band.max };
  }
  return { ok: true };
}

/**
 * Block obviously unsafe swap quotes before execution (Telegram + HTTP swap agent).
 * - Price impact above SWAP_MAX_PRICE_IMPACT_PCT (default 15).
 * - For stable/stable pairs: implied output/input must stay within a pair-aware safe band.
 */
export function evaluateSwapSanity(input: {
  amountInRaw: bigint;
  amountOutRaw: bigint;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  priceImpactPct: number | null;
  tokenInDecimals?: number;
  tokenOutDecimals?: number;
  provider?: string | null;
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
        'Quoted output is zero - the swap would revert on-chain. Try a smaller amount or check liquidity.',
    };
  }

  const pairKey = getStablePairKey(input.tokenIn, input.tokenOut);
  if (pairKey) {
    const normalizedAmountIn = normalizeStableAmount(
      input.amountInRaw,
      input.tokenInDecimals ?? NORMALIZED_STABLE_DECIMALS,
    );
    const normalizedAmountOut = normalizeStableAmount(
      input.amountOutRaw,
      input.tokenOutDecimals ?? NORMALIZED_STABLE_DECIMALS,
    );
    const quotedRate = Number(normalizedAmountOut) / Number(normalizedAmountIn);

    if (!Number.isFinite(quotedRate) || quotedRate <= 0) {
      return {
        ok: false,
        reason: 'Unable to evaluate quoted stable rate safely.',
      };
    }

    const rateCheck = evaluateStableRateBand({ pairKey, quotedRate });
    if (!rateCheck.ok) {
      console.warn(
        '[SWAP_SANITY_BLOCKED]',
        JSON.stringify({
          pair: pairKey,
          quotedRate,
          configuredMin: rateCheck.min,
          configuredMax: rateCheck.max,
          provider: input.provider ?? null,
          amountInRaw: input.amountInRaw.toString(),
          expectedOutRaw: input.amountOutRaw.toString(),
          reason: 'rate_band',
        }),
      );
      return {
        ok: false,
        reason:
          `Quoted rate ${formatRatio(quotedRate)} is outside the configured safe range for ` +
          `${pairKey} (${formatRatio(rateCheck.min)}-${formatRatio(rateCheck.max)}). ` +
          `This is set conservatively - to override for testnet, contact admin or set env ` +
          `SWAP_SANITY_${pairKey.replace('-', '_')}_MIN/MAX.`,
      };
    }
  }

  return { ok: true };
}
