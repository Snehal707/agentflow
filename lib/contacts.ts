import { adminDb } from '../db/client';

/**
 * Resolve a saved contact name to its stored address for the given owner wallet (EOA).
 */
export async function resolveContactName(
  name: string,
  walletAddress: string,
): Promise<string | null> {
  const cleanName = name.toLowerCase().trim();
  if (!cleanName) return null;

  const { data, error } = await adminDb
    .from('contacts')
    .select('address')
    .eq('wallet_address', walletAddress)
    .ilike('name', cleanName)
    .maybeSingle();

  if (error) {
    console.warn('[contacts] resolveContactName:', error.message);
    return null;
  }

  const addr = data?.address;
  return typeof addr === 'string' && addr.trim() ? addr.trim() : null;
}
