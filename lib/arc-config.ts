/**
 * Central Arc Network configuration.
 * Import from here everywhere; do not scatter chain IDs or registry addresses.
 */

/** Arc Testnet defaults (ERC-8004 registries — see AgentFlow V3 spec). */
const DEFAULT_IDENTITY_REGISTRY =
  '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const DEFAULT_REPUTATION_REGISTRY =
  '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const DEFAULT_VALIDATION_REGISTRY =
  '0x8004Cb1BF31DAf7788923b405b754f57acEB4272';

const DEFAULT_CHAIN_ID = 5042002;
const DEFAULT_RPC_URL = 'https://rpc.testnet.arc.network';

function parseChainId(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function resolveArcRpcUrl(): string {
  return (
    firstConfigured(
      process.env.ALCHEMY_ARC_RPC,
      process.env.ARC_RPC_URL,
      process.env.ARC_RPC,
    ) || DEFAULT_RPC_URL
  );
}

export const ARC = {
  blockchain: process.env.ARC_NETWORK?.trim() || 'ARC-TESTNET',
  /** Prefer Alchemy for reads because the public Arc RPC can rate-limit heavily. */
  rpc: resolveArcRpcUrl(),
  chainId: parseChainId(process.env.ARC_CHAIN_ID, DEFAULT_CHAIN_ID),
  identityRegistry:
    process.env.IDENTITY_REGISTRY?.trim() || DEFAULT_IDENTITY_REGISTRY,
  reputationRegistry:
    process.env.REPUTATION_REGISTRY?.trim() || DEFAULT_REPUTATION_REGISTRY,
  validationRegistry:
    process.env.VALIDATION_REGISTRY?.trim() || DEFAULT_VALIDATION_REGISTRY,
  /** Optional until swap contract is deployed. */
  alchemyRpc: process.env.ALCHEMY_ARC_RPC?.trim() ?? '',
  swapContract: process.env.SWAP_CONTRACT_ADDRESS?.trim() ?? '',
  vaultContract: process.env.VAULT_CONTRACT_ADDRESS?.trim() ?? '',
  /** Circle USYC (Arc Testnet) — see tokenized/usyc/smart-contracts */
  usycAddress: process.env.USYC_ADDRESS?.trim() ?? '',
  usycTeller: process.env.USYC_TELLER_ADDRESS?.trim() ?? '',
  usycOracle: process.env.USYC_ORACLE_ADDRESS?.trim() ?? '',
  usycEntitlements: process.env.USYC_ENTITLEMENTS_ADDRESS?.trim() ?? '',
} as const;

export type ArcConfig = typeof ARC;
