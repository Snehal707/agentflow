import { createPublicClient, defineChain, formatUnits, http } from 'viem';

import { ARC } from './arc-config';
import { getUSYCPrice } from './usyc';
import { readVaultApyPercent, resolveVaultAddress } from './vault-apy';

const vaultAbi = [
  {
    name: 'totalAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export type YieldRoute = {
  protocol: string;
  apy: number;
  tvl: string;
  lockPeriod: number;
  riskLevel: 'low' | 'very_low' | 'medium' | 'high';
  contractAddress: string;
  requiresWhitelist: boolean;
  recommended: boolean;
};

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

function getClient() {
  return createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });
}

export async function getVaultAPY(): Promise<number> {
  const v = resolveVaultAddress();
  if (!v) {
    return Number(process.env.VAULT_TARGET_APY || '8');
  }
  return readVaultApyPercent(v);
}

export async function getVaultTVL(): Promise<string> {
  const v = resolveVaultAddress();
  if (!v) {
    return '0';
  }
  const client = getClient();
  const raw = (await client.readContract({
    address: v,
    abi: vaultAbi,
    functionName: 'totalAssets',
  })) as bigint;
  return formatUnits(raw, 6);
}

/** Oracle price is NAV/share, not APY — use env-backed estimate for routing. */
export async function estimateUSYCAPY(_priceUsd: number): Promise<number> {
  const raw = process.env.USYC_ESTIMATED_APY?.trim();
  const n = raw != null && raw !== '' ? Number(raw) : 5.3;
  return Number.isFinite(n) ? n : 5.3;
}

export async function getBestYieldRoute(_amount: string): Promise<YieldRoute[]> {
  const routes: YieldRoute[] = [];

  const vaultAPY = await getVaultAPY();
  const vaultAddr = (ARC.vaultContract || process.env.VAULT_CONTRACT_ADDRESS || '').trim();
  let vaultTvl = '0';
  try {
    vaultTvl = await getVaultTVL();
  } catch {
    vaultTvl = '0';
  }

  routes.push({
    protocol: 'AgentFlow Vault',
    apy: vaultAPY,
    tvl: vaultTvl,
    lockPeriod: 0,
    riskLevel: 'low',
    contractAddress: vaultAddr || '',
    requiresWhitelist: false,
    recommended: false,
  });

  try {
    const usycPrice = await getUSYCPrice();
    const usycAPY = await estimateUSYCAPY(usycPrice);
    const teller = (ARC.usycTeller || '').trim();
    routes.push({
      protocol: 'Circle USYC',
      apy: usycAPY,
      tvl: 'institutional',
      lockPeriod: 0,
      riskLevel: 'very_low',
      contractAddress: teller,
      requiresWhitelist: true,
      recommended: false,
    });
  } catch (e) {
    console.warn('[arc-router] USYC route unavailable:', e);
  }

  const sorted = routes.sort((a, b) => b.apy - a.apy);
  return sorted.map((r, i) => ({
    ...r,
    recommended: i === 0 && sorted.length > 0,
  }));
}
