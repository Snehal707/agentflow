import { answerProductQuestion, retrieveProductKnowledge } from '../lib/product-rag';

// Every INFO starter prompt should land on a relevant product-knowledge topic
// (so the chip gives a real answer, not a dead end). Action prompts (swap/show
// vaults/portfolio/markets) route to services, not RAG, so they're excluded here.
const infoPrompts: Array<[string, string]> = [
  ['Start here', 'What can AgentFlow do for me?'],
  ['Start here', 'How do I get started with AgentFlow?'],
  ['Start here', 'How do I add funds to my wallet?'],
  ['Start here', 'What does it cost to use AgentFlow?'],
  ['Start here', 'Can I use AgentFlow in my own language like Hindi or Spanish?'],
  ['Start here', 'What is Arc Network and how does gas work?'],
  ['Payments', 'What can I do with AgentPay?'],
  ['Payments', 'How do I send USDC to someone?'],
  ['Payments', 'How do I request a payment or create a payment link or QR code?'],
  ['Payments', 'How do invoices work on AgentFlow?'],
  ['Payments', 'How do I split a payment between multiple people?'],
  ['Payments', 'How do batch payments and payroll from CSV work?'],
  ['Payments', 'How do scheduled and recurring payments work?'],
  ['Payments', 'How do contacts and .arc handles work?'],
  ['DeFi', 'How do token swaps work on AgentFlow?'],
  ['DeFi', 'How do vaults and yield work?'],
  ['DeFi', 'How do prediction markets work?'],
  ['Bridge', 'How do I bridge USDC to Arc?'],
  ['Bridge', 'Which chains can I bridge from?'],
  ['Research & AI', 'What can the Research agent do?'],
  ['Research & AI', 'What can you do with an image I upload?'],
  ['Research & AI', 'How does voice to text work?'],
  ['Research & AI', 'Does AgentFlow remember my preferences and past chats?'],
  ['Research & AI', 'How do I use AgentFlow on Telegram?'],
  ['Agents & trust', 'What is the Agent Store?'],
  ['Agents & trust', 'How do agent reputation and ratings work?'],
  ['Agents & trust', 'What AI powers AgentFlow?'],
];

let weak = 0;
for (const [group, prompt] of infoPrompts) {
  const docs = retrieveProductKnowledge(prompt, { limit: 1, minScore: 1 });
  const top = docs[0];
  const ans = answerProductQuestion(prompt);
  const ok = Boolean(top && top.score >= 8) || Boolean(ans);
  if (!ok) weak++;
  const tag = ok ? 'ok  ' : 'WEAK';
  console.log(
    `${tag} [${group}] "${prompt.slice(0, 46)}" -> topic=${top?.id ?? 'none'} score=${top?.score ?? 0} answer=${ans ? 'yes' : 'no'}`,
  );
}
console.log(`\n${infoPrompts.length - weak}/${infoPrompts.length} info prompts have solid RAG coverage`);
process.exit(0);

export {};
