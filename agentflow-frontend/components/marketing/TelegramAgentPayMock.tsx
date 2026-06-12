"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  { from: "user", text: "pay 1 USDC to jack.arc for coffee" },
  { from: "bot", text: "Send 1 USDC to jack.arc? Note: coffee. Reply YES to confirm." },
  { from: "user", text: "yes" },
  { from: "bot", text: "Payment sent on Arc. Tx: 0x7cc...91a7" },
] as const;

export function TelegramAgentPayMock() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const runSequence = () => {
      if (cancelled) return;
      setVisibleCount(0);
      setIsTyping(false);

      // 1. Show user first message after 800ms
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setVisibleCount(1);
          // Start bot typing for second message
          setIsTyping(true);
        }, 800)
      );

      // 2. Show bot message after 2200ms
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setIsTyping(false);
          setVisibleCount(2);
        }, 2200)
      );

      // 3. Show user yes reply after 3600ms
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setVisibleCount(3);
          // Start bot typing for fourth message
          setIsTyping(true);
        }, 3600)
      );

      // 4. Show bot receipt after 5000ms
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setIsTyping(false);
          setVisibleCount(4);
        }, 5000)
      );

      // 5. Restart loop after 10000ms
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          runSequence();
        }, 11000)
      );
    };

    runSequence();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="rounded-[2rem] border border-white/[0.08] bg-[#0d0d0d]/80 backdrop-blur-md p-5 shadow-2xl font-display-sans transition-all duration-300 hover:border-[#f2ca50]/20 hover:shadow-[0_8px_32px_rgba(242,202,80,0.05)]">
      <style>{`
        @keyframes afTgPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
        .af-tg-dot { animation: afTgPulse 1.4s infinite both; }
        .af-tg-dot:nth-child(2) { animation-delay: 0.2s; }
        .af-tg-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>

      <div className="mb-5 flex items-center justify-between border-b border-white/[0.06] pb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <div className="text-base font-bold text-white tracking-tight">AgentFlow Telegram Bot</div>
        </div>
        <div className="rounded-full bg-blue-500/10 px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-blue-400 border border-blue-500/20">
          Connected
        </div>
      </div>

      <div className="space-y-3.5 min-h-[195px] flex flex-col justify-end">
        {MESSAGES.slice(0, visibleCount).map((message, index) => (
          <div
            key={`${message.from}-${index}`}
            className={`flex ${message.from === "user" ? "justify-end" : "justify-start"} af-rise`}
          >
            <div
              className={`max-w-[82%] rounded-[1.25rem] px-4 py-2.5 text-xs leading-relaxed shadow-sm transition-all duration-300 ${
                message.from === "user"
                  ? "bg-gradient-to-r from-amber-400 to-[#f2ca50] text-black font-semibold rounded-tr-sm"
                  : "border border-white/[0.06] bg-white/[0.03] text-white/90 rounded-tl-sm"
              }`}
            >
              {message.text}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start af-rise">
            <div className="flex items-center gap-1.5 border border-white/[0.06] bg-white/[0.03] rounded-[1.25rem] rounded-tl-sm px-4.5 py-3.5 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-white/60 af-tg-dot" />
              <span className="h-1.5 w-1.5 rounded-full bg-white/60 af-tg-dot" />
              <span className="h-1.5 w-1.5 rounded-full bg-white/60 af-tg-dot" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

