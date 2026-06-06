import { getRedis } from '../../../db/client';
import { createPublicClient, formatUnits, getAddress, http, parseAbi } from 'viem';
import { ARC } from '../../arc-config';
import { executeTransaction, waitForTransaction } from '../../dcw';
import type {
  VaultApyResult,
  VaultDepositParams,
  VaultDepositResult,
  VaultInfo,
  VaultPosition,
  VaultProvider,
  VaultWithdrawParams,
  VaultWithdrawResult,
} from '../types';

const VAULT_ABI = parseAbi([
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function convertToShares(uint256 assets) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
]);

const ERC20_ABI = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)',
]);

const publicClient = createPublicClient({
  transport: http(ARC.alchemyRpc || ARC.rpc),
});

const ONE_SHARE_RAW = 1_000_000n;

export const HARVEST_DISCLAIMER =
  'Yield not auto-compounding yet - Lunex harvest keeper coming. Manual harvest may be needed for full APY realization.';

export const LUNEX_VAULTS = [
  {
    address: getAddress('0x66CF9CA9D75FD62438C6E254bA35E61775EF9496') as `0x${string}`,
    asset: getAddress('0x3600000000000000000000000000000000000000') as `0x${string}`,
    assetSymbol: 'USDC',
    vaultSymbol: 'luneUSDC',
    label: 'Lunex USDC Vault',
  },
  {
    address: getAddress('0xcF2C839B12ECf6D9eEcd4607521B73fcFb7E8713') as `0x${string}`,
    asset: getAddress('0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a') as `0x${string}`,
    assetSymbol: 'EURC',
    vaultSymbol: 'luneEURC',
    label: 'Lunex EURC Vault',
  },
] as const;

type LunexVaultConfig = (typeof LUNEX_VAULTS)[number];

function getVaultConfig(vaultAddress: `0x${string}`): LunexVaultConfig {
  const normalized = getAddress(vaultAddress);
  const found = LUNEX_VAULTS.find((vault) => vault.address === normalized);
  if (!found) {
    throw new Error(`[vault/lunex] unknown vault: ${normalized}`);
  }
  return found;
}

function snapshotKey(vaultAddress: `0x${string}`): string {
  return `vault:apy:share_price:snapshots:${getAddress(vaultAddress).toLowerCase()}`;
}

function parseSnapshotMember(member: string): { ts: number; sharePriceRaw: bigint } | null {
  const separator = member.indexOf(':');
  if (separator <= 0) return null;
  const ts = Number(member.slice(0, separator));
  const raw = member.slice(separator + 1);
  if (!Number.isFinite(ts) || !raw) return null;
  try {
    return { ts, sharePriceRaw: BigInt(raw) };
  } catch {
    return null;
  }
}

async function readSharesReceivedFromDeposit(
  vaultAddress: `0x${string}`,
  assetsRaw: bigint,
): Promise<bigint> {
  return (await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'convertToShares',
    args: [assetsRaw],
  })) as bigint;
}

async function readSharesBurnedFromWithdraw(
  vaultAddress: `0x${string}`,
  assetsRaw: bigint,
): Promise<bigint> {
  return (await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'convertToShares',
    args: [assetsRaw],
  })) as bigint;
}

async function assertVaultAsset(
  vaultAddress: `0x${string}`,
  expectedAsset: `0x${string}`,
): Promise<void> {
  const asset = (await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'asset',
  })) as `0x${string}`;
  const normalizedActual = getAddress(asset);
  const normalizedExpected = getAddress(expectedAsset);
  if (normalizedActual !== normalizedExpected) {
    throw new Error(
      `[vault/lunex] vault asset mismatch: expected ${normalizedExpected}, got ${normalizedActual}`,
    );
  }
}

export const lunexVaultProvider: VaultProvider = {
  name: 'lunex',

  async listVaults(): Promise<VaultInfo[]> {
    return LUNEX_VAULTS.map((vault) => ({
      provider: 'lunex',
      address: vault.address,
      asset: vault.asset,
      assetSymbol: vault.assetSymbol,
      vaultSymbol: vault.vaultSymbol,
      label: vault.label,
      network: 'testnet',
      experimental: true,
      notes: [HARVEST_DISCLAIMER],
    }));
  },

  async getApy(vaultAddress: `0x${string}`): Promise<VaultApyResult> {
    const config = getVaultConfig(vaultAddress);
    const redis = getRedis();
    const now = Date.now();
    const nowIso = new Date(now);
    const currentSharePriceRaw = (await publicClient.readContract({
      address: config.address,
      abi: VAULT_ABI,
      functionName: 'convertToAssets',
      args: [ONE_SHARE_RAW],
    })) as bigint;

    const key = snapshotKey(config.address);
    const member = `${now}:${currentSharePriceRaw.toString()}`;
    await redis.zadd(key, now, member);
    await redis.zremrangebyrank(key, 0, -31);

    const members = await redis.zrange(key, 0, -1);
    const parsed = members
      .map(parseSnapshotMember)
      .filter((value): value is { ts: number; sharePriceRaw: bigint } => value !== null)
      .sort((a, b) => a.ts - b.ts);

    if (parsed.length < 2) {
      return {
        apy: 0,
        method: 'insufficient_data',
        lastUpdate: nowIso,
        sampleCount: parsed.length,
      };
    }

    const oldest = parsed[0];
    const newest = parsed[parsed.length - 1];

    if (oldest.sharePriceRaw <= 0n || newest.ts <= oldest.ts) {
      return {
        apy: 0,
        method: 'insufficient_data',
        lastUpdate: nowIso,
        sampleCount: parsed.length,
      };
    }

    const growthRate =
      Number(newest.sharePriceRaw - oldest.sharePriceRaw) /
      Number(oldest.sharePriceRaw);
    const timeDiffDays = (newest.ts - oldest.ts) / (1000 * 60 * 60 * 24);
    const annualized = timeDiffDays > 0 ? growthRate * (365 / timeDiffDays) : 0;

    return {
      apy: Number.isFinite(annualized) ? annualized * 100 : 0,
      method: 'share_price_snapshot',
      lastUpdate: nowIso,
      sampleCount: parsed.length,
    };
  },

  async getUserPosition(
    walletAddress: `0x${string}`,
    vaultAddress: `0x${string}`,
  ): Promise<VaultPosition> {
    const config = getVaultConfig(vaultAddress);
    const sharesRaw = (await publicClient.readContract({
      address: config.address,
      abi: VAULT_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    })) as bigint;

    const underlyingValueRaw = (await publicClient.readContract({
      address: config.address,
      abi: VAULT_ABI,
      functionName: 'convertToAssets',
      args: [sharesRaw],
    })) as bigint;

    return {
      sharesRaw,
      sharesFormatted: formatUnits(sharesRaw, 6),
      underlyingValueRaw,
      underlyingValueFormatted: formatUnits(underlyingValueRaw, 6),
      underlyingSymbol: config.assetSymbol,
    };
  },

  async deposit(params: VaultDepositParams): Promise<VaultDepositResult> {
    const config = getVaultConfig(params.vaultAddress);
    await assertVaultAsset(config.address, params.assetAddress);

    const allowance = (await publicClient.readContract({
      address: params.assetAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [params.walletAddress, config.address],
    })) as bigint;

    let approvalTxId: string | undefined;
    let approvalTxHash: `0x${string}` | undefined;
    let approvalSkipped = true;

    if (allowance < params.amountInRaw) {
      approvalSkipped = false;
      const approval = (await executeTransaction({
        walletId: params.walletId,
        contractAddress: params.assetAddress,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [config.address, params.amountInRaw.toString()],
        feeLevel: 'HIGH',
        usdcAmount: Number(formatUnits(params.amountInRaw, 6)),
      })) as { data?: { id?: string; transaction?: { id?: string } } };

      approvalTxId = approval.data?.transaction?.id || approval.data?.id;
      if (!approvalTxId) {
        throw new Error('[vault/lunex] approval did not return a transaction id');
      }

      const approvalReceipt = await waitForTransaction(approvalTxId, 'vault-lunex-approval');
      if (approvalReceipt.state !== 'COMPLETE' || !approvalReceipt.txHash) {
        throw new Error(
          `[vault/lunex] approval failed: ${approvalReceipt.errorReason || approvalReceipt.state || 'unknown'}`,
        );
      }
      approvalTxHash = approvalReceipt.txHash as `0x${string}`;
    }

    const sharesReceivedRaw = await readSharesReceivedFromDeposit(
      config.address,
      params.amountInRaw,
    );

    const depositTx = (await executeTransaction({
      walletId: params.walletId,
      contractAddress: config.address,
      abiFunctionSignature: 'deposit(uint256,address)',
      abiParameters: [params.amountInRaw.toString(), params.walletAddress],
      feeLevel: 'HIGH',
      usdcAmount: Number(formatUnits(params.amountInRaw, 6)),
    })) as { data?: { id?: string; transaction?: { id?: string } } };

    const txId = depositTx.data?.transaction?.id || depositTx.data?.id;
    if (!txId) {
      throw new Error('[vault/lunex] deposit did not return a transaction id');
    }

    const receipt = await waitForTransaction(txId, 'vault-lunex-deposit');
    if (receipt.state !== 'COMPLETE' || !receipt.txHash) {
      throw new Error(
        `[vault/lunex] deposit failed: ${receipt.errorReason || receipt.state || 'unknown'}`,
      );
    }

    return {
      provider: this.name,
      txId,
      txHash: receipt.txHash as `0x${string}`,
      approvalTxId,
      approvalTxHash,
      approvalSkipped,
      sharesReceivedRaw,
    };
  },

  async withdraw(params: VaultWithdrawParams): Promise<VaultWithdrawResult> {
    const config = getVaultConfig(params.vaultAddress);
    await assertVaultAsset(config.address, params.assetAddress);

    const sharesBurnedRaw = await readSharesBurnedFromWithdraw(
      config.address,
      params.amountOutRaw,
    );

    const withdrawTx = (await executeTransaction({
      walletId: params.walletId,
      contractAddress: config.address,
      abiFunctionSignature: 'withdraw(uint256,address,address)',
      abiParameters: [
        params.amountOutRaw.toString(),
        params.walletAddress,
        params.walletAddress,
      ],
      feeLevel: 'HIGH',
      usdcAmount: Number(formatUnits(params.amountOutRaw, 6)),
    })) as { data?: { id?: string; transaction?: { id?: string } } };

    const txId = withdrawTx.data?.transaction?.id || withdrawTx.data?.id;
    if (!txId) {
      throw new Error('[vault/lunex] withdraw did not return a transaction id');
    }

    const receipt = await waitForTransaction(txId, 'vault-lunex-withdraw');
    if (receipt.state !== 'COMPLETE' || !receipt.txHash) {
      throw new Error(
        `[vault/lunex] withdraw failed: ${receipt.errorReason || receipt.state || 'unknown'}`,
      );
    }

    return {
      provider: this.name,
      txId,
      txHash: receipt.txHash as `0x${string}`,
      sharesBurnedRaw,
      assetsReceivedRaw: params.amountOutRaw,
    };
  },
};
