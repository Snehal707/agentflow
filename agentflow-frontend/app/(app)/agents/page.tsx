"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { fetchStoreAgents, type StoreAgent } from "@/lib/liveProductClient";
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

export default function AgentsPage() {
  const router = useRouter();
  const { isCollapsed, toggleSidebar } = useSidebarPreference();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isAuthenticated, signIn, loading: authLoading, error: authError } = useAgentJwt();
  const [activeCategory, setActiveCategory] = useState<(typeof categoryOrder)[number]>("All Agents");
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
      return catMatch;
    });
  }, [activeCategory, agents]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#050505] font-body text-[#e5e2e1]">
      <AppSidebar collapsed={isCollapsed} onToggleCollapse={toggleSidebar} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/5 bg-[#050505]/90 px-8 py-5 backdrop-blur-md xl:px-10">
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

        <main className="flex-1 overflow-y-auto px-8 py-10 xl:px-10">
          <div className="mx-auto max-w-[1320px]">
            <div className="mb-12 border-b border-white/5 pb-12">
              <h1 className="mb-4 font-headline text-6xl leading-tight tracking-tight text-white/90">
                Agents
              </h1>
              <p className="max-w-3xl text-sm font-light leading-relaxed text-white/40">
                Live agent inventory only. Pick an agent and open it in chat where the actual workflow runs.
              </p>
            </div>

            <div className="mb-10 flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
              {categories.map((category) => {
                const active = activeCategory === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={`whitespace-nowrap rounded-full px-6 py-2 text-[11px] font-bold uppercase tracking-widest transition-all ${
                      active
                        ? "bg-[#f2ca50] text-[#241a00]"
                        : "border border-white/10 text-white/40 hover:border-[#f2ca50]/40 hover:text-white/70"
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div className="rounded border border-white/5 bg-[#131313] p-8 text-sm text-white/40">
                Loading live agent inventory...
              </div>
            ) : error ? (
              <div className="rounded border border-rose-500/20 bg-rose-500/10 p-8 text-sm text-rose-300">
                {error}
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="rounded border border-white/5 bg-[#131313] p-8 text-sm text-white/40">
                No agents matched this filter.
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {filteredAgents.map((agent) => (
                  <div
                    key={agent.id}
                    className="rounded-xl border border-white/5 bg-[#131313] p-8 transition-all hover:border-[#f2ca50]/20"
                  >
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div>
                        <h2 className="font-headline text-xl text-white/90">{agent.name}</h2>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-widest text-white/40">
                            {agent.category}
                          </span>
                          <span className="h-1 w-1 rounded-full bg-white/20" />
                          <span className="text-[10px] text-[#f2ca50]">
                            {reputationLabel(agent.reputationScore)}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[9px] font-bold uppercase tracking-[0.18em] ${
                          agent.available
                            ? "border border-[#f2ca50]/20 bg-[#f2ca50]/10 text-[#f2ca50]"
                            : "border border-white/10 bg-white/5 text-white/35"
                        }`}
                      >
                        {agent.available ? "Live" : "Offline"}
                      </span>
                    </div>

                    <p className="mb-8 text-xs font-light leading-relaxed text-white/40">
                      {agent.description}
                    </p>

                    <div className="mb-8 flex items-end justify-between border-t border-white/5 pt-5">
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-white/30">Per run</div>
                        <div className="mt-2 font-headline text-2xl text-[#f2ca50]">
                          {formatPrice(agent.priceUsdc)} USDC
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const tab = agentTabMap[agent.slug] ?? "Research";
                        router.push(`/chat?agent=${agent.slug}&tab=${tab}`);
                      }}
                      className="w-full rounded-lg border border-white/10 py-3 text-[10px] font-bold uppercase tracking-widest text-white/45 transition-all hover:border-[#f2ca50]/30 hover:text-[#f2ca50]"
                    >
                      Open in chat
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
