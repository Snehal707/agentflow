"use client";

import { useEffect, useState } from "react";
import { BorderBeam } from "./BorderBeam";

const QUERY = "Swap 50 USDC to EURC, then send it to maya.arc";

export function HeroChatMock() {
  // Looping staged sequence: type query -> send -> preview -> settle -> reset.
  const [typed, setTyped] = useState("");
  const [stage, setStage] = useState(0); // 0 typing, 1 user msg, 2 preview, 3 settled

  useEffect(() => {
    if (typeof window !== "undefined") {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (reduce) {
        setTyped(QUERY);
        setStage(3);
        return;
      }
    }

    let timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      setTyped("");
      setStage(0);

      // typewriter
      QUERY.split("").forEach((_, i) => {
        timers.push(
          setTimeout(() => !cancelled && setTyped(QUERY.slice(0, i + 1)), 40 * (i + 1)),
        );
      });
      const typeDone = 40 * QUERY.length + 250;
      timers.push(setTimeout(() => !cancelled && setStage(1), typeDone));
      timers.push(setTimeout(() => !cancelled && setStage(2), typeDone + 700));
      timers.push(setTimeout(() => !cancelled && setStage(3), typeDone + 1700));
      // restart the loop
      timers.push(setTimeout(run, typeDone + 6500));
    };

    run();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="relative">
      <style>{`
        @keyframes afRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes afBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        .af-rise { animation: afRise .5s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .af-caret { animation: afBlink 1s step-end infinite; }
      `}</style>

      <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-[#f2ca50]/10 blur-[80px] opacity-70 animate-pulse" />
      <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[#0d0d0d]/80 backdrop-blur-md shadow-2xl transition-all duration-300 hover:border-[#f2ca50]/20 hover:shadow-[0_8px_32px_rgba(242,202,80,0.05)]">
        <BorderBeam size={100} duration={8} />
        {/* window chrome */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5 font-display-sans">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f2ca50]/15 text-[10px] font-black text-[#f2ca50]">
              AF
            </span>
            <span className="text-sm font-semibold text-white tracking-tight">AgentFlow</span>
            <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Live
            </span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
            Arc Testnet
          </span>
        </div>

        <div className="flex min-h-[330px] flex-col justify-end gap-4 p-5 font-display-sans">
          {/* user message */}
          {stage >= 1 ? (
            <div className="af-rise flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-gradient-to-r from-amber-400/20 to-amber-500/10 border border-amber-400/20 px-4 py-2.5 text-sm text-white shadow-lg">
                {QUERY}
              </div>
            </div>
          ) : null}

          {/* agent action card */}
          {stage >= 2 ? (
            <div className="af-rise flex justify-start">
              <div className="w-full max-w-[92%] rounded-2xl rounded-tl-sm border border-white/[0.06] bg-neutral-900/60 backdrop-blur-sm p-4 shadow-lg">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#f2ca50]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#f2ca50] animate-ping" />
                  Swap Agent · preview
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-white/55">Route</span>
                    <span className="font-medium text-white">50 USDC → ~50.07 EURC</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/55">Slippage</span>
                    <span className="font-medium text-white">0.3% · guarded</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/55">Then send to</span>
                    <span className="font-mono text-[11px] font-medium text-[#f2ca50]">maya.arc</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* settled receipt */}
          {stage >= 3 ? (
            <div className="af-rise flex justify-start">
              <div className="flex w-full max-w-[92%] items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] px-4 py-3 shadow-lg">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white">Swapped &amp; sent to maya.arc</div>
                  <div className="truncate font-mono text-[9px] text-white/40">
                    tx 0x7b70…42bdd · settled in 2.1s
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#f2ca50]">
                  $0.01 x402
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* composer */}
        <div className="border-t border-white/[0.06] px-5 py-3.5 font-display-sans">
          <div className="flex items-center gap-3 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 focus-within:border-amber-400/30 transition-all duration-300">
            <span className="truncate text-xs text-white/80">
              {typed || <span className="text-white/30">Ask AgentFlow anything…</span>}
              {stage === 0 ? <span className="af-caret ml-0.5 text-[#f2ca50]">|</span> : null}
            </span>
            <span className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f2ca50] text-black shadow-md hover:bg-yellow-400 cursor-pointer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
