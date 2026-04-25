import { createPublicClient, defineChain, getAddress, http } from 'viem';
import { ARC } from './arc-config';

const REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'dcwWallet', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'resolve',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'isAvailable',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getNameInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'paymentAddress', type: 'address' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'active', type: 'bool' },
      { name: 'expired', type: 'bool' },
    ],
  },
  {
    name: 'getMyName',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'ownerToName',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'updateDCW',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newDcwWallet', type: 'address' }],
    outputs: [],
  },
  {
    name: 'renew',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'registrationFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'renewalFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const arcChain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [ARC.alchemyRpc || ARC.rpc] },
  },
});

const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(ARC.alchemyRpc || ARC.rpc),
});

export function getAgentPayRegistryAddress(): `0x${string}` | null {
  const raw = process.env.AGENTPAY_REGISTRY_ADDRESS?.trim();
  if (!raw || !raw.startsWith('0x')) {
    return null;
  }
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

export function cleanRegistryName(name: string): string {
  return name.toLowerCase().replace(/\.arc$/i, '').trim();
}

export async function resolveRegistryName(name: string): Promise<string | null> {
  const addr = getAgentPayRegistryAddress();
  if (!addr) return null;
  const cleanName = cleanRegistryName(name);
  if (!cleanName) return null;
  try {
    const resolved = await publicClient.readContract({
      address: addr,
      abi: REGISTRY_ABI,
      functionName: 'resolve',
      args: [cleanName],
    });
    return getAddress(resolved as `0x${string}`);
  } catch {
    return null;
  }
}

export async function isNameAvailableOnChain(name: string): Promise<boolean> {
  const addr = getAgentPayRegistryAddress();
  if (!addr) return false;
  const cleanName = cleanRegistryName(name);
  if (!cleanName) return false;
  try {
    return (await publicClient.readContract({
      address: addr,
      abi: REGISTRY_ABI,
      functionName: 'isAvailable',
      args: [cleanName],
    })) as boolean;
  } catch {
    return false;
  }
}

export async function getNameInfoOnChain(name: string) {
  const addr = getAgentPayRegistryAddress();
  if (!addr) return null;
  const cleanName = cleanRegistryName(name);
  if (!cleanName) return null;
  try {
    return await publicClient.readContract({
      address: addr,
      abi: REGISTRY_ABI,
      functionName: 'getNameInfo',
      args: [cleanName],
    });
  } catch {
    return null;
  }
}

export async function getOwnerRegisteredName(owner: `0x${string}`): Promise<string | null> {
  const addr = getAgentPayRegistryAddress();
  if (!addr) return null;
  try {
    const s = await publicClient.readContract({
      address: addr,
      abi: REGISTRY_ABI,
      functionName: 'ownerToName',
      args: [getAddress(owner)],
    });
    const str = String(s ?? '').trim();
    return str.length > 0 ? str : null;
  } catch {
    return null;
  }
}

export async function readRegistrationFee(): Promise<bigint> {
  const addr = getAgentPayRegistryAddress();
  if (!addr) return 1_000_000n;
  try {
    const v = await publicClient.readContract({
      address: addr,
      abi: REGISTRY_ABI,
      functionName: 'registrationFee',
    });
    return v as bigint;
  } catch {
    return 1_000_000n;
  }
}

export async function readRenewalFee(): Promise<bigint> {
  const addr = getAgentPayRegistryAddress();
  if (!addr) return 1_000_000n;
  try {
    const v = await publicClient.readContract({
      address: addr,
      abi: REGISTRY_ABI,
      functionName: 'renewalFee',
    });
    return v as bigint;
  } catch {
    return 1_000_000n;
  }
}

export { REGISTRY_ABI };
