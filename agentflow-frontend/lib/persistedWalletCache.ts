const PORTFOLIO_SNAPSHOT_PREFIX = "agentflow:portfolio:snapshot:";

type PersistablePortfolioSnapshot = {
  walletAddress?: string;
  [key: string]: unknown;
};

export function persistPortfolioSnapshot(snapshot: PersistablePortfolioSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  const walletAddress = typeof snapshot.walletAddress === "string"
    ? snapshot.walletAddress.trim().toLowerCase()
    : "";

  if (!walletAddress) {
    return;
  }

  try {
    window.localStorage.setItem(
      `${PORTFOLIO_SNAPSHOT_PREFIX}${walletAddress}`,
      JSON.stringify({
        savedAt: Date.now(),
        snapshot,
      }),
    );
  } catch {
    // Best-effort cache only; never block portfolio rendering.
  }
}
