"use client";

import { useEffect, useState } from "react";

export function AnimatedExecutionStates({ states }: { states: readonly string[] }) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (states.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % states.length);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [states.length]);

  return (
    <div className="space-y-3">
      {states.map((state, index) => {
        const isActive = index === activeIndex;
        const isComplete = index < activeIndex;

        return (
          <div
            key={state}
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 transition-all duration-300 ${
              isActive
                ? "border-[#f2ca50]/50 bg-[#f2ca50]/12 text-white shadow-[0_0_24px_rgba(242,202,80,0.12)]"
                : isComplete
                  ? "border-green-400/20 bg-green-400/5 text-[#d8f9df]"
                  : "border-white/10 bg-white/[0.03] text-[#a3a3a3]"
            }`}
          >
            <span className="font-mono text-xs uppercase tracking-[0.18em]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-sm font-semibold">{state}</span>
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isActive ? "bg-[#f2ca50]" : isComplete ? "bg-green-400" : "bg-white/20"
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}
