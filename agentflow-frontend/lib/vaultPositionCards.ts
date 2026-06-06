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
  displaySymbol: string;
  usdValue: number | null;
  readLabel: string;
};

function inferUnderlyingSymbol(holding: PortfolioHolding): string {
  const upperSymbol = holding.symbol.trim().toUpperCase();
  const notes = holding.notes.join(" ").toUpperCase();

  if (notes.includes("UNDERLYING USDC") || upperSymbol.includes("USDC")) {
    return "USDC";
  }
  if (notes.includes("UNDERLYING EURC") || upperSymbol.includes("EURC")) {
    return "EURC";
  }
  return holding.symbol || "VAULT";
}

export function findVaultHoldings(holdings: PortfolioHolding[]): PortfolioHolding[] {
  return holdings.filter((holding) => {
    if (holding.kind !== "vault_share") {
      return false;
    }
    const amount = Number(holding.balanceFormatted ?? "0");
    return Number.isFinite(amount) && amount > 0;
  });
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
    const walletVaults = findVaultHoldings(walletSnapshot.holdings);
    for (const walletVault of walletVaults) {
      nextHoldings.push({
        key: `wallet-${address}-${walletVault.id}`,
        label: "Connected wallet",
        walletAddress: address,
        balanceFormatted: walletVault.balanceFormatted,
        symbol: walletVault.symbol || "afvUSDC",
        displaySymbol: inferUnderlyingSymbol(walletVault),
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
        const executionVaults = findVaultHoldings(executionSnapshot.holdings);

        if (executionVaults.length > 0) {
          for (const executionVault of executionVaults) {
            nextHoldings.push({
              key: `execution-${executionAddress}-${executionVault.id}`,
              label: "Agent wallet",
              walletAddress: executionAddress,
              balanceFormatted: executionVault.balanceFormatted,
              symbol: executionVault.symbol || "afvUSDC",
              displaySymbol: inferUnderlyingSymbol(executionVault),
              usdValue: executionVault.usdValue,
              readLabel: "Live onchain read",
            });
          }
        } else {
          const balance = Number(executionSummary.balances.vaultShares?.formatted ?? "0");
          if (Number.isFinite(balance) && balance > 0) {
            nextHoldings.push({
              key: `execution-${executionAddress}`,
              label: "Agent wallet",
              walletAddress: executionAddress,
              balanceFormatted: executionSummary.balances.vaultShares.formatted,
              symbol: "afvUSDC",
              displaySymbol: "USDC",
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
