/**
 * Drain all USDC + pair token from AgentFlowSwap to the deployer wallet.
 * Only the contract owner can call withdrawLiquidity(address).
 *
 * Run while SWAP_CONTRACT_ADDRESS still points at the pool you want to drain:
 *   npx tsx --env-file=.env scripts/withdraw-old-liquidity.ts
 *
 * Requires: SWAP_CONTRACT_ADDRESS, DEPLOYER_PRIVATE_KEY, ARC_RPC
 */

import dotenv from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ARC } from '../lib/arc-config';

dotenv.config();

const swapAbi = parseAbi([
  'function withdrawLiquidity(address to)',
  'function owner() view returns (address)',
  'function pairToken() view returns (address)',
  'function usdc() view returns (address)',
  'function reserveUsdc() view returns (uint256)',
  'function reservePair() view returns (uint256)',
]);

const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const k = raw.trim();
  return (k.startsWith('0x') ? k : `0x${k}`) as `0x${string}`;
}

async function main(): Promise<void> {
  const rpc = requireEnv('ARC_RPC');
  const pk = requireEnv('DEPLOYER_PRIVATE_KEY');
  const swapAddr = getAddress(requireEnv('SWAP_CONTRACT_ADDRESS'));

  const account = privateKeyToAccount(normalizePrivateKey(pk));
  const deployer = getAddress(account.address);

  const chain = defineChain({
    id: ARC.chainId,
    name: ARC.blockchain,
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: [rpc] } },
  });

  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(rpc),
  });

  const pairToken = (await publicClient.readContract({
    address: swapAddr,
    abi: swapAbi,
    functionName: 'pairToken',
  })) as `0x${string}`;

  const usdcAddr = (await publicClient.readContract({
    address: swapAddr,
    abi: swapAbi,
    functionName: 'usdc',
  })) as `0x${string}`;

  const owner = (await publicClient.readContract({
    address: swapAddr,
    abi: swapAbi,
    functionName: 'owner',
  })) as `0x${string}`;

  if (owner.toLowerCase() !== deployer.toLowerCase()) {
    console.error(
      `[withdraw-old-liquidity] Deployer ${deployer} is not swap owner ${owner}. Cannot withdraw.`,
    );
    process.exit(1);
  }

  const logBalances = async (label: string) => {
    const [r0, r1, depUsdc, depPair] = await Promise.all([
      publicClient.readContract({
        address: swapAddr,
        abi: swapAbi,
        functionName: 'reserveUsdc',
      }) as Promise<bigint>,
      publicClient.readContract({
        address: swapAddr,
        abi: swapAbi,
        functionName: 'reservePair',
      }) as Promise<bigint>,
      publicClient.readContract({
        address: usdcAddr,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [deployer],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: pairToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [deployer],
      }) as Promise<bigint>,
    ]);

    console.log(`[withdraw-old-liquidity] ${label}`);
    console.log(
      JSON.stringify(
        {
          swapContract: swapAddr,
          poolReserveUsdc: formatUnits(r0, 6),
          poolReservePair: formatUnits(r1, 6),
          deployerUsdc: formatUnits(depUsdc, 6),
          deployerPair: formatUnits(depPair, 6),
        },
        null,
        2,
      ),
    );
  };

  await logBalances('BEFORE');

  const r0Before = (await publicClient.readContract({
    address: swapAddr,
    abi: swapAbi,
    functionName: 'reserveUsdc',
  })) as bigint;
  const r1Before = (await publicClient.readContract({
    address: swapAddr,
    abi: swapAbi,
    functionName: 'reservePair',
  })) as bigint;

  if (r0Before === 0n && r1Before === 0n) {
    console.log('[withdraw-old-liquidity] Pool already empty; nothing to do.');
    return;
  }

  const hash = await wallet.writeContract({
    account,
    chain,
    address: swapAddr,
    abi: swapAbi,
    functionName: 'withdrawLiquidity',
    args: [deployer],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(
    `[withdraw-old-liquidity] withdrawLiquidity tx hash: ${hash} status=${receipt.status}`,
  );

  await logBalances('AFTER');

  console.log('[withdraw-old-liquidity] done');
}

main().catch((err) => {
  console.error('[withdraw-old-liquidity] Fatal:', err);
  process.exit(1);
});
