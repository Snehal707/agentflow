const STEPS = [
  "Link Telegram",
  "Ask from mobile",
  "Confirm guarded actions",
  "Return to web history",
] as const;

export function TelegramContinuityShowcase() {
  return (
    <div className="grid gap-5 md:grid-cols-4">
      {STEPS.map((step, index) => (
        <div
          key={step}
          className="rounded-3xl border border-white/10 bg-[#111111] p-6 text-center transition-colors hover:border-[#f2ca50]/35"
        >
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 font-mono text-xs font-bold text-[#f2ca50]">
            {String(index + 1).padStart(2, "0")}
          </div>
          <div className="font-semibold text-white">{step}</div>
          <p className="mt-3 text-sm leading-relaxed text-[#a3a3a3]">
            {index === 0
              ? "Connect once from settings."
              : index === 1
                ? "Continue flows through the bot."
                : index === 2
                  ? "Approve money movement explicitly."
                  : "Receipts stay visible in AgentFlow."}
          </p>
        </div>
      ))}
    </div>
  );
}
