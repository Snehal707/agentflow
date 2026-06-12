import { classifyIntent } from '../lib/intent-router/index';

// All INFO starter prompts (from starter-rag-coverage.ts) plus common help phrasings
// that previously got hijacked by the heuristic layer. None of these should land
// on an executable action intent — general.chat is the safe outcome; bridge.precheck
// is acceptable for capability checks like "which chains can I bridge from".
const prompts: string[] = [
  'What can AgentFlow do for me?',
  'How do I get started with AgentFlow?',
  'How do I add funds to my wallet?',
  'What does it cost to use AgentFlow?',
  'Can I use AgentFlow in my own language like Hindi or Spanish?',
  'What is Arc Network and how does gas work?',
  'What can I do with AgentPay?',
  'How do I send USDC to someone?',
  'How do I request a payment or create a payment link or QR code?',
  'How do invoices work on AgentFlow?',
  'How do I split a payment between multiple people?',
  'How do batch payments and payroll from CSV work?',
  'How do scheduled and recurring payments work?',
  'How do contacts and .arc handles work?',
  'How do token swaps work on AgentFlow?',
  'How do vaults and yield work?',
  'How do prediction markets work?',
  'How do I bridge USDC to Arc?',
  'Which chains can I bridge from?',
  'What can the Research agent do?',
  'What can you do with an image I upload?',
  'How does voice to text work?',
  'Does AgentFlow remember my preferences and past chats?',
  'How do I use AgentFlow on Telegram?',
  'What is the Agent Store?',
  'How do agent reputation and ratings work?',
  'What AI powers AgentFlow?',
  // previously-hijacked phrasings
  'what happens when I pay someone?',
  'does sending money cost gas?',
  'is it safe to transfer money here?',
  'what happens if a payment fails?',
  'can I cancel a scheduled payment?',
  'do payments work on weekends?',
];

const EXECUTABLE = new Set([
  'agentpay.send', 'agentpay.request', 'agentpay.payment_link',
  'swap.execute', 'bridge.execute', 'vault.deposit', 'vault.withdraw',
  'predmarket.buy', 'predmarket.sell', 'predmarket.redeem', 'predmarket.refund',
  'schedule.create', 'schedule.cancel', 'split.execute', 'batch.execute',
  'invoice.create', 'treasury.topup',
]);

async function main() {
  let hijacked = 0;
  for (const msg of prompts) {
    const r = await classifyIntent(msg);
    const bad = EXECUTABLE.has(r.intent);
    if (bad) hijacked += 1;
    console.log(`${bad ? 'HIJACK' : 'ok    '} | ${r.intent.padEnd(22)} | ${(r as any).source.padEnd(10)} | ${msg}`);
  }
  console.log(`\n${hijacked} of ${prompts.length} product questions routed to an executable action`);
  if (hijacked > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
