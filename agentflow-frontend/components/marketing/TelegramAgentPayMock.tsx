const MESSAGES = [
  { from: "user", text: "pay 1 USDC to jack.arc for coffee" },
  { from: "bot", text: "Send 1 USDC to jack.arc? Note: coffee. Reply YES to confirm." },
  { from: "user", text: "yes" },
  { from: "bot", text: "Payment sent on Arc. Tx: 0x7cc...91a7" },
] as const;

export function TelegramAgentPayMock() {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-[#101010] p-5 shadow-2xl">
      <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
        <div className="font-headline text-xl font-bold text-white">AgentFlow bot</div>
        <div className="rounded-full bg-green-400/10 px-3 py-1 text-xs font-semibold text-green-300">
          Linked
        </div>
      </div>

      <div className="space-y-3">
        {MESSAGES.map((message, index) => (
          <div
            key={`${message.from}-${index}`}
            className={`flex ${message.from === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                message.from === "user"
                  ? "bg-[#f2ca50] text-black"
                  : "border border-white/10 bg-white/[0.04] text-white"
              }`}
            >
              {message.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
