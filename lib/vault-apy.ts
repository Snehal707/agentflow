/**
 * Deprecated AgentFlowVault APY helper.
 * Live vault APY reads are handled by provider vault adapters.
 */
export async function readVaultApyPercent(_vaultAddress: `0x${string}`): Promise<number> {
  return Number(process.env.VAULT_TARGET_APY || '5.3');
}

export function resolveVaultAddress(): `0x${string}` | null {
  return null;
}
