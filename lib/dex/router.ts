import { formatUnits, getAddress } from 'viem';
import { swaparcProvider } from './providers/swaparc';
import { achswapProvider } from './providers/achswap';
import { lunexProvider, LunexRateLimitError } from './providers/lunex';
import { resolveArcTokenSymbol } from '../swap-symbols';
import { evaluateStableRateBand, getStablePairKey } from '../swap-sanity';
import type { DexProvider, QuoteParams, QuoteResult, SwapParams, SwapResult } from './types';

const providers: DexProvider[] = [swaparcProvider, achswapProvider, lunexProvider];

export function getDexProviderNames(): string[] {
  return providers.map((provider) => provider.name);
}

function sanitizeErrorReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.LUNEX_API_KEY?.trim();
  if (!apiKey) {
    return raw;
  }
  return raw.split(apiKey).join('[REDACTED]');
}

function isPlausibleQuote(
  quote: QuoteResult,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountInRaw: bigint,
  tokenInDecimals: number,
  tokenOutDecimals: number,
): boolean {
  const normalizedTokenInDecimals = getLogicalStableDecimals(tokenIn) ?? tokenInDecimals;
  const normalizedTokenOutDecimals = getLogicalStableDecimals(tokenOut) ?? tokenOutDecimals;
  const amountIn = Number(amountInRaw) / 10 ** normalizedTokenInDecimals;
  const amountOut = Number(quote.expectedOutRaw) / 10 ** normalizedTokenOutDecimals;

  if (!Number.isFinite(amountIn) || !Number.isFinite(amountOut) || amountIn <= 0 || amountOut <= 0) {
    return false;
  }

  const impliedRate = amountOut / amountIn;
  return impliedRate >= 0.5 && impliedRate <= 2.0;
}

function getImpliedRate(
  quote: QuoteResult,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountInRaw: bigint,
): number | null {
  const normalizedTokenInDecimals =
    getLogicalStableDecimals(tokenIn) ?? quote.tokenInDecimals;
  const normalizedTokenOutDecimals =
    getLogicalStableDecimals(tokenOut) ?? quote.tokenOutDecimals;
  const amountIn = Number(amountInRaw) / 10 ** normalizedTokenInDecimals;
  const amountOut = Number(quote.expectedOutRaw) / 10 ** normalizedTokenOutDecimals;

  if (!Number.isFinite(amountIn) || !Number.isFinite(amountOut) || amountIn <= 0 || amountOut <= 0) {
    return null;
  }

  return amountOut / amountIn;
}

function formatCompactAmount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  if (value === 0) return '0';
  if (value >= 100) return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  if (value >= 1) return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function getLogicalStableDecimals(token: `0x${string}`): number | null {
  const normalized = getAddress(token);
  const usdc = resolveArcTokenSymbol('USDC');
  const eurc = resolveArcTokenSymbol('EURC');
  if (usdc && normalized === getAddress(usdc)) return 6;
  if (eurc && normalized === getAddress(eurc)) return 6;
  return null;
}

export async function getBestQuote(params: QuoteParams): Promise<QuoteResult> {
  const attempts = await Promise.allSettled(
    providers.map(async (provider) => {
      const quote = await provider.quote(params);
      return { provider: provider.name, quote };
    }),
  );

  const successful: QuoteResult[] = [];

  for (let index = 0; index < attempts.length; index++) {
    const providerName = providers[index]?.name ?? 'unknown';
    const attempt = attempts[index];

    if (attempt.status === 'fulfilled') {
      const { provider, quote } = attempt.value;
      console.info(
        '[DEX_ROUTER_QUOTE]',
        JSON.stringify({
          provider,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountInRaw: params.amountInRaw.toString(),
          success: true,
          expectedOutRaw: quote.expectedOutRaw.toString(),
          latencyMs: quote.latencyMs,
          errorReason: null,
        }),
      );
      successful.push(quote);
    } else {
      if (attempt.reason instanceof LunexRateLimitError) {
        console.warn(
          '[DEX_ROUTER_RATE_LIMITED]',
          JSON.stringify({
            provider: providerName,
            window: '60_per_min',
          }),
        );
      }

      const message = sanitizeErrorReason(attempt.reason);
      console.info(
        '[DEX_ROUTER_QUOTE]',
        JSON.stringify({
          provider: providerName,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountInRaw: params.amountInRaw.toString(),
          success: false,
          expectedOutRaw: null,
          latencyMs: null,
          errorReason: message,
        }),
      );
    }
  }

  if (!successful.length) {
    throw new Error('no swap route available for this pair on any configured DEX provider');
  }

  const plausible = successful.filter((quote) => {
    const ok = isPlausibleQuote(
      quote,
      params.tokenIn,
      params.tokenOut,
      params.amountInRaw,
      quote.tokenInDecimals,
      quote.tokenOutDecimals,
    );

    if (!ok) {
      const impliedRate = getImpliedRate(
        quote,
        params.tokenIn,
        params.tokenOut,
        params.amountInRaw,
      );
      console.warn(
        '[DEX_ROUTER_IMPLAUSIBLE_QUOTE]',
        JSON.stringify({
          provider: quote.provider,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountInRaw: params.amountInRaw.toString(),
          expectedOutRaw: quote.expectedOutRaw.toString(),
          tokenInDecimals: getLogicalStableDecimals(params.tokenIn) ?? quote.tokenInDecimals,
          tokenOutDecimals: getLogicalStableDecimals(params.tokenOut) ?? quote.tokenOutDecimals,
          impliedRate,
        }),
      );
    }

    return ok;
  });

  if (!plausible.length) {
    throw new Error('No valid quotes available for this swap');
  }

  const stablePairKey = getStablePairKey(params.tokenIn, params.tokenOut);
  if (stablePairKey) {
    const safeStableQuotes = plausible.filter((quote) => {
      const impliedRate = getImpliedRate(
        quote,
        params.tokenIn,
        params.tokenOut,
        params.amountInRaw,
      );
      if (impliedRate === null) {
        return false;
      }

      const rateCheck = evaluateStableRateBand({ pairKey: stablePairKey, quotedRate: impliedRate });
      if (!rateCheck.ok) {
        console.warn(
          '[DEX_ROUTER_UNSAFE_STABLE_QUOTE]',
          JSON.stringify({
            provider: quote.provider,
            pair: stablePairKey,
            amountInRaw: params.amountInRaw.toString(),
            expectedOutRaw: quote.expectedOutRaw.toString(),
            impliedRate,
            configuredMin: rateCheck.min,
            configuredMax: rateCheck.max,
          }),
        );
      }
      return rateCheck.ok;
    });

    if (!safeStableQuotes.length) {
      const inputDecimals = getLogicalStableDecimals(params.tokenIn) ?? plausible[0].tokenInDecimals;
      const inputAmount = Number(formatUnits(params.amountInRaw, inputDecimals));
      const [inputSymbol, outputSymbol] = stablePairKey.split('-');
      const quoteSummary = plausible
        .map((quote) => {
          const impliedRate = getImpliedRate(
            quote,
            params.tokenIn,
            params.tokenOut,
            params.amountInRaw,
          );
          const formattedRate =
            impliedRate === null ? 'n/a' : impliedRate.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
          return `${quote.provider}=${formattedRate}`;
        })
        .join(', ');
      const outputSummary = plausible
        .map((quote) => {
          const amountOut = Number(formatUnits(quote.expectedOutRaw, quote.tokenOutDecimals));
          return `${quote.provider}=${formatCompactAmount(amountOut)} ${outputSymbol}`;
        })
        .join(', ');

      throw new Error(
        `No safe ${stablePairKey} quote available right now. ` +
          `For ${formatCompactAmount(inputAmount)} ${inputSymbol} in, current providers return ` +
          `${outputSummary} (${quoteSummary} ${outputSymbol} per ${inputSymbol}). ` +
          `AgentFlow blocks this because USDC and EURC should stay near parity, and these routes are currently off-peg on testnet.`,
      );
    }

    safeStableQuotes.sort((left, right) => {
      if (left.expectedOutRaw === right.expectedOutRaw) return 0;
      return left.expectedOutRaw > right.expectedOutRaw ? -1 : 1;
    });

    return safeStableQuotes[0];
  }

  plausible.sort((left, right) => {
    if (left.expectedOutRaw === right.expectedOutRaw) return 0;
    return left.expectedOutRaw > right.expectedOutRaw ? -1 : 1;
  });

  return plausible[0];
}

export async function executeSwap(
  providerName: string,
  params: SwapParams,
): Promise<SwapResult> {
  const provider = providers.find((entry) => entry.name === providerName);
  if (!provider) {
    throw new Error(`[dex/router] unknown provider: ${providerName}`);
  }
  return provider.swap(params);
}
