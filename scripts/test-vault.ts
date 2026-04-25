import dotenv from 'dotenv';
import { createPublicClient, defineChain, http, parseUnits } from 'viem';

import { ARC } from '../lib/arc-config';
import { readVaultApyPercent } from '../lib/vault-apy';
import {
  executeVaultAction,
  formatUsdc,
  getVaultOwnerWallet,
  readVaultBalances,
  readVaultSharePreview,
} from '../agents/vault/execution';

dotenv.config();

const DEPOSIT_AMOUNT = 1;
const WITHDRAW_AMOUNT = 0.5;

async function main(): Promise<void> {
  const vaultAddress = (
    ARC.vaultContract || process.env.VAULT_CONTRACT_ADDRESS || ''
  ).trim() as `0x${string}`;
  if (!vaultAddress) {
    throw new Error('[test-vault] VAULT_CONTRACT_ADDRESS is required');
  }

  const ownerWallet = await getVaultOwnerWallet();
  const before = await readVaultBalances(vaultAddress, ownerWallet.address);
  const previews = await readVaultSharePreview({
    vaultAddress,
    depositAssetsRaw: parseUnits(String(DEPOSIT_AMOUNT), 6),
    withdrawAssetsRaw: parseUnits(String(WITHDRAW_AMOUNT), 6),
  });

  console.log('[test-vault] vault owner wallet');
  console.log(
    JSON.stringify(
      {
        walletId: ownerWallet.wallet_id,
        address: ownerWallet.address,
        erc8004TokenId: ownerWallet.erc8004_token_id,
      },
      null,
      2,
    ),
  );

  console.log('[test-vault] state before');
  console.log(
    JSON.stringify(
      {
        vaultAddress,
        assetAddress: before.assetAddress,
        totalAssets: formatUsdc(before.totalAssetsRaw),
        totalSupply: formatUsdc(before.totalSupplyRaw),
        ownerShares: formatUsdc(before.walletSharesRaw),
        ownerUsdc: formatUsdc(before.walletUsdcRaw),
      },
      null,
      2,
    ),
  );

  console.log('[test-vault] check APY');
  const apyPercent = await readVaultApyPercent(vaultAddress);
  console.log(
    JSON.stringify(
      {
        apyPercent,
      },
      null,
      2,
    ),
  );

  console.log('[test-vault] share previews');
  console.log(
    JSON.stringify(
      {
        depositAssets: String(DEPOSIT_AMOUNT),
        previewDepositShares: formatUsdc(previews.depositSharesRaw),
        withdrawAssets: String(WITHDRAW_AMOUNT),
        previewWithdrawShares: formatUsdc(previews.withdrawSharesRaw),
      },
      null,
      2,
    ),
  );

  console.log('[test-vault] deposit 1 USDC');
  const deposit = await executeVaultAction({
    action: 'deposit',
    walletAddress: ownerWallet.address,
    walletId: ownerWallet.wallet_id,
    vaultAddress,
    amountRaw: parseUnits(String(DEPOSIT_AMOUNT), 6),
    amountUsdc: DEPOSIT_AMOUNT,
  });
  console.log(
    JSON.stringify(
      {
        approvalTxId: deposit.approvalTxId ?? null,
        approvalSkipped: deposit.approvalSkipped,
        depositTxId: deposit.txId,
        depositTxHash: deposit.txHash ?? null,
        explorerLink: deposit.txHash ? `${explorerBase}${deposit.txHash}` : null,
      },
      null,
      2,
    ),
  );

  const afterDeposit = await readVaultBalances(vaultAddress, ownerWallet.address);
  console.log('[test-vault] shares received');
  console.log(
    JSON.stringify(
      {
        ownerSharesBefore: formatUsdc(before.walletSharesRaw),
        ownerSharesAfter: formatUsdc(afterDeposit.walletSharesRaw),
        sharesReceived: formatUsdc(afterDeposit.walletSharesRaw - before.walletSharesRaw),
        totalAssetsAfterDeposit: formatUsdc(afterDeposit.totalAssetsRaw),
        totalSupplyAfterDeposit: formatUsdc(afterDeposit.totalSupplyRaw),
        ownerUsdcAfterDeposit: formatUsdc(afterDeposit.walletUsdcRaw),
      },
      null,
      2,
    ),
  );

  console.log('[test-vault] withdraw 0.5 USDC');
  const withdraw = await executeVaultAction({
    action: 'withdraw',
    walletAddress: ownerWallet.address,
    walletId: ownerWallet.wallet_id,
    vaultAddress,
    amountRaw: parseUnits(String(WITHDRAW_AMOUNT), 6),
    amountUsdc: WITHDRAW_AMOUNT,
  });
  console.log(
    JSON.stringify(
      {
        approvalTxId: withdraw.approvalTxId ?? null,
        approvalSkipped: withdraw.approvalSkipped,
        withdrawTxId: withdraw.txId,
        withdrawTxHash: withdraw.txHash ?? null,
        explorerLink: withdraw.txHash ? `${explorerBase}${withdraw.txHash}` : null,
      },
      null,
      2,
    ),
  );

  const afterWithdraw = await readVaultBalances(vaultAddress, ownerWallet.address);
  console.log('[test-vault] state after withdraw');
  console.log(
    JSON.stringify(
      {
        ownerSharesAfterWithdraw: formatUsdc(afterWithdraw.walletSharesRaw),
        sharesBurned: formatUsdc(afterDeposit.walletSharesRaw - afterWithdraw.walletSharesRaw),
        ownerUsdcAfterWithdraw: formatUsdc(afterWithdraw.walletUsdcRaw),
        usdcReturned: formatUsdc(afterWithdraw.walletUsdcRaw - afterDeposit.walletUsdcRaw),
        totalAssetsAfterWithdraw: formatUsdc(afterWithdraw.totalAssetsRaw),
        totalSupplyAfterWithdraw: formatUsdc(afterWithdraw.totalSupplyRaw),
      },
      null,
      2,
    ),
  );

  const receipt = await publicClient.getTransactionReceipt({
    hash: withdraw.txHash as `0x${string}`,
  });
  console.log('[test-vault] final receipt');
  console.log(
    JSON.stringify(
      {
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        txHash: withdraw.txHash,
      },
      null,
      2,
    ),
  );
}

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

const publicClient = createPublicClient({
  chain,
  transport: http(ARC.rpc),
});

const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';

main().catch((error) => {
  console.error('[test-vault] Fatal:', error);
  process.exit(1);
});
