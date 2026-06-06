import '../lib/loadEnv';
import { randomUUID } from 'node:crypto';
import {
  rememberSemanticMemory,
  retrieveSemanticMemories,
  type SemanticMemoryRow,
} from '../lib/semantic-memory';

type Scenario = {
  id: string;
  query: string;
  expectedType: string;
  expectedCategoryIncludes?: string;
  expectedContentIncludes?: string;
};

function short(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

async function seedWallet(wallet: string, sessionId: string): Promise<void> {
  const seeds: SemanticMemoryRow[] = [
    {
      wallet_address: wallet,
      memory_type: 'profile',
      category: 'display_name',
      content: 'Saved display name: Pratik',
      confidence: 0.99,
    },
    {
      wallet_address: wallet,
      memory_type: 'profile',
      category: 'preference:reply_style',
      content: 'User preference for reply_style: short direct answers',
      confidence: 0.95,
    },
    {
      wallet_address: wallet,
      session_id: sessionId,
      memory_type: 'routing_example',
      category: 'telegram_user_correction',
      content:
        'Telegram user correction or policy guidance: Telegram should not support prediction markets and should use DCW balance by default.',
      confidence: 0.88,
    },
    {
      wallet_address: wallet,
      session_id: sessionId,
      memory_type: 'episodic',
      category: 'portfolio_context',
      content:
        'Earlier in this thread, the user asked: show my portfolio | AgentFlow replied: USDC: 656.31 | EURC: 39.16 | Positions: 1 | Value: 1.00',
      confidence: 0.76,
    },
    {
      wallet_address: wallet,
      session_id: sessionId,
      memory_type: 'episodic',
      category: 'research_context',
      content:
        'Earlier in this thread, the user asked: research arc stablecoin launch | AgentFlow replied: generated a research report about Arc ecosystem stablecoin launch risks and timing.',
      confidence: 0.74,
    },
  ];

  for (const seed of seeds) {
    await rememberSemanticMemory(seed);
  }
}

const scenarios: Scenario[] = [
  {
    id: 'name_recall',
    query: 'do you remember my name?',
    expectedType: 'profile',
    expectedCategoryIncludes: 'display_name',
    expectedContentIncludes: 'Pratik',
  },
  {
    id: 'style_preference_recall',
    query: 'how should you answer me?',
    expectedType: 'profile',
    expectedCategoryIncludes: 'reply_style',
    expectedContentIncludes: 'short direct answers',
  },
  {
    id: 'telegram_policy_recall',
    query: 'what do you remember about telegram policy?',
    expectedType: 'routing_example',
    expectedCategoryIncludes: 'telegram',
    expectedContentIncludes: 'not support prediction markets',
  },
  {
    id: 'portfolio_context_recall',
    query: 'what were we talking about in my portfolio?',
    expectedType: 'episodic',
    expectedCategoryIncludes: 'portfolio',
    expectedContentIncludes: 'show my portfolio',
  },
  {
    id: 'research_context_recall',
    query: 'what research did we do before?',
    expectedType: 'episodic',
    expectedCategoryIncludes: 'research',
    expectedContentIncludes: 'research arc stablecoin launch',
  },
];

async function main(): Promise<void> {
  const wallet = `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`.padEnd(42, '1').slice(0, 42);
  const sessionId = `memory-eval-${randomUUID()}`;
  await seedWallet(wallet, sessionId);

  const results = [];
  for (const scenario of scenarios) {
    const retrieved = await retrieveSemanticMemories({
      walletAddress: wallet as `0x${string}`,
      sessionId,
      query: scenario.query,
      limit: 3,
    });
    const top = retrieved[0];
    const passed =
      Boolean(top) &&
      top.memory_type === scenario.expectedType &&
      (!scenario.expectedCategoryIncludes ||
        (top.category ?? '').toLowerCase().includes(scenario.expectedCategoryIncludes.toLowerCase())) &&
      (!scenario.expectedContentIncludes ||
        top.content.toLowerCase().includes(scenario.expectedContentIncludes.toLowerCase()));

    results.push({
      id: scenario.id,
      passed,
      topType: top?.memory_type ?? null,
      topCategory: top?.category ?? null,
      topContentPreview: top ? short(top.content) : null,
    });
  }

  const passed = results.filter((item) => item.passed).length;
  const total = results.length;
  console.log(JSON.stringify({ wallet, sessionId, passed, total, results }, null, 2));
  if (passed !== total) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
