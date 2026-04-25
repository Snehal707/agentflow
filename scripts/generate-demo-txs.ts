/**
 * Generate many small AgentPay USDC transfers for hackathon demos.
 * Run: npx tsx --env-file=.env scripts/generate-demo-txs.ts
 */

import dotenv from 'dotenv';
import { getAddress, isAddress } from 'viem';
import { executeUsdcTransfer } from '../lib/agentpay-transfer';
import { incrementTxCount } from '../lib/tx-counter';

dotenv.config();

const TARGET = 55;
const AMOUNTS = ['0.001', '0.003', '0.005', '0.008', '0.01'] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateDemoTransactions(): Promise<void> {
  console.log('Generating demo transactions...');

  const testWallet = process.env.TEST_WALLET_ADDRESS?.trim();
  if (!testWallet || !isAddress(testWallet)) {
    console.error('Set TEST_WALLET_ADDRESS in .env to a valid EOA (payer).');
    process.exit(1);
  }

  const payerEoa = getAddress(testWallet);
  const r1 = process.env.DEMO_RECIPIENT_1?.trim();
  const r2 = process.env.DEMO_RECIPIENT_2?.trim();
  const recipients = [r1, r2].filter((a): a is string => Boolean(a && isAddress(a))).map((a) => getAddress(a));

  if (recipients.length === 0) {
    console.error('Set DEMO_RECIPIENT_1 and DEMO_RECIPIENT_2 in .env to valid Arc addresses.');
    process.exit(1);
  }

  let successCount = 0;

  for (let i = 0; i < TARGET; i += 1) {
    const recipient = recipients[i % recipients.length]!;
    const amountStr = AMOUNTS[i % AMOUNTS.length]!;
    const amountUsdc = Number(amountStr);
    const remark = `Demo tx #${i + 1} - AgentFlow hackathon`;

    try {
      const { txHash } = await executeUsdcTransfer({
        payerEoa,
        toAddress: recipient,
        amountUsdc,
        remark,
        actionType: 'demo_payment',
      });

      await incrementTxCount('agentpay');

      successCount += 1;
      console.log(
        `[${successCount}/${TARGET}] ✓ ${amountStr} USDC → ${recipient.slice(0, 8)}... tx: ${txHash.slice(0, 10)}...`,
      );
    } catch (e) {
      console.error(`[${i + 1}] Failed:`, e);
    }

    await sleep(1000);
  }

  console.log(`\nDone! ${successCount} transactions generated.`);
  console.log('View on Arcscan: https://testnet.arcscan.app');
  process.exit(0);
}

void generateDemoTransactions();
