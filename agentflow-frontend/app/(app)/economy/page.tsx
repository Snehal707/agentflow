"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
import {
  fetchEconomyBenchmarkStatus,
  fetchEconomyStats,
  startEconomyBenchmark,
  type EconomyBenchmarkJobStatus,
  type EconomyBenchmarkResult,
  type EconomyStats,
  type EconomyTransaction,
} from "@/lib/liveProductClient";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { useSidebarPreference } from "@/lib/useSidebarPreference";

function formatUsd(value: number, digits = 4): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 16) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`;
}

function parseTransactionDate(value: string | null | undefined): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(raw) ? raw : `${raw}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTransactionDateTime(value: string | null | undefined): string {
  const parsed = parseTransactionDate(value);
  if (!parsed) return "--";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTransactionTime(value: string | null | undefined): string {
  const parsed = parseTransactionDate(value);
  if (!parsed) return "--";
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function agentLabel(
  slug: string,
  specMap: Map<string, EconomyStats["agent_specs"][number]>,
): string {
  return specMap.get(slug)?.name ?? `${titleCase(slug)} Agent`;
}

function joinMetricParts(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" | ");
}

function transactionTitle(
  tx: EconomyTransaction,
  specMap: Map<string, EconomyStats["agent_specs"][number]>,
): string {
  if (tx.action_type === "agent_to_agent_payment") {
    const buyer = tx.buyer_agent || tx.agent_slug || "unknown";
    const seller = tx.seller_agent || "unknown";
    return `${agentLabel(buyer, specMap)} -> ${agentLabel(seller, specMap)}`;
  }
  if (tx.remark?.trim()) {
    return tx.remark.trim();
  }
  return titleCase(tx.action_type || "transaction");
}

function MiniSparkline({ data }: { data: number[] }) {
  const series = data.length ? data : [0, 0, 0, 0, 0, 0];
  const max = Math.max(...series, 1);

  return (
    <div className="flex h-6 items-end gap-0.5">
      {series.map((value, index) => (
        <div
          key={`${index}-${value}`}
          className={`w-2 rounded-sm ${
            index === series.length - 1 ? "bg-[#f2ca50]" : "bg-[#f2ca50]/40"
          }`}
          style={{
            height: `${Math.max(16, (value / max) * 100)}%`,
            opacity: index === series.length - 1 ? 1 : 0.45 + (index / series.length) * 0.45,
          }}
        />
      ))}
    </div>
  );
}

export default function EconomyPage() {
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const {
    isAuthenticated,
    signIn,
    loading: authLoading,
    getAuthHeaders,
  } = useAgentJwt();

  const [stats, setStats] = useState<EconomyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [newTxCount, setNewTxCount] = useState(0);
  const [lastTxCount, setLastTxCount] = useState(0);
  const [pulseActive, setPulseActive] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkJob, setBenchmarkJob] = useState<EconomyBenchmarkJobStatus | null>(null);
  const [benchmarkResults, setBenchmarkResults] = useState<EconomyBenchmarkResult | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const lastTxCountRef = useRef(0);
  const pulseTimeoutRef = useRef<number | null>(null);

  const loadStats = useCallback(async () => {
    const initialLoad = !hasLoadedRef.current;
    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const next = await fetchEconomyStats();
      const nextTxCount = next.all_time.settlements || 0;

      if (hasLoadedRef.current && nextTxCount > lastTxCountRef.current) {
        setNewTxCount(nextTxCount - lastTxCountRef.current);
        setPulseActive(true);
        if (pulseTimeoutRef.current) {
          window.clearTimeout(pulseTimeoutRef.current);
        }
        pulseTimeoutRef.current = window.setTimeout(() => {
          setPulseActive(false);
        }, 2000);
      } else {
        setNewTxCount(0);
      }

      setStats(next);
      setLastUpdated(new Date());
      setLastTxCount(nextTxCount);
      lastTxCountRef.current = nextTxCount;
      setError(null);
      hasLoadedRef.current = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Economy stats failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setCountdown(30);
    }
  }, []);

  const runBenchmark = useCallback(async () => {
    setBenchmarkRunning(true);
    setBenchmarkJob(null);
    setBenchmarkError(null);
    setBenchmarkResults(null);

    try {
      if (!address) {
        openConnectModal?.();
        throw new Error("Connect a wallet to run the benchmark.");
      }

      let authHeaders = getAuthHeaders();
      if (!authHeaders) {
        await signIn();
        authHeaders = getAuthHeaders();
      }

      if (!authHeaders) {
        throw new Error("Sign in to run the benchmark.");
      }

      const job = await startEconomyBenchmark(authHeaders);
      setBenchmarkJob(job);
      if (job.status === "complete" && job.result) {
        setBenchmarkResults(job.result);
        setBenchmarkRunning(false);
        await loadStats();
      } else if (job.status === "failed") {
        setBenchmarkError(job.error || "Benchmark failed");
        setBenchmarkRunning(false);
      }
    } catch (cause) {
      setBenchmarkError(cause instanceof Error ? cause.message : "Benchmark failed");
      setBenchmarkRunning(false);
    }
  }, [address, getAuthHeaders, loadStats, openConnectModal, signIn]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((previous) => {
        if (previous <= 1) {
          void loadStats();
          return 30;
        }
        return previous - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadStats]);

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) {
        window.clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!benchmarkRunning || !benchmarkJob?.jobId || !address) {
      return;
    }

    const poll = async () => {
      try {
        const authHeaders = getAuthHeaders();
        if (!authHeaders) {
          return;
        }

        const next = await fetchEconomyBenchmarkStatus(authHeaders, benchmarkJob.jobId);
        setBenchmarkJob(next);

        if (next.status === "complete" && next.result) {
          setBenchmarkResults(next.result);
          setBenchmarkRunning(false);
          setBenchmarkError(null);
          await loadStats();
          return;
        }

        if (next.status === "failed") {
          setBenchmarkError(next.error || "Benchmark failed");
          setBenchmarkRunning(false);
        }
      } catch (cause) {
        setBenchmarkError(
          cause instanceof Error ? cause.message : "Benchmark status failed",
        );
        setBenchmarkRunning(false);
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [address, benchmarkJob?.jobId, benchmarkRunning, getAuthHeaders, loadStats]);

  const specMap = useMemo(() => {
    return new Map((stats?.agent_specs || []).map((spec) => [spec.slug, spec]));
  }, [stats]);

  const coreAgentSlugs = useMemo(() => {
    return new Set((stats?.agent_specs || []).map((spec) => spec.slug));
  }, [stats]);

  const topEarners = useMemo(() => {
    return Object.entries(stats?.agent_earnings || {})
      .filter(([slug, rollup]) => coreAgentSlugs.has(slug) && rollup.earned > 0)
      .sort((a, b) => b[1].earned - a[1].earned)
      .slice(0, 6);
  }, [coreAgentSlugs, stats]);

  const topActiveAgents = useMemo(() => {
    return Object.entries(stats?.agent_earnings || {})
      .filter(([slug, rollup]) => coreAgentSlugs.has(slug) && rollup.tasks > 0)
      .sort((a, b) => {
        if (b[1].tasks !== a[1].tasks) {
          return b[1].tasks - a[1].tasks;
        }
        if (b[1].earned !== a[1].earned) {
          return b[1].earned - a[1].earned;
        }
        return b[1].spent - a[1].spent;
      })
      .slice(0, 6);
  }, [coreAgentSlugs, stats]);

  const topChains = useMemo(() => {
    return Object.entries(stats?.a2a_chains || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [stats]);

  const maxEarned = topEarners[0]?.[1].earned || 1;
  const maxTasks = topActiveAgents[0]?.[1].tasks || 1;
  const maxGatewayBalance = Math.max(
    1,
    ...Object.values(stats?.gateway_balances || {}).map((value) =>
      Number.isFinite(value) ? value : 0,
    ),
  );

  const liveBadgeLabel = pulseActive
    ? `New activity${newTxCount > 0 ? ` +${newTxCount}` : "!"}`
    : "Live";

  const benchmarkButtonLabel = benchmarkRunning
    ? "Running benchmark... (60 txs)"
    : "Run 60-Tx Benchmark";
  const benchmarkProgressLabel = benchmarkJob
    ? `${benchmarkJob.progress.completed}/${benchmarkJob.progress.total} settled | ${benchmarkJob.progress.successful} success | ${benchmarkJob.progress.failed} failed`
    : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] font-body text-[#e5e2e1]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto scrollbar-hide">
          <ChatTopNavbar
            actions={(
              <SessionStatusChip
                address={address}
                isAuthenticated={isAuthenticated}
                isLoading={authLoading}
                onAction={() => {
                  if (!address) {
                    openConnectModal?.();
                    return;
                  }
                  if (!isAuthenticated) {
                    void signIn().catch(() => {});
                  }
                }}
                compact
              />
            )}
          />

          <div className="px-6 py-8 md:px-10">
            <section className="mb-8 rounded-xl border border-white/5 bg-[#131313] p-6 md:p-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                    Shared Platform Proof
                  </p>
                  <h1 className="mt-2 font-headline text-4xl tracking-tight text-white/90 md:text-5xl">
                    Benchmark
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/40">
                    This page is the shared platform proof surface for the hackathon: global
                    A2A nanopayments first, direct execution activity second, and private
                    benchmark controls kept separate below.
                  </p>
                </div>

                <div className="flex flex-col gap-4 lg:items-end">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          pulseActive ? "bg-green-400 animate-pulse" : "bg-green-400/50"
                        }`}
                      />
                      <span className="text-green-400">{liveBadgeLabel}</span>
                    </div>
                    <div className="text-white/35">
                      Tracking {lastTxCount} shared settled txs
                    </div>
                    <div className="text-white/35">Refreshes in {countdown}s</div>
                    <div className="text-white/35">
                      {lastUpdated
                        ? `Updated ${lastUpdated.toLocaleTimeString()}`
                        : "Waiting for first sync"}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => void loadStats()}
                      disabled={refreshing}
                      className="rounded-xl border border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 transition hover:border-[#f2ca50]/40 hover:text-[#f2ca50] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {refreshing ? "Refreshing" : "Refresh"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {error ? (
              <div className="mb-6 rounded-xl border border-[#c65454]/30 bg-[#2a1212] px-4 py-3 text-sm text-[#ffb5b5]">
                {error}
              </div>
            ) : null}

            {loading && !stats ? (
              <div className="rounded-xl border border-white/5 bg-[#131313] px-5 py-12 text-center text-sm text-white/45">
                Loading economy data...
              </div>
            ) : null}

            {!loading && stats ? (
              <div className="space-y-6">
                <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
                  <div className="rounded-xl border border-[#f2ca50]/15 bg-[#131313] p-5">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                          Total USDC Settled
                        </p>
                        <div className="mt-3 text-4xl font-semibold tracking-tight text-[#f2ca50]">
                          {formatUsd(parseFloat(stats.all_time.usdc || "0"), 4)}
                        </div>
                        <p className="mt-2 text-sm text-white/40">
                          {stats.all_time.settlements} settled rows all time:{" "}
                          {stats.all_time.tasks} direct executions and{" "}
                          {stats.all_time.a2a_payments} core A2A nanopayment settlements.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 lg:min-w-[280px]">
                        <div className="rounded-xl border border-white/5 bg-black/20 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                            Today
                          </p>
                          <p className="mt-2 text-2xl font-semibold text-white/90">
                            {formatUsd(parseFloat(stats.today.usdc || "0"), 4)}
                          </p>
                          <p className="mt-1 text-xs text-white/35">
                            {stats.today.settlements} settled rows / {stats.today.tasks} direct executions
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/5 bg-black/20 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                            A2A Today
                          </p>
                          <p className="mt-2 text-2xl font-semibold text-white/90">
                            {stats.today.a2a_payments}
                          </p>
                          <p className="mt-1 text-xs text-white/35">
                            Core paid agent hops
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                    <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                        Net Margin
                      </p>
                      <p className="mt-3 text-3xl font-semibold text-emerald-300">
                        {stats.today.net_margin}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-white/35">
                        Measured retained margin after Arc receipt gas on today&apos;s settled flow.
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                        Arc Gas Today
                      </p>
                      <p className="mt-3 text-3xl font-semibold text-white/90">
                        {(() => {
                          const raw = parseFloat(stats.today.arc_gas_paid || "0");
                          if (!Number.isFinite(raw) || raw <= 0) return "$0.00";
                          if (raw < 0.0001) return `$${raw.toFixed(8)}`;
                          if (raw < 1) return `$${raw.toFixed(6)}`;
                          return formatUsd(raw, 4);
                        })()}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-white/35">
                        {stats.today.arc_gas_attribution === "batcher_onchain"
                          ? `Pro-rata Arc gas from ${stats.today.arc_gas_attributed_tx_count ?? 0} batch tx${
                              (stats.today.arc_gas_attributed_tx_count ?? 0) === 1 ? "" : "es"
                            } that included our settlements (${
                              stats.today.arc_gas_attributed_transfer_count ?? 0
                            } transfers).`
                          : stats.today.arc_gas_attribution === "direct_onchain"
                            ? "Measured from today’s direct on-chain Arc transaction receipts."
                            : stats.today.arc_gas_attribution === "placeholder"
                              ? "Estimated placeholder gas — settlement hashes not yet linked to batch receipts."
                              : "No on-chain Arc gas attributable to today’s settlements yet."}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-white/5 bg-[#131313] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                        Why Arc Works
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-white/90">
                        Micro-payments that still make margin
                      </h2>
                    </div>
                    <div className="text-xs text-[#f2ca50]">
                      {stats.arc_vs_ethereum.savings_multiplier === "n/a"
                        ? "Awaiting on-chain Arc gas data"
                        : `${stats.arc_vs_ethereum.savings_multiplier} cheaper`}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-[#c65454]/20 bg-[#1a1111] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300">
                        Ethereum
                      </p>
                      <dl className="mt-3 space-y-2 text-sm text-white/50">
                        <div className="flex justify-between gap-4">
                          <dt>Gas per tx</dt>
                          <dd>{stats.arc_vs_ethereum.ethereum_gas_per_tx}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Min viable payment</dt>
                          <dd>{stats.arc_vs_ethereum.min_viable_payment_eth}</dd>
                        </div>
                        <div className="text-red-300">Sub-cent pricing collapses under gas.</div>
                      </dl>
                    </div>

                    <div className="rounded-xl border border-[#f2ca50]/20 bg-[#1a1811] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#f2ca50]">
                        Arc Network
                      </p>
                      <dl className="mt-3 space-y-2 text-sm text-white/50">
                        <div className="flex justify-between gap-4">
                          <dt>Gas per tx</dt>
                          <dd>{stats.arc_vs_ethereum.arc_gas_per_tx}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt>Min viable payment</dt>
                          <dd>{stats.arc_vs_ethereum.min_viable_payment_arc}</dd>
                        </div>
                        <div className="text-emerald-300">
                          Sub-cent task pricing stays economically viable.
                        </div>
                      </dl>
                    </div>
                  </div>
                </section>

                <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-6">
                    <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                            Agent Leaderboard
                          </p>
                          <h2 className="mt-2 text-xl font-semibold text-white/90">
                            Top earners today
                          </h2>
                        </div>
                        <div className="text-xs text-white/35">
                          {topEarners.length} earning agents
                        </div>
                      </div>

                      {topEarners.length === 0 ? (
                        <div className="mt-6 text-sm text-white/35">
                          No agents have earned revenue yet today.
                        </div>
                      ) : (
                        <div className="mt-5 space-y-4">
                          {topEarners.map(([slug, rollup], index) => {
                            const width = Math.max(6, (rollup.earned / maxEarned) * 100);
                            const hourly = stats.hourly_activity?.[slug] || [0, 0, 0, 0, 0, 0];
                            return (
                              <div key={slug} className="space-y-2">
                                <div className="flex items-center justify-between gap-4 text-sm">
                                  <div className="flex items-center gap-3">
                                    <span className="w-4 text-white/35">{index + 1}</span>
                                    <div>
                                      <div className="text-white/90">{agentLabel(slug, specMap)}</div>
                                      <div className="text-xs text-white/35">
                                        {joinMetricParts([
                                          `${rollup.tasks} tasks`,
                                          rollup.spent > 0 ? `spent ${formatUsd(rollup.spent, 4)}` : null,
                                        ])}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <MiniSparkline data={hourly} />
                                    <div className="text-[#f2ca50]">
                                      {formatUsd(rollup.earned, 4)}
                                    </div>
                                  </div>
                                </div>
                                <div className="h-1.5 rounded-full bg-white/5">
                                  <div
                                    className="h-1.5 rounded-full bg-[#f2ca50]"
                                    style={{ width: `${Math.min(100, width)}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                            Activity Leaderboard
                          </p>
                          <h2 className="mt-2 text-xl font-semibold text-white/90">
                            Most active today
                          </h2>
                        </div>
                        <div className="text-xs text-white/35">
                          {topActiveAgents.length} active agents
                        </div>
                      </div>

                      {topActiveAgents.length === 0 ? (
                        <div className="mt-6 text-sm text-white/35">
                          No agent activity recorded yet today.
                        </div>
                      ) : (
                        <div className="mt-5 space-y-4">
                          {topActiveAgents.map(([slug, rollup], index) => {
                            const width = Math.max(8, (rollup.tasks / maxTasks) * 100);
                            const hourly = stats.hourly_activity?.[slug] || [0, 0, 0, 0, 0, 0];
                            return (
                              <div key={`active-${slug}`} className="space-y-2">
                                <div className="flex items-center justify-between gap-4 text-sm">
                                  <div className="flex items-center gap-3">
                                    <span className="w-4 text-white/35">{index + 1}</span>
                                    <div>
                                      <div className="text-white/90">{agentLabel(slug, specMap)}</div>
                                      <div className="text-xs text-white/35">
                                        {joinMetricParts([
                                          rollup.earned > 0 ? `earned ${formatUsd(rollup.earned, 4)}` : null,
                                          rollup.spent > 0 ? `spent ${formatUsd(rollup.spent, 4)}` : null,
                                        ]) || "No value settled"}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <MiniSparkline data={hourly} />
                                    <div className="text-white/80">{rollup.tasks} tasks</div>
                                  </div>
                                </div>
                                <div className="h-1.5 rounded-full bg-white/5">
                                  <div
                                    className="h-1.5 rounded-full bg-white/60"
                                    style={{ width: `${Math.min(100, width)}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-[#f2ca50]/20 bg-[#131313] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                            A2A Benchmark Proof
                          </p>
                          <h2 className="mt-2 text-xl font-semibold text-white/90">
                            Real nanopayment settlements
                          </h2>
                        </div>
                        <div className="text-xs text-[#f2ca50]/80">
                          {stats.today.a2a_payments} today
                        </div>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-white/40">
                        Shared platform A2A proof: core agent-to-agent x402 settlements only.
                      </p>

                      <div className="mt-5 space-y-3">
                        {(stats.recent_a2a_payments || []).length === 0 ? (
                          <div className="text-sm text-white/35">No A2A ledger rows yet.</div>
                        ) : (
                          (stats.recent_a2a_payments || []).slice(0, 12).map((tx) => {
                            const settlement =
                              (tx.arc_tx_id && tx.arc_tx_id.trim()) ||
                              (tx.gateway_transfer_id && tx.gateway_transfer_id.trim()) ||
                              (tx.request_id && tx.request_id.trim()) ||
                              null;
                            const settlementShort = settlement
                              ? settlement.length > 20
                                ? `${settlement.slice(0, 10)}…${settlement.slice(-8)}`
                                : settlement
                              : "—";
                            const buyer = tx.buyer_agent || "—";
                            const seller = tx.seller_agent || "—";
                            const rail = (tx.payment_rail || "x402/gateway").replace(/_/g, "/");
                            return (
                              <div
                                key={`a2a-${tx.id}`}
                                className="flex flex-col gap-1 border-b border-white/5 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-white/90">
                                    <span className="text-[#f2ca50]">{agentLabel(buyer, specMap)}</span>
                                    <span className="mx-2 text-white/30">→</span>
                                    <span className="text-[#f2ca50]">{agentLabel(seller, specMap)}</span>
                                  </div>
                                  <div className="mt-1 break-all text-xs text-white/40">
                                    {rail} · settlement{" "}
                                    <span className="font-mono text-white/55">{settlementShort}</span>
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  <div className="text-sm font-medium text-white/90">
                                    {formatUsd(Number(tx.amount || 0), 4)}
                                  </div>
                                  <div className="text-xs text-white/35">
                                    {formatTransactionDateTime(tx.created_at)}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="mt-4 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/40">
                        Only core agent-to-agent nanopayment settlements belong here. User-to-agent
                        executions and sponsored runs are tracked elsewhere on the page.
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                            Direct Executions
                          </p>
                          <h2 className="mt-2 text-xl font-semibold text-white/90">
                            Single-agent execution activity
                          </h2>
                        </div>
                        <div className="text-xs text-white/35">
                          {(stats.latest_transactions || []).length} recent rows
                        </div>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-white/40">
                        Shared execution rows across the platform. They support throughput and
                        coverage, but they are not the A2A nanopayment proof lane.
                      </p>

                      <div className="mt-5 space-y-3">
                        {(stats.latest_transactions || []).length === 0 ? (
                          <div className="text-sm text-white/35">
                            No direct execution rows yet.
                          </div>
                        ) : (
                          (stats.latest_transactions || []).slice(0, 10).map((tx) => {
                            const settlementRef = shortRef(tx.gateway_transfer_id || tx.arc_tx_id);
                            return (
                              <div
                                key={tx.id}
                                className="flex items-start justify-between gap-4 border-b border-white/5 pb-3 last:border-b-0 last:pb-0"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm text-white/90">
                                    {transactionTitle(tx, specMap)}
                                  </div>
                                  <div className="mt-1 text-xs text-white/35">
                                    {(tx.payment_rail || "arc_usdc").replace(/_/g, "/")} |{" "}
                                    {formatTransactionTime(tx.created_at)}
                                    {settlementRef ? ` | ${settlementRef}` : ""}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm text-white/90">
                                    {formatUsd(Number(tx.amount || 0), 4)}
                                  </div>
                                  <div className="mt-1 text-xs text-emerald-300">complete</div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-xl border border-[#f2ca50]/20 bg-[#131313] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                            Private Benchmark Run
                          </p>
                          <h2 className="mt-2 text-xl font-semibold text-white/90">
                            Push the 50+ tx proof
                          </h2>
                        </div>
                        <div className="text-xs text-[#f2ca50]">Hackathon benchmark</div>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-white/40">
                        Start a private benchmark job from your signed-in wallet. Once it settles,
                        its results roll into the shared platform proof above.
                      </p>
                      <p className="mt-2 text-xs text-white/35">
                        Lightweight benchmark mode usually finishes in well under a minute. The
                        control is private to your wallet, but the proof totals on this page stay
                        global for demo clarity.
                      </p>

                      {benchmarkError ? (
                        <div className="mt-4 rounded-xl border border-[#c65454]/30 bg-[#2a1212] px-3 py-2 text-xs text-[#ffb5b5]">
                          {benchmarkError}
                        </div>
                      ) : null}

                      {!benchmarkResults ? (
                        <div className="mt-4 space-y-3">
                          <button
                            type="button"
                            onClick={() => void runBenchmark()}
                            disabled={benchmarkRunning || authLoading}
                            className="w-full rounded-xl bg-[#f2ca50] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#f2ca50]/90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {benchmarkButtonLabel}
                          </button>
                          {benchmarkRunning ? (
                            <div className="space-y-1 text-xs text-[#f2ca50]">
                              <div>
                                Benchmark in progress. Keep this tab open while your private run
                                settles into the shared proof.
                              </div>
                              {benchmarkProgressLabel ? (
                                <div className="text-white/45">{benchmarkProgressLabel}</div>
                              ) : null}
                              {benchmarkJob?.progress.currentAgent ? (
                                <div className="text-white/35">
                                  Current agent: {titleCase(benchmarkJob.progress.currentAgent)}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3">
                          <div className="text-sm font-semibold text-emerald-300">
                            Benchmark complete
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                              <div className="text-white/35">Transactions</div>
                              <div className="mt-1 text-base font-semibold text-white/90">
                                {benchmarkResults.total_txs}
                              </div>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                              <div className="text-white/35">Total USDC</div>
                              <div className="mt-1 text-base font-semibold text-white/90">
                                ${benchmarkResults.total_usdc}
                              </div>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                              <div className="text-white/35">Arc gas paid</div>
                              <div className="mt-1 text-base font-semibold text-white/90">
                                ${benchmarkResults.gas_paid}
                              </div>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                              <div className="text-white/35">Net margin</div>
                              <div className="mt-1 text-base font-semibold text-emerald-300">
                                {benchmarkResults.margin}
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                              <div className="text-white/35">Direct x402</div>
                              <div className="mt-1 text-base font-semibold text-[#f2ca50]">
                                {benchmarkResults.breakdown.x402_payments}
                              </div>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                              <div className="text-white/35">A2A nanopayments</div>
                              <div className="mt-1 text-sm font-semibold text-white/90">
                                {benchmarkResults.breakdown.a2a_payments}
                              </div>
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-xs text-white/40">
                            Shared A2A today: {stats.today.a2a_payments} | Top shared A2A pair:{" "}
                            {topChains[0] ? topChains[0][0].replace('->', ' -> ') : "No A2A yet"}
                          </div>
                          <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-xs text-white/40">
                            Arc benchmark cost {benchmarkResults.arc_vs_eth.arc_cost} | Ethereum
                            benchmark cost {benchmarkResults.arc_vs_eth.eth_cost} |{" "}
                            {benchmarkResults.arc_vs_eth.savings}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setBenchmarkJob(null);
                              setBenchmarkResults(null);
                              setBenchmarkError(null);
                            }}
                            className="text-xs text-white/45 transition hover:text-white/80"
                          >
                            Run again
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                            A2A Pairs
                          </p>
                          <h2 className="mt-2 text-xl font-semibold text-white/90">
                            Frequent nanopayment pairs
                          </h2>
                        </div>
                      </div>

                      {topChains.length === 0 ? (
                        <div className="mt-6 text-sm text-white/35">
                          No agent-to-agent chains yet today.
                        </div>
                      ) : (
                        <div className="mt-5 space-y-3">
                          {topChains.map(([chain, count]) => {
                            const [buyer, seller] = chain.split("->");
                            return (
                              <div
                                key={chain}
                                className="flex items-center justify-between border-b border-white/5 pb-3 last:border-b-0 last:pb-0"
                              >
                                <div className="text-sm text-white/85">
                                  <span className="text-[#f2ca50]">{agentLabel(buyer, specMap)}</span>
                                  <span className="mx-2 text-white/30">{"->"}</span>
                                  <span className="text-[#f2ca50]">{agentLabel(seller, specMap)}</span>
                                </div>
                                <div className="text-xs text-white/35">{count}x</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                            Gateway Balances
                          </p>
                          <h2 className="mt-2 text-xl font-semibold text-white/90">
                            Agent payment liquidity
                          </h2>
                        </div>
                      </div>

                      <div className="mt-5 space-y-4">
                        {Object.entries(stats.gateway_balances || {}).map(([slug, balance]) => {
                          const width = Math.min(100, (balance / maxGatewayBalance) * 100);
                          const tone =
                            balance < 1 ? "bg-red-400" : balance < 3 ? "bg-amber-300" : "bg-[#f2ca50]";

                          return (
                            <div key={slug} className="space-y-2">
                              <div className="flex items-center justify-between gap-4 text-sm">
                                <div className="text-white/85">{agentLabel(slug, specMap)}</div>
                                <div className={balance < 1 ? "text-red-300" : "text-white/50"}>
                                  {balance.toFixed(3)} USDC
                                </div>
                              </div>
                              <div className="h-1.5 rounded-full bg-white/5">
                                <div
                                  className={`h-1.5 rounded-full ${tone}`}
                                  style={{ width: `${Math.max(6, width)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {stats.treasury ? (
                      <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                              Agent Treasury
                            </p>
                            <h2 className="mt-2 text-xl font-semibold text-white/90">
                              Auto top-up reserves
                            </h2>
                          </div>
                          {stats.treasury.agents_needing_topup > 0 ? (
                            <div className="rounded-lg bg-red-400/10 px-2 py-1 text-xs text-red-300">
                              {stats.treasury.agents_needing_topup} low
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3">
                          <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                            <div className="text-xs text-white/35">Total DCW</div>
                            <div className="mt-1 text-sm font-medium text-white/90">
                              ${stats.treasury.total_dcw} USDC
                            </div>
                          </div>
                          <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                            <div className="text-xs text-white/35">Total Gateway</div>
                            <div className="mt-1 text-sm font-medium text-white/90">
                              ${stats.treasury.total_gateway} USDC
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-1">
                          {stats.treasury.agents.map((agent) => (
                            <div
                              key={agent.slug}
                              className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 text-xs last:border-b-0"
                            >
                              <div className="min-w-0 truncate text-white/85">
                                {agentLabel(agent.slug, specMap)}
                              </div>
                              <div className="flex shrink-0 items-center gap-3">
                                <span className="text-white/40">DCW: {agent.dcw}</span>
                                <span className="text-white/40">GW: {agent.gateway}</span>
                                <span
                                  className={
                                    agent.status === "ok" ? "text-emerald-300" : "text-red-300"
                                  }
                                >
                                  {agent.status === "ok" ? "✓" : "⚠"}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-white/5 bg-[#131313] p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                        Proof Story
                      </p>
                      <div className="mt-4 space-y-3 text-sm leading-relaxed text-white/45">
                        <p>1. Agents price work in sub-cent or low-cent USDC.</p>
                        <p>2. Buyers pay sellers over Circle Gateway using x402 batched settlement.</p>
                        <p>3. The ledger records payment rail, buyer agent, seller agent, and settlement ID.</p>
                        <p>4. Private benchmark runs feed this shared proof page once they settle.</p>
                        <p>5. Arc keeps gas low enough for these task-level payments to stay profitable.</p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
