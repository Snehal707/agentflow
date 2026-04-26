"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { fetchStoreAgents, type StoreAgent } from "@/lib/liveProductClient";
import { AppSidebar } from "@/components/app/AppSidebar";
import { SessionStatusChip } from "@/components/app/SessionStatusChip";
import { ChatTopNavbar } from "@/components/chat/ChatTopNavbar";
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

function agentMeta(agent: StoreAgent) {
  switch (agent.slug) {
    case "ascii":
      return { icon: "draw" };
    case "research":
      return { icon: "query_stats" };
    case "analyst":
      return { icon: "analytics" };
    case "writer":
      return { icon: "edit_note" };
    case "swap":
      return { icon: "swap_horiz" };
    case "vault":
      return { icon: "account_balance" };
    case "bridge":
      return { icon: "alt_route" };
    case "portfolio":
      return { icon: "analytics" };
    case "invoice":
      return { icon: "receipt_long" };
    case "vision":
      return { icon: "visibility" };
    case "transcribe":
      return { icon: "mic" };
    case "schedule":
      return { icon: "event_repeat" };
    case "split":
      return { icon: "call_split" };
    case "batch":
      return { icon: "table_rows" };
    default:
      return { icon: "smart_toy" };
  }
}

export default function AgentsPage() {
  const router = useRouter();
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isAuthenticated, signIn, loading: authLoading } = useAgentJwt();
  const [activeCategory, setActiveCategory] = useState<(typeof categoryOrder)[number]>("All Agents");
  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<StoreAgent | null>(null);
  const [agents, setAgents] = useState<StoreAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    return () => { cancelled = true; };
  }, []);

  const categories = useMemo(() => {
    const seen = new Set<string>(["All Agents"]);
    for (const cat of categoryOrder.slice(1)) {
      if (agents.some((a) => a.category === cat)) seen.add(cat);
    }
    return Array.from(seen) as Array<(typeof categoryOrder)[number]>;
  }, [agents]);

  const featuredAgent = useMemo(
    () => agents.find((a) => a.available) ?? agents[0] ?? null,
    [agents],
  );

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      const catMatch = activeCategory === "All Agents" || a.category === activeCategory;
      const searchMatch = !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
      return catMatch && searchMatch;
    });
  }, [activeCategory, agents, search]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] font-body text-[#e5e2e1]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
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

          <div className="px-10 py-10">
            {/* Hero */}
            <div className="mb-14">
              <h1 className="font-headline text-6xl tracking-tight text-white/90 leading-tight mb-4">
                Agent <span className="italic text-[#f2ca50]">Store</span>
              </h1>
              <p className="max-w-xl text-white/40 text-sm font-light leading-relaxed">
                Browse the agents that power research, execution, portfolio analysis, and payment
                flows across AgentFlow.
              </p>
            </div>

            <div className="mb-10 max-w-md">
              <div className="flex items-center gap-3 rounded-full border border-white/5 bg-[#131313] px-5 py-2">
                <span className="material-symbols-outlined text-white/40" style={{ fontSize: 18 }}>search</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 bg-transparent text-xs text-white/70 placeholder:text-white/30 outline-none border-none"
                  placeholder="Search agents..."
                  type="text"
                />
              </div>
            </div>

            {/* Category rail */}
            <div className="flex gap-3 mb-12 overflow-x-auto scrollbar-hide pb-1">
              {categories.map((cat) => {
                const active = activeCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`px-6 py-2 rounded-full text-[11px] uppercase tracking-widest font-bold whitespace-nowrap transition-all ${
                      active
                        ? "bg-[#f2ca50] text-[#241a00]"
                        : "border border-white/10 text-white/40 hover:border-[#f2ca50]/40 hover:text-white/70"
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Featured agent banner */}
            {featuredAgent ? (
              <div className="mb-14">
                <div className="cinematic-card relative overflow-hidden rounded-xl" style={{ aspectRatio: "21/9" }}>
                  <div className="absolute inset-0 bg-gradient-to-r from-[#050505] via-[#050505]/80 to-transparent z-10" />
                  <div className="relative z-20 h-full flex flex-col justify-center p-12 max-w-lg">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#f2ca50]/10 border border-[#f2ca50]/20 rounded-full mb-6 w-fit">
                      <span className="w-1 h-1 rounded-full bg-[#f2ca50]" />
                      <span className="text-[9px] uppercase tracking-[0.2em] text-[#f2ca50] font-bold">Featured agent</span>
                    </div>
                    <h2 className="font-headline text-4xl mb-4 text-white/90">{featuredAgent.name}</h2>
                    <p className="text-white/40 text-sm mb-8 font-light leading-relaxed">{featuredAgent.description}</p>
                    <div className="flex items-center gap-6 mb-8">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Usage Price</div>
                        <div className="text-lg font-label text-[#f2ca50]">{formatPrice(featuredAgent.priceUsdc)} USDC</div>
                      </div>
                      <div className="w-px h-8 bg-white/10" />
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Reputation</div>
                        <div className="text-lg font-label text-white/90">{reputationLabel(featuredAgent.reputationScore)}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const tab = agentTabMap[featuredAgent.slug] ?? "Research";
                        router.push(`/chat?agent=${featuredAgent.slug}&tab=${tab}`);
                      }}
                      className="burnished-gold px-8 py-3 rounded-lg text-xs font-bold uppercase tracking-widest w-fit text-[#241a00] transition-all"
                    >
                      Open in chat
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Agent grid */}
            {loading ? (
              <div className="rounded border border-white/5 bg-[#131313] p-8 text-sm text-white/40">
                Loading live agent inventory...
              </div>
            ) : error ? (
              <div className="rounded border border-rose-500/20 bg-rose-500/10 p-8 text-sm text-rose-300">{error}</div>
            ) : filteredAgents.length === 0 ? (
              <div className="rounded border border-white/5 bg-[#131313] p-8 text-sm text-white/40">
                No agents matched this filter.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                {filteredAgents.map((agent) => {
                  const meta = agentMeta(agent);
                  const isSelected = selectedAgent?.id === agent.id;
                  return (
                    <div
                      key={agent.id}
                      onClick={() => setSelectedAgent(isSelected ? null : agent)}
                      className={`cursor-pointer rounded-xl p-8 transition-all ${
                        isSelected
                          ? "bg-[#131313] border border-[#f2ca50]/30"
                          : "bg-[#131313] border border-white/5 hover:border-[#f2ca50]/20"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h3 className="font-headline text-xl mb-1 text-white/90">{agent.name}</h3>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-white/40 uppercase tracking-widest">{agent.category}</span>
                            <span className="w-1 h-1 rounded-full bg-white/20" />
                            <span className="text-[10px] text-[#f2ca50]">★ {reputationLabel(agent.reputationScore)}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-label text-[#f2ca50]">
                            {formatPrice(agent.priceUsdc)}<span className="text-xs text-white/30 italic"> USDC</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-white/40 text-xs mb-6 font-light leading-relaxed line-clamp-2">
                        {agent.description}
                      </p>

                      <div className="flex flex-wrap gap-2 mb-8">
                        <span className="px-2 py-1 bg-[#201f1f] text-[9px] uppercase text-white/50 rounded border border-white/5 tracking-tighter">
                          {agent.category}
                        </span>
                        <span className={`px-2 py-1 text-[9px] uppercase rounded border tracking-tighter ${
                          agent.available
                            ? "bg-[#f2ca50]/10 border-[#f2ca50]/20 text-[#f2ca50]/80"
                            : "bg-white/5 border-white/5 text-white/30"
                        }`}>
                          {agent.available ? "Live" : "Unavailable"}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const tab = agentTabMap[agent.slug] ?? "Research";
                          router.push(`/chat?agent=${agent.slug}&tab=${tab}`);
                        }}
                        className="w-full py-3 border border-white/10 text-white/40 hover:bg-[#201f1f] hover:text-[#f2ca50] hover:border-[#f2ca50]/30 transition-all text-[10px] uppercase tracking-widest font-bold rounded-lg"
                      >
                        View details
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* Right sidebar: Agent details */}
        <aside className="w-80 flex-shrink-0 border-l border-white/5 bg-[#0a0a0a] overflow-y-auto scrollbar-hide p-8 flex flex-col">
          <h2 className="text-[10px] uppercase tracking-[0.3em] text-[#f2ca50] font-bold mb-8">Agent details</h2>

          {selectedAgent ? (
            <>
              <div className="cinematic-card rounded-xl p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#201f1f] border border-[#f2ca50]/20">
                    <span className="material-symbols-outlined text-[#f2ca50]" style={{ fontSize: 18 }}>
                      {agentMeta(selectedAgent).icon}
                    </span>
                  </div>
                  <div>
                    <div className="font-headline text-lg text-white/90">{selectedAgent.name}</div>
                    <div className="text-[10px] uppercase tracking-widest text-white/30">{selectedAgent.category}</div>
                  </div>
                </div>
                <p className="text-xs text-white/40 leading-relaxed">{selectedAgent.description}</p>
              </div>

              <div className="space-y-5 mb-8">
                {[
                  { label: "Reputation", value: reputationLabel(selectedAgent.reputationScore), pct: Math.min(100, selectedAgent.reputationScore) },
                  { label: "Availability", value: selectedAgent.available ? "Live" : "Offline", pct: selectedAgent.available ? 100 : 20 },
                  { label: "Usage Cost", value: `${formatPrice(selectedAgent.priceUsdc)} USDC`, pct: 72 },
                ].map(({ label, value, pct }) => (
                  <div key={label}>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[10px] uppercase tracking-widest text-white/30">{label}</span>
                      <span className="text-xs font-label text-[#f2ca50]">{value}</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-[#201f1f]">
                      <div className="h-full rounded-full bg-[#f2ca50]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-auto space-y-3">
                <div className="flex justify-between items-end mb-6 pt-4 border-t border-white/5">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Per Run</div>
                    <div className="font-headline text-2xl text-[#f2ca50]">{formatPrice(selectedAgent.priceUsdc)} USDC</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const tab = agentTabMap[selectedAgent.slug] ?? "Research";
                    router.push(`/chat?agent=${selectedAgent.slug}&tab=${tab}`);
                  }}
                  className="w-full burnished-gold py-4 rounded-lg text-xs font-bold uppercase tracking-[0.2em] text-[#241a00] flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bolt</span>
                  Open in chat
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedAgent(null)}
                  className="w-full py-4 rounded-lg border border-white/10 text-white/40 text-xs uppercase tracking-widest font-bold hover:bg-white/5 hover:text-white/70 transition-all"
                >
                  Clear Selection
                </button>
              </div>

              <p className="text-center text-[10px] text-white/20 mt-6 uppercase tracking-widest italic">
                Need a custom workflow? Start in chat and AgentFlow will route the right flow.
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-center">
              <div className="h-16 w-16 rounded-full bg-[#131313] border border-white/5 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-white/20" style={{ fontSize: 24 }}>smart_toy</span>
              </div>
              <p className="text-xs text-white/30 leading-relaxed">
                Select an agent from the grid to review pricing, status, and how it opens in chat.
              </p>
            </div>
          )}

          <div className="pt-8 mt-6">
            <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-6" />
            <p className="text-center font-headline text-2xl font-black tracking-tighter text-white/10 select-none pointer-events-none">
              AGENTFLOW
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
