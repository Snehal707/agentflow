"use client";

import { useState } from "react";

export function PredictionMarketMock() {
  const [active, setActive] = useState<"Yes" | "No">("Yes");

  const yesProb = active === "Yes" ? 62 : 38;
  const noProb = active === "Yes" ? 38 : 62;

  const previewRows = active === "Yes" 
    ? [
        { label: "You'll receive", value: "~7.8 Yes shares" },
        { label: "Implied probability", value: "62%" },
        { label: "Max cost (1% slippage)", value: "$5.04" },
      ]
    : [
        { label: "You'll receive", value: "~13.2 No shares" },
        { label: "Implied probability", value: "62%" },
        { label: "Max cost (1% slippage)", value: "$5.02" },
      ];

  return (
    <div className="rounded-[2rem] border border-white/[0.08] bg-[#0d0d0d]/80 backdrop-blur-md p-6 shadow-2xl md:p-7 font-display-sans transition-all duration-300 hover:border-[#f2ca50]/20 hover:shadow-[0_8px_32px_rgba(242,202,80,0.05)]">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-white/[0.06] pb-5">
        <div>
          <div className="text-base font-bold leading-snug text-white tracking-tight">
            Will Bitcoin reach $85,000 before May 31?
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">
            AchMarket · Testnet · LMSR
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-400">
          Live
        </span>
      </div>

      <div className="space-y-4">
        {/* Yes Outcome */}
        <div 
          onClick={() => setActive("Yes")}
          className="space-y-1.5 cursor-pointer group/item"
        >
          <div className="flex items-center justify-between text-xs">
            <span className={active === "Yes" ? "font-bold text-white transition-colors" : "text-white/55 transition-colors group-hover/item:text-white"}>
              Yes
            </span>
            <span className={`font-mono text-xs font-semibold transition-all duration-300 ${active === "Yes" ? "text-[#f2ca50] drop-shadow-[0_0_8px_rgba(242,202,80,0.3)]" : "text-white/45"}`}>
              {yesProb}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                active === "Yes" 
                  ? "bg-gradient-to-r from-amber-400 to-[#f2ca50] shadow-[0_0_12px_rgba(242,202,80,0.5)]" 
                  : "bg-white/10"
              }`}
              style={{ width: `${yesProb}%` }}
            />
          </div>
        </div>

        {/* No Outcome */}
        <div 
          onClick={() => setActive("No")}
          className="space-y-1.5 cursor-pointer group/item"
        >
          <div className="flex items-center justify-between text-xs">
            <span className={active === "No" ? "font-bold text-white transition-colors" : "text-white/55 transition-colors group-hover/item:text-white"}>
              No
            </span>
            <span className={`font-mono text-xs font-semibold transition-all duration-300 ${active === "No" ? "text-[#f2ca50] drop-shadow-[0_0_8px_rgba(242,202,80,0.3)]" : "text-white/45"}`}>
              {noProb}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                active === "No" 
                  ? "bg-gradient-to-r from-amber-400 to-[#f2ca50] shadow-[0_0_12px_rgba(242,202,80,0.5)]" 
                  : "bg-white/10"
              }`}
              style={{ width: `${noProb}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2.5">
        <button
          onClick={() => setActive("Yes")}
          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all duration-300 ${
            active === "Yes"
              ? "bg-[#f2ca50] text-black shadow-[0_0_12px_rgba(242,202,80,0.15)]"
              : "border border-white/10 bg-white/[0.02] text-white/75 hover:bg-white/[0.05]"
          }`}
        >
          YES
        </button>
        <button
          onClick={() => setActive("No")}
          className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all duration-300 ${
            active === "No"
              ? "bg-[#f2ca50] text-black shadow-[0_0_12px_rgba(242,202,80,0.15)]"
              : "border border-white/10 bg-white/[0.02] text-white/75 hover:bg-white/[0.05]"
          }`}
        >
          NO
        </button>
      </div>

      <div className="mt-5 rounded-[1.25rem] border border-white/[0.06] bg-black/40 p-5 transition-all duration-300">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-bold text-white transition-colors">Bet $5 on {active}</div>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#f2ca50]/80">
            Preview
          </span>
        </div>
        <div className="space-y-2.5">
          {previewRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between text-xs">
              <span className="text-white/50">{row.label}</span>
              <span className="font-medium text-white transition-colors duration-300">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[9px] text-white/45">
        <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 hover:border-white/20 transition-colors cursor-pointer">Buy</span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 hover:border-white/20 transition-colors cursor-pointer">Sell</span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 hover:border-white/20 transition-colors cursor-pointer">Redeem</span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 hover:border-white/20 transition-colors cursor-pointer">Refund</span>
        <span className="ml-auto rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-3 py-1 font-bold text-[#f2ca50]">
          Settled on Arc
        </span>
      </div>
    </div>
  );
}

