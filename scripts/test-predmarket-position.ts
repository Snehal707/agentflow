import dotenv from 'dotenv';
import { getAddress } from 'viem';
import { getUserPositionsAcrossProviders } from '../lib/predmarket/router';

dotenv.config();

async function main(): Promise<void> {
  const walletAddress = getAddress(
    process.argv[2] || '0x79FD75a3fC633259aDD60885f927d973d3A3642b',
  ) as `0x${string}`;

  const positions = await getUserPositionsAcrossProviders(walletAddress);
  console.log(`Found ${positions.length} positions for ${walletAddress}`);
  console.log(JSON.stringify(positions, null, 2));
}

main().catch((e) => {
  console.error('[test-predmarket-position] Fatal:', e);
  process.exit(1);
});
