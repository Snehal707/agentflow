"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortfolioHolding, PortfolioPosition } from "@/lib/liveAgentClient";

export type AllocationViewMode = "live" | "holdings" | "pnl";

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TOKEN_LINE_COLORS: Record<string, string> = {
  USDC: "#f2ca50", // Gold
  EURC: "#ffffff", // White
  AFVUSDC: "#d8ad27", // Golden variant
};

/** Deterministic series for sparkline; same wobble math as previous SVG path. */
function sparkSeries(
  id: string,
  steps: number,
  h: number,
  amp01: number,
): { i: number; y: number }[] {
  const seed = hashSeed(id);
  const maxAmp = (h / 2 - 1) * Math.max(0.12, Math.min(1, amp01));
  const out: { i: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s1 = Math.sin(t * Math.PI * 4 + seed * 1e-6);
    const s2 = Math.sin(t * Math.PI * 11 + seed * 3e-6);
    const s3 = Math.sin(t * Math.PI * 19 + seed * 7e-6) * 0.35;
    const wobble = s1 * 0.5 + s2 * 0.35 + s3;
    const y = h / 2 + maxAmp * wobble;
    out.push({ i, y });
  }
  return out;
}

function strokeForIndex(index: number): string {
  const isAlt = index % 2 === 0;
  if (isAlt) {
    const hue = 42 + (index % 4) * 4;
    return `hsla(${hue}, 82%, 62%, 0.8)`;
  } else {
    return `rgba(255, 255, 255, 0.75)`;
  }
}

function strokeForHolding(symbol: string | undefined, index: number): string {
  if (!symbol) return strokeForIndex(index);
  const key = symbol.toUpperCase();
  return TOKEN_LINE_COLORS[key] ?? strokeForIndex(index);
}

function formatUsdExact(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatSignedUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${formatUsdExact(abs)}`;
}

function AllocationLineTooltip({
  active,
  holding,
  usdValue,
}: {
  active?: boolean;
  holding: PortfolioHolding;
  usdValue: number;
}) {
  if (!active) return null;
  const title = holding.name?.trim() || holding.symbol;
  return (
    <div className="rounded-md border border-[#46484d]/40 bg-[#1d2025]/95 px-2.5 py-1.5 text-left shadow-lg backdrop-blur-sm">
      <p className="text-[11px] font-semibold leading-tight text-[#f6f6fc]">{title}</p>
      <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[#aaabb0]">{formatUsdExact(usdValue)}</p>
    </div>
  );
}

type Props = {
  holdings: PortfolioHolding[];
  maxUsd: number;
  shareDenom: number;
  /** Total tokens in wallet (may exceed visible rows). */
  totalTokenCount?: number;
  emptySlots?: number;
  allocationView?: AllocationViewMode;
  /** Agent positions with unrealized PnL (PNL tab). */
  positions?: PortfolioPosition[];
};

const CHART_H = 28;
const STEPS = 28;

export function AllocationSparklines({
  holdings,
  maxUsd,
  shareDenom,
  totalTokenCount,
  emptySlots = 0,
  allocationView = "live",
  positions = [],
}: Props) {
  if (allocationView === "pnl") {
    if (positions.length === 0) {
      return (
        <p className="px-1 py-2 text-[10px] leading-relaxed text-[#6a6c72]">
          No active agent positions with PnL. Deploy or fund strategies from the{" "}
          <span className="text-[#aaabb0]">Active Agent Positions</span> section below.
        </p>
      );
    }
    const rows = positions.slice(0, 12);
    return (
      <div className="flex flex-col gap-1.5">
        {rows.map((position) => {
          const pnl = position.pnlUsd;
          const pnlPositive = typeof pnl === "number" && pnl >= 0;
          return (
            <div
              key={position.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[#46484d]/10 bg-[#0c0e12]/80 px-2 py-1.5 sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold text-[#f6f6fc]">{position.name}</p>
                <p className="truncate text-[8px] uppercase tracking-wide text-[#6a6c72]">{position.protocol}</p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`font-mono text-[10px] tabular-nums ${
                    pnlPositive ? "text-[#10d5ff]" : "text-[#ff716c]"
                  }`}
                >
                  {formatSignedUsd(pnl)}
                </p>
                <p className="text-[8px] text-[#6a6c72]">unrealized</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const max = maxUsd > 0 ? maxUsd : 1;
  const rows =
    holdings.length > 0
      ? holdings
      : Array.from({ length: Math.min(5, emptySlots || 3) }, (_, i) => null as PortfolioHolding | null);

  const hidden = (totalTokenCount ?? 0) > holdings.length ? totalTokenCount! - holdings.length : 0;
  const holdingsEmphasis = allocationView === "holdings";
  const chartMuted = holdingsEmphasis ? "opacity-75" : "";

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-52 overflow-y-auto overflow-x-hidden pr-1">
        <div className="space-y-1.5">
          {rows.map((holding, index) => {
            const id = holding?.id ?? `empty-${index}`;
            const usd = holding?.usdValue ?? 0;
            const amp = holding ? usd / max : 0;
            const pct =
              holding && shareDenom > 0
                ? Math.max(1, Math.round(((holding.usdValue ?? 0) / shareDenom) * 100))
                : 0;
            const stroke = holding ? strokeForHolding(holding.symbol, index) : "rgba(70, 72, 77, 0.35)";
            const series = sparkSeries(holding ? holding.id : `empty-${index}`, STEPS, CHART_H, holding ? amp : 0.08);

            return (
              <div
                key={id}
                className="flex items-center gap-2 rounded-lg border border-[#46484d]/10 bg-[#0c0e12]/80 px-2 py-1 sm:gap-3"
              >
                <div className="w-16 shrink-0 sm:w-[4.5rem]">
                  <p className="text-[10px] font-semibold uppercase leading-tight tracking-tight text-[#aaabb0]">
                    {holding?.symbol ?? "—"}
                  </p>
                </div>
                <div className={`relative min-h-[28px] min-w-0 flex-1 ${chartMuted}`}>
                  <ResponsiveContainer width="100%" height={CHART_H}>
                    <LineChart data={series} margin={{ top: 1, right: 2, left: 2, bottom: 1 }}>
                      <XAxis dataKey="i" type="number" domain={[0, STEPS]} hide allowDataOverflow />
                      <YAxis domain={[0, CHART_H]} hide allowDataOverflow />
                      {holding ? (
                        <Tooltip
                          content={(tip) => (
                            <AllocationLineTooltip active={tip.active} holding={holding} usdValue={usd} />
                          )}
                          cursor={{ stroke: "rgba(148, 163, 184, 0.35)", strokeWidth: 1 }}
                        />
                      ) : null}
                      <Line
                        type="linear"
                        dataKey="y"
                        stroke={stroke}
                        strokeWidth={holding ? 1.25 : 0.75}
                        dot={false}
                        isAnimationActive={false}
                        activeDot={
                          holding
                            ? {
                                r: 4,
                                fill: stroke,
                                stroke: "#0c0e12",
                                strokeWidth: 1,
                              }
                            : false
                        }
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-24 shrink-0 text-right">
                  {holding ? (
                    <>
                      <p className="text-[10px] font-mono text-[#f6f6fc]">
                        {usd.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 2,
                        })}
                      </p>
                      <p
                        className={`text-[9px] text-[#6a6c72] ${holdingsEmphasis ? "font-semibold text-[#aaabb0]" : ""}`}
                      >
                        {pct}% of wallet
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] text-[#46484d]">—</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {hidden > 0 ? (
        <p className="text-[10px] text-[#6a6c72]">
          Showing top {holdings.length} by USD · +{hidden} more token{hidden === 1 ? "" : "s"} on this wallet
        </p>
      ) : null}
    </div>
  );
}
