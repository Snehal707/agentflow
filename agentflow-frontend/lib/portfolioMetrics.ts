import type {
  PortfolioHolding,
  PortfolioPosition,
  PortfolioRecentTransaction,
  PortfolioSnapshotResponse,
} from "@/lib/liveAgentClient";

function holdingMergeKey(h: PortfolioHolding): string {
  const addr = (h.address ?? "").toLowerCase();
  return `${h.kind}:${addr || h.symbol.toUpperCase()}`;
}

function positionMergeKey(p: PortfolioPosition): string {
  return `${p.kind}:${p.protocol}:${p.name}`;
}

/**
 * Merges EOA + execution holdings for Combined view: aggregates by token identity,
 * sums USD. Includes Arc native USDC (gas) so allocation matches on-chain balances.
 */
export function mergeCombinedHoldings(
  eoa: PortfolioSnapshotResponse | null,
  execution: PortfolioSnapshotResponse | null,
): PortfolioHolding[] {
  const map = new Map<string, PortfolioHolding>();

  function ingest(h: PortfolioHolding) {
    const usd = h.usdValue ?? 0;
    if (!Number.isFinite(usd)) return;

    if (h.kind === "native") {
      const key = `native:${h.symbol.toUpperCase()}`;
      const prev = map.get(key);
      if (prev) {
        prev.usdValue = (prev.usdValue ?? 0) + usd;
      } else {
        map.set(key, {
          ...h,
          id: `combined:${key}`,
          source: "combined",
          usdValue: usd,
        });
      }
      return;
    }

    const key = holdingMergeKey(h);
    const prev = map.get(key);
    if (prev) {
      prev.usdValue = (prev.usdValue ?? 0) + usd;
    } else {
      map.set(key, {
        ...h,
        id: `combined:${key}`,
        source: "combined",
        usdValue: usd,
      });
    }
  }

  for (const snap of [eoa, execution]) {
    if (!snap) continue;
    for (const h of snap.holdings) ingest(h);
  }

  return Array.from(map.values());
}

export function mergeCombinedPositions(
  eoa: PortfolioSnapshotResponse | null,
  execution: PortfolioSnapshotResponse | null,
): PortfolioPosition[] {
  const map = new Map<string, PortfolioPosition>();

  function ingest(p: PortfolioPosition) {
    if (p.kind === "gateway_position") return;
    const usd = p.usdValue ?? 0;
    if (!Number.isFinite(usd)) return;
    const key = positionMergeKey(p);
    const prev = map.get(key);
    if (prev) {
      prev.usdValue = (prev.usdValue ?? 0) + usd;
      prev.costBasisUsd = (prev.costBasisUsd ?? 0) + (p.costBasisUsd ?? 0);
      prev.pnlUsd = (prev.pnlUsd ?? 0) + (p.pnlUsd ?? 0);
    } else {
      map.set(key, {
        ...p,
        id: `combined:${key}`,
      });
    }
  }

  for (const snap of [eoa, execution]) {
    if (!snap) continue;
    for (const p of snap.positions) ingest(p);
  }

  return Array.from(map.values());
}

export function mergeCombinedRecentTransactions(
  eoa: PortfolioSnapshotResponse | null,
  execution: PortfolioSnapshotResponse | null,
): PortfolioRecentTransaction[] {
  const a = eoa?.recentTransactions ?? [];
  const b = execution?.recentTransactions ?? [];
  return [...a, ...b].sort((x, y) => {
    const tx = new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime();
    return Number.isNaN(tx) ? 0 : tx;
  });
}

/**
 * Spendable / investable USD: ERC-20 style holdings + protocol positions,
 * excluding Circle Gateway position and Arc native USDC (18‑dec gas balance).
 * Use for the EOA / Execution sub-cards that label “excl. Gateway / gas”.
 */
export function portfolioValueUsdExcludingGatewayAndGas(
  snapshot: PortfolioSnapshotResponse | null,
): number {
  if (!snapshot) return 0;
  const holdingsUsd = snapshot.holdings
    .filter((h) => h.kind !== "native")
    .reduce((sum, h) => sum + (h.usdValue ?? 0), 0);
  const positionsUsd = snapshot.positions
    .filter((p) => p.kind !== "gateway_position")
    .reduce((sum, p) => sum + (p.usdValue ?? 0), 0);
  return holdingsUsd + positionsUsd;
}

/**
 * Full wallet USD: all holdings (including Arc native USDC used for gas) + protocol positions,
 * excluding only the Circle Gateway *position* row (unified balance is separate in UI).
 */
export function portfolioValueUsdExcludingGatewayOnly(
  snapshot: PortfolioSnapshotResponse | null,
): number {
  if (!snapshot) return 0;
  const holdingsUsd = snapshot.holdings.reduce((sum, h) => sum + (h.usdValue ?? 0), 0);
  const positionsUsd = snapshot.positions
    .filter((p) => p.kind !== "gateway_position")
    .reduce((sum, p) => sum + (p.usdValue ?? 0), 0);
  return holdingsUsd + positionsUsd;
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * P&L scoped like {@link portfolioValueUsdExcludingGatewayOnly}: subtracts Circle Gateway
 * rows so headline value, cost basis, and net P&L refer to the same basket of assets.
 * (Backend `pnlSummary` includes Gateway position value + basis; the UI headline does not.)
 */
export function pnlSummaryExcludingGateway(snapshot: PortfolioSnapshotResponse | null): {
  currentValueUsd: number;
  costBasisUsd: number;
  pnlUsd: number;
  pnlPct: number;
} {
  if (!snapshot?.pnlSummary) {
    return { currentValueUsd: 0, costBasisUsd: 0, pnlUsd: 0, pnlPct: 0 };
  }
  const gw = snapshot.positions.filter((p) => p.kind === "gateway_position");
  const gwCost = gw.reduce((s, p) => s + (p.costBasisUsd ?? 0), 0);
  const gwPnl = gw.reduce((s, p) => s + (p.pnlUsd ?? 0), 0);

  const full = snapshot.pnlSummary;
  const currentValueUsd = portfolioValueUsdExcludingGatewayOnly(snapshot);
  const costBasisUsd = roundUsd(full.costBasisUsd - gwCost);
  const pnlUsd = roundUsd(full.pnlUsd - gwPnl);
  const pnlPct =
    costBasisUsd > 0 ? roundUsd((pnlUsd / costBasisUsd) * 100) : full.pnlPct;

  return { currentValueUsd, costBasisUsd, pnlUsd, pnlPct };
}

export function combinedPortfolioMetrics(
  eoa: PortfolioSnapshotResponse | null,
  execution: PortfolioSnapshotResponse | null,
): {
  totalValueUsd: number;
  netPnlUsd: number;
  costBasisUsd: number;
  pnlPct: number;
} {
  const pEoa = pnlSummaryExcludingGateway(eoa);
  const pEx = pnlSummaryExcludingGateway(execution);
  const totalValueUsd = pEoa.currentValueUsd + pEx.currentValueUsd;
  const netPnlUsd = pEoa.pnlUsd + pEx.pnlUsd;
  const costBasisUsd = pEoa.costBasisUsd + pEx.costBasisUsd;

  const pnlPct =
    costBasisUsd > 0 ? roundUsd((netPnlUsd / costBasisUsd) * 100) : eoa?.pnlSummary?.pnlPct ?? 0;

  return { totalValueUsd, netPnlUsd, costBasisUsd, pnlPct };
}
