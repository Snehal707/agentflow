const BASE = (process.env.AGENTFLOW_API_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const WALLET =
  process.env.TEST_WALLET_ADDRESS || '0xb82AE74138acdcd2045b66984990EED0559Ec769';

type Case = {
  message: string;
  expected: RegExp;
  forbidden: RegExp;
};

const cases: Case[] = [
  {
    message: 'show prediction market',
    expected: /Prediction markets on AchMarket/i,
    forbidden: /Your prediction market positions/i,
  },
  {
    message: 'show prediction market positions',
    expected: /Your prediction market positions/i,
    forbidden: /Prediction markets on AchMarket/i,
  },
  {
    message: 'show my predictions',
    expected: /Your prediction market positions/i,
    forbidden: /Prediction markets on AchMarket/i,
  },
  {
    message: 'show my positions',
    expected: /Portfolio|Wallet tokens|Prediction market positions/i,
    forbidden: /Your vault positions|Yield vaults/i,
  },
  {
    message: 'show vault positions',
    expected: /vault positions|No vault positions|Your vault positions/i,
    forbidden: /Prediction market/i,
  },
  {
    message: 'show vaults',
    expected: /Yield vaults|vault options/i,
    forbidden: /Portfolio|prediction market positions/i,
  },
  {
    message: 'show scheduled payments',
    expected: /scheduled|payment|schedule/i,
    forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i,
  },
  {
    message: 'show payment link',
    expected: /payment link|recipient|jack\.arc/i,
    forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i,
  },
  {
    message: 'check gas on base sepolia',
    expected: /bridge|Base|gas|USDC|source/i,
    forbidden: /Portfolio|Prediction market positions|vault positions/i,
  },
  {
    message: 'how to check portfolio?',
    expected: /do you want me to run the portfolio check now/i,
    forbidden: /Wallet tokens|Gateway reserve|Prediction market positions/i,
  },
  {
    message: 'is this my portfolio',
    expected: /do you want me to run the portfolio check now/i,
    forbidden: /Wallet tokens|Gateway reserve|Prediction market positions/i,
  },
];

function parseSseDeltas(raw: string): string {
  let text = '';
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    const parsed = JSON.parse(payload) as {
      delta?: unknown;
      markdown?: unknown;
      error?: unknown;
    };
    if (typeof parsed.delta === 'string') text += parsed.delta;
    if (typeof parsed.markdown === 'string' && !text.trim()) text = parsed.markdown;
    if (typeof parsed.error === 'string') text += ` ERROR:${parsed.error}`;
  }
  return text;
}

async function chat(message: string, index: number): Promise<{ status: number; text: string }> {
  const response = await fetch(`${BASE}/api/chat/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': `chat-fastpath-regression-${Date.now()}-${index}`,
    },
    body: JSON.stringify({
      message,
      rawUserMessage: message,
      messages: [{ role: 'user', content: message }],
      walletAddress: WALLET,
      executionTarget: 'DCW',
    }),
  });
  return {
    status: response.status,
    text: parseSseDeltas(await response.text()),
  };
}

async function main(): Promise<void> {
  let failures = 0;
  for (const [index, testCase] of cases.entries()) {
    const result = await chat(testCase.message, index);
    const pass =
      result.status === 200 &&
      testCase.expected.test(result.text) &&
      !testCase.forbidden.test(result.text);
    if (!pass) failures += 1;
    console.log(
      JSON.stringify({
        message: testCase.message,
        status: result.status,
        pass,
        preview: result.text.slice(0, 180).replace(/\s+/g, ' '),
      }),
    );
  }
  if (failures > 0) {
    throw new Error(`${failures} fast-path regression case(s) failed`);
  }
}

main().catch((error) => {
  console.error('[test:chat-fastpath-regressions] failed:', error);
  process.exit(1);
});

export {};
