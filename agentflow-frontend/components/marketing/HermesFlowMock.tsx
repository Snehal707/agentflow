const FLOW = [
  { role: "User", text: "Research BTC, explain portfolio impact, then prepare a swap." },
  { role: "Hermes", text: "Classified: research + portfolio + swap preview." },
  { role: "AgentFlow", text: "Routing to Research, Portfolio, and Swap agents with guardrails." },
] as const;

export function HermesFlowMock() {
  return (
    <div className="relative rounded-[2rem] border border-white/10 bg-[#101010] p-5 shadow-2xl md:p-6">
      <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <div className="font-headline text-2xl font-bold text-white">Hermes routing trace</div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/40">
            Natural language to agent graph
          </div>
        </div>
        <div className="rounded-full border border-green-400/20 bg-green-400/10 px-3 py-1 text-xs font-semibold text-green-300">
          Live
        </div>
      </div>

      <div className="space-y-4">
        {FLOW.map((item, index) => (
          <div key={item.role} className="flex gap-3">
            <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#f2ca50]/25 bg-[#f2ca50]/10 font-mono text-[10px] text-[#f2ca50]">
              {index + 1}
            </div>
            <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#f2ca50]">
                {item.role}
              </div>
              <div className="text-sm leading-relaxed text-[#d7d7d7]">{item.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
