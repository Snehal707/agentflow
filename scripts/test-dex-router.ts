import dotenv from 'dotenv';
import { formatUnits, parseUnits } from 'viem';
import { getBestQuote } from '../lib/dex/router';
import { swaparcProvider } from '../lib/dex/providers/swaparc';
import { achswapProvider } from '../lib/dex/providers/achswap';
import { lunexProvider } from '../lib/dex/providers/lunex';

dotenv.config();

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;
const USER_AMOUNT = '1';
const SLIPPAGE_BPS = 50;

type ProviderResultRow = {
  provider: string;
  expectedOutRaw: string;
  normalizedOut: string;
  latencyMs: string;
};

async function main(): Promise<void> {
  const providerQuotes = await Promise.allSettled([
    swaparcProvider.quote({
      tokenIn: ARC_USDC,
      tokenOut: ARC_EURC,
      amountInRaw: parseUnits(USER_AMOUNT, 6),
      slippageBps: SLIPPAGE_BPS,
    }),
    achswapProvider.quote({
      tokenIn: ARC_USDC,
      tokenOut: ARC_EURC,
      amountInRaw: parseUnits(USER_AMOUNT, 6),
      slippageBps: SLIPPAGE_BPS,
    }),
    lunexProvider.quote({
      tokenIn: ARC_USDC,
      tokenOut: ARC_EURC,
      amountInRaw: parseUnits(USER_AMOUNT, 6),
      slippageBps: SLIPPAGE_BPS,
    }),
  ]);

  const rows: ProviderResultRow[] = providerQuotes.map((result, index) => {
    const provider = index === 0 ? 'swaparc' : index === 1 ? 'achswap' : 'lunex';
    if (result.status === 'fulfilled') {
      return {
        provider,
        expectedOutRaw: result.value.expectedOutRaw.toString(),
        normalizedOut: formatUnits(result.value.expectedOutRaw, result.value.tokenOutDecimals),
        latencyMs: String(result.value.latencyMs),
      };
    }

    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return {
      provider,
      expectedOutRaw: `ERROR: ${reason}`,
      normalizedOut: 'ERROR',
      latencyMs: '-',
    };
  });

  console.log('provider | expectedOutRaw | normalizedOut | latencyMs');
  console.log('---------+----------------+---------------+----------');
  for (const row of rows) {
    console.log(
      `${row.provider} | ${row.expectedOutRaw} | ${row.normalizedOut} | ${row.latencyMs}`,
    );
  }

  const successful = providerQuotes
    .map((result, index) => ({
      result,
      provider: index === 0 ? 'swaparc' : index === 1 ? 'achswap' : 'lunex',
    }))
    .filter((entry): entry is {
      result: PromiseFulfilledResult<Awaited<ReturnType<typeof swaparcProvider.quote>>>;
      provider: string;
    } => entry.result.status === 'fulfilled')
    .map((entry) => ({
      provider: entry.provider,
      expectedOutRaw: entry.result.value.expectedOutRaw,
      normalizedOut: Number(
        formatUnits(entry.result.value.expectedOutRaw, entry.result.value.tokenOutDecimals),
      ),
    }))
    .filter((entry) => Number.isFinite(entry.normalizedOut));

  if (!successful.length) {
    throw new Error('no provider returned a quote');
  }

  successful.sort((left, right) => right.normalizedOut - left.normalizedOut);
  const routerWinner = await getBestQuote({
    tokenIn: ARC_USDC,
    tokenOut: ARC_EURC,
    amountInRaw: parseUnits(USER_AMOUNT, 6),
    slippageBps: SLIPPAGE_BPS,
  });

  console.log('');
  console.log(
    `winner: ${successful[0].provider} (${successful[0].expectedOutRaw.toString()} raw, ${successful[0].normalizedOut} normalized)`,
  );
  console.log(
    `router: ${routerWinner.provider} (${routerWinner.expectedOutRaw.toString()} raw, ${formatUnits(
      routerWinner.expectedOutRaw,
      routerWinner.tokenOutDecimals,
    )} normalized)`,
  );
}

main().catch((error) => {
  console.error('[test-dex-router] Fatal:', error);
  process.exit(1);
});
