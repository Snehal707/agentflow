import dotenv from 'dotenv';
import { listAllVaults } from '../lib/vault/router';

dotenv.config();

async function main(): Promise<void> {
  const vaults = await listAllVaults();
  console.log(JSON.stringify(vaults, null, 2));

  if (vaults.length !== 2) {
    throw new Error(`[test-vault-list] expected 2 vaults, got ${vaults.length}`);
  }
}

main().catch((error) => {
  console.error('[test-vault-list] Fatal:', error);
  process.exit(1);
});
