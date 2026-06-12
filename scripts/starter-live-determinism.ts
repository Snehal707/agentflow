// Live determinism sweep: run every INFO starter prompt N times against the real
// /api/chat/respond and flag any run that returns a "bad" follow-up — the LLM
// balance/portfolio fallback, a history dump, a clarification bounce, or a
// hallucinated "not supported". A chip passes only if ALL runs are clean.

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:4000';
const WALLET = '0xb82ae74138acdcd2045b66984990eed0559ec769';
const RUNS = Number(process.env.RUNS || 2);

// Exact prompt strings sent by the info chips (action chips excluded).
const infoPrompts: string[] = [
  'What can AgentFlow do for me?',
  'How do I get started with AgentFlow?',
  'Explain how funding and Gateway work',
  'What does AgentFlow cost per task?',
  'Explain what languages AgentFlow supports',
  'What is Arc Network and how does gas work?',
  'Explain AgentPay and its features',
  'Explain how sending USDC works on AgentFlow',
  'Explain payment requests, links and QR codes on AgentFlow',
  'Explain how invoices work on AgentFlow',
  'Explain how splitting a bill works on AgentFlow',
  'Explain how batch payments and payroll work',
  'Explain how scheduled and recurring payments work',
  'Explain how contacts and .arc handles work',
  'Explain how token swaps work on AgentFlow',
  'Explain how vaults and yield work on AgentFlow',
  'Explain how prediction markets work on AgentFlow',
  'Explain how bridging USDC to Arc works',
  'Which chains can I bridge from?',
  'What can the Research agent do?',
  'What can you do with an image I upload?',
  'Explain how voice to text works on AgentFlow',
  'Explain how AgentFlow remembers my preferences and past chats',
  'Explain how to use AgentFlow on Telegram',
  'What is the Agent Store?',
  'Explain how agent reputation and ratings work',
  'What AI powers AgentFlow?',
];

const BAD = [
  /can't verify live balances or market state/i,
  /Showing your latest \d+ AgentPay records/i,
  /What do you mean by/i,
  /How much do you want to send/i,
  /aren't wired up/i,
  /aren't yet fully wired/i,
  /doesn't yet support/i,
  /I refreshed the live state for this turn/i,
];

async function once(prompt: string): Promise<string> {
  const res = await fetch(`${BACKEND}/api/chat/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-id': `det-${Date.now()}-${Math.random()}` },
    body: JSON.stringify({
      message: prompt, rawUserMessage: prompt,
      messages: [{ role: 'user', content: prompt }],
      walletAddress: WALLET, executionTarget: 'EOA', browserTimeZone: 'UTC', browserLocale: 'en-US',
    }),
  });
  if (!res.ok || !res.body) return `__HTTP_${res.status}__`;
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '', text = '';
  const handle = (line: string) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const raw = t.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    try { const r = JSON.parse(raw); if (typeof r.delta === 'string') text += r.delta; } catch {}
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) !== -1) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  if (buf) handle(buf);
  return text;
}

async function main() {
  let failed = 0;
  for (const prompt of infoPrompts) {
    let bad = '';
    for (let r = 0; r < RUNS; r++) {
      const txt = await once(prompt);
      const hit = BAD.find((re) => re.test(txt));
      if (hit) { bad = txt.slice(0, 70); break; }
    }
    if (bad) { failed++; console.log(`FAIL "${prompt.slice(0, 52)}" -> ${bad}`); }
    else console.log(`ok   "${prompt.slice(0, 52)}"`);
  }
  console.log(`\n${infoPrompts.length - failed}/${infoPrompts.length} info chips clean across ${RUNS} runs each`);
}

main();

export {};
