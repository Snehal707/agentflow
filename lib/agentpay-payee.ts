import { getAddress } from 'viem';
import { resolveContactName } from './contacts';
import { normalizeHandle, resolveHandle } from './handles';
import {
  cleanRegistryName,
  resolveRegistryName,
} from './agentpay-registry';

export function looksLikeAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

function isZeroResolved(addr: string | null): boolean {
  if (!addr) return true;
  try {
    return getAddress(addr as `0x${string}`).toLowerCase() === ZERO_ADDR.toLowerCase();
  } catch {
    return true;
  }
}

/** Resolve contact name, .arc name, bare name, or 0x address to payee checksum address. */
export async function resolvePayee(input: string, ownerWallet?: string): Promise<string> {
  const t = input.trim();
  if (!t) {
    throw new Error('Recipient is required');
  }
  if (looksLikeAddress(t)) {
    return getAddress(t);
  }
  if (ownerWallet?.trim()) {
    const fromContact = await resolveContactName(t, ownerWallet.trim());
    if (fromContact) {
      try {
        return getAddress(fromContact as `0x${string}`);
      } catch {
        /* fall through to registry / handles */
      }
    }
  }
  if (t.toLowerCase().includes('.arc')) {
    const resolved = await resolveRegistryName(t);
    if (!resolved || isZeroResolved(resolved)) {
      throw new Error(`${t} is not registered on AgentPay`);
    }
    return getAddress(resolved);
  }
  const bare = cleanRegistryName(t);
  if (/^[a-z0-9]{3,20}$/.test(bare)) {
    const onChain = await resolveRegistryName(bare);
    if (onChain && !isZeroResolved(onChain)) {
      return getAddress(onChain);
    }
    return resolveHandle(normalizeHandle(bare));
  }
  return resolveHandle(normalizeHandle(t.replace(/\.arc$/i, '')));
}
