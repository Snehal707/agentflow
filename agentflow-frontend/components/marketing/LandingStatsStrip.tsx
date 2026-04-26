"use client";

import { useEffect, useState } from "react";

type StatsPayload = {
  total_transactions?: number;
  onchain_transactions?: number;
};

export function LandingStatsStrip() {
  const [stats, setStats] = useState({ total: 0, onchain: 0 });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: StatsPayload) => {
        if (cancelled) return;
        setStats({
          total: typeof data.total_transactions === "number" ? data.total_transactions : 0,
          onchain:
            typeof data.onchain_transactions === "number" ? data.onchain_transactions : 0,
        });
      })
      .catch(() => {
        if (!cancelled) setStats({ total: 0, onchain: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid gap-4 border-y border-[#4d4635]/20 py-6 sm:grid-cols-3 sm:gap-8">
      <div>
        <div className="font-label text-[10px] uppercase tracking-[0.2em] text-[#d0c5af]/48">
          Onchain proof
        </div>
        <div className="mt-2 font-headline text-3xl font-bold text-[#f2ca50] md:text-4xl">
          {stats.onchain.toLocaleString("en-US")}+
        </div>
        <div className="mt-1 text-xs text-[#d0c5af]/60">Completed Arc records</div>
      </div>
      <div>
        <div className="font-label text-[10px] uppercase tracking-[0.2em] text-[#d0c5af]/48">
          Settlement rail
        </div>
        <div className="mt-2 font-headline text-3xl font-bold text-[#f2ca50] md:text-4xl">
          Arc + USDC
        </div>
        <div className="mt-1 text-xs text-[#d0c5af]/60">USDC-native agent work</div>
      </div>
      <div>
        <div className="font-label text-[10px] uppercase tracking-[0.2em] text-[#d0c5af]/48">
          x402 activity
        </div>
        <div className="mt-2 font-headline text-3xl font-bold text-[#f2ca50] md:text-4xl">
          {stats.total > 0 ? stats.total.toLocaleString("en-US") : "Live"}
        </div>
        <div className="mt-1 text-xs text-[#d0c5af]/60">Per-task buyer and seller traces</div>
      </div>
    </div>
  );
}
