import dotenv from 'dotenv';
import { LUNEX_CHAIN_ID, lunexProvider } from '../lib/dex/providers/lunex';

dotenv.config();

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;
const SLIPPAGE_BPS = 50;

function computeExpectedMinOut(amountOutRaw: bigint, slippageBps: number): bigint {
  return (amountOutRaw * BigInt(10_000 - slippageBps)) / 10_000n;
}

async function main(): Promise<void> {
  const baseUrl = process.env.LUNEX_API_BASE_URL?.trim();
  const apiKey = process.env.LUNEX_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    throw new Error(
      '[test-lunex-route] Missing LUNEX_API_BASE_URL or LUNEX_API_KEY in .env',
    );
  }

  const quote = await lunexProvider.quote({
    tokenIn: ARC_USDC,
    tokenOut: ARC_EURC,
    amountInRaw: 1_000_000n,
    slippageBps: SLIPPAGE_BPS,
  });
  const expectedMinOutRaw = computeExpectedMinOut(quote.expectedOutRaw, SLIPPAGE_BPS);

  console.log(
    JSON.stringify(
      {
        provider: quote.provider,
        expectedOutRaw: quote.expectedOutRaw.toString(),
        amountOutMinRaw: quote.amountOutMinRaw.toString(),
        expectedMinOutRaw: expectedMinOutRaw.toString(),
        route: JSON.parse(quote.routeData),
        routeSegments: quote.segments,
        tokenInDecimals: quote.tokenInDecimals,
        tokenOutDecimals: quote.tokenOutDecimals,
        latencyMs: quote.latencyMs,
        chainIdVerified: LUNEX_CHAIN_ID,
      },
      null,
      2,
    ),
  );

  if (quote.expectedOutRaw <= 0n) {
    throw new Error('[test-lunex-route] Lunex returned zero output for 1 USDC -> EURC');
  }

  const lowerBound = (expectedMinOutRaw * 99n) / 100n;
  const upperBound = (expectedMinOutRaw * 101n) / 100n;
  if (quote.amountOutMinRaw < lowerBound || quote.amountOutMinRaw > upperBound) {
    throw new Error(
      `[test-lunex-route] minimum output ${quote.amountOutMinRaw} is not within 1% of expected ${expectedMinOutRaw}`,
    );
  }
}

main().catch((error) => {
  console.error('[test-lunex-route] Fatal:', error);
  process.exit(1);
});
