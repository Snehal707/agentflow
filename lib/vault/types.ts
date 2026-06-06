export type VaultInfo = {
  provider: string;
  address: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  vaultSymbol: string;
  label: string;
  network: 'testnet' | 'mainnet';
  experimental: boolean;
  notes: string[];
};

export type VaultApyResult = {
  apy: number;
  method: string;
  lastUpdate: Date;
  sampleCount: number;
};

export type VaultPosition = {
  sharesRaw: bigint;
  sharesFormatted: string;
  underlyingValueRaw: bigint;
  underlyingValueFormatted: string;
  underlyingSymbol: string;
};

export type VaultDepositParams = {
  walletId: string;
  walletAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  assetAddress: `0x${string}`;
  amountInRaw: bigint;
  slippageBps: number;
};

export type VaultDepositResult = {
  provider: string;
  txId: string;
  txHash: `0x${string}`;
  approvalTxId?: string;
  approvalTxHash?: `0x${string}`;
  approvalSkipped: boolean;
  sharesReceivedRaw: bigint;
};

export type VaultWithdrawParams = {
  walletId: string;
  walletAddress: `0x${string}`;
  vaultAddress: `0x${string}`;
  assetAddress: `0x${string}`;
  amountOutRaw: bigint;
};

export type VaultWithdrawResult = {
  provider: string;
  txId: string;
  txHash: `0x${string}`;
  sharesBurnedRaw: bigint;
  assetsReceivedRaw: bigint;
};

export interface VaultProvider {
  name: string;
  listVaults(): Promise<VaultInfo[]>;
  getApy(vaultAddress: `0x${string}`): Promise<VaultApyResult>;
  getUserPosition(
    walletAddress: `0x${string}`,
    vaultAddress: `0x${string}`,
  ): Promise<VaultPosition>;
  deposit(params: VaultDepositParams): Promise<VaultDepositResult>;
  withdraw(params: VaultWithdrawParams): Promise<VaultWithdrawResult>;
}
