/**
 * Seed AgentFlowSwap (USDC + pair 1:1) and AgentFlowVault with initial testnet liquidity.
 *
 * Run: npx tsx --env-file=.env scripts/add-liquidity.ts
 *
 * Defaults: 150_000 USDC + 150_000 pair to swap (balanced StableSwap pool).
 * Override: ADD_LIQUIDITY_SWAP_AMOUNT (human, 6dp), VAULT_DEPOSIT_AMOUNT (USDC to vault, default 10).
 */

import dotenv from 'dotenv';
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  parseUnits,
} from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';

import { ARC } from '../lib/arc-config';

dotenv.config();

const USDC = '0x3600000000000000000000000000000000000000' as const;
const DEFAULT_PAIR_TOKEN =
  '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

const swapAbi = parseAbi(['function addLiquidity(uint256 amount)']);

const vaultAbi = parseAbi([
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
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

async function ensureAllowance(
  wallet: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  chain: Chain,
  account: PrivateKeyAccount,
  args: {
    token: `0x${string}`;
    owner: `0x${string}`;
    spender: `0x${string}`;
    amount: bigint;
    label: string;
  },
): Promise<void> {
  const current = await publicClient.readContract({
    address: args.token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [args.owner, args.spender],
  });
  if (current >= args.amount) {
    console.log(`[add-liquidity] ${args.label}: allowance already sufficient`);
    return;
  }
  const hash = await wallet.writeContract({
    account,
    chain,
    address: args.token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [args.spender, args.amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[add-liquidity] ${args.label}: approve tx ${hash} status=${receipt.status}`);
}

async function main(): Promise<void> {
  const rpc = requireEnv('ARC_RPC');
  let pk = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!pk) {
    console.error('Missing required env: DEPLOYER_PRIVATE_KEY');
    process.exit(1);
  }
  const swap = getAddress(requireEnv('SWAP_CONTRACT_ADDRESS'));
  const vault = getAddress(requireEnv('VAULT_CONTRACT_ADDRESS'));
  const pairToken = getAddress(
    process.env.SWAP_PAIR_TOKEN_ADDRESS?.trim() || DEFAULT_PAIR_TOKEN,
  );
  const usdc = getAddress(USDC);

  const account = privateKeyToAccount(normalizePrivateKey(pk));

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

  const swapAmount = parseUnits(
    process.env.ADD_LIQUIDITY_SWAP_AMOUNT?.trim() || '150000',
    6,
  );
  const vaultAmount = parseUnits(process.env.VAULT_DEPOSIT_AMOUNT?.trim() || '10', 6);
  /** Swap: `swapAmount` USDC + `swapAmount` pair; vault: `vaultAmount` USDC only. */
  const minUsdc = swapAmount + vaultAmount;

  const [balUsdc, balPair] = await Promise.all([
    publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
    publicClient.readContract({
      address: pairToken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ]);

  console.log(`[add-liquidity] deployer=${account.address}`);
  console.log(`[add-liquidity] swap=${swap} vault=${vault}`);
  console.log(
    `[add-liquidity] swapLiquidity=${swapAmount} each token (raw), vaultDeposit=${vaultAmount} USDC (raw)`,
  );
  console.log(
    `[add-liquidity] USDC balance=${balUsdc} pair balance=${balPair} need USDC >= ${minUsdc} (swap + vault), pair >= ${swapAmount}`,
  );

  if (balUsdc < minUsdc || balPair < swapAmount) {
    console.error(
      `[add-liquidity] Insufficient balances: need swap USDC+pair (${swapAmount} each) plus vault USDC (${vaultAmount}). Fund the deployer and retry.`,
    );
    process.exit(1);
  }

  await ensureAllowance(wallet, publicClient, chain, account, {
    token: usdc,
    owner: account.address,
    spender: swap,
    amount: swapAmount,
    label: 'USDC -> swap',
  });

  await ensureAllowance(wallet, publicClient, chain, account, {
    token: pairToken,
    owner: account.address,
    spender: swap,
    amount: swapAmount,
    label: 'pair -> swap',
  });

  const addLiqHash = await wallet.writeContract({
    account,
    chain,
    address: swap,
    abi: swapAbi,
    functionName: 'addLiquidity',
    args: [swapAmount],
  });
  const addLiqReceipt = await publicClient.waitForTransactionReceipt({ hash: addLiqHash });
  console.log(`[add-liquidity] addLiquidity tx ${addLiqHash} status=${addLiqReceipt.status}`);

  await ensureAllowance(wallet, publicClient, chain, account, {
    token: usdc,
    owner: account.address,
    spender: vault,
    amount: vaultAmount,
    label: 'USDC -> vault',
  });

  const depositHash = await wallet.writeContract({
    account,
    chain,
    address: vault,
    abi: vaultAbi,
    functionName: 'deposit',
    args: [vaultAmount, account.address],
  });
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`[add-liquidity] deposit tx ${depositHash} status=${depositReceipt.status}`);
  console.log('[add-liquidity] done');
}

main().catch((err) => {
  console.error('[add-liquidity] Fatal:', err);
  process.exit(1);
});
