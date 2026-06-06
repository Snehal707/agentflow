import dotenv from 'dotenv';
import { getAddress } from 'viem';
import { getProviderPosition, listAllVaults } from '../lib/vault/router';

dotenv.config();

async function main(): Promise<void> {
  const walletAddress = getAddress(
    process.argv[2] || '0x79FD75a3fC633259aDD60885f927d973d3A3642b',
  ) as `0x${string}`;

  const vaults = await listAllVaults();
  const vault = vaults.find(
    (entry) => entry.provider === 'lunex' && entry.vaultSymbol === 'luneUSDC',
  );
  if (!vault) {
    throw new Error('[test-vault-position] luneUSDC vault not found');
  }

  const position = await getProviderPosition('lunex', walletAddress, vault.address);
  console.log(
    JSON.stringify(
      {
        walletAddress,
        vaultAddress: vault.address,
        sharesRaw: position.sharesRaw.toString(),
        sharesFormatted: position.sharesFormatted,
        underlyingValueRaw: position.underlyingValueRaw.toString(),
        underlyingValueFormatted: position.underlyingValueFormatted,
        underlyingSymbol: position.underlyingSymbol,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[test-vault-position] Fatal:', error);
  process.exit(1);
});
