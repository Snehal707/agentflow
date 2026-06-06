"use client";

import { useEffect, useState } from "react";

const TAGLINES = [
  "settle per task on Arc.",
  "execute with wallet context.",
  "turn intent into execution.",
] as const;

export function RotatingHeroTagline() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % TAGLINES.length);
    }, 2600);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <span
      key={TAGLINES[index]}
      className="inline-block animate-[heroTaglineIn_420ms_ease-out] bg-gradient-to-r from-[#f2ca50] via-[#ffd966] to-[#f2ca50] bg-clip-text font-black italic text-transparent"
    >
      {TAGLINES[index]}
    </span>
  );
}
