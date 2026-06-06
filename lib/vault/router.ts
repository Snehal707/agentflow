import { lunexVaultProvider } from './providers/lunex';
import type {
  VaultApyResult,
  VaultDepositParams,
  VaultDepositResult,
  VaultInfo,
  VaultPosition,
  VaultProvider,
  VaultWithdrawParams,
  VaultWithdrawResult,
} from './types';

const providers: VaultProvider[] = [lunexVaultProvider];

function sanitizeErrorReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.LUNEX_API_KEY?.trim();
  // Defense-in-depth: future vault providers may use API keys.
  // No-op redaction is fine.
  if (!apiKey) {
    return raw;
  }
  return raw.split(apiKey).join('[REDACTED]');
}

function requireProvider(providerName: string): VaultProvider {
  const provider = providers.find((entry) => entry.name === providerName);
  if (!provider) {
    throw new Error(`[vault/router] unknown provider: ${providerName}`);
  }
  return provider;
}

export async function listAllVaults(): Promise<VaultInfo[]> {
  const attempts = await Promise.allSettled(
    providers.map(async (provider) => {
      const vaults = await provider.listVaults();
      return { provider: provider.name, vaults };
    }),
  );

  const allVaults: VaultInfo[] = [];

  for (let index = 0; index < attempts.length; index++) {
    const providerName = providers[index]?.name ?? 'unknown';
    const attempt = attempts[index];

    if (attempt.status === 'fulfilled') {
      console.info(
        '[VAULT_ROUTER_LIST]',
        JSON.stringify({
          provider: providerName,
          success: true,
          vaultCount: attempt.value.vaults.length,
          errorReason: null,
        }),
      );
      allVaults.push(...attempt.value.vaults);
    } else {
      console.info(
        '[VAULT_ROUTER_LIST]',
        JSON.stringify({
          provider: providerName,
          success: false,
          vaultCount: 0,
          errorReason: sanitizeErrorReason(attempt.reason),
        }),
      );
    }
  }

  return allVaults;
}

export async function getVaultApy(
  providerName: string,
  vaultAddress: `0x${string}`,
): Promise<VaultApyResult> {
  const provider = requireProvider(providerName);
  return provider.getApy(vaultAddress);
}

export async function getProviderPosition(
  providerName: string,
  walletAddress: `0x${string}`,
  vaultAddress: `0x${string}`,
): Promise<VaultPosition> {
  const provider = requireProvider(providerName);
  return provider.getUserPosition(walletAddress, vaultAddress);
}

export async function executeDeposit(
  providerName: string,
  params: VaultDepositParams,
): Promise<VaultDepositResult> {
  const provider = requireProvider(providerName);

  try {
    const result = await provider.deposit(params);
    console.info(
      '[VAULT_DEPOSIT]',
      JSON.stringify({
        provider: providerName,
        vaultAddress: params.vaultAddress,
        assetAddress: params.assetAddress,
        amountInRaw: params.amountInRaw.toString(),
        sharesReceivedRaw: result.sharesReceivedRaw.toString(),
        txHash: result.txHash,
        approvalTxId: result.approvalTxId ?? null,
        approvalSkipped: result.approvalSkipped,
      }),
    );
    return result;
  } catch (error) {
    console.info(
      '[VAULT_DEPOSIT]',
      JSON.stringify({
        provider: providerName,
        vaultAddress: params.vaultAddress,
        assetAddress: params.assetAddress,
        amountInRaw: params.amountInRaw.toString(),
        success: false,
        errorReason: sanitizeErrorReason(error),
      }),
    );
    throw error;
  }
}

export async function executeWithdraw(
  providerName: string,
  params: VaultWithdrawParams,
): Promise<VaultWithdrawResult> {
  const provider = requireProvider(providerName);

  try {
    const result = await provider.withdraw(params);
    console.info(
      '[VAULT_WITHDRAW]',
      JSON.stringify({
        provider: providerName,
        vaultAddress: params.vaultAddress,
        assetAddress: params.assetAddress,
        amountOutRaw: params.amountOutRaw.toString(),
        sharesBurnedRaw: result.sharesBurnedRaw.toString(),
        assetsReceivedRaw: result.assetsReceivedRaw.toString(),
        txHash: result.txHash,
      }),
    );
    return result;
  } catch (error) {
    console.info(
      '[VAULT_WITHDRAW]',
      JSON.stringify({
        provider: providerName,
        vaultAddress: params.vaultAddress,
        assetAddress: params.assetAddress,
        amountOutRaw: params.amountOutRaw.toString(),
        success: false,
        errorReason: sanitizeErrorReason(error),
      }),
    );
    throw error;
  }
}

export async function getUserPositionsAcrossProviders(
  walletAddress: `0x${string}`,
): Promise<Array<VaultPosition & { provider: string; vault: VaultInfo }>> {
  const positions: Array<VaultPosition & { provider: string; vault: VaultInfo }> = [];

  for (const provider of providers) {
    const vaults = await provider.listVaults();
    const providerPositions = await Promise.all(
      vaults.map(async (vault) => {
        const position = await provider.getUserPosition(walletAddress, vault.address);
        return { provider: provider.name, vault, position };
      }),
    );

    for (const entry of providerPositions) {
      if (entry.position.sharesRaw > 0n) {
        positions.push({
          provider: entry.provider,
          vault: entry.vault,
          ...entry.position,
        });
      }
    }
  }

  return positions;
}
