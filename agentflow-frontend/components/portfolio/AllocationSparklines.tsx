"use client";

import type { PortfolioHolding } from "@/lib/liveAgentClient";

const TOKEN_BAR_COLORS: Record<string, string> = {
  USDC: "#3B82F6",
  EURC: "#10B981",
  AFVUSDC: "#A855F7",
  APVUSDC: "#A855F7",
};

const TOKEN_LABELS: Record<string, { title: string; subtitle?: string }> = {
  USDC: { title: "USDC" },
  EURC: { title: "EURC" },
  AFVUSDC: { title: "Vault USDC", subtitle: "afvUSDC" },
  APVUSDC: { title: "Vault USDC", subtitle: "apvUSDC" },
};

type Props = {
  holdings: PortfolioHolding[];
  maxUsd: number;
  shareDenom: number;
  totalTokenCount?: number;
  emptySlots?: number;
};

function accentForIndex(index: number): string {
  const palette = [188, 206, 222, 254, 162, 138];
  const hue = palette[index % palette.length] ?? 188;
  return `hsla(${hue}, 78%, 62%, 0.92)`;
}

function accentForHolding(symbol: string | undefined, index: number): string {
  if (!symbol) return accentForIndex(index);
  return TOKEN_BAR_COLORS[symbol.toUpperCase()] ?? accentForIndex(index);
}

function holdingDisplayMeta(holding: PortfolioHolding | null | undefined): {
  title: string;
  subtitle: string;
} {
  if (!holding) {
    return { title: "--", subtitle: "Waiting for holdings" };
  }

  const symbol = holding.symbol?.toUpperCase() ?? "";
  const configured = TOKEN_LABELS[symbol];
  if (configured) {
    return {
      title: configured.title,
      subtitle: configured.subtitle ?? holding.symbol ?? configured.title,
    };
  }

  const rawTitle = holding.symbol?.trim() || holding.name?.trim() || "Asset";
  const rawSubtitle = holding.name?.trim() || holding.symbol?.trim() || rawTitle;
  return { title: rawTitle, subtitle: rawSubtitle };
}

function formatUsdExact(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatSignedUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatUsdExact(abs)}`;
}

function formatSharePercent(usdValue: number | null | undefined, shareDenom: number): string {
  if (typeof usdValue !== "number" || !Number.isFinite(usdValue) || usdValue <= 0 || shareDenom <= 0) {
    return "0%";
  }
  return `${((usdValue / shareDenom) * 100).toFixed(1)}%`;
}

function normalizedShareLabels(holdings: PortfolioHolding[], shareDenom: number): Map<string, string> {
  const labels = new Map<string, string>();
  if (holdings.length === 0 || shareDenom <= 0) {
    return labels;
  }

  const scale = 10;
  const rawShares = holdings.map((holding) => {
    const usd = holding.usdValue ?? 0;
    const scaled = usd > 0 ? (usd / shareDenom) * 100 * scale : 0;
    const base = Math.floor(scaled);
    return {
      id: holding.id,
      usd,
      base,
      remainder: scaled - base,
    };
  });

  let assigned = rawShares.reduce((sum, item) => sum + item.base, 0);
  const target = 100 * scale;
  const ranked = [...rawShares].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return b.usd - a.usd;
  });

  let cursor = 0;
  while (assigned < target && ranked.length > 0) {
    ranked[cursor % ranked.length]!.base += 1;
    assigned += 1;
    cursor += 1;
  }

  const byId = new Map(ranked.map((item) => [item.id, item.base]));
  for (const item of rawShares) {
    const normalized = (byId.get(item.id) ?? 0) / scale;
    labels.set(item.id, `${normalized.toFixed(1)}%`);
  }

  return labels;
}

function barWidthPercent(
  usdValue: number | null | undefined,
  maxUsd: number,
  emphasized: boolean,
): number {
  if (typeof usdValue !== "number" || !Number.isFinite(usdValue) || usdValue <= 0 || maxUsd <= 0) {
    return 0;
  }
  const scaled = Math.round((usdValue / maxUsd) * 100);
  const minimum = emphasized ? 18 : 12;
  return Math.min(100, Math.max(minimum, scaled));
}

export function AllocationSparklines({
  holdings,
  maxUsd,
  shareDenom,
  totalTokenCount,
  emptySlots = 0,
}: Props) {
  const max = maxUsd > 0 ? maxUsd : 1;
  const shareLabels = normalizedShareLabels(holdings, shareDenom);
  const rows =
    holdings.length > 0
      ? holdings
      : Array.from({ length: Math.min(5, emptySlots || 3) }, () => null as PortfolioHolding | null);
  const hidden = (totalTokenCount ?? 0) > holdings.length ? totalTokenCount! - holdings.length : 0;
  const holdingsEmphasis = true;

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-52 overflow-y-auto overflow-x-hidden pr-1">
        <div className="space-y-1.5">
          {rows.map((holding, index) => {
            const id = holding?.id ?? `empty-${index}`;
            const usd = holding?.usdValue ?? 0;
            const accent = holding ? accentForHolding(holding.symbol, index) : "rgba(70, 72, 77, 0.35)";
            const width = holding ? barWidthPercent(usd, max, holdingsEmphasis) : 0;
            const displayMeta = holdingDisplayMeta(holding);
            const shareLabel = holding
              ? shareLabels.get(holding.id) ?? formatSharePercent(holding.usdValue, shareDenom)
              : "--";

            return (
              <div
                key={id}
                className="flex items-center gap-2 rounded-lg border border-[#46484d]/10 bg-[#0c0e12]/80 px-2 py-1.5 sm:gap-3"
              >
                <div className="w-16 shrink-0 sm:w-[4.5rem]">
                  <p className="text-[10px] font-semibold leading-tight tracking-tight text-[#f6f6fc]">
                    {displayMeta.title}
                  </p>
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={`relative overflow-hidden rounded-full border border-white/5 bg-[#11151b] ${
                      holdingsEmphasis ? "h-4" : "h-3.5"
                    }`}
                  >
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 opacity-20"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 14px)",
                      }}
                    />
                    {holding ? (
                      <div
                        className="relative h-full rounded-full transition-[width] duration-500"
                        style={{
                          width: `${width}%`,
                          backgroundColor: accent,
                          boxShadow: `0 0 24px ${accent}`,
                        }}
                      />
                    ) : null}
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p
                      className="truncate text-[8px] uppercase tracking-[0.14em] text-[#aaabb0]"
                    >
                      {displayMeta.subtitle}
                    </p>
                    <p
                      className="shrink-0 text-[8px] uppercase tracking-[0.14em] text-[#aaabb0]"
                    >
                      {shareLabel}
                    </p>
                  </div>
                </div>

                <div className="w-24 shrink-0 text-right">
                  {holding ? (
                    <>
                      <p className="text-[10px] font-mono text-[#f6f6fc]">{formatUsdExact(usd)}</p>
                      <p className="text-[9px] font-semibold text-[#aaabb0]">
                        value
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] text-[#46484d]">--</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hidden > 0 ? (
        <p className="text-[10px] text-[#6a6c72]">
          Showing top {holdings.length} by USD - +{hidden} more token{hidden === 1 ? "" : "s"} on this wallet
        </p>
      ) : null}
    </div>
  );
}
