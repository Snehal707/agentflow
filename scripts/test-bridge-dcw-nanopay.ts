/**
 * Reproduces the REAL chat bridge nanopayment: pays the bridge agent via the
 * user's DCW execution wallet (payer != seller), exactly like the chat does.
 *
 * Run: AGENTFLOW_X402_DEBUG=true npx tsx scripts/test-bridge-dcw-nanopay.ts
 */
import dotenv from 'dotenv';
import { getAddress } from 'viem';
import { executeDcwPaidAgentViaX402 } from '../lib/paidAgentX402';
import { getOrCreateUserAgentWallet } from '../lib/dcw';

dotenv.config();

function bridgeFinalizeUrl(): string {
  const base = (
    process.env.BRIDGE_AGENT_URL ||
    process.env.NEXT_PUBLIC_BRIDGE_AGENT_URL ||
    'http://127.0.0.1:3021'
  ).replace(/\/+$/, '');
  return `${base}/bridge/finalize`;
}

async function main(): Promise<void> {
  const userWallet = getAddress(
    (process.env.TEST_WALLET_ADDRESS || '').trim() as `0x${string}`,
  );
  console.log('[dcw-repro] user wallet  :', userWallet);

  const exec = await getOrCreateUserAgentWallet(userWallet);
  console.log('[dcw-repro] DCW payer    :', exec.address, '(walletId', exec.wallet_id + ')');
  console.log('[dcw-repro] seller/payTo :', process.env.SELLER_ADDRESS);
  console.log('[dcw-repro] payer==seller?', getAddress(exec.address) === getAddress(process.env.SELLER_ADDRESS || exec.address));

  const requestId = `x402_repro_${Date.now()}`;
  try {
    const result = await executeDcwPaidAgentViaX402({
      userWalletAddress: userWallet,
      url: bridgeFinalizeUrl(),
      agent: 'bridge',
      price: process.env.BRIDGE_AGENT_PRICE ? `$${process.env.BRIDGE_AGENT_PRICE}` : '$0.009',
      body: { sourceChain: 'ethereum-sepolia', amount: 0.1 },
      requestId,
      ledgerContext: 'repro',
    });
    console.log('\n[dcw-repro] ✅ SUCCESS');
    console.log('[dcw-repro] status:', result.status);
    console.log('[dcw-repro] settlementTxHash:', result.payment.settlementTxHash);
    console.log('[dcw-repro] data:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    console.log('\n[dcw-repro] ❌ FAILED');
    console.log('[dcw-repro] error:', error instanceof Error ? error.message : String(error));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[dcw-repro] fatal:', e);
    process.exit(1);
  });
