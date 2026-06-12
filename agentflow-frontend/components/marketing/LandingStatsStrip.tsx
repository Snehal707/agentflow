"use client";

import { useEffect, useState } from "react";

type StatsPayload = {
  core_agents?: number;
  onchain_transactions?: number;
  agent_to_agent_payments?: number;
};

export function LandingStatsStrip() {
  const [stats, setStats] = useState({ a2a: 0, onchain: 0, coreAgents: 12 });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: StatsPayload) => {
        if (cancelled) return;
        setStats({
          coreAgents: typeof data.core_agents === "number" ? data.core_agents : 12,
          a2a:
            typeof data.agent_to_agent_payments === "number"
              ? data.agent_to_agent_payments
              : 0,
          onchain:
            typeof data.onchain_transactions === "number" ? data.onchain_transactions : 0,
        });
      })
      .catch(() => {
        if (!cancelled) setStats({ a2a: 0, onchain: 0, coreAgents: 12 });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="font-display-sans">
      <div className="grid gap-4 py-2 sm:grid-cols-3 sm:gap-5">
        <div className="flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all duration-300 hover:border-amber-400/20 hover:bg-white/[0.04]">
          <div className="max-w-[10ch] text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
          Onchain transactions
          </div>
          <div className="mt-auto pt-4 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-200 bg-clip-text text-3xl font-black tracking-tight tabular-nums text-transparent md:text-4xl">
            {stats.onchain.toLocaleString("en-US")}
          </div>
        </div>
        <div className="flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all duration-300 hover:border-amber-400/20 hover:bg-white/[0.04]">
          <div className="max-w-[10ch] text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
            Core agents
          </div>
          <div className="mt-auto pt-4 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-200 bg-clip-text text-3xl font-black tracking-tight tabular-nums text-transparent md:text-4xl">
            {stats.coreAgents}
          </div>
        </div>
        <div className="flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-all duration-300 hover:border-amber-400/20 hover:bg-white/[0.04]">
          <div className="max-w-[10ch] text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
            Agent-to-agent payments
          </div>
          <div className="mt-auto pt-4 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-200 bg-clip-text text-3xl font-black tracking-tight tabular-nums text-transparent md:text-4xl">
            {stats.a2a.toLocaleString("en-US")}
          </div>
        </div>
      </div>

      <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-amber-100/45">
        Live product and settlement metrics
      </p>
    </div>
  );
}
