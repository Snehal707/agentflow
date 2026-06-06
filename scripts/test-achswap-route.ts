import dotenv from 'dotenv';
import { getBestQuote } from '../lib/dex/router';

dotenv.config();

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;

async function main(): Promise<void> {
  const quote = await getBestQuote({
    tokenIn: ARC_USDC,
    tokenOut: ARC_EURC,
    amountInRaw: 1_000_000n,
    slippageBps: 100,
  });

  console.log(
    JSON.stringify(
      {
        provider: quote.provider,
        expectedOutRaw: quote.expectedOutRaw.toString(),
        routeDataLength: quote.routeData.length,
        segments: quote.segments,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[test-achswap-route] Fatal:', error);
  process.exit(1);
});
