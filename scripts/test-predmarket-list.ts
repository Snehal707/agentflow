import dotenv from 'dotenv';
import { listAllMarkets } from '../lib/predmarket/router';
import type { MarketSummary } from '../lib/predmarket/types';

dotenv.config();

function assertMarketSummaryShape(markets: MarketSummary[]): void {
  for (const market of markets) {
    if (
      typeof market.provider !== 'string' ||
      typeof market.address !== 'string' ||
      typeof market.marketId !== 'string' ||
      typeof market.title !== 'string' ||
      typeof market.category !== 'string' ||
      !Array.isArray(market.outcomes)
    ) {
      throw new Error('[test-predmarket-list] Invalid MarketSummary shape');
    }
  }
}

async function main(): Promise<void> {
  const markets = await listAllMarkets();
  assertMarketSummaryShape(markets);

  if (markets.length === 0) {
    console.log('[test-predmarket-list] No AchMarket markets returned on Arc testnet.');
    return;
  }

  console.log(`[test-predmarket-list] Found ${markets.length} market(s)`);
  for (const market of markets) {
    console.log(
      JSON.stringify(
        {
          title: market.title,
          stage: market.stage,
          outcomes: market.outcomes.map((outcome) => ({
            label: outcome.label,
            impliedProbability: outcome.impliedProbability,
          })),
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error) => {
  console.error('[test-predmarket-list] Fatal:', error);
  process.exit(1);
});
