"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  fetchStoreAgentStats,
  fetchStoreAgents,
  type StoreAgent,
  type StoreAgentStats,
} from "@/lib/liveProductClient";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { useAgentJwt } from "@/lib/hooks/useAgentJwt";
import { useSidebarPreference } from "@/lib/useSidebarPreference";

const categoryOrder = [
  "All Agents",
  "Research",
  "Payments",
  "DeFi",
  "Analytics",
  "Perception",
  "Custom",
] as const;

const agentTabMap: Record<string, string> = {
  ascii: "Research",
  research: "Research",
  analyst: "Research",
  writer: "Research",
  swap: "Swap",
  vault: "Vault",
  bridge: "Bridge",
  portfolio: "Portfolio",
  invoice: "Research",
  vision: "Research",
  transcribe: "Research",
  schedule: "AgentPay",
  split: "AgentPay",
  batch: "AgentPay",
};

function reputationLabel(score: number): string {
  return `${(score / 20).toFixed(1)}/5`;
}

function formatPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Custom";
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function WalletCopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const displayAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded bg-white/[0.03] px-2 py-1 text-[10px] font-mono text-white/50 hover:bg-[#f2ca50]/10 hover:text-[#f2ca50] transition duration-200 select-all"
      title="Click to copy full address"
    >
      <span>{displayAddress}</span>
      <span className="material-symbols-outlined text-[11px] leading-none">
        {copied ? "check" : "content_copy"}
      </span>
    </button>
  );
}

export default function AgentsPage() {
  const router = useRouter();
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isAuthenticated, signIn, loading: authLoading, error: authError } = useAgentJwt();
  const [activeCategory, setActiveCategory] = useState<(typeof categoryOrder)[number]>("All Agents");
  const [searchQuery, setSearchQuery] = useState("");
  const [agents, setAgents] = useState<StoreAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string | null>(null);
  const [selectedAgentStats, setSelectedAgentStats] = useState<StoreAgentStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const handleSelectAgent = (slug: string) => {
    setSelectedAgentSlug(slug);
    setDetailsCollapsed(false);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await fetchStoreAgents();
        if (!cancelled) setAgents(next);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load agents");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const seen = new Set<string>(["All Agents"]);
    for (const cat of categoryOrder.slice(1)) {
      if (agents.some((agent) => agent.category === cat)) {
        seen.add(cat);
      }
    }
    return Array.from(seen) as Array<(typeof categoryOrder)[number]>;
  }, [agents]);

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      const catMatch = activeCategory === "All Agents" || agent.category === activeCategory;
      const searchLower = searchQuery.toLowerCase().trim();
      const searchMatch =
        !searchLower ||
        agent.name.toLowerCase().includes(searchLower) ||
        agent.description.toLowerCase().includes(searchLower) ||
        agent.category.toLowerCase().includes(searchLower);
      return catMatch && searchMatch;
    });
  }, [activeCategory, agents, searchQuery]);

  useEffect(() => {
    if (!filteredAgents.length) {
      setSelectedAgentSlug(null);
      return;
    }

    if (!selectedAgentSlug || !filteredAgents.some((agent) => agent.slug === selectedAgentSlug)) {
      setSelectedAgentSlug(filteredAgents[0]?.slug ?? null);
    }
  }, [filteredAgents, selectedAgentSlug]);

  useEffect(() => {
    if (!selectedAgentSlug) {
      setSelectedAgentStats(null);
      return;
    }

    let cancelled = false;
    const loadStats = async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const next = await fetchStoreAgentStats(selectedAgentSlug);
        if (!cancelled) {
          setSelectedAgentStats(next);
        }
      } catch (cause) {
        if (!cancelled) {
          setSelectedAgentStats(null);
          setStatsError(cause instanceof Error ? cause.message : "Could not load agent stats");
        }
      } finally {
        if (!cancelled) {
          setStatsLoading(false);
        }
      }
    };

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [selectedAgentSlug]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#070707] font-body text-[#e9e6df]">
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

        <main className="flex-1 overflow-y-auto px-8 py-10 xl:px-10 lg:flex lg:flex-col lg:overflow-hidden">
          <div className="mx-auto w-full max-w-[1320px] lg:flex lg:flex-row lg:gap-6 lg:min-h-0 lg:flex-1">
            {/* Left column — title, filters, and cards scroll together as one region */}
            <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-2 thin-scrollbar">
            {/* Title / Hero */}
            <div className="mb-8 flex flex-col gap-2 border-b border-white/5 pb-8">
              <h1 className="font-headline text-[clamp(2.8rem,5.5vw,4.5rem)] font-black leading-[0.92] tracking-[-0.055em] text-white">
                Agent<span className="text-[#f2ca50]">Store</span>
              </h1>
            </div>

            {/* Filter and Search Row */}
            <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              {/* Category buttons */}
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {categories.map((category) => {
                  const active = activeCategory === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      className={`whitespace-nowrap rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all duration-300 ${
                        active
                          ? "border border-[#f2ca50]/30 bg-[#f2ca50] text-black shadow-[0_8px_24px_rgba(242,202,80,0.15)]"
                          : "border border-white/5 bg-white/[0.02] text-white/50 hover:border-white/20 hover:text-white/80"
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>

              {/* Search Box */}
              <div className="relative w-full max-w-xs shrink-0">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-white/30">
                  search
                </span>
                <input
                  type="text"
                  placeholder="Search agents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-full border border-white/5 bg-white/[0.02] py-2.5 pl-10 pr-4 text-xs text-white placeholder-white/30 outline-none transition-all duration-300 focus:border-[#f2ca50]/30 focus:bg-white/[0.04] focus:shadow-[0_0_20px_rgba(242,202,80,0.03)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white transition"
                    aria-label="Clear search"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="rounded-[24px] border border-white/5 bg-[#121212] p-8 text-sm text-white/40 flex items-center justify-center gap-3">
                <div className="h-4 w-4 animate-spin rounded-full border border-t-transparent border-[#f2ca50]/40" />
                <span>Loading live agent inventory...</span>
              </div>
            ) : error ? (
              <div className="rounded-[24px] border border-rose-500/20 bg-rose-500/5 p-8 text-sm text-rose-300/80">
                {error}
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="rounded-[24px] border border-white/5 bg-[#121212] p-8 text-sm text-white/40 text-center">
                No agents matched this filter or search query.
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                  {filteredAgents.map((agent) => (
                    (() => {
                      const isResearchPipeline = agent.slug === "research";
                      const displayPrice = agent.priceUsdc;
                      const priceLabel = isResearchPipeline ? "Pipeline total" : "Per run";
                      const selected = selectedAgentSlug === agent.slug;

                      return (
                        <div
                          key={agent.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSelectAgent(agent.slug)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleSelectAgent(agent.slug);
                            }
                          }}
                          className={`group relative flex flex-col justify-between rounded-[26px] border p-6 transition-all duration-300 hover:-translate-y-1 ${
                            selected
                              ? "border-[#f2ca50]/25 bg-[radial-gradient(circle_at_top_left,rgba(242,202,80,0.08),transparent_45%),linear-gradient(180deg,#181613_0%,#0e0d0c_100%)] shadow-[0_0_24px_rgba(242,202,80,0.04)]"
                              : "border-white/5 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.015),transparent_40%),linear-gradient(180deg,#131313_0%,#0c0c0c_100%)] hover:border-[#f2ca50]/15 hover:shadow-[0_0_24px_rgba(255,255,255,0.01)]"
                          }`}
                        >
                          <div className={`absolute right-6 top-6 h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                            selected 
                              ? "bg-[#f2ca50] scale-125 shadow-[0_0_8px_#f2ca50]" 
                              : "bg-white/10 group-hover:scale-125 group-hover:bg-[#f2ca50]/60"
                          }`} />

                          <div className="flex flex-col h-full justify-between">
                            <div>
                              <div className="mb-4 flex items-start justify-between pr-6">
                                <div>
                                  <h2 className="font-display text-[1.5rem] font-bold text-white tracking-tight leading-snug transition-colors">
                                    {agent.name}
                                  </h2>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#f2ca50]/80">
                                      {agent.category}
                                    </span>
                                    <span className="h-1 w-1 rounded-full bg-white/20" />
                                    <span className="text-[10px] font-bold tracking-[0.05em] text-[#f2ca50] flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[13px] leading-none">star</span>
                                      {reputationLabel(agent.reputationScore)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <p className="mb-6 text-sm leading-relaxed text-white/45 group-hover:text-white/60 transition-colors line-clamp-3">
                                {agent.description}
                              </p>
                            </div>

                            <div>
                              <div className="mb-5 border-t border-white/5 pt-4 flex items-center justify-between">
                                <div>
                                  <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">{priceLabel}</div>
                                  <div className="mt-1 font-display text-[1.4rem] font-bold text-[#f2ca50] leading-none">
                                    {formatPrice(displayPrice)} <span className="text-[10px] font-bold tracking-wider text-[#f2ca50]/70">USDC</span>
                                  </div>
                                </div>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] flex items-center gap-1.5 ${
                                    agent.available
                                      ? "border border-[#f2ca50]/15 bg-[#f2ca50]/5 text-[#f2ca50]"
                                      : "border border-white/5 bg-white/[0.02] text-white/35"
                                  }`}
                                >
                                  <span className={`h-1 w-1 rounded-full ${agent.available ? "bg-[#f2ca50] animate-pulse" : "bg-white/20"}`} />
                                  {agent.available ? "Live" : "Offline"}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const tab = agentTabMap[agent.slug] ?? "Research";
                                  router.push(`/chat?agent=${agent.slug}&tab=${tab}`);
                                }}
                                className="w-full rounded-full border border-white/10 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-white/50 transition-all duration-300 hover:border-[#f2ca50]/30 hover:bg-[#f2ca50]/5 hover:text-[#f2ca50] hover:shadow-[0_4px_16px_rgba(242,202,80,0.05)]"
                              >
                                Open in chat
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ))}
                </div>
              )}
            </div>
            {/* Agent Details Panel — pinned full-height sibling, scrolls independently */}
            {!loading && !error && filteredAgents.length > 0 && (
              detailsCollapsed ? (
                  <>
                    <aside className="hidden lg:flex w-14 flex-shrink-0 items-start justify-center pt-2">
                      <button
                        type="button"
                        onClick={() => setDetailsCollapsed(false)}
                        className="rounded-2xl border border-[#f2ca50]/15 bg-[#141414] px-3.5 py-6 text-[9px] font-black uppercase tracking-[0.24em] text-[#f2ca50] [writing-mode:vertical-rl] transition-all duration-300 hover:border-[#f2ca50]/35 hover:bg-[#1a1917] hover:shadow-[0_0_15px_rgba(242,202,80,0.03)]"
                        aria-label="Open agent details"
                      >
                        Show Details
                      </button>
                    </aside>

                    <aside className="h-fit overflow-hidden rounded-[28px] border border-white/5 bg-[radial-gradient(circle_at_top_right,rgba(242,202,80,0.04),transparent_40%),linear-gradient(180deg,#141414_0%,#0e0e0e_100%)] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)] lg:hidden">
                      <div className="flex items-start justify-between gap-3 border-b border-white/5 pb-5">
                        <div>
                          <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#f2ca50]">
                            Agent Audit
                          </div>
                          <div className="mt-1 text-xs text-white/35 font-medium">
                            Scorecard & performance statistics
                          </div>
                        </div>
                      </div>
                      {statsLoading ? (
                        <div className="py-12 text-center text-sm text-white/35 flex flex-col items-center justify-center gap-3">
                          <div className="h-5 w-5 animate-spin rounded-full border border-t-transparent border-[#f2ca50]/40" />
                          <span>Loading stats...</span>
                        </div>
                      ) : statsError ? (
                        <div className="py-8 text-sm text-rose-300/80 bg-rose-500/5 border border-rose-500/10 rounded-2xl p-4 mt-6">
                          {statsError}
                        </div>
                      ) : selectedAgentStats ? (
                        <>
                          <div className="mb-6 mt-6">
                            <div className="flex items-center justify-between">
                              <h2 className="font-display text-[1.8rem] font-bold text-white tracking-tight leading-none">
                                {selectedAgentStats.agent.name}
                              </h2>
                            </div>
                            <p className="mt-3.5 text-xs leading-relaxed text-white/45">
                              {selectedAgentStats.agent.description}
                            </p>
                          </div>
                        </>
                      ) : (
                        <div className="py-12 text-center text-xs text-white/35 font-medium">Select an agent to view details.</div>
                      )}
                    </aside>
                  </>
                ) : (
                  <aside className="sticky top-4 h-fit max-h-[calc(100vh-140px)] rounded-[28px] border border-white/5 bg-[radial-gradient(circle_at_top_right,rgba(242,202,80,0.04),transparent_40%),linear-gradient(180deg,#141414_0%,#0e0e0e_100%)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] lg:static lg:h-full lg:w-[350px] lg:shrink-0 lg:max-h-none lg:min-h-0 lg:overflow-hidden">
                    <div className="thin-scrollbar max-h-[calc(100vh-140px)] overflow-y-auto overscroll-contain p-6 lg:h-full lg:max-h-none">
                    <div className="flex items-start justify-between gap-3 border-b border-white/5 pb-5">
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-[0.25em] text-[#f2ca50]">
                          Agent Audit
                        </div>
                        <div className="mt-1 text-xs text-white/35 font-medium">
                          Scorecard & performance statistics
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDetailsCollapsed(true)}
                        className="hidden lg:inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/5 bg-white/[0.02] text-white/45 transition-all duration-300 hover:border-[#f2ca50]/20 hover:text-[#f2ca50]"
                        aria-label="Collapse agent details"
                      >
                        <span className="material-symbols-outlined text-[16px]">right_panel_close</span>
                      </button>
                    </div>

                    {statsLoading ? (
                      <div className="py-12 text-center text-sm text-white/35 flex flex-col items-center justify-center gap-3">
                        <div className="h-5 w-5 animate-spin rounded-full border border-t-transparent border-[#f2ca50]/40" />
                        <span>Loading stats...</span>
                      </div>
                    ) : statsError ? (
                      <div className="py-8 text-sm text-rose-300/80 bg-rose-500/5 border border-rose-500/10 rounded-2xl p-4 mt-6">
                        {statsError}
                      </div>
                    ) : selectedAgentStats ? (
                      <>
                        <div className="mb-6 mt-6">
                          <div className="flex items-center justify-between">
                            <h2 className="font-display text-[1.8rem] font-bold text-white tracking-tight leading-none">
                              {selectedAgentStats.agent.name}
                            </h2>
                            <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.15em] border ${
                              selectedAgentStats.agent.available
                                ? "border-[#f2ca50]/20 bg-[#f2ca50]/5 text-[#f2ca50]"
                                : "border-white/5 bg-white/[0.02] text-white/35"
                            }`}>
                              {selectedAgentStats.agent.available ? "Live" : "Offline"}
                            </span>
                          </div>
                          <p className="mt-3.5 text-xs leading-relaxed text-white/45">
                            {selectedAgentStats.agent.description}
                          </p>
                        </div>

                        {/* Pricing block */}
                        <div className="border-t border-white/5 py-5 bg-gradient-to-r from-white/[0.01] to-transparent px-3 rounded-xl">
                          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">
                            {selectedAgentStats.stats.priceLabel}
                          </div>
                          <div className="mt-2 font-display text-[1.8rem] font-bold text-[#f2ca50] leading-none">
                            {formatPrice(selectedAgentStats.agent.priceUsdc)} <span className="text-[11px] font-black tracking-wider text-[#f2ca50]/80">USDC</span>
                          </div>
                          <div className="mt-2 text-[10px] text-white/40 font-medium">
                            {selectedAgentStats.stats.scopeLabel}
                          </div>
                        </div>

                        <div className="mt-4 border-t border-white/5 space-y-1">
                          {/* Custom visual Success Rate row */}
                          <div className="border-b border-white/5 py-3.5 flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[15px] text-[#f2ca50]">bolt</span>
                                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">Success Rate</span>
                              </div>
                              <span className="text-xs font-bold text-[#f2ca50]">{selectedAgentStats.stats.successRate}%</span>
                            </div>
                            {/* Success rate progress bar */}
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-[#f2ca50] to-[#e6bd3c] rounded-full transition-all duration-1000"
                                style={{ width: `${selectedAgentStats.stats.successRate}%` }}
                              />
                            </div>
                          </div>

                          {/* Standard Stats Rows */}
                          {[
                            { label: "Completed tasks", value: String(selectedAgentStats.stats.completedTasks), icon: "task_alt" },
                            { label: "Total runs", value: String(selectedAgentStats.stats.totalRuns), icon: "data_usage" },
                            { label: "Rating", value: `${selectedAgentStats.stats.rating}/5`, icon: "star" },
                            { label: "Nanopayments", value: String(selectedAgentStats.stats.nanopaymentCount), icon: "payments" },
                            { label: "Payment volume", value: `${formatPrice(selectedAgentStats.stats.nanopaymentVolumeUsdc)} USDC`, icon: "monetization_on" },
                            { label: "Category", value: selectedAgentStats.agent.category, icon: "category" },
                            { label: "Token ID", value: selectedAgentStats.agent.tokenId ?? "Not minted", icon: "fingerprint" },
                            { label: "Wallet", value: selectedAgentStats.agent.devWallet ?? "Not available", icon: "account_balance_wallet" },
                          ].map((row) => (
                            <div
                              key={row.label}
                              className="flex items-start justify-between gap-4 border-b border-white/5 py-3.5 last:border-b-0"
                            >
                              <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-[15px] text-[#f2ca50]">{row.icon}</span>
                                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">
                                  {row.label}
                                </div>
                              </div>
                              <div className={`text-right ${row.label === "Wallet" ? "max-w-[160px] break-all font-mono text-[11px] text-white/60" : "text-xs font-semibold text-white/80"}`}>
                                {row.label === "Wallet" && row.value !== "Not available" ? (
                                  <WalletCopyAddress address={row.value} />
                                ) : (
                                  row.value
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="py-12 text-center text-xs text-white/35 font-medium">Select an agent to view details.</div>
                    )}
                    </div>
                  </aside>
                )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
