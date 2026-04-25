import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
} from 'viem';

import { ARC } from '../../lib/arc-config';
import {
  checkSpendingLimits,
  executeTransaction,
  getOrCreateAgentWallets,
  waitForTransaction,
} from '../../lib/dcw';
import { readVaultApyPercent } from '../../lib/vault-apy';

export type VaultAction = 'deposit' | 'withdraw' | 'compound';

export interface ExecuteVaultActionInput {
  action: VaultAction;
  walletAddress: string;
  walletId: string;
  vaultAddress: `0x${string}`;
  amountRaw: bigint;
  amountUsdc: number;
}

export interface ExecuteVaultActionResult {
  txId: string;
  txHash?: `0x${string}`;
  approvalTxId?: string;
  approvalSkipped: boolean;
}

export interface VaultBalances {
  assetAddress: `0x${string}`;
  totalAssetsRaw: bigint;
  totalSupplyRaw: bigint;
  walletSharesRaw: bigint;
  walletUsdcRaw: bigint;
}

export async function executeVaultAction(
  input: ExecuteVaultActionInput,
): Promise<ExecuteVaultActionResult> {
  if (input.amountUsdc <= 0) {
    throw new Error('[vault] amount must be a positive number');
  }

  const vaultAddress = getAddress(input.vaultAddress) as `0x${string}`;
  const walletAddress = getAddress(input.walletAddress) as `0x${string}`;

  if (input.action === 'deposit' || input.action === 'withdraw') {
    await checkSpendingLimits(walletAddress, input.amountUsdc);
  }

  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  const assetAddress = (await client.readContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: 'asset',
  })) as `0x${string}`;

  let approvalTxId: string | undefined;
  let approvalSkipped = true;

  if (input.action === 'deposit' || input.action === 'compound') {
    const approval = await ensureAssetAllowance({
      client,
      walletId: input.walletId,
      walletAddress,
      assetAddress,
      spender: vaultAddress,
      amountRaw: input.amountRaw,
    });
    approvalTxId = approval.approvalTxId;
    approvalSkipped = approval.approvalSkipped;
  }

  if (input.action === 'deposit' || input.action === 'compound') {
    await assertUsdcBalance(client, assetAddress, walletAddress, input.amountRaw);
  }

  const tx = await executeTransaction({
    walletId: input.walletId,
    contractAddress: vaultAddress,
    abiFunctionSignature: buildSignature(input.action),
    abiParameters: buildParameters(input.action, input.amountRaw, walletAddress),
    feeLevel: 'HIGH',
    usdcAmount: input.action === 'withdraw' ? undefined : input.amountUsdc,
  });

  const txId = extractTransactionId(tx);
  if (!txId) {
    throw new Error('[vault] missing transaction id');
  }

  const settled = await waitForTransaction(txId, `vault-${input.action}`);
  if (settled.state !== 'COMPLETE') {
    throw new Error(`[vault] transaction failed: ${settled.errorReason || settled.state}`);
  }

  return {
    txId,
    txHash: settled.txHash as `0x${string}` | undefined,
    approvalTxId,
    approvalSkipped,
  };
}

export async function readVaultBalances(
  vaultAddress: `0x${string}`,
  walletAddress: string,
): Promise<VaultBalances> {
  const normalizedVault = getAddress(vaultAddress) as `0x${string}`;
  const normalizedWallet = getAddress(walletAddress) as `0x${string}`;

  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  const assetAddress = (await client.readContract({
    address: normalizedVault,
    abi: vaultAbi,
    functionName: 'asset',
  })) as `0x${string}`;

  const [totalAssetsRaw, totalSupplyRaw, walletSharesRaw, walletUsdcRaw] = await Promise.all([
    client.readContract({
      address: normalizedVault,
      abi: vaultAbi,
      functionName: 'totalAssets',
    }) as Promise<bigint>,
    client.readContract({
      address: normalizedVault,
      abi: vaultAbi,
      functionName: 'totalSupply',
    }) as Promise<bigint>,
    client.readContract({
      address: normalizedVault,
      abi: vaultAbi,
      functionName: 'balanceOf',
      args: [normalizedWallet],
    }) as Promise<bigint>,
    client.readContract({
      address: assetAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [normalizedWallet],
    }) as Promise<bigint>,
  ]);

  return {
    assetAddress,
    totalAssetsRaw,
    totalSupplyRaw,
    walletSharesRaw,
    walletUsdcRaw,
  };
}

export async function readVaultSharePreview(input: {
  vaultAddress: `0x${string}`;
  depositAssetsRaw: bigint;
  withdrawAssetsRaw: bigint;
}): Promise<{ depositSharesRaw: bigint; withdrawSharesRaw: bigint; apyPercent: number }> {
  const vaultAddress = getAddress(input.vaultAddress) as `0x${string}`;
  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  const [depositSharesRaw, withdrawSharesRaw, apyPercent] = await Promise.all([
    client.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: 'previewDeposit',
      args: [input.depositAssetsRaw],
    }) as Promise<bigint>,
    client.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: 'previewWithdraw',
      args: [input.withdrawAssetsRaw],
    }) as Promise<bigint>,
    readVaultApyPercent(vaultAddress),
  ]);

  return { depositSharesRaw, withdrawSharesRaw, apyPercent };
}

export function formatUsdc(raw: bigint): string {
  return formatUnits(raw, 6);
}

export async function getVaultOwnerWallet() {
  const { ownerWallet } = await getOrCreateAgentWallets('vault');
  return ownerWallet;
}

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

const vaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
  'function previewWithdraw(uint256 assets) view returns (uint256 shares)',
  'function paused() view returns (bool)',
]);

/** Returns null if the contract has no paused() or call reverts. */
export async function readVaultPaused(vaultAddress: `0x${string}`): Promise<boolean | null> {
  const v = getAddress(vaultAddress) as `0x${string}`;
  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });
  try {
    return (await client.readContract({
      address: v,
      abi: vaultAbi,
      functionName: 'paused',
    })) as boolean;
  } catch {
    return null;
  }
}

const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

async function ensureAssetAllowance(input: {
  client: ReturnType<typeof createPublicClient>;
  walletId: string;
  walletAddress: `0x${string}`;
  assetAddress: `0x${string}`;
  spender: `0x${string}`;
  amountRaw: bigint;
}): Promise<{ approvalTxId?: string; approvalSkipped: boolean }> {
  const currentAllowance = (await input.client.readContract({
    address: input.assetAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [input.walletAddress, input.spender],
  })) as bigint;

  if (currentAllowance >= input.amountRaw) {
    return { approvalSkipped: true };
  }

  const approvalTx = await executeTransaction({
    walletId: input.walletId,
    contractAddress: input.assetAddress,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [input.spender, input.amountRaw.toString()],
    feeLevel: 'HIGH',
  });

  const approvalTxId = extractTransactionId(approvalTx);
  if (!approvalTxId) {
    throw new Error('[vault] approve() did not return transaction id');
  }

  const approvalResult = await waitForTransaction(approvalTxId, 'vault-approve');
  if (approvalResult.state !== 'COMPLETE') {
    throw new Error(
      `[vault] approve failed: ${approvalResult.errorReason || approvalResult.state || 'unknown'}`,
    );
  }

  const refreshedAllowance = (await input.client.readContract({
    address: input.assetAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [input.walletAddress, input.spender],
  })) as bigint;

  if (refreshedAllowance < input.amountRaw) {
    throw new Error('[vault] approve() completed but allowance is still too low');
  }

  return {
    approvalTxId,
    approvalSkipped: false,
  };
}

async function assertUsdcBalance(
  client: ReturnType<typeof createPublicClient>,
  assetAddress: `0x${string}`,
  walletAddress: `0x${string}`,
  amountRaw: bigint,
): Promise<void> {
  const balance = (await client.readContract({
    address: assetAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [walletAddress],
  })) as bigint;

  if (balance < amountRaw) {
    throw new Error(
      `[vault] insufficient asset balance: have ${balance.toString()} need ${amountRaw.toString()}`,
    );
  }
}

function buildSignature(action: VaultAction): string {
  switch (action) {
    case 'deposit':
      return 'deposit(uint256,address)';
    case 'withdraw':
      return 'withdraw(uint256,address,address)';
    case 'compound':
      return 'compound(uint256)';
  }
}

function buildParameters(
  action: VaultAction,
  amountRaw: bigint,
  walletAddress: `0x${string}`,
): string[] {
  switch (action) {
    case 'deposit':
      return [amountRaw.toString(), walletAddress];
    case 'withdraw':
      return [amountRaw.toString(), walletAddress, walletAddress];
    case 'compound':
      return [amountRaw.toString()];
  }
}

function extractTransactionId(tx: unknown): string | null {
  const obj = tx as { data?: { transaction?: { id?: string }; id?: string } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}
