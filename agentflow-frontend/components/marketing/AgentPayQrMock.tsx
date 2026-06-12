// Static, deterministic "dummy" QR — looks like a real version-1 code (21x21)
// with the three corner finder patterns, separators, timing strips, and dense
// data modules. It is decorative only and does not encode a payload.
const QR_SIZE = 21;

function buildQrModules(): boolean[][] {
  const m: boolean[][] = Array.from({ length: QR_SIZE }, () =>
    Array.from({ length: QR_SIZE }, () => false),
  );

  const finders = [
    [0, 0],
    [0, QR_SIZE - 7],
    [QR_SIZE - 7, 0],
  ];
  const reserved = [
    [0, 0],
    [0, QR_SIZE - 8],
    [QR_SIZE - 8, 0],
  ];

  const inFinder = (r: number, c: number): boolean | null => {
    for (const [fr, fc] of finders) {
      if (r >= fr && r < fr + 7 && c >= fc && c < fc + 7) {
        const i = r - fr;
        const j = c - fc;
        const ring = i === 0 || i === 6 || j === 0 || j === 6;
        const center = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        return ring || center;
      }
    }
    return null;
  };

  const isReserved = (r: number, c: number): boolean =>
    reserved.some(([br, bc]) => r >= br && r < br + 8 && c >= bc && c < bc + 8);

  for (let r = 0; r < QR_SIZE; r++) {
    for (let c = 0; c < QR_SIZE; c++) {
      const f = inFinder(r, c);
      if (f !== null) {
        m[r][c] = f;
        continue;
      }
      if (isReserved(r, c)) {
        continue; // separator whitespace
      }
      if (r === 6 || c === 6) {
        m[r][c] = (r + c) % 2 === 0; // timing pattern
        continue;
      }
      const h = (r * 73856093) ^ (c * 19349663) ^ (r * c * 83492791);
      m[r][c] = Math.abs(h) % 100 < 50;
    }
  }
  return m;
}

const QR_MODULES = buildQrModules();

export function AgentPayQrMock() {
  return (
    <>
      <div className="rounded-2xl border border-white/[0.08] bg-white p-4 shadow-xl flex items-center justify-center">
        <div
          className="grid aspect-square w-[180px] overflow-hidden rounded-md"
          style={{ gridTemplateColumns: `repeat(${QR_SIZE}, minmax(0, 1fr))` }}
        >
          {QR_MODULES.flat().map((on, index) => (
            <div key={index} className={on ? "bg-black" : "bg-white"} />
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-black/40 p-5 font-display-sans">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#f2ca50]">
            Payment link
          </div>
          <div className="mt-2 break-all rounded-xl border border-white/[0.06] bg-black/30 p-3 font-mono text-xs text-white">
            agentflow.one/pay/jack.arc?amount=50&amp;remark=design
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="text-white/50">Amount</div>
            <div className="mt-1 font-bold text-white">50 USDC</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="text-white/50">Remark</div>
            <div className="mt-1 font-bold text-white">design</div>
          </div>
        </div>
      </div>
    </>
  );
}
