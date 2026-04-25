import '../lib/loadEnv';
import { getAddress, isAddress } from 'viem';
import { getCircleWalletForUser } from '../lib/circleWallet';
import { executeUsdcTransfer } from '../lib/agentpay-transfer';

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

async function main(): Promise<void> {
  const raw = process.env.TEST_WALLET_ADDRESS?.trim();
  if (!raw || !isAddress(raw)) {
    throw new Error('TEST_WALLET_ADDRESS missing');
  }
  const wallet = getAddress(raw);
  const circle = await getCircleWalletForUser(wallet);
  console.log('[fund-user-gateway] circle funding wallet', circle.address, circle.walletId);

  const transfer = await executeUsdcTransfer({
    payerEoa: wallet,
    toAddress: circle.address,
    amountUsdc: 3,
    remark: 'fund Gateway for vision/transcribe A2A test',
    actionType: 'test_gateway_fund',
  });
  console.log('[fund-user-gateway] funded on-chain tx', transfer.txHash);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  const res = await fetch(`${BASE}/wallet/fund-gateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAddress: wallet }),
  });
  const text = await res.text();
  console.log('[fund-user-gateway] fund-gateway status', res.status, text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
