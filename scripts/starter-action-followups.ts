// Live click-test: drive each ACTION starter chip's exact prompt through the
// real backend /api/chat/respond SSE stream and report what follow-up affordance
// comes back (confirmation button / quick-action groups / payment card / text).
// Execute steps need a browser wallet signature and can't run headlessly — this
// verifies the FIRST follow-up (the preview/list/confirm the chip lands on).

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:4000';
const TEST_WALLET = '0xb82ae74138acdcd2045b66984990eed0559ec769';

type Probe = { label: string; tab: string; prompt: string };
const actionChips: Probe[] = [
  { label: 'Try a swap', tab: 'Swap', prompt: 'Swap 1 USDC to EURC.' },
  { label: 'Show vaults', tab: 'Vault', prompt: 'Show available vaults.' },
  { label: 'Show markets', tab: 'AgentPay', prompt: 'Show prediction markets.' },
  { label: 'My portfolio', tab: 'Portfolio', prompt: 'Show my portfolio.' },
];

async function probe(p: Probe) {
  const res = await fetch(`${BACKEND}/api/chat/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-id': `test-${Date.now()}` },
    body: JSON.stringify({
      message: p.prompt,
      rawUserMessage: p.prompt,
      messages: [{ role: 'user', content: p.prompt }],
      walletAddress: TEST_WALLET,
      executionTarget: 'EOA',
      browserTimeZone: 'UTC',
      browserLocale: 'en-US',
    }),
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    console.log(`FAIL [${p.label}] HTTP ${res.status} ${t.slice(0, 120)}`);
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  let deltaLen = 0;
  let title = '';
  const affordances = new Set<string>();
  let errored = '';

  const handle = (line: string) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const raw = t.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    let rec: any;
    try { rec = JSON.parse(raw); } catch { return; }
    if (rec.type === 'report') affordances.add('report');
    if (typeof rec.delta === 'string') deltaLen += rec.delta.length;
    if (rec.error) errored = String(rec.error).slice(0, 140);
    const m = rec.meta;
    if (m) {
      if (m.title) title = m.title;
      if (m.confirmation?.action) affordances.add(`confirm:${m.confirmation.action}`);
      if (Array.isArray(m.quickActionGroups) && m.quickActionGroups.length) {
        const n = m.quickActionGroups.reduce((a: number, g: any) => a + (g.actions?.length || 0), 0);
        affordances.add(`quickActions:${n}`);
      }
      if (m.paymentMeta?.entries?.length) affordances.add(`payment:${m.paymentMeta.entries.length}`);
      if (m.paymentLink) affordances.add('paymentLink');
      if (m.reportMeta?.kind) affordances.add(`reportMeta:${m.reportMeta.kind}`);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      handle(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  }
  if (buf) handle(buf);

  const aff = affordances.size ? [...affordances].join(', ') : 'none';
  const tag = errored ? 'ERR ' : 'ok  ';
  console.log(
    `${tag} [${p.label}] tab=${p.tab} title="${title}" text=${deltaLen}ch followups={${aff}}` +
      (errored ? ` error="${errored}"` : ''),
  );
}

async function main() {
  console.log(`Backend: ${BACKEND}\n`);
  for (const chip of actionChips) {
    try {
      await probe(chip);
    } catch (e) {
      console.log(`THROW [${chip.label}] ${(e as Error).message.slice(0, 140)}`);
    }
  }
}

main();

export {};
