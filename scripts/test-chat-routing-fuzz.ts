const BASE = (process.env.AGENTFLOW_API_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const WALLET =
  process.env.TEST_WALLET_ADDRESS || '0xb82AE74138acdcd2045b66984990EED0559Ec769';

type FuzzCase = {
  category: string;
  message: string;
  expected: RegExp;
  forbidden: RegExp;
};

const predmarketListExpected = /Prediction markets on AchMarket|No prediction markets available/i;
const predmarketClarifyExpected = /What would you like to do with prediction markets/i;
const predmarketPositionExpected =
  /Your prediction market positions|don't have any prediction market positions/i;
const portfolioExpected = /Portfolio|Wallet tokens|Gateway reserve|Total marked value/i;
const balanceExpected = /Wallet tokens|Gateway balance|Connected wallet|Execution wallet|USDC|EURC/i;
const vaultListExpected = /Yield vaults|vault options|No vault options/i;
const vaultPositionExpected = /vault positions|No vault positions|Your vault positions/i;
const bridgeExpected = /bridge|source chains|Base Sepolia|Ethereum Sepolia|USDC|gas/i;
const paymentExpected = /AgentPay|payment|recipient|amount|USDC|history|records|payment link/i;
const scheduleExpected = /scheduled|recurring|schedule|payment|amount is required|how much USDC/i;
const invoiceExpected = /invoice|Invoice|recipient|amount|status/i;
const splitExpected = /split|recipients|alice|bob|registered on AgentPay|confirm/i;
const batchExpected = /batch|recipients|alice|bob|registered on AgentPay|confirm/i;
const productExpected = /AgentFlow|DeFi|payments on Arc|swap|bridge|AgentPay|voice/i;

const notPosition = /Your prediction market positions/i;
const notMarketList = /Prediction markets on AchMarket/i;
const notPortfolio = /Portfolio|Wallet tokens|Gateway reserve/i;
const notVault = /Your vault positions|Yield vaults/i;
const notPredOrVault = /Prediction markets on AchMarket|Your prediction market positions|Your vault positions|Yield vaults/i;

const cases: FuzzCase[] = [
  // Prediction market browsing: singular/plural/natural variants must list markets, not user positions.
  { category: 'predmarket.list', message: 'show prediction market', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'show prediction markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'list prediction market', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'list prediction markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'browse prediction market', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'browse prediction markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.clarify', message: 'prediction market', expected: predmarketClarifyExpected, forbidden: notPosition },
  { category: 'predmarket.clarify', message: 'prediction markets', expected: predmarketClarifyExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'show market', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'show markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'what markets are available', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'what prediction markets are live right now', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'show all markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'list all markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'browse all markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'show crypto markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'show sports markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'show politics markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'show entertainment markets', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'what can i bet on', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'markets i can bet on', expected: predmarketListExpected, forbidden: notPosition },
  { category: 'predmarket.list', message: 'available bets', expected: predmarketListExpected, forbidden: notPosition },

  // Prediction market positions: ownership phrasing must show positions, not browse list.
  { category: 'predmarket.position', message: 'show prediction market positions', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'show my prediction market positions', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'and what are my prediction market position', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'what are my prediction market positions', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'show my market positions', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'show market positions', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'my prediction positions', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'show my predictions', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'where are my market positions', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'what prediction markets am i in', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'what prediction bets am i holding right now', expected: predmarketPositionExpected, forbidden: notMarketList },
  { category: 'predmarket.position', message: 'check my prediction market holdings', expected: predmarketPositionExpected, forbidden: notMarketList },

  // Portfolio/generic positions: generic "positions" should not be hijacked by vault-only routes.
  { category: 'portfolio', message: 'show my portfolio', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'portfolio', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'show my holdings', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'show my positions', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'show positions', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'what do i own', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'scan my wallet', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'review my funds', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'break down my wallet', expected: portfolioExpected, forbidden: notVault },
  { category: 'portfolio', message: 'show wallet balances', expected: balanceExpected, forbidden: notVault },
  { category: 'portfolio', message: 'list my balances', expected: /USDC|EURC|balance|Portfolio/i, forbidden: notPredOrVault },
  { category: 'portfolio', message: 'what funds do i have', expected: /USDC|EURC|balance|Portfolio/i, forbidden: notPredOrVault },

  // Vault list/positions: vault words should remain vault-specific.
  { category: 'vault.list', message: 'show vaults', expected: vaultListExpected, forbidden: notPortfolio },
  { category: 'vault.list', message: 'show vault options', expected: vaultListExpected, forbidden: notPortfolio },
  { category: 'vault.list', message: 'list vaults', expected: vaultListExpected, forbidden: notPortfolio },
  { category: 'vault.list', message: 'what vaults are available', expected: vaultListExpected, forbidden: notPortfolio },
  { category: 'vault.list', message: 'show yield options', expected: vaultListExpected, forbidden: notPortfolio },
  { category: 'vault.list', message: 'show vault APY', expected: vaultListExpected, forbidden: notPortfolio },
  { category: 'vault.position', message: 'show vault positions', expected: vaultPositionExpected, forbidden: /Prediction market/i },
  { category: 'vault.position', message: 'show my vault positions', expected: vaultPositionExpected, forbidden: /Prediction market/i },
  { category: 'vault.position', message: 'my vault shares', expected: vaultPositionExpected, forbidden: /Prediction market/i },
  { category: 'vault.position', message: "what's in my vault", expected: vaultPositionExpected, forbidden: /Prediction market/i },
  { category: 'vault.position', message: 'show my vault holdings', expected: vaultPositionExpected, forbidden: /Prediction market/i },
  { category: 'vault.position', message: 'check vault balance', expected: vaultPositionExpected, forbidden: /Prediction market/i },

  // Bridge readiness/list/execute-ish language should not become portfolio or payment history.
  { category: 'bridge', message: 'check gas on base sepolia', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'check bridge gas on base sepolia', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'show bridge source chains', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'what bridge chains are supported', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'can you bridge from base sepolia', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'do i have enough gas to bridge from base', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'bridge 1 USDC from base sepolia to arc', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'i want to bridge', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'is bridge free', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },
  { category: 'bridge', message: 'does bridge need gateway balance', expected: bridgeExpected, forbidden: /Portfolio|payment history|prediction market positions/i },

  // AgentPay/payment/history/link.
  { category: 'agentpay.history', message: 'show payments', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.history', message: 'show payment history', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.history', message: 'show agentpay history', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.history', message: 'what payments have i sent', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.history', message: 'list recent transfers', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.history', message: 'what did i pay earlier', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.history', message: 'payments sent earlier', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.link', message: 'show payment link', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.link', message: 'make payment link for jack.arc 5 USDC', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.link', message: 'create a payment link for jack.arc for 5 USDC and note coffee', expected: /payment link|5 USDC|Remark: _coffee_/i, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.link', message: 'create payment link for my address and add note coffee', expected: /payment link|Remark: _coffee_/i, forbidden: /Pre-filled amount|Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.link', message: 'qr code for jack.arc 5 USDC', expected: paymentExpected, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.send', message: 'pay jack.arc', expected: /amount|USDC|send|jack/i, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.send', message: 'send money to jack.arc', expected: /amount|USDC|send|jack/i, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },
  { category: 'agentpay.request', message: 'request 5 USDC from jack.arc', expected: /request|jack|USDC|created|registered/i, forbidden: /Portfolio|Prediction markets on AchMarket|vault positions/i },

  // Schedule/invoice/split/batch.
  { category: 'schedule', message: 'show scheduled payments', expected: scheduleExpected, forbidden: notPredOrVault },
  { category: 'schedule', message: 'list recurring payments', expected: scheduleExpected, forbidden: notPredOrVault },
  { category: 'schedule', message: 'pay jack.arc every monday', expected: scheduleExpected, forbidden: notPredOrVault },
  { category: 'schedule', message: 'schedule 10 USDC to jack.arc monthly', expected: scheduleExpected, forbidden: notPredOrVault },
  { category: 'schedule', message: 'cancel scheduled payment to jack.arc', expected: scheduleExpected, forbidden: notPredOrVault },
  { category: 'invoice', message: 'show my invoices', expected: invoiceExpected, forbidden: notPredOrVault },
  { category: 'invoice', message: 'invoice status', expected: invoiceExpected, forbidden: notPredOrVault },
  { category: 'invoice', message: 'list invoices', expected: invoiceExpected, forbidden: notPredOrVault },
  { category: 'invoice', message: 'create invoice for alice.arc 40 USDC for design', expected: invoiceExpected, forbidden: notPredOrVault },
  { category: 'invoice', message: 'make invoice for bob.arc 12 USDC for lunch', expected: invoiceExpected, forbidden: notPredOrVault },
  { category: 'split', message: 'split 30 USDC between alice.arc and bob.arc', expected: splitExpected, forbidden: notPredOrVault },
  { category: 'split', message: 'divide 18 USDC between alice.arc and bob.arc', expected: splitExpected, forbidden: notPredOrVault },
  { category: 'split', message: 'split dinner with alice.arc and bob.arc', expected: splitExpected, forbidden: notPredOrVault },
  { category: 'batch', message: 'batch pay alice.arc 1 and bob.arc 2', expected: batchExpected, forbidden: notPredOrVault },
  { category: 'batch', message: 'run payroll to pay alice.arc 25 plus bob.arc 40', expected: batchExpected, forbidden: notPredOrVault },
  { category: 'batch', message: 'pay multiple people alice.arc 1 bob.arc 2', expected: batchExpected, forbidden: notPredOrVault },

  // Product/help/media should not be hijacked into financial state.
  { category: 'product', message: 'what can you do?', expected: productExpected, forbidden: /Your prediction market positions|Portfolio|Your vault positions/i },
  { category: 'product', message: 'what can agentflow do?', expected: productExpected, forbidden: /Your prediction market positions|Portfolio|Your vault positions/i },
  { category: 'product', message: 'how do i use voice notes', expected: /voice|mic|transcrib|audio/i, forbidden: /Portfolio|Your prediction market positions|Your vault positions/i },
  { category: 'product', message: 'can you analyze screenshots', expected: /screenshot|image|analy/i, forbidden: /Portfolio|Your prediction market positions|Your vault positions/i },
  { category: 'product', message: 'do you support wallet addresses for payments', expected: /wallet|address|payment|AgentPay/i, forbidden: /Your prediction market positions|Your vault positions/i },
  { category: 'product', message: 'Can you be my personal fund manager?', expected: /not a discretionary fund manager|You stay in control|preview and confirmation/i, forbidden: /Lighthouse|Lyra|current\s*\d+|hedg|balance tier/i },
  { category: 'product', message: 'can you manage my money for me?', expected: /not a discretionary fund manager|You stay in control|preview and confirmation/i, forbidden: /Lighthouse|Lyra|current\s*\d+|hedg|balance tier/i },
  { category: 'product', message: 'will you invest my funds automatically?', expected: /not a discretionary fund manager|You stay in control|preview and confirmation|doesn't automatically invest|nothing executes without/i, forbidden: /Lighthouse|Lyra|current\s*\d+|hedg|balance tier/i },
  { category: 'product', message: 'can you rebalance my portfolio?', expected: /not a discretionary fund manager|You stay in control|preview and confirmation/i, forbidden: /Lighthouse|Lyra|current\s*\d+|hedg|balance tier/i },
];

function parseArgValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const onlyCategory = parseArgValue('category');
const limit = Number.parseInt(parseArgValue('limit') || '', 10);
const timeoutMs = Math.max(5_000, Number.parseInt(parseArgValue('timeout-ms') || '120000', 10));
const soft = process.argv.includes('--soft');
const rotateWallets = !process.argv.includes('--single-wallet');

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

function walletForCase(index: number): string {
  if (!rotateWallets) return WALLET;
  const suffix = (index + 1).toString(16).padStart(40, '0');
  return `0x${suffix}`;
}

async function chat(message: string, index: number): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}/api/chat/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': `chat-routing-fuzz-${Date.now()}-${index}`,
      },
      body: JSON.stringify({
        message,
        rawUserMessage: message,
        messages: [{ role: 'user', content: message }],
        walletAddress: walletForCase(index),
        executionTarget: 'EOA',
      }),
      signal: controller.signal,
    });
    return {
      status: response.status,
      text: parseSseDeltas(await response.text()),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  let selected = onlyCategory
    ? cases.filter((testCase) => testCase.category === onlyCategory)
    : [...cases];
  if (Number.isFinite(limit) && limit > 0) {
    selected = selected.slice(0, limit);
  }

  const failures: Array<{ testCase: FuzzCase; status: number; text: string }> = [];
  const counts = new Map<string, { pass: number; fail: number }>();

  for (const [index, testCase] of selected.entries()) {
    const result = await chat(testCase.message, index);
    const pass =
      result.status === 200 &&
      testCase.expected.test(result.text) &&
      !testCase.forbidden.test(result.text);
    const count = counts.get(testCase.category) || { pass: 0, fail: 0 };
    count[pass ? 'pass' : 'fail'] += 1;
    counts.set(testCase.category, count);
    if (!pass) failures.push({ testCase, status: result.status, text: result.text });
    console.log(
      JSON.stringify({
        category: testCase.category,
        message: testCase.message,
        status: result.status,
        pass,
        preview: result.text.slice(0, 180).replace(/\s+/g, ' '),
      }),
    );
  }

  console.log(
    JSON.stringify({
      total: selected.length,
      failures: failures.length,
      categories: Object.fromEntries(counts.entries()),
    }),
  );

  if (failures.length > 0) {
    for (const failure of failures.slice(0, 8)) {
      console.error(
        JSON.stringify({
          category: failure.testCase.category,
          message: failure.testCase.message,
          status: failure.status,
          expected: String(failure.testCase.expected),
          forbidden: String(failure.testCase.forbidden),
          text: failure.text.slice(0, 600),
        }),
      );
    }
    if (!soft) {
      throw new Error(`${failures.length} routing fuzz case(s) failed`);
    }
  }
}

main().catch((error) => {
  console.error('[test:chat-routing-fuzz] failed:', error);
  process.exit(1);
});

export {};
