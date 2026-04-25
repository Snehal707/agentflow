import dotenv from 'dotenv';

import { executeBridgeTransfer, getBridgeOwnerWallet } from '../agents/bridge/bridgeKit';

dotenv.config();

async function main(): Promise<void> {
  const bridgeOwner = await getBridgeOwnerWallet();
  const recipientAddress =
    process.env.BRIDGE_TEST_RECIPIENT?.trim() ||
    process.env.BRIDGE_OWNER_RECIPIENT?.trim() ||
    bridgeOwner.address;

  console.log('[test-bridge] starting');
  console.log(
    JSON.stringify(
      {
        sourceChain: 'ethereum-sepolia',
        destinationChain: 'arc-testnet',
        amount: '0.1',
        recipientAddress,
      },
      null,
      2,
    ),
  );

  const result = await executeBridgeTransfer({
    sourceChain: 'ethereum-sepolia',
    recipientAddress,
    amount: '0.1',
    onEvent: ({ event, data }) => {
      console.log(`[test-bridge] ${event}`);
      console.log(JSON.stringify(data, null, 2));
    },
  });

  console.log('[test-bridge] result');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[test-bridge] Fatal:', error);
  process.exit(1);
});
