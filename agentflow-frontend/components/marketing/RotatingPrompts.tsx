"use client";

import { useEffect, useState } from "react";

const PROMPTS = [
  "research Bitcoin before the May 31 market",
  "swap 100 USDC to EURC and send to maya.arc",
  "split 500 USDC between my 4 designers",
  "deposit 250 USDC into the best vault",
  "show my prediction market positions",
  "pay this invoice and log it",
] as const;

export function RotatingPrompts() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % PROMPTS.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 lg:justify-start">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30">
        Try
      </span>
      <span
        key={PROMPTS[index]}
        className="animate-[heroTaglineIn_420ms_ease-out] text-sm font-medium text-white/70"
      >
        &ldquo;{PROMPTS[index]}&rdquo;
      </span>
    </div>
  );
}
