import dotenv from 'dotenv';
import { formatUnits, parseUnits } from 'viem';
import { adminDb } from '../db/client';
import { executeSwap } from '../agents/swap/subagents/execute';
import { fetchSwapQuote } from '../agents/swap/subagents/price';
import { waitForTransaction, type PersistedWalletRow } from '../lib/dcw';
import { verifyTokenTransfer } from '../agents/swap/subagents/verify';

dotenv.config();

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;
const AMOUNT = process.env.SWAP_TEST_AMOUNT?.trim() || '0.1';

async function main(): Promise<void> {
  const ownerWallet = await loadSwapOwnerWallet();
  const amountInRaw = parseUnits(AMOUNT, 18);

  console.log('[test-swap] wallet');
  console.log(
    JSON.stringify(
      {
        walletId: ownerWallet.wallet_id,
        address: ownerWallet.address,
      },
      null,
      2,
    ),
  );

  const quote = await fetchSwapQuote({
    tokenIn: ARC_USDC,
    tokenOut: ARC_EURC,
    amountIn: amountInRaw,
  });

  console.log('[test-swap] quote');
  console.log(
    JSON.stringify(
      {
        amountIn: AMOUNT,
        amountInRaw: amountInRaw.toString(),
        provider: quote.source,
        expectedOutRaw: quote.amountOut.toString(),
        expectedOutFormatted: formatUnits(quote.amountOut, 6),
      },
      null,
      2,
    ),
  );

  const submitted = await executeSwap({
    userWalletAddress: ownerWallet.address,
    userAgentWalletId: ownerWallet.wallet_id,
    userAgentWalletAddress: ownerWallet.address as `0x${string}`,
    tokenIn: ARC_USDC,
    tokenOut: ARC_EURC,
    amountInRaw,
    minAmountOutRaw: 0n,
    slippageBps: 100,
  });

  console.log('[test-swap] submitted');
  console.log(JSON.stringify(submitted, null, 2));

  const settled = await waitForTransaction(submitted.txId, 'test-swap');
  if (settled.state !== 'COMPLETE' || !settled.txHash) {
    throw new Error(
      `[test-swap] swap transaction failed: ${settled.errorReason || settled.state || 'unknown'}`,
    );
  }

  const verified = await verifyTokenTransfer({
    tokenAddress: ARC_EURC,
    recipient: ownerWallet.address,
    txHash: settled.txHash as `0x${string}`,
    timeoutMs: 30_000,
  });

  console.log('[test-swap] receipt');
  console.log(
    JSON.stringify(
      {
        txHash: verified.txHash,
        actualOutRaw: verified.valueRaw?.toString() ?? null,
        actualOutFormatted: verified.valueRaw ? formatUnits(verified.valueRaw, 6) : null,
      },
      null,
      2,
    ),
  );
}

async function loadSwapOwnerWallet(): Promise<PersistedWalletRow> {
  const { data, error } = await adminDb
    .from('wallets')
    .select('*')
    .eq('agent_slug', 'swap')
    .eq('purpose', 'owner')
    .maybeSingle();

  if (error) {
    throw new Error(`[test-swap] Failed loading swap owner wallet: ${error.message}`);
  }
  if (!data) {
    throw new Error('[test-swap] Swap owner wallet not found in Supabase');
  }

  return data as PersistedWalletRow;
}

main().catch((error) => {
  console.error('[test-swap] Fatal:', error);
  process.exit(1);
});
