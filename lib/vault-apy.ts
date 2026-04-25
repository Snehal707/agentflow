import { createPublicClient, defineChain, http, parseAbiItem } from 'viem';
import { ARC } from './arc-config';

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

/**
 * Read vault APY (percent) from ERC-4626-style vault with apyBps() or getAPY().
 * Falls back to VAULT_TARGET_APY env.
 */
export async function readVaultApyPercent(vaultAddress: `0x${string}`): Promise<number> {
  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  const candidates = [
    {
      signature: 'function apyBps() view returns (uint256)',
      functionName: 'apyBps' as const,
      parse: (v: bigint) => Number(v) / 100,
    },
    {
      signature: 'function getAPY() view returns (uint256)',
      functionName: 'getAPY' as const,
      parse: (v: bigint) => Number(v) / 100,
    },
  ] as const;

  for (const candidate of candidates) {
    try {
      const result = (await client.readContract({
        address: vaultAddress,
        abi: [parseAbiItem(candidate.signature)],
        functionName: candidate.functionName,
      })) as bigint;
      return candidate.parse(result);
    } catch {
      // try next
    }
  }

  return Number(process.env.VAULT_TARGET_APY || '8');
}

export function resolveVaultAddress(): `0x${string}` | null {
  const raw = (ARC.vaultContract || process.env.VAULT_CONTRACT_ADDRESS || '').trim();
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    return null;
  }
  return raw as `0x${string}`;
}
