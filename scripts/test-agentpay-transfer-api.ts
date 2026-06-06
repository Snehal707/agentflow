import dotenv from 'dotenv';
import { getAddress } from 'viem';
import { getCircleClient, getOrCreateUserAgentWallet, waitForTransaction } from '../lib/dcw';

dotenv.config();

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ARC_BLOCKCHAIN = 'ARC-TESTNET' as const;

async function main(): Promise<void> {
  const payerEoa =
    process.argv[2]?.trim() || '0x79FD75a3fC633259aDD60885f927d973d3A3642b';
  const toAddress =
    process.argv[3]?.trim() || '0x598d9a6beeEC9522d988038747181438A9Cf99B3';
  const amountUsdc = Number(process.argv[4] ?? '0.01');

  const payer = getAddress(payerEoa);
  const payee = getAddress(toAddress);
  const userAgent = await getOrCreateUserAgentWallet(payer);
  const dcw = getCircleClient();

  const payload = {
    walletId: userAgent.wallet_id,
    tokenAddress: ARC_USDC,
    blockchain: ARC_BLOCKCHAIN,
    amount: [amountUsdc.toFixed(6)],
    destinationAddress: payee,
    fee: {
      type: 'level' as const,
      config: {
        feeLevel: 'HIGH' as const,
      },
    },
  };

  console.log('[test-agentpay-transfer-api] Starting');
  console.log('[test-agentpay-transfer-api] payer EOA:', payer);
  console.log('[test-agentpay-transfer-api] payer DCW:', userAgent.address);
  console.log('[test-agentpay-transfer-api] to:', payee);
  console.log('[test-agentpay-transfer-api] amount:', amountUsdc);
  console.log('[test-agentpay-transfer-api] createTransaction args:', payload);

  try {
    const tx = await dcw.createTransaction(payload);
    const txId = tx?.data?.id ?? tx?.data?.transaction?.id ?? null;

    console.log('[test-agentpay-transfer-api] createTransaction response:', tx?.data);

    if (!txId) {
      throw new Error('[test-agentpay-transfer-api] Missing Circle transaction id');
    }

    const settled = await waitForTransaction(txId, 'agentpay-transfer-api');

    console.log('[test-agentpay-transfer-api] settled:', settled);

    if (settled.state !== 'COMPLETE' || !settled.txHash) {
      throw new Error(
        `[test-agentpay-transfer-api] Transfer failed: ${settled.errorReason ?? settled.state ?? 'unknown'}${settled.errorDetails ? ` (${settled.errorDetails})` : ''}`,
      );
    }

    console.log('[test-agentpay-transfer-api] SUCCESS');
    console.log('[test-agentpay-transfer-api] txHash:', settled.txHash);
  } catch (error) {
    console.error('[test-agentpay-transfer-api] FAILED');
    console.error(
      '[test-agentpay-transfer-api] error:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

main().catch(console.error);
