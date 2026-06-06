export function AgentPayQrMock() {
  return (
    <>
      <div className="rounded-3xl border border-white/10 bg-white p-4">
        <div className="grid aspect-square grid-cols-7 gap-1">
          {Array.from({ length: 49 }).map((_, index) => {
            const filled =
              index < 7 ||
              index % 7 === 0 ||
              index % 7 === 6 ||
              index > 41 ||
              [10, 11, 15, 17, 19, 23, 24, 27, 31, 32, 36, 38].includes(index);
            return (
              <div
                key={index}
                className={filled ? "rounded-sm bg-black" : "rounded-sm bg-transparent"}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f2ca50]">
            Payment link
          </div>
          <div className="mt-2 break-all rounded-2xl border border-white/10 bg-black/30 p-3 font-mono text-xs text-white">
            agentflow.one/pay/jack.arc?amount=50&amp;remark=design
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[#a3a3a3]">Amount</div>
            <div className="mt-1 font-bold text-white">50 USDC</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[#a3a3a3]">Remark</div>
            <div className="mt-1 font-bold text-white">design</div>
          </div>
        </div>
      </div>
    </>
  );
}
