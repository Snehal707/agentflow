import dotenv from 'dotenv';
import { getAddress } from 'viem';
import { getMarketDetail, listAllMarkets } from '../lib/predmarket/router';

dotenv.config();

async function main(): Promise<void> {
  const markets = await listAllMarkets({ stage: 'active' });
  if (markets.length === 0) {
    throw new Error('[test-predmarket-detail] No active markets to probe');
  }

  const targetMarket = process.argv[2]
    ? (getAddress(process.argv[2]) as `0x${string}`)
    : markets[0].address;

  const detail = await getMarketDetail('achmarket', targetMarket);
  console.log(JSON.stringify(detail, null, 2));
}

main().catch((e) => {
  console.error('[test-predmarket-detail] Fatal:', e);
  process.exit(1);
});
