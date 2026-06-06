import { formatUnits } from 'viem';
import { getOrCreateAgentWallets } from '../../lib/dcw';

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
  _input: ExecuteVaultActionInput,
): Promise<ExecuteVaultActionResult> {
  throw new Error(
    'Legacy AgentFlowVault execution is deprecated; provider vault routing handles live vault actions.',
  );
}

export async function readVaultBalances(
  _vaultAddress: `0x${string}`,
  _walletAddress: string,
): Promise<VaultBalances> {
  return {
    assetAddress: '0x3600000000000000000000000000000000000000',
    totalAssetsRaw: 0n,
    totalSupplyRaw: 0n,
    walletSharesRaw: 0n,
    walletUsdcRaw: 0n,
  };
}

export async function readVaultSharePreview(input: {
  vaultAddress: `0x${string}`;
  depositAssetsRaw: bigint;
  withdrawAssetsRaw: bigint;
}): Promise<{ depositSharesRaw: bigint; withdrawSharesRaw: bigint; apyPercent: number }> {
  return {
    depositSharesRaw: input.depositAssetsRaw,
    withdrawSharesRaw: input.withdrawAssetsRaw,
    apyPercent: Number(process.env.VAULT_TARGET_APY || '5.3'),
  };
}

export function formatUsdc(raw: bigint): string {
  return formatUnits(raw, 6);
}

export async function getVaultOwnerWallet() {
  const { ownerWallet } = await getOrCreateAgentWallets('vault');
  return ownerWallet;
}

export async function readVaultPaused(_vaultAddress: `0x${string}`): Promise<boolean | null> {
  return null;
}
