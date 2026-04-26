import {
  fetchExecutionWalletSummary,
  fetchPortfolioSnapshot,
  type PortfolioHolding,
} from "@/lib/liveAgentClient";

export type VaultHoldingCard = {
  key: string;
  label: string;
  walletAddress: string;
  balanceFormatted: string;
  symbol: string;
  usdValue: number | null;
  readLabel: string;
};

export function findVaultHolding(holdings: PortfolioHolding[]): PortfolioHolding | null {
  return (
    holdings.find((holding) => {
      if (holding.kind !== "vault_share") {
        return false;
      }
      const amount = Number(holding.balanceFormatted ?? "0");
      return Number.isFinite(amount) && amount > 0;
    }) ?? null
  );
}

export type LoadVaultHoldingCardsResult = {
  cards: VaultHoldingCard[];
  error: string | null;
};

/**
 * Live vault share positions for connected wallet + Agent wallet (when authenticated).
 */
export async function loadVaultHoldingCards(
  address: string | undefined,
  getAuthHeaders: () => Record<string, string> | null,
  isAuthenticated: boolean,
): Promise<LoadVaultHoldingCardsResult> {
  if (!address) {
    return { cards: [], error: null };
  }

  const nextHoldings: VaultHoldingCard[] = [];
  let didReadAnything = false;
  let didFail = false;

  try {
    const walletSnapshot = await fetchPortfolioSnapshot(address);
    didReadAnything = true;
    const walletVault = findVaultHolding(walletSnapshot.holdings);
    if (walletVault) {
      nextHoldings.push({
        key: `wallet-${address}`,
        label: "Connected wallet",
        walletAddress: address,
        balanceFormatted: walletVault.balanceFormatted,
        symbol: walletVault.symbol || "afvUSDC",
        usdValue: walletVault.usdValue,
        readLabel: "Live onchain read",
      });
    }
  } catch {
    didFail = true;
  }

  const authHeaders = getAuthHeaders();
  if (isAuthenticated && authHeaders) {
    try {
      const executionSummary = await fetchExecutionWalletSummary(authHeaders);
      const executionAddress = executionSummary.userAgentWalletAddress;

      if (executionAddress && executionAddress.toLowerCase() !== address.toLowerCase()) {
        const executionSnapshot = await fetchPortfolioSnapshot(executionAddress);
        didReadAnything = true;
        const executionVault = findVaultHolding(executionSnapshot.holdings);

        if (executionVault) {
          nextHoldings.push({
            key: `execution-${executionAddress}`,
            label: "Agent wallet",
            walletAddress: executionAddress,
            balanceFormatted: executionVault.balanceFormatted,
            symbol: executionVault.symbol || "afvUSDC",
            usdValue: executionVault.usdValue,
            readLabel: "Live onchain read",
          });
        } else {
          const balance = Number(executionSummary.balances.vaultShares?.formatted ?? "0");
          if (Number.isFinite(balance) && balance > 0) {
            nextHoldings.push({
              key: `execution-${executionAddress}`,
              label: "Agent wallet",
              walletAddress: executionAddress,
              balanceFormatted: executionSummary.balances.vaultShares.formatted,
              symbol: "afvUSDC",
              usdValue: null,
              readLabel: "Live wallet summary",
            });
          }
        }
      }
    } catch {
      didFail = true;
    }
  }

  return {
    cards: nextHoldings,
    error: didFail && !didReadAnything ? "Could not read vault holdings." : null,
  };
}
