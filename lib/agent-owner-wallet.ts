import { getAddress, isAddress, type Address } from 'viem';
import { adminDb } from '../db/client';

export type AgentOwnerWallet = {
  walletId: string;
  address: Address;
};

export async function loadAgentOwnerWallet(slug: string): Promise<AgentOwnerWallet> {
  const { data, error } = await adminDb
    .from('wallets')
    .select('wallet_id, address')
    .eq('purpose', 'owner')
    .eq('agent_slug', slug);

  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error(
      `[agent-wallet] Missing owner wallet for agent "${slug}" in Supabase (purpose=owner). Run script:bootstrap.`,
    );
  }

  const row = data.find((item) => item?.wallet_id && item?.address && isAddress(item.address));
  if (!row) {
    throw new Error(
      `[agent-wallet] No valid owner wallet available for agent "${slug}".`,
    );
  }

  return {
    walletId: row.wallet_id as string,
    address: getAddress(row.address as string),
  };
}
