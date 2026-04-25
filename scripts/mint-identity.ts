/**
 * Mint ERC-8004 identity for agent owner wallets in Supabase that lack erc8004_token_id.
 *
 * See lib/mintIdentityOwners.ts for behavior.
 */

import dotenv from 'dotenv';

import { runMintIdentityOwners } from '../lib/mintIdentityOwners';

dotenv.config();

runMintIdentityOwners().catch((err) => {
  console.error('[mint-identity] Fatal:', err);
  process.exit(1);
});
