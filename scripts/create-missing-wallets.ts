/**
 * Create DCW owner + validator wallet pairs in Supabase for required agents when missing.
 * Does not run bootstrap, create treasury, or create a new wallet set — uses WALLET_SET_ID from env.
 * After wallets are ensured, runs the same ERC-8004 mint pass as mint-identity for owners missing erc8004_token_id.
 */

import dotenv from 'dotenv';

import { adminDb } from '../db/client';
import {
  getOrCreateAgentWallets,
  getWalletSetId,
  type PersistedWalletRow,
} from '../lib/dcw';
import { runMintIdentityOwners } from '../lib/mintIdentityOwners';

dotenv.config();

const REQUIRED_AGENTS = [
  'invoice',
  'vault',
  'bridge',
  'portfolio',
  'research',
  'analyst',
  'writer',
  'vision',
  'transcribe',
] as const;

async function main(): Promise<void> {
  const setId = getWalletSetId();
  console.log(`[create-missing-wallets] WALLET_SET_ID=${setId}`);

  for (const slug of REQUIRED_AGENTS) {
    const [ownerRes, validatorRes] = await Promise.all([
      adminDb
        .from('wallets')
        .select('*')
        .eq('agent_slug', slug)
        .eq('purpose', 'owner')
        .maybeSingle(),
      adminDb
        .from('wallets')
        .select('*')
        .eq('agent_slug', slug)
        .eq('purpose', 'validator')
        .maybeSingle(),
    ]);

    if (ownerRes.error) {
      throw new Error(
        `[create-missing-wallets] owner query failed for ${slug}: ${ownerRes.error.message}`,
      );
    }
    if (validatorRes.error) {
      throw new Error(
        `[create-missing-wallets] validator query failed for ${slug}: ${validatorRes.error.message}`,
      );
    }

    const ownerRow = ownerRes.data as PersistedWalletRow | null;
    const validatorRow = validatorRes.data as PersistedWalletRow | null;

    if (ownerRow && validatorRow) {
      console.log(
        `[wallet] skip slug=${slug} owner=${ownerRow.address} validator=${validatorRow.address}`,
      );
      continue;
    }

    const pair = await getOrCreateAgentWallets(slug);
    console.log(
      `[wallet] created slug=${slug} owner=${pair.owner.address} validator=${pair.validator.address}`,
    );
  }

  console.log('\n[create-missing-wallets] running ERC-8004 mint for owners missing token id...\n');
  await runMintIdentityOwners({ logPrefix: '[mint-identity]' });
}

main().catch((err) => {
  console.error('[create-missing-wallets] Fatal:', err);
  process.exit(1);
});
