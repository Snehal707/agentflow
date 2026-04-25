import { getAddress, isAddress, type Address } from 'viem';
import { loadAgentOwnerWallet } from './agent-owner-wallet';

function readAddressFromEnv(keys: string[]): Address | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (!value) {
      continue;
    }
    if (!isAddress(value)) {
      throw new Error(`[agent-seller] Invalid address in ${key}`);
    }
    return getAddress(value);
  }
  return null;
}

export async function resolveAgentSellerAddress(input: {
  agentSlug: string;
  preferredEnvKeys?: string[];
  fallbackEnvKeys?: string[];
  fallbackAddress: Address;
}): Promise<Address> {
  const preferred = readAddressFromEnv(input.preferredEnvKeys ?? []);
  if (preferred) {
    return preferred;
  }

  try {
    const ownerWallet = await loadAgentOwnerWallet(input.agentSlug);
    return ownerWallet.address;
  } catch (error) {
    console.warn(
      `[agent-seller] Falling back for ${input.agentSlug}:`,
      error instanceof Error ? error.message : String(error),
    );
  }

  const fallbackFromEnv = readAddressFromEnv(input.fallbackEnvKeys ?? []);
  if (fallbackFromEnv) {
    return fallbackFromEnv;
  }

  return getAddress(input.fallbackAddress);
}
