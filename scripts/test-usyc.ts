/**
 * USYC smoke test: entitlement (RolesAuthority), oracle price, optional deposit/redeem.
 * Run: npx tsx --env-file=.env scripts/test-usyc.ts
 */

import { getOrCreateAgentWallets } from '../lib/dcw';
import {
  checkEntitlement,
  getUSYCPrice,
  redeemUSYC,
  subscribeUSYC,
} from '../lib/usyc';

async function main(): Promise<void> {
  const { ownerWallet } = await getOrCreateAgentWallets('vault');
  const deployerAddress = ownerWallet.address;

  console.log('[test-usyc] wallet', deployerAddress);

  const entitled = await checkEntitlement(deployerAddress);
  console.log('[test-usyc] entitled:', entitled);
  if (!entitled) {
    console.log('[test-usyc] Not entitled yet — apply at hackathon form for USYC whitelist.');
  }

  try {
    const price = await getUSYCPrice();
    console.log('[test-usyc] USYC price (oracle, ~USD):', price, 'USDC');
  } catch (e) {
    console.warn('[test-usyc] Oracle unavailable (set USYC_ORACLE_ADDRESS in .env):', e);
  }

  if (!entitled) {
    return;
  }

  console.log('[test-usyc] deposit 1 USDC → USYC');
  const sub = await subscribeUSYC({
    walletId: ownerWallet.wallet_id,
    walletAddress: ownerWallet.address,
    usdcAmount: '1',
    receiverAddress: ownerWallet.address,
  });
  console.log('[test-usyc] subscribe result', sub);

  const redeemAmt = sub.usycReceived;
  const amtNum = Number(redeemAmt);
  if (!Number.isFinite(amtNum) || amtNum <= 0) {
    throw new Error('[test-usyc] no USYC received to redeem');
  }

  console.log('[test-usyc] redeem', redeemAmt, 'USYC → USDC');
  const red = await redeemUSYC({
    walletId: ownerWallet.wallet_id,
    walletAddress: ownerWallet.address,
    usycAmount: redeemAmt,
    receiverAddress: ownerWallet.address,
  });
  console.log('[test-usyc] redeem result', red);
}

main().catch((e) => {
  console.error('[test-usyc] fatal:', e);
  process.exit(1);
});
