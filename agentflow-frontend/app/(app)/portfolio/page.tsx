"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import {
  fetchExecutionWalletSummary,
  fetchPortfolioSnapshot,
  type ExecutionWalletSummary,
  type PortfolioPosition,
  type PortfolioSnapshotResponse,
} from "@/lib/liveAgentClient";
import { shortenAddress } from "@/lib/appData";
import { AllocationSparklines } from "@/components/portfolio/AllocationSparklines";
import {
  combinedPortfolioMetrics,
  mergeCombinedHoldings,
  mergeCombinedPositions,
  pnlSummaryExcludingGateway,
} from "@/lib/portfolioMetrics";
import {
  loadVaultHoldingCards,
  type VaultHoldingCard,
} from "@/lib/vaultPositionCards";
import { useSidebarPreference } from "@/lib/useSidebarPreference";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

function formatAmount(value: string | number | null | undefined): string {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: numeric >= 100 ? 2 : 4,
  }).format(numeric);
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseNumeric(value: string | number | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatSignedUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  const formatted = formatUsd(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "N/A";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

const TOKEN_LINE_COLORS: Record<string, string> = {
  USDC: "#f2ca50", // Gold
  EURC: "#6fd6ff", // Ice blue
  AFVUSDC: "#d8ad27", // Golden variant
};

function strokeForIndex(index: number): string {
  const palette = [
    "#f2ca50",
    "#6fd6ff",
    "#ff8f6b",
    "#8ce38b",
    "#d8ad27",
    "#c38bff",
  ];
  return palette[index % palette.length];
}

function strokeForHolding(symbol: string | undefined, index: number): string {
  if (!symbol) return strokeForIndex(index);
  const key = symbol.toUpperCase();
  return TOKEN_LINE_COLORS[key] ?? strokeForIndex(index);
}

function tokenIconSrc(symbol: string | undefined): string | null {
  if (!symbol) {
    return null;
  }

  const key = symbol.toUpperCase();
  if (key.includes("EURC")) {
    return "/media-kit/tokens/eurc.svg";
  }
  if (key.includes("USDC")) {
    return "/media-kit/tokens/usdc.svg";
  }
  return null;
}

function SummaryValue({ value, highlightCurrency = false }: { value: string; highlightCurrency?: boolean }) {
  if (!highlightCurrency || !value.startsWith("$")) {
    return <>{value}</>;
  }

  return (
    <>
      <span className="text-[#f2ca50]">$</span>
      {value.slice(1)}
    </>
  );
}

function MetricCard({
  label,
  title,
  value,
  unit,
  accent = false,
  detail,
  supporting,
  compact = false,
}: {
  label: string;
  title: string;
  value: string;
  unit?: string;
  accent?: boolean;
  detail: string;
  supporting?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <article
      className={`group relative flex flex-col rounded-[28px] border transition-all duration-300 hover:-translate-y-1 ${
        compact ? "min-h-[220px] p-5 xl:p-6" : "min-h-[270px] p-6 xl:min-h-[290px] xl:p-7"
      } ${
        accent
          ? "border-[#f2ca50]/30 bg-[radial-gradient(circle_at_top_left,rgba(242,202,80,0.15),transparent_45%),linear-gradient(180deg,#171512_0%,#0c0b09_100%)] hover:border-[#f2ca50]/60 hover:shadow-[0_0_30px_rgba(242,202,80,0.06)]"
          : "border-white/5 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.02),transparent_40%),linear-gradient(180deg,#131313_0%,#0d0d0d_100%)] hover:border-[#f2ca50]/20 hover:shadow-[0_0_30px_rgba(255,255,255,0.015)]"
      }`}
    >
      <div className="absolute right-6 top-6 h-1.5 w-1.5 rounded-full bg-white/20 transition-all duration-300 group-hover:scale-150 group-hover:bg-[#f2ca50]" />
      
      <p className="text-[9px] font-black uppercase tracking-[0.28em] text-[#f2ca50]">{label}</p>
      <h2 className="mt-4 max-w-[11ch] font-headline text-[clamp(1.35rem,1.85vw,2rem)] font-bold tracking-tight text-white/90 group-hover:text-white">
        {title}
      </h2>
      <p
        className={`font-headline font-black leading-none ${
          compact ? "mt-5 text-[clamp(2.5rem,3vw,3.5rem)]" : "mt-6 text-[clamp(2.8rem,4vw,4.2rem)]"
        } ${
          accent ? "text-[#f2ca50]" : "text-white"
        }`}
      >
        {value}
      </p>
      {unit ? (
        <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.24em] text-[#f2ca50]/75">{unit}</p>
      ) : null}
      <p className="mt-4 max-w-[28ch] text-sm leading-relaxed text-white/45 transition-colors group-hover:text-white/60">{detail}</p>
      {supporting ? <div className="mt-auto pt-7">{supporting}</div> : null}
    </article>
  );
}

export default function PortfolioPage() {
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const {
    isAuthenticated,
    signIn,
    loading: authLoading,
    error: authError,
    getAuthHeaders,
  } = useAgentJwt();

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const executionAddress = executionSummary?.userAgentWalletAddress;
    if (!executionAddress) return;
    void navigator.clipboard.writeText(executionAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [executionSummary, setExecutionSummary] = useState<ExecutionWalletSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [vaultCards, setVaultCards] = useState<VaultHoldingCard[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [walletSnapshot, setWalletSnapshot] = useState<PortfolioSnapshotResponse | null>(null);
  const [executionSnapshot, setExecutionSnapshot] = useState<PortfolioSnapshotResponse | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const loadExecutionSummary = useCallback(async () => {
    const authHeaders = getAuthHeaders();
    if (!address || !isAuthenticated || !authHeaders) {
      setExecutionSummary(null);
      setSummaryError(null);
      setSummaryLoading(false);
      return;
    }

    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const summary = await fetchExecutionWalletSummary(authHeaders);
      setExecutionSummary(summary);
    } catch (cause) {
      setExecutionSummary(null);
      setSummaryError(
        cause instanceof Error ? cause.message : "Could not load DCW balances.",
      );
    } finally {
      setSummaryLoading(false);
    }
  }, [address, getAuthHeaders, isAuthenticated]);

  const loadVaultCards = useCallback(async () => {
    if (!address) {
      setVaultCards([]);
      setVaultError(null);
      setVaultLoading(false);
      return;
    }
    setVaultLoading(true);
    try {
      const { cards, error } = await loadVaultHoldingCards(address, getAuthHeaders, isAuthenticated);
      setVaultCards(cards);
      setVaultError(error);
    } finally {
      setVaultLoading(false);
    }
  }, [address, getAuthHeaders, isAuthenticated]);

  useEffect(() => {
    void loadExecutionSummary();
  }, [loadExecutionSummary]);

  useEffect(() => {
    void loadVaultCards();
  }, [loadVaultCards]);

  const loadPortfolioSnapshots = useCallback(async () => {
    if (!address) {
      setWalletSnapshot(null);
      setExecutionSnapshot(null);
      setSnapshotError(null);
      setSnapshotLoading(false);
      return;
    }

    setSnapshotLoading(true);
    setSnapshotError(null);

    try {
      const wallet = await fetchPortfolioSnapshot(address);
      setWalletSnapshot(wallet);

      const executionAddressCandidate = executionSummary?.userAgentWalletAddress;
      if (
        executionAddressCandidate &&
        executionAddressCandidate.toLowerCase() !== address.toLowerCase()
      ) {
        const execution = await fetchPortfolioSnapshot(executionAddressCandidate);
        setExecutionSnapshot(execution);
      } else {
        setExecutionSnapshot(null);
      }
    } catch (cause) {
      setSnapshotError(
        cause instanceof Error ? cause.message : "Could not load portfolio holdings.",
      );
    } finally {
      setSnapshotLoading(false);
    }
  }, [address, executionSummary?.userAgentWalletAddress]);

  useEffect(() => {
    void loadPortfolioSnapshots();
  }, [loadPortfolioSnapshots]);

  const executionAddress = executionSummary?.userAgentWalletAddress ?? null;
  const dcwBalance = executionSummary?.balances.usdc.formatted ?? "0";
  const gatewayReserve = executionSummary?.balances.gatewayUsdc.formatted ?? "0";
  const summaryVaultShares = executionSummary?.balances.vaultShares.formatted ?? "0";
  const totalVaultUsd = vaultCards.reduce((sum, card) => sum + (card.usdValue ?? 0), 0);
  const vaultBalancesBySymbol = vaultCards.reduce<Record<string, number>>((acc, card) => {
    const key = card.displaySymbol || card.symbol || "VAULT";
    acc[key] = (acc[key] ?? 0) + parseNumeric(card.balanceFormatted);
    return acc;
  }, {});
  const vaultSymbols = Object.keys(vaultBalancesBySymbol);
  const hasMixedVaultAssets = vaultSymbols.length > 1;
  const primaryVaultSymbol = vaultSymbols[0] ?? "USDC";
  const primaryVaultBalance = vaultBalancesBySymbol[primaryVaultSymbol] ?? parseNumeric(summaryVaultShares);
  const vaultHeadlineValue =
    hasMixedVaultAssets && totalVaultUsd > 0
      ? formatUsd(totalVaultUsd)
      : formatAmount(primaryVaultBalance);
  const vaultSourceAddresses =
    vaultCards.length > 0
      ? vaultCards.map((card) => shortenAddress(card.walletAddress)).join(" / ")
      : "Waiting for live wallet data";
  const vaultTokenLabel = hasMixedVaultAssets ? "TOTAL VALUE" : primaryVaultSymbol;
  const vaultBalanceBreakdown =
    vaultSymbols.length > 0
      ? vaultSymbols
          .map((symbol) => `${formatAmount(vaultBalancesBySymbol[symbol])} ${symbol}`)
          .join(" / ")
      : "No live vault balances detected";
  const dcwHoldings = (executionSnapshot?.holdings ?? [])
    .filter((holding) => (holding.usdValue ?? 0) > 0)
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
  const dcwHoldingsTotalUsd = dcwHoldings.reduce((sum, holding) => sum + (holding.usdValue ?? 0), 0);
  const combinedPositions = mergeCombinedPositions(null, executionSnapshot);
  const predictionPositions = combinedPositions.filter(
    (position) => (position.kind as string) === "prediction_market",
  );
  const pnlMetrics = combinedPortfolioMetrics(walletSnapshot, executionSnapshot);
  const heroPnlMetrics = pnlSummaryExcludingGateway(executionSnapshot);
  const dcwHoldingRows = dcwHoldings.slice(0, 6);
  const summaryCards = [
    {
      key: "dcw",
      label: "DCW",
      title: "Primary wallet",
      value: summaryLoading ? "..." : formatAmount(dcwBalance),
      unit: "USDC",
      icon: "account_balance_wallet",
      accent: true,
    },
    {
      key: "vault",
      label: "Vault",
      title: "Vault assets",
      value: summaryLoading && vaultLoading ? "..." : vaultHeadlineValue,
      unit: vaultTokenLabel,
      icon: "savings",
      accent: false,
    },
    {
      key: "gateway",
      label: "Gateway",
      title: "Reserved funds",
      value: summaryLoading ? "..." : formatAmount(gatewayReserve),
      unit: "USDC",
      icon: "hub",
      accent: false,
    },
  ] as const;

  return (
    <div className="flex h-screen overflow-hidden bg-[#070707] text-[#e9e6df]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/5 bg-[#070707]/92 px-8 py-5 backdrop-blur-md xl:px-10">
          <div />
          <SessionStatusChip
            address={address}
            isAuthenticated={isAuthenticated}
            isLoading={authLoading}
            error={authError}
            onAction={() => {
              if (!address) {
                openConnectModal?.();
                return;
              }
              if (!isAuthenticated) {
                void signIn().catch(() => {});
              }
            }}
          />
        </header>

        <main className="flex-1 overflow-y-auto px-8 pb-16 pt-8 xl:px-10 relative">
          <div className={`mx-auto max-w-[1320px] transition-all duration-500 ${!address || !isAuthenticated ? "blur-[6px] pointer-events-none opacity-25" : ""}`}>
            
            {/* Title Block */}
            <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h1 className="font-headline text-[clamp(2.5rem,5vw,4rem)] font-black leading-[0.9] tracking-[-0.055em] text-white">
                  Port<span className="text-[#f2ca50]">Folio</span>
                </h1>
              </div>
            </div>

            {/* Net Worth Hero Display */}
            <div className="mb-6 flex flex-col gap-3 rounded-[24px] border border-white/5 bg-gradient-to-r from-[#171512] to-[#0c0c0c] px-6 py-5 shadow-2xl relative overflow-hidden">
              <div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(242,202,80,0.06),transparent_70%)] pointer-events-none" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[#f2ca50]/80">account_balance</span>
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#f2ca50]">Net Worth</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <h2 className="font-headline text-[clamp(1.8rem,3vw,2.8rem)] font-black text-white leading-none">
                    {snapshotLoading ? "..." : formatUsd(heroPnlMetrics.currentValueUsd)}
                    </h2>
                    <span className={`text-[11px] font-black uppercase tracking-[0.12em] px-3 py-1 rounded-full border ${
                      heroPnlMetrics.pnlUsd >= 0
                        ? 'text-[#f2ca50] border-[#f2ca50]/20 bg-[#f2ca50]/5'
                        : 'text-white/60 border-white/10 bg-white/5'
                    }`}>
                      {snapshotLoading ? "..." : `${formatSignedUsd(heroPnlMetrics.pnlUsd)} (${formatPct(heroPnlMetrics.pnlPct)})`}
                    </span>
                  </div>
                </div>
                <span className="mt-1 h-2.5 w-2.5 rounded-full bg-white/20" />
              </div>
            </div>

            {summaryError ? (
              <div className="mb-6 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {summaryError}
              </div>
            ) : null}
            {authError ? (
              <div className="mb-6 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {authError}
              </div>
            ) : null}
            {snapshotError ? (
              <div className="mb-6 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {snapshotError}
              </div>
            ) : null}

            <section className="overflow-hidden rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(242,202,80,0.08),transparent_24%),linear-gradient(180deg,#121212_0%,#0c0c0c_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-all duration-300 hover:border-white/12">
              <div className="grid gap-3 lg:grid-cols-[1.15fr_0.95fr_0.95fr]">
                {summaryCards.map((card) => (
                  <article
                    key={card.key}
                    className={`relative overflow-hidden rounded-[24px] border px-5 py-4 ${
                      card.accent
                        ? "border-[#f2ca50]/20 bg-[linear-gradient(135deg,rgba(242,202,80,0.12),rgba(242,202,80,0.02)_36%,rgba(255,255,255,0.01)_100%)]"
                        : "border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))]"
                    }`}
                  >
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/0 via-white/12 to-white/0" />
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                              card.accent
                                ? "border-[#f2ca50]/25 bg-[#f2ca50]/10 text-[#f2ca50]"
                                : "border-[#f2ca50]/18 bg-[#f2ca50]/[0.07] text-[#f2ca50]"
                            }`}
                          >
                            <span className="material-symbols-outlined text-[20px] leading-none">{card.icon}</span>
                          </span>
                          <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.32em] text-[#f2ca50]">{card.label}</p>
                            <h2 className="mt-1 text-[0.95rem] font-semibold text-white/88">{card.title}</h2>
                          </div>
                        </div>
                      </div>
                      <span className={`mt-1 h-2.5 w-2.5 rounded-full ${card.accent ? "bg-[#f2ca50]/70" : "bg-white/20"}`} />
                    </div>

                    <div className="mt-7 flex items-end justify-between gap-4">
                      <p
                        className={`min-w-0 truncate text-[clamp(1.55rem,1.9vw,2.15rem)] font-semibold leading-none tracking-[-0.035em] tabular-nums ${
                          card.accent || card.key === "vault" || card.key === "gateway" ? "text-[#f2ca50]" : "text-white"
                        }`}
                      >
                        <SummaryValue
                          value={card.value}
                          highlightCurrency={card.key === "vault" || card.key === "gateway"}
                        />
                      </p>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${
                          card.accent
                            ? "border-[#f2ca50]/20 bg-[#f2ca50]/8 text-[#f2ca50]/85"
                            : "border-white/10 bg-white/[0.03] text-white/50"
                        }`}
                      >
                        {card.unit}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* 3-Column Reserves Row */}
            <section className="hidden grid gap-5 grid-cols-1 lg:grid-cols-3">
              <div className="h-full">
                <MetricCard
                  label="DCW"
                  title="DCW balance"
                  value={summaryLoading ? "..." : formatAmount(dcwBalance)}
                  unit="USDC"
                  accent
                  detail="Spendable USDC available in your dedicated chat wallet."
                  supporting={
                    <div className="rounded-2xl border border-white/5 bg-black/16 px-4 py-3 relative group/address">
                      <div className="flex items-center justify-between">
                        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#f2ca50]/70">
                          Address
                        </p>
                        {executionAddress && (
                          <button
                            type="button"
                            onClick={handleCopy}
                            className="text-[9px] font-bold uppercase tracking-wider text-white/40 hover:text-[#f2ca50] transition flex items-center gap-1"
                          >
                            {copied ? (
                              <span className="text-[#f2ca50] animate-pulse">✓ Copied</span>
                            ) : (
                              <>
                                <span className="material-symbols-outlined text-[10px] leading-none">content_copy</span>
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <p className="mt-1.5 break-all font-mono text-[11px] text-white/80 select-all">
                        {executionAddress ? shortenAddress(executionAddress) : "Sign session to load"}
                      </p>
                    </div>
                  }
                />
              </div>

              <div className="h-full">
                <MetricCard
                  label="Vault"
                  title="Vault balance"
                  value={summaryLoading && vaultLoading ? "..." : vaultHeadlineValue}
                  unit={vaultTokenLabel}
                  detail=""
                />
              </div>

              <div className="h-full">
                <MetricCard
                  label="Gateway"
                  title="Gateway reserve"
                  value={summaryLoading ? "..." : formatAmount(gatewayReserve)}
                  unit="USDC"
                  detail=""
                />
              </div>
            </section>

            {/* Holdings & Sidebar Positions Section */}
            <section className="mt-6 grid gap-5 xl:grid-cols-12">
              
              {/* Asset Allocation Table (Combined Holdings & PnL) */}
              <article className="relative overflow-hidden rounded-[28px] border border-white/5 bg-gradient-to-b from-[#131313] to-[#0d0d0d] p-6 xl:col-span-8 transition-all duration-300 hover:border-white/10">
                <p className="text-[9px] font-black uppercase tracking-[0.28em] text-[#f2ca50]">Holdings & Performance</p>
                <div className="mt-4 flex items-end justify-between gap-4 border-b border-white/5 pb-4">
                  <h2 className="font-headline text-[1.6rem] font-bold text-white">Asset Allocation</h2>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Portfolio value</p>
                    <p className="mt-0.5 font-headline text-xl font-black text-white">
                      {snapshotLoading ? "..." : formatUsd(dcwHoldingsTotalUsd)}
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  {/* Table Headers */}
                  <div className="grid grid-cols-12 gap-4 text-[9px] font-black uppercase tracking-wider text-white/30 border-b border-white/5 pb-2">
                    <div className="col-span-3">Asset</div>
                    <div className="col-span-4 text-center">Allocation Trend</div>
                    <div className="col-span-2 text-right">Weight</div>
                    <div className="col-span-3 text-right">Balance & Value</div>
                  </div>

                  {/* Table Rows */}
                  {dcwHoldingRows.length > 0 ? (
                    dcwHoldingRows.map((holding, index) => {
                      const max = Math.max(...dcwHoldings.map((h) => h.usdValue ?? 0), 1);
                      const shareDenom = Math.max(dcwHoldingsTotalUsd, 1);
                      const usd = holding.usdValue ?? 0;
                      const amp = usd / max;
                      const pct = shareDenom > 0 ? Math.max(1, Math.round((usd / shareDenom) * 100)) : 0;
                      const stroke = strokeForHolding(holding.symbol, index);
                      const series = sparkSeries(holding.id, 28, 28, amp);
                      const iconSrc = tokenIconSrc(holding.symbol);

                      return (
                        <div
                          key={holding.id}
                          className="grid grid-cols-12 gap-4 items-center border-b border-white/5 py-3 last:border-b-0 last:pb-0"
                        >
                          {/* Col 1: Asset */}
                          <div className="col-span-3 flex items-center gap-3">
                            {iconSrc ? (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-white/10">
                                <Image
                                  src={iconSrc}
                                  alt={`${holding.symbol} token icon`}
                                  width={32}
                                  height={32}
                                  className="h-8 w-8 rounded-full"
                                />
                              </div>
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#f2ca50]/20 bg-gradient-to-b from-white/[0.08] to-transparent text-[10px] font-black text-[#f2ca50] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                                {holding.symbol.substring(0, 2).toUpperCase()}
                              </div>
                            )}
                            <div className="truncate">
                              <p className="text-sm font-semibold text-white leading-none truncate">{holding.symbol}</p>
                              <p className="text-[10px] text-white/35 mt-1 font-medium truncate">{holding.name}</p>
                            </div>
                          </div>

                          {/* Col 2: Sparkline Chart */}
                          <div className="col-span-4 h-[28px] relative opacity-90">
                            <ResponsiveContainer width="100%" height={28}>
                              <LineChart data={series} margin={{ top: 1, right: 2, left: 2, bottom: 1 }}>
                                <XAxis dataKey="i" type="number" domain={[0, 28]} hide allowDataOverflow />
                                <YAxis domain={[0, 28]} hide allowDataOverflow />
                                <Line
                                  type="linear"
                                  dataKey="y"
                                  stroke={stroke}
                                  strokeWidth={1.25}
                                  dot={false}
                                  isAnimationActive={false}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>

                          {/* Col 3: Weight */}
                          <div className="col-span-2 text-right">
                            <p className="text-sm font-semibold text-white leading-none">{pct}%</p>
                            <p className="text-[9px] text-white/35 mt-1 uppercase tracking-wider font-semibold">Weight</p>
                          </div>

                          {/* Col 4: Value & PnL */}
                          <div className="col-span-3 text-right">
                            <p className="text-sm font-black text-white leading-none">
                              {formatAmount(holding.balanceFormatted)} {holding.symbol}
                            </p>
                            <p className="text-[10px] text-white/45 mt-1 truncate">{formatUsd(holding.usdValue ?? 0)}</p>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-white/45 py-4">
                      {snapshotLoading ? "Loading holdings..." : "No token holdings available yet."}
                    </p>
                  )}
                </div>
              </article>

              {/* Stacked Positions Sidebar (col-span-4) */}
              <article className="relative overflow-hidden rounded-[28px] border border-white/5 bg-gradient-to-b from-[#131313] to-[#0d0d0d] p-6 xl:col-span-4 transition-all duration-300 hover:border-white/10 flex flex-col">
                <p className="text-[9px] font-black uppercase tracking-[0.28em] text-[#f2ca50]">Positions</p>
                <div className="mt-4 border-b border-white/5 pb-4 mb-5">
                  <h2 className="font-headline text-[1.6rem] font-bold text-white leading-none">Active Positions</h2>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto max-h-[420px] pr-1">
                  {predictionPositions.length > 0 ? (
                    predictionPositions.map((position) => (
                      <PredictionMarketCard key={position.id} position={position} />
                    ))
                  ) : (
                    <p className="text-sm text-white/45 py-4">
                      {snapshotLoading ? "Loading market positions..." : "No active positions detected."}
                    </p>
                  )}
                </div>
              </article>

            </section>
          </div>

          {/* Connected / Authenticated Onboarding Screen */}
          {(!address || !isAuthenticated) && (
            <div className="absolute inset-0 z-30 flex items-center justify-center p-8 bg-black/40 backdrop-blur-[2px]">
              <div className="w-full max-w-[480px] rounded-[32px] border border-[#f2ca50]/20 bg-[#0e0e0e]/95 p-8 shadow-[0_20px_50px_rgba(242,202,80,0.06)] backdrop-blur-xl text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-[#f2ca50]/20 bg-gradient-to-b from-[#f2ca50]/10 to-transparent text-[#f2ca50]">
                  <span className="material-symbols-outlined text-3xl">account_balance_wallet</span>
                </div>
                <h2 className="font-headline text-2xl font-black italic tracking-wide text-white uppercase">
                  Access Your <span className="text-[#f2ca50]">Portfolio</span>
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-white/60">
                  {!address
                    ? "Connect your Web3 wallet to load execution balances, active vaults, reserves, and positions."
                    : "Sign your session to authorize portfolio reads and view live execution data."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (!address) {
                      openConnectModal?.();
                      return;
                    }
                    if (!isAuthenticated) {
                      void signIn().catch(() => {});
                    }
                  }}
                  className="mt-8 w-full rounded-full border border-[#f2ca50]/30 bg-gradient-to-r from-[#f2ca50] to-[#f2ca50]/80 py-3.5 text-sm font-black uppercase tracking-wider text-black transition-all duration-300 hover:brightness-110 hover:shadow-[0_0_25px_rgba(242,202,80,0.2)]"
                >
                  {!address ? "Connect Wallet" : "Sign Session"}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function PredictionMarketCard({ position }: { position: PortfolioPosition }) {
  const isPnlPositive = (position.pnlUsd ?? 0) >= 0;
  return (
    <article className="relative overflow-hidden rounded-[22px] border border-white/5 bg-gradient-to-b from-[#131313] to-[#0c0c0c] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-[#f2ca50]/35 hover:shadow-[0_8px_25px_rgba(242,202,80,0.03)] group">
      <div className="absolute right-0 top-0 h-[2px] w-0 bg-[#f2ca50] transition-all duration-500 group-hover:w-full" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white group-hover:text-[#f2ca50] transition-colors duration-300">{position.name}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-wider text-white/30 bg-white/5 px-2 py-0.5 rounded-full">
              {position.protocol}
            </span>
            <span className="text-[9px] font-black uppercase tracking-wider text-[#f2ca50] bg-[#f2ca50]/10 px-2 py-0.5 rounded-full border border-[#f2ca50]/15">
              Active
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-black text-white">{formatUsd(position.usdValue ?? 0)}</p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/5 pt-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">Position</p>
          <p className="mt-1 text-sm font-semibold text-white/80">{position.amountFormatted}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-bold uppercase tracking-wider text-white/30">PnL</p>
          <p className={`mt-1 text-sm font-bold ${isPnlPositive ? 'text-[#f2ca50]' : 'text-white/60'}`}>
            {formatSignedUsd(position.pnlUsd)}
          </p>
        </div>
      </div>
    </article>
  );
}
