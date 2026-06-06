import dotenv from 'dotenv';
import { executeUsdcTransfer } from '../lib/agentpay-transfer';

dotenv.config();

async function main(): Promise<void> {
  const payerEoa =
    process.argv[2]?.trim() || '0x79FD75a3fC633259aDD60885f927d973d3A3642b';
  const toAddress = '0x598d9a6beeEC9522d988038747181438A9Cf99B3'; // jack.arc
  const amountUsdc = 0.01; // smallest meaningful amount

  console.log('[test-agentpay-transfer] Starting');
  console.log('[test-agentpay-transfer] payer EOA:', payerEoa);
  console.log('[test-agentpay-transfer] to:', toAddress);
  console.log('[test-agentpay-transfer] amount:', amountUsdc);

  try {
    const { txHash } = await executeUsdcTransfer({
      payerEoa,
      toAddress,
      amountUsdc,
      remark: 'test-agentpay-transfer script',
      actionType: 'agentpay_send',
    });
    console.log('[test-agentpay-transfer] SUCCESS');
    console.log('[test-agentpay-transfer] txHash:', txHash);
  } catch (error) {
    console.error('[test-agentpay-transfer] FAILED');
    console.error(
      '[test-agentpay-transfer] error:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

main().catch(console.error);
