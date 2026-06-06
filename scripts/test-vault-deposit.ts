import dotenv from 'dotenv';
import { parseUnits } from 'viem';
import { listAllVaults } from '../lib/vault/router';

dotenv.config();

async function main(): Promise<void> {
  const vaults = await listAllVaults();
  const vault = vaults.find(
    (entry) => entry.provider === 'lunex' && entry.vaultSymbol === 'luneUSDC',
  );
  if (!vault) {
    throw new Error('[test-vault-deposit] luneUSDC vault not found');
  }

  const params = {
    provider: 'lunex',
    vaultAddress: vault.address,
    assetAddress: vault.asset,
    amount: '1',
    amountInRaw: parseUnits('1', 6).toString(),
    executionTarget: 'DCW',
    confirmed: false,
    executionGuardWouldFireOnConfirmedPath: true,
  };

  console.log(JSON.stringify(params, null, 2));
}

main().catch((error) => {
  console.error('[test-vault-deposit] Fatal:', error);
  process.exit(1);
});
