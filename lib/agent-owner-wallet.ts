import { getAddress, isAddress, type Address } from 'viem';
import { adminDb } from '../db/client';

export async function loadAgentOwnerWallet(slug: string): Promise<{
  walletId: string;
  address: Address;
}> {
  const { data, error } = await adminDb
    .from('wallets')
    .select('wallet_id, address')
    .eq('purpose', 'owner')
    .eq('agent_slug', slug)
    .single();

  if (error || !data?.wallet_id || !data?.address) {
    throw new Error(
      `[agent-wallet] Missing owner wallet for agent "${slug}" in Supabase (purpose=owner). Run script:bootstrap.`,
    );
  }
  if (!isAddress(data.address)) {
    throw new Error(`[agent-wallet] Invalid address for agent "${slug}"`);
  }
  return { walletId: data.wallet_id, address: getAddress(data.address) };
}
