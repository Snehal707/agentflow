"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { isLikelyErc8004Registry } from "@/lib/arcChain";
import { shortenAddress } from "@/lib/appData";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import {
  AllocationSparklines,
} from "@/components/portfolio/AllocationSparklines";
import {
  fetchExecutionWalletSummary,
  fetchPortfolioSnapshot,
  type PortfolioHolding,
  type PortfolioRecentTransaction,
  type PortfolioSnapshotResponse,
} from "@/lib/liveAgentClient";
import {
  portfolioValueUsdExcludingGatewayOnly,
  pnlSummaryExcludingGateway,
} from "@/lib/portfolioMetrics";
import { findVaultHolding, type VaultHoldingCard } from "@/lib/vaultPositionCards";
import { useSidebarPreference } from "@/lib/useSidebarPreference";

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatVaultShares(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: numeric >= 100 ? 2 : 4,
  }).format(numeric);
}

function getLocalTimeHint(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone ? `Times shown in your local timezone (${zone})` : "Times shown in your local timezone";
  } catch {
    return "Times shown in your local timezone";
  }
}

function humanizeMethodName(method: string | null | undefined): string {
  if (!method) return "Transaction";
  const base = method.split("(")[0]?.trim() || method.trim();
  if (!base) return "Transaction";
  const spaced = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatActivityCounterparty(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? shortenAddress(trimmed) : trimmed;
}

type ActivityFeedKind = "transfer" | "register" | "approve" | "other";

/** Bullet / middle-dot / dash separators from activity summaries. */
const ACTIVITY_SUMMARY_SPLIT = /\s*[•·-]\s*/;

function extractRecentActivityMeta(
  activity: PortfolioRecentTransaction,
  viewerAddress?: string | null,
): {
  title: string;
  counterparty: string | null;
  fee: string | null;
  kind: ActivityFeedKind;
  transferDirection: "in" | "out" | null;
} {
  const rawParts = activity.summary
    .split(ACTIVITY_SUMMARY_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);

  const methodPart = rawParts[0] ?? activity.method ?? "transaction";
  const contractPart = rawParts[1] ?? null;

  const feePart = rawParts.find((part) => /^fee\s+/i.test(part)) ?? null;

  const counterpartyPart =
    rawParts.find((part, index) => index > 0 && !/^fee\s+/i.test(part)) ?? activity.to ?? null;

  const methodLower = methodPart.toLowerCase();
  const contractLower = (contractPart ?? "").toLowerCase();
  const isFiatTokenProxy = contractLower.includes("fiattokenproxy");
  const isTransferMethod = methodLower.includes("transfer");
  const isApproveMethod = methodLower.includes("approve");
  const isRegisterMethod = methodLower.includes("register");
  const isSwapMethod = methodLower.includes("swap");
  const isDepositMethod = methodLower.includes("deposit");
  const isWithdrawMethod = methodLower.includes("withdraw") || methodLower.includes("redeem");
  const isMintMethod = methodLower.includes("mint");
  const isBurnMethod = methodLower.includes("burn");
  const isGenericTransaction =
    methodLower === "transaction" ||
    methodLower === "contract interaction" ||
    methodLower === "contractinteraction";

  let title: string;
  let kind: ActivityFeedKind = "other";

  const registerTarget =
    activity.to ??
    (contractPart && /^0x[a-fA-F0-9]{40}$/.test(contractPart.trim()) ? contractPart.trim() : null);

  if (isFiatTokenProxy && isTransferMethod) {
    title = "USDC Transfer";
    kind = "transfer";
  } else if (isFiatTokenProxy && isApproveMethod) {
    title = "USDC Approval";
    kind = "approve";
  } else if (isRegisterMethod && registerTarget && isLikelyErc8004Registry(registerTarget)) {
    title = "Agent Registration";
    kind = "register";
  } else if (isSwapMethod) {
    title = "Swap";
  } else if (isDepositMethod && contractLower.includes("vault")) {
    title = "Vault Deposit";
  } else if (isWithdrawMethod && contractLower.includes("vault")) {
    title = "Vault Withdraw";
  } else if (isMintMethod) {
    title = "Mint";
  } else if (isBurnMethod) {
    title = "Burn";
  } else if (isApproveMethod) {
    title = "Token Approval";
    kind = "approve";
  } else if (isTransferMethod) {
    title = "Transfer";
    kind = "transfer";
  } else if (isGenericTransaction && contractPart && /^0x[a-fA-F0-9]{40}$/.test(contractPart.trim())) {
    title = "Contract Interaction";
  } else if (contractPart && /^0x[a-fA-F0-9]{40}$/.test(contractPart.trim())) {
    title = "Contract Interaction";
    if (isTransferMethod) kind = "transfer";
    else if (isApproveMethod) kind = "approve";
    else if (isRegisterMethod) kind = "register";
  } else {
    title = humanizeMethodName(methodPart);
    if (isTransferMethod) kind = "transfer";
    else if (isApproveMethod) kind = "approve";
    else if (isRegisterMethod) kind = "register";
  }

  let transferDirection: "in" | "out" | null = null;
  if (kind === "transfer" && viewerAddress) {
    const v = viewerAddress.toLowerCase();
    const from = activity.from?.toLowerCase() ?? "";
    const to = activity.to?.toLowerCase() ?? "";
    if (from === v) transferDirection = "out";
    else if (to === v) transferDirection = "in";
  }

  return {
    title,
    counterparty:
      title === "Contract Interaction"
        ? formatActivityCounterparty(contractPart ?? counterpartyPart)
        : formatActivityCounterparty(counterpartyPart),
    fee: feePart,
    kind,
    transferDirection,
  };
}

function ActivityFeedIcon({
  kind,
  direction,
}: {
  kind: ActivityFeedKind;
  direction: "in" | "out" | null;
}) {
  const cls = "material-symbols-outlined flex size-5 shrink-0 items-center justify-center leading-none";
  if (kind === "transfer") {
    if (direction === "in") {
      return (
        <span className={`${cls} text-[#f2ca50]`} aria-hidden>
          arrow_downward
        </span>
      );
    }
    if (direction === "out") {
      return (
        <span className={`${cls} text-[#f2ca50]`} aria-hidden>
          arrow_upward
        </span>
      );
    }
    return (
      <span className={`${cls} text-[#8f96a7]`} aria-hidden>
        swap_horiz
      </span>
    );
  }
  if (kind === "register") {
    return (
      <span className={`${cls} text-[#f2ca50]`} style={{ fontVariationSettings: "'FILL' 0" }} aria-hidden>
        shield
      </span>
    );
  }
  if (kind === "approve") {
    return (
      <span className={`${cls} text-[#f2ca50]`} style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden>
        check_circle
      </span>
    );
  }
  return (
    <span className={`${cls} text-[#8f96a7]`} aria-hidden>
      contract
    </span>
  );
}

export default function PortfolioPage() {
  const router = useRouter();
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const {
    session,
    isAuthenticated,
    signIn,
    loading: authLoading,
    error: authError,
    getAuthHeaders,
  } = useAgentJwt();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [execSnapshot, setExecSnapshot] = useState<PortfolioSnapshotResponse | null>(null);
  const [execLoadError, setExecLoadError] = useState<string | null>(null);
  const [execLoading, setExecLoading] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  useEffect(() => {
    let cancelled = false;
    const loadExec = async () => {
      if (!address || !isAuthenticated) {
        setExecSnapshot(null);
        setExecLoadError(null);
        setExecLoading(false);
        return;
      }
      const headers = getAuthHeaders();
      if (!headers) {
        setExecSnapshot(null);
        return;
      }
      setExecLoading(true);
      try {
        const summary = await fetchExecutionWalletSummary(headers);
        if (cancelled) return;
        if (cancelled) return;
        const next = await fetchPortfolioSnapshot(summary.userAgentWalletAddress);
        if (!cancelled) {
          setExecSnapshot(next);
          setExecLoadError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setExecSnapshot(null);
          setExecLoadError(cause instanceof Error ? cause.message : "Execution wallet snapshot failed");
        }
      } finally {
        if (!cancelled) {
          setExecLoading(false);
        }
      }
    };
    void loadExec();
    return () => {
      cancelled = true;
    };
  }, [address, getAuthHeaders, isAuthenticated, session?.token]);

  const activeSnapshot = execSnapshot;
  const displayTotalUsd = useMemo(
    () => portfolioValueUsdExcludingGatewayOnly(execSnapshot),
    [execSnapshot],
  );
  const displayPnl = useMemo(() => pnlSummaryExcludingGateway(execSnapshot), [execSnapshot]);
  const displayPnlUsd = execSnapshot ? displayPnl.pnlUsd : null;
  const displayPnlPct = execSnapshot ? displayPnl.pnlPct : null;
  const displayCostBasisUsd = execSnapshot ? displayPnl.costBasisUsd : null;

  const pnlTone = useMemo(() => {
    if (typeof displayPnlUsd !== "number" || !Number.isFinite(displayPnlUsd)) {
      return { dot: "bg-white/40", text: "text-white/40" };
    }
    if (displayPnlUsd > 0) {
      return { dot: "bg-emerald-400", text: "text-emerald-400" };
    }
    if (displayPnlUsd < 0) {
      return { dot: "bg-rose-400", text: "text-rose-400" };
    }
      return { dot: "bg-white/40", text: "text-white/40" };
  }, [displayPnlUsd]);

  const vaultPositionCards = useMemo<VaultHoldingCard[]>(() => {
    const nextCards: VaultHoldingCard[] = [];

    const executionAddress = execSnapshot?.walletAddress;
    if (executionAddress) {
      const executionVault = findVaultHolding(execSnapshot.holdings);
      if (executionVault) {
        nextCards.push({
          key: `execution-${executionAddress}`,
          label: "Agent wallet",
          walletAddress: executionAddress,
          balanceFormatted: executionVault.balanceFormatted,
          symbol: executionVault.symbol || "afvUSDC",
          usdValue: executionVault.usdValue,
          readLabel: "Live portfolio snapshot",
        });
      }
    }

    return nextCards;
  }, [execSnapshot]);

  const vaultPositionLoading = isLoading || execLoading;

  const vaultPositionError = useMemo(() => {
    if (!address) {
      return null;
    }
    if (error || execLoadError) {
      return "Some vault positions may be missing because Arc portfolio reads are rate-limited.";
    }
    return null;
  }, [address, error, execLoadError]);

  const holdings = useMemo(() => activeSnapshot?.holdings ?? [], [activeSnapshot]);
  const positions = useMemo(() => activeSnapshot?.positions ?? [], [activeSnapshot]);
  const gatewayPosition = useMemo(
    () => positions.find((position) => position.kind === "gateway_position") ?? null,
    [positions],
  );
  const agentPositions = useMemo(
    () => positions.filter((position) => position.kind !== "gateway_position"),
    [positions],
  );
  const recentTransactions = useMemo(() => activeSnapshot?.recentTransactions ?? [], [activeSnapshot]);
  const allocationTotalUsd = useMemo(
    () => holdings.reduce((sum, h) => sum + (h.usdValue ?? 0), 0),
    [holdings],
  );
  const shareDenomAllocation = allocationTotalUsd > 0 ? allocationTotalUsd : 1;
  const sortedAllHoldings = useMemo(
    () => [...holdings].sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0)),
    [holdings],
  );
  const searchNeedle = assetSearch.trim().toLowerCase();
  const filteredHoldings = useMemo(() => {
    if (!searchNeedle) return sortedAllHoldings;
    return sortedAllHoldings.filter((h) => {
      const n = (h.name ?? "").toLowerCase();
      const s = (h.symbol ?? "").toLowerCase();
      return n.includes(searchNeedle) || s.includes(searchNeedle);
    });
  }, [sortedAllHoldings, searchNeedle]);
  const topHoldings = useMemo(() => filteredHoldings.slice(0, 4), [filteredHoldings]);
  const chartHoldings = useMemo(() => filteredHoldings.slice(0, 12), [filteredHoldings]);

  const filteredPositions = useMemo(() => {
    if (!searchNeedle) return agentPositions;
    return agentPositions.filter((p) => {
      const n = (p.name ?? "").toLowerCase();
      const pr = (p.protocol ?? "").toLowerCase();
      return n.includes(searchNeedle) || pr.includes(searchNeedle);
    });
  }, [agentPositions, searchNeedle]);
  const maxHoldingValue = useMemo(() => {
    const max = chartHoldings.reduce((highest, item) => Math.max(highest, item.usdValue ?? 0), 0);
    return max > 0 ? max : 1;
  }, [chartHoldings]);

  const refreshSnapshot = async () => {
    if (!address) {
      openConnectModal?.();
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
      if (!headers || !isAuthenticated) {
        setExecSnapshot(null);
        setExecLoadError("Sign your AgentFlow session to load the Agent wallet portfolio.");
        return;
      }
      setExecLoading(true);
      try {
        const summary = await fetchExecutionWalletSummary(headers);
        setExecSnapshot(await fetchPortfolioSnapshot(summary.userAgentWalletAddress, { force: true }));
        setExecLoadError(null);
      } catch (e) {
        setExecLoadError(e instanceof Error ? e.message : "Execution snapshot failed");
      } finally {
        setExecLoading(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Portfolio snapshot failed");
    } finally {
      setIsLoading(false);
    }
  };

  const latestActivities = recentTransactions;
  const localTimeHint = useMemo(() => getLocalTimeHint(), []);

  const compactSummary = useMemo((): string | null => {
    const parts: string[] = [];
    if (typeof displayTotalUsd === "number" && Number.isFinite(displayTotalUsd)) {
      parts.push(`Total: ${formatUsd(displayTotalUsd)}`);
    }
    for (const h of sortedAllHoldings.slice(0, 3)) {
      if ((h.symbol ?? h.name) && typeof h.usdValue === "number") {
        parts.push(`${h.symbol ?? h.name}: ${formatUsd(h.usdValue)}`);
      }
    }
    if (typeof displayPnlUsd === "number" && Number.isFinite(displayPnlUsd)) {
      const pctStr =
        typeof displayPnlPct === "number" && Number.isFinite(displayPnlPct)
          ? ` (${formatPct(displayPnlPct)})`
          : "";
      parts.push(
        `PnL: ${displayPnlUsd >= 0 ? "+" : ""}${formatUsd(Math.abs(displayPnlUsd))}${pctStr}`,
      );
    }
    return parts.length > 0 ? parts.join(", ") : null;
  }, [displayTotalUsd, displayPnlUsd, displayPnlPct, sortedAllHoldings]);

  const openPortfolioChat = () => {
    const activeWalletTab = "dcw";
    const focusLabel = "agent wallet (DCW)";
    const message = encodeURIComponent(
      `Review my ${focusLabel}, explain the biggest risks, and suggest next steps.`,
    );
    const ctx = compactSummary ? encodeURIComponent(compactSummary) : "";
    const params = new URLSearchParams({
      tab: "Portfolio",
      walletTab: activeWalletTab,
      message,
    });
    if (ctx) {
      params.set("context", ctx);
    }
    params.set("executionTarget", "DCW");
    router.push(`/chat?${params.toString()}`);
  };

  const scrollToAllocation = () => {
    if (typeof document !== "undefined") {
      requestAnimationFrame(() => {
        document.getElementById("portfolio-allocation-section")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#131313] font-body text-[#e5e2e1]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />
      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[#131313]">
        <ChatTopNavbar
          actions={(
            <SessionStatusChip
              address={isAuthenticated ? execSnapshot?.walletAddress ?? address : address}
              isAuthenticated={isAuthenticated}
              isLoading={false}
              onAction={() => {
                if (!address) { openConnectModal?.(); return; }
                if (!isAuthenticated) void signIn().catch(() => {});
              }}
              compact
            />
          )}
        />
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-12 py-8">
          <section className="mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="font-headline text-5xl italic tracking-tight text-[#f2ca50]">Portfolio</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/40">
                Track your Agent wallet, Gateway reserve, vault exposure, and recent activity in one place.
              </p>
            </div>
            <div className="flex flex-col gap-4 xl:items-end">
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full bg-[#f2ca50] px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#3c2f00]">
                  Agent wallet view
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-4 rounded-full border border-white/5 bg-[#1c1b1b] px-4 py-2">
                  <span className="material-symbols-outlined icon-standard text-white/40">search</span>
                  <input
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    className="w-48 bg-transparent border-none focus:ring-0 text-sm text-[#e5e2e1] placeholder:text-white/30 outline-none"
                    placeholder="Search assets..."
                    type="search"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { void refreshSnapshot(); }}
                  disabled={isLoading}
                  className="rounded-full border border-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white/50 transition hover:border-[#f2ca50]/40 hover:text-[#f2ca50] disabled:opacity-50"
                >
                  {isLoading ? "Refreshing" : "Refresh"}
                </button>
              </div>
            </div>
          </section>

          {execLoadError ? (
            <div className="mb-6 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {execLoadError}
            </div>
          ) : null}

          <section className="mb-6 rounded-xl border border-white/5 bg-[#1c1b1b] px-6 py-4">
            <div className="max-w-3xl">
                <p className="font-label text-[10px] uppercase tracking-[0.18em] text-white/40">
                  Agent wallet
                </p>
                <ul className="mt-2 space-y-2 text-sm leading-relaxed text-white/78">
                  <li>
                    <span className="font-semibold text-[#e5e2e1]">Agent wallet</span>
                    {" - "}
                    Circle DCW used for DeFi execution in chat after preview and confirmation.
                  </li>
                  <li>
                    <span className="font-semibold text-[#e5e2e1]">Funding wallet</span>
                    {" - "}
                    your connected wallet is used only to fund AgentFlow and sign your session.
                  </li>
                </ul>
            </div>
          </section>

          {/* Hero — Total Portfolio Value */}
          <section className="relative mb-10 overflow-hidden rounded-xl bg-[#0e0e0e] p-10">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-20">
              <div className="h-full w-full bg-gradient-to-l from-[#f2ca50]/20 to-transparent blur-3xl" />
            </div>
            <div className="relative z-10">
              <div className="mb-2 flex items-center gap-3">
                <span className="font-label uppercase tracking-[0.25em] text-white/40 text-[10px] font-bold">
                  Total portfolio value
                </span>
                <div className="h-px w-12 bg-[#4d4635]/30" />
              </div>
              <div className="flex items-baseline gap-6">
                <h2 className="font-headline text-7xl font-bold text-[#e5e2e1] tracking-tight leading-none">
                  {!address
                    ? "Connect wallet"
                    : !execSnapshot && (isLoading || execLoading)
                      ? "Loading..."
                      : formatUsd(displayTotalUsd)}
                </h2>
                {typeof displayPnlPct === "number" && Number.isFinite(displayPnlPct) ? (
                  <div className="flex items-center gap-2 rounded-full border border-[#f2ca50]/20 bg-[#f2ca50]/10 px-3 py-1">
                    <span className="material-symbols-outlined icon-standard text-[#f2ca50] text-sm">
                      {(displayPnlUsd ?? 0) >= 0 ? "trending_up" : "trending_down"}
                    </span>
                    <span className={`font-label font-bold text-xs uppercase tracking-wider ${pnlTone.text}`}>
                      {formatPct(displayPnlPct)}
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="mt-4 font-body text-sm text-white/40 max-w-md leading-relaxed">
                {!address
                  ? "Connect your wallet to load your live Arc holdings and portfolio analytics."
                  : `Net PnL: ${formatSignedUsd(displayPnlUsd)} · Cost basis: ${formatUsd(displayCostBasisUsd)}`}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={openPortfolioChat}
                  className="gold-shimmer px-10 py-3 rounded-md text-[#3c2f00] font-label font-extrabold uppercase tracking-[0.2em] text-[11px] shadow-lg shadow-[#f2ca50]/20 hover:scale-[1.02] hover:shadow-[#f2ca50]/40 transition-all duration-300 cursor-pointer"
                >
                  Open in chat
                </button>
                <button
                  type="button"
                  onClick={scrollToAllocation}
                  className="px-8 py-3 border border-[#4d4635]/30 rounded-md text-[#e5e2e1] font-label font-bold uppercase tracking-widest text-[11px] hover:bg-[#3a3939] transition-colors"
                >
                  See holdings
                </button>
              </div>
            </div>
          </section>

          {/* Vault share positions */}
          <section className="mb-10 rounded-xl border border-white/5 bg-[#1c1b1b] p-8">
            <p className="font-label text-[10px] font-black uppercase tracking-[0.2em] text-[#f2ca50]">
              Vault Position
            </p>
            <h2 className="font-headline mt-2 text-2xl text-[#e5e2e1]">Vault shares</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">
              Live vault share balances for your Agent wallet, alongside token holdings below.
            </p>
            {vaultPositionLoading ? (
              <div className="mt-8 rounded-xl border border-white/5 bg-black/20 px-6 py-5 text-sm text-white/45">
                Reading live vault balances...
              </div>
            ) : vaultPositionCards.length > 0 ? (
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {vaultPositionCards.map((holding) => (
                  <article
                    key={holding.key}
                    className="rounded-xl border border-white/5 bg-black/20 p-6"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-label text-[10px] uppercase tracking-[0.18em] text-[#f2ca50]">
                          {holding.label}
                        </p>
                        <p className="mt-2 text-sm font-medium text-[#e5e2e1]">
                          {shortenAddress(holding.walletAddress)}
                        </p>
                      </div>
                      <span className="rounded bg-emerald-500/10 px-3 py-1 font-label text-[9px] font-bold uppercase tracking-widest text-emerald-300">
                        Live
                      </span>
                    </div>
                    <div className="mt-6 grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-white/5 bg-[#141414] px-4 py-3">
                        <p className="font-label text-[9px] uppercase tracking-[0.16em] text-white/35">
                          Shares
                        </p>
                        <p className="mt-2 text-sm font-semibold text-[#e5e2e1]">
                          {formatVaultShares(holding.balanceFormatted)} {holding.symbol}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-[#141414] px-4 py-3">
                        <p className="font-label text-[9px] uppercase tracking-[0.16em] text-white/35">
                          Est. value
                        </p>
                        <p className="mt-2 text-sm font-semibold text-[#e5e2e1]">
                          {holding.usdValue == null ? "N/A" : formatUsd(holding.usdValue)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/5 bg-[#141414] px-4 py-3">
                        <p className="font-label text-[9px] uppercase tracking-[0.16em] text-white/35">
                          Read
                        </p>
                        <p className="mt-2 text-sm font-semibold text-[#e5e2e1]">{holding.readLabel}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-8 rounded-xl border border-white/5 bg-black/20 px-6 py-5 text-sm text-white/45">
                {vaultPositionError ??
                  (!address
                    ? "Connect your wallet to see vault positions."
                    : "No vault shares were detected in your Agent wallet.")}
              </div>
            )}
          </section>

          <div className="mb-4">
            <p className="font-label text-[10px] uppercase tracking-[0.18em] text-white/40">Your Holdings</p>
            <h2 className="font-headline mt-1 text-2xl font-bold text-[#e5e2e1]">Allocation &amp; activity</h2>
          </div>

          {/* Lower grid: Allocation + Activity */}
          <div id="portfolio-allocation-section" className="grid grid-cols-12 gap-8">
            {/* Allocation Surface */}
            <div className="col-span-12 rounded-xl bg-[#1c1b1b] p-10 lg:col-span-5">
              <div className="mb-6 flex items-center justify-between">
                <h4 className="font-headline text-xl font-bold">Allocation</h4>
                <p className="font-label text-[10px] uppercase tracking-[0.18em] text-white/40">
                  Live holdings
                </p>
              </div>
              <div className="relative min-h-[5rem] rounded-xl border border-white/5 bg-black/30 px-2 py-2">
                {execLoading ? (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/80 font-label text-xs text-white/50">
                    Loading agent wallet...
                  </div>
                ) : null}
                <AllocationSparklines
                  holdings={chartHoldings}
                  maxUsd={maxHoldingValue}
                  shareDenom={shareDenomAllocation}
                  totalTokenCount={filteredHoldings.length}
                  emptySlots={5}
                />
              </div>
              {topHoldings.length > 0 ? (
                <p className="mt-6 text-xs leading-relaxed text-white/45">
                  {topHoldings.length > 0 && (topHoldings[0]?.symbol?.toUpperCase() === "USDC" || topHoldings[0]?.name?.toLowerCase().includes("usdc"))
                    ? "Mostly stablecoin exposure, with a smaller EURC sleeve and vault allocation."
                    : "Current allocation is shown by live Agent wallet balances and vault holdings."}
                </p>
              ) : null}
              {!isLoading && chartHoldings.length === 0 ? (
                <p className="mt-8 font-body text-sm text-white/40">
                  {!address
                    ? "Connect wallet to load holdings."
                    : searchNeedle
                      ? "No holdings match your search."
                      : "No holdings found for this wallet."}
                </p>
              ) : null}
            </div>

            {/* Recent Activity */}
            <div className="col-span-12 rounded-xl bg-[#1c1b1b] p-10 lg:col-span-7">
              <div className="mb-10 flex items-center justify-between">
                <h4 className="font-headline text-xl font-bold">Recent Activity</h4>
              </div>
              <div className="space-y-2">
                {latestActivities.length === 0 && !isLoading ? (
                  <div className="rounded-xl border border-white/5 bg-black/30 p-6 font-body text-sm text-white/40">
                    {!address
                      ? "Connect your wallet to see activity."
                      : "No recent transactions found yet for the Agent wallet."}
                  </div>
                ) : null}
                {latestActivities.slice(0, 6).map((activity) => {
                  const meta = extractRecentActivityMeta(activity, execSnapshot?.walletAddress ?? address);
                  return (
                    <div
                      key={activity.hash}
                      className="group flex cursor-default items-center justify-between rounded-xl px-4 py-4 hover:bg-white/5 transition-colors duration-300"
                    >
                      <div className="flex items-center gap-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#201f1f] text-white/40 group-hover:bg-[#f2ca50] group-hover:text-[#3c2f00] transition-all duration-500">
                          <ActivityFeedIcon kind={meta.kind} direction={meta.transferDirection} />
                        </div>
                        <div>
                          <p className="font-label font-bold text-[#e5e2e1] text-sm">{meta.title}</p>
                          <p className="font-body text-xs text-white/40 mt-1">
                            {meta.counterparty ? `${meta.counterparty} · ` : ""}
                            {formatTimestamp(activity.timestamp)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Positions */}
          {gatewayPosition ? (
            <section className="mt-8 overflow-hidden rounded-xl border border-white/5 bg-[#1c1b1b]">
              <div className="flex items-center justify-between border-b border-white/5 p-8">
                <div>
                  <h3 className="font-headline text-xl font-bold">Gateway Reserve</h3>
                  <p className="mt-1 text-sm text-white/40">
                    USDC set aside for x402 and agent-to-agent nanopayments.
                  </p>
                </div>
                <span className="w-fit rounded-full border border-[#f2ca50]/35 bg-[#f2ca50]/10 px-3 py-1 font-label text-[10px] font-black tracking-[0.14em] text-[#f2ca50]">
                  Live
                </span>
              </div>
              <div className="grid gap-3 p-6 md:grid-cols-3">
                <div className="rounded-xl border border-white/5 bg-black/30 px-5 py-4">
                  <p className="font-label text-[10px] uppercase tracking-[0.16em] text-white/40">Current Balance</p>
                  <p className="mt-2 font-mono text-lg font-bold text-[#e5e2e1]">
                    {gatewayPosition.amountFormatted}
                  </p>
                </div>
                <div className="rounded-xl border border-white/5 bg-black/30 px-5 py-4">
                  <p className="font-label text-[10px] uppercase tracking-[0.16em] text-white/40">Reserve Value</p>
                  <p className="mt-2 font-mono text-lg font-bold text-[#e5e2e1]">
                    {formatUsd(gatewayPosition.usdValue)}
                  </p>
                </div>
                <div className="rounded-xl border border-white/5 bg-black/30 px-5 py-4">
                  <p className="font-label text-[10px] uppercase tracking-[0.16em] text-white/40">Reserve Notes</p>
                  <p className="mt-2 text-sm text-white/65">
                    {gatewayPosition.notes.find(Boolean) ?? "Use this reserve for x402, A2A, and Gateway-backed payments."}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {agentPositions.length > 0 ? (
            <section className="mt-8 overflow-hidden rounded-xl border border-white/5 bg-[#1c1b1b]">
              <div className="flex items-center justify-between border-b border-white/5 p-8">
                <h3 className="font-headline text-xl font-bold">Agent Positions</h3>
                <Link href="/agents" className="font-label text-[10px] font-bold uppercase tracking-[0.14em] text-[#f2ca50] hover:underline transition">
                  Browse agents
                </Link>
              </div>
              <div className="space-y-3 p-6">
                {filteredPositions.map((position) => (
                  <article
                    key={position.id}
                    className="rounded-xl border border-white/5 bg-black/30 p-6 hover:border-[#f2ca50]/20 transition-colors"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#201f1f]">
                          <span className="material-symbols-outlined icon-standard text-[#f2ca50]">smart_toy</span>
                        </div>
                        <div>
                          <p className="font-label font-bold text-[#e5e2e1] text-sm">{position.name}</p>
                          <p className="font-body text-[10px] uppercase tracking-[0.14em] text-white/40">{position.amountFormatted}</p>
                        </div>
                      </div>
                      <span className="w-fit rounded-full border border-[#f2ca50]/35 bg-[#f2ca50]/10 px-3 py-1 font-label text-[10px] font-black tracking-[0.14em] text-[#f2ca50]">
                        Live
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      {[
                        { label: "Cost Basis", value: formatUsd(position.costBasisUsd) },
                        { label: "Current Value", value: formatUsd(position.usdValue) },
                        { label: "Unrealized PnL", value: formatSignedUsd(position.pnlUsd), tone: (position.pnlUsd ?? 0) >= 0 ? "text-[#f2ca50]" : "text-rose-400" },
                      ].map(({ label, value, tone }) => (
                        <div key={label} className="rounded-lg border border-white/5 bg-black/30 px-4 py-3">
                          <p className="font-label text-[10px] uppercase tracking-[0.16em] text-white/40">{label}</p>
                          <p className={`mt-1 font-mono text-sm font-bold ${tone ?? "text-[#e5e2e1]"}`}>{value}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>
          ) : null}
          {authError ? (
            <div className="mt-6 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">{authError}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
