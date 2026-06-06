export type ProductKnowledgeDoc = {
  id: string;
  title: string;
  summary: string;
  facts: string[];
  keywords: string[];
};

export type ProductRagAnswer = {
  answer: string;
  sources: string[];
  confidence: number;
};

const STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'can',
  'do',
  'does',
  'for',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'what',
  'with',
  'you',
]);

export const PRODUCT_KNOWLEDGE: ProductKnowledgeDoc[] = [
  {
    id: 'capabilities',
    title: 'AgentFlow capabilities',
    summary:
      'AgentFlow helps with payments, portfolio and funds, research, and guided onchain actions on Arc.',
    facts: [
      'AgentPay supports sends, requests, splits, batch payouts, invoices, payment links, QR receive flows, contacts, and scheduled payments.',
      'Portfolio and funds cover balances, Gateway reserve, execution wallet holdings, vault shares, recent activity, and wallet-level context.',
      'Onchain actions include swaps, provider vault flows, prediction markets, and Bridge to Arc.',
      'Input helpers include image analysis and mic dictation.',
    ],
    keywords: ['capability', 'capabilities', 'help', 'what can you do', 'agentflow'],
  },
  {
    id: 'voice-to-text',
    title: 'Voice to text',
    summary:
      'Voice to text is the mic dictation feature in the chat composer. It turns spoken audio into editable chat text.',
    facts: [
      'Click the mic icon beside the send button to start recording.',
      'Allow microphone permission if the browser asks.',
      'Speak naturally, then click the mic again to stop.',
      'AgentFlow transcribes the recording into the input box so the user can edit or send it.',
      'Use the small dropdown beside the mic icon to choose a different microphone input.',
      'Voice to text is not an upload/research/analyzer workflow; it is for composing chat messages by speaking.',
    ],
    keywords: [
      'voice',
      'voice note',
      'voice notes',
      'voice to text',
      'speech to text',
      'dictation',
      'dictate',
      'mic',
      'microphone',
      'transcribe',
    ],
  },
  {
    id: 'bridge',
    title: 'Bridge to Arc',
    summary:
      'Bridge to Arc uses the web app native Circle BridgeKit flow from a connected EOA on the source chain.',
    facts: [
      'Bridge to Arc moves USDC from a supported source chain into the user AgentFlow wallet on Arc.',
      'The source chain wallet must have USDC and enough native gas to approve and sign the source-chain transaction.',
      'The bridge starts from the connected wallet on the source chain, then AgentFlow completes the Arc receive step.',
      'Users can ask how bridge works, ask for supported source chains, or start directly with a request like "bridge 1 USDC from Base Sepolia to Arc".',
      'If the user names only a source chain, AgentFlow asks for the amount next.',
    ],
    keywords: ['bridge', 'arc', 'source chain', 'cctp', 'circle', 'forwarder', 'codex', 'gas'],
  },
  {
    id: 'agentpay',
    title: 'AgentPay',
    summary:
      'AgentPay is the payments surface for sending, requesting, receiving, scheduling, and tracking USDC payments.',
    facts: [
      'AgentPay can send USDC to .arc names, saved contacts, or wallet addresses.',
      'It can create payment requests, links, QR receive flows, invoices, splits, batch payouts, and scheduled payments.',
      'Risky money-moving actions preview first and require explicit confirmation before execution.',
      'Chat can also help check payment history, pending requests, invoices, contacts, and scheduled payments.',
    ],
    keywords: ['agentpay', 'payment', 'payments', 'send', 'request', 'invoice', 'split', 'batch', 'schedule', 'link', 'qr'],
  },
  {
    id: 'schedule-payments',
    title: 'Scheduled payments',
    summary: 'AgentFlow can create recurring USDC payments on a schedule.',
    facts: [
      'Schedule daily, weekly, or monthly USDC payments to any .arc handle or address.',
      'Say "pay jack.arc 10 USDC every monday" to create a schedule.',
      'Say "show my scheduled payments" to see active schedules.',
      'Say "cancel my weekly payment to jack.arc" to cancel.',
      'Scheduled payments run automatically from your execution wallet when the cron worker processes due payments.',
      'Due scheduled payments are processed by the cron worker at 09:00 UTC daily; schedules are date-based, not exact user-selected hour based.',
      'Schedule CSV uploads are supported on web for a single schedule row with columns such as recipient, amount, currency, frequency, day, remark.',
      'Example schedule CSV: recipient,amount,currency,frequency,day,remark then jack.arc,10,USDC,weekly,Monday,cleaning.',
      'Schedule CSV may include schedule_name as an optional first column; it is not BatchPay CSV.',
    ],
    keywords: ['schedule', 'scheduled', 'recurring', 'weekly', 'monthly', 'daily', 'automatic', 'repeat', 'schedule csv', 'scheduled payment csv', 'frequency', 'cadence'],
  },
  {
    id: 'split-payments',
    title: 'Split payments',
    summary: 'AgentFlow can split a USDC amount across multiple recipients in one command.',
    facts: [
      'Split payments across 2 to 10 recipients.',
      'Say "split 30 USDC between alice.arc and bob.arc" to split equally.',
      'For split CSV uploads, provide one total amount to divide, e.g. first line "split,30,dinner", then a recipient header and recipient rows.',
      'Do not put per-recipient amounts in split CSV; use BatchPay when each row has its own amount.',
      'Telegram and web both recognize split CSV files named like split_payment_30_dinner.csv or starting with split,30,dinner.',
      'Each recipient gets an equal share by default.',
      'Split payments preview first and require YES confirmation.',
    ],
    keywords: ['split', 'divide', 'share', 'recipients', 'equally', 'between'],
  },
  {
    id: 'batch-payments',
    title: 'Batch payments',
    summary: 'AgentFlow supports bulk USDC payouts from CSV for payroll and DAO payments.',
    facts: [
      'Upload a CSV with recipient addresses and amounts for bulk payments.',
      'BatchPay CSV format is recipient,amount,remark with one payment amount per recipient row.',
      'Do not use BatchPay CSV for schedule creation or equal split totals; use Schedule CSV or Split CSV for those workflows.',
      'Supports up to 500 recipients in one batch.',
      'Used for DAO payroll, team salaries, and contractor payouts.',
      'Say "batch pay" or upload a CSV file to start.',
      'Batch payments preview total and recipient count before execution.',
    ],
    keywords: ['batch', 'bulk', 'payroll', 'csv', 'dao', 'salary', 'contractors', 'mass payment'],
  },
  {
    id: 'invoices',
    title: 'Invoices',
    summary: 'AgentFlow can create, send, and manage USDC invoices.',
    facts: [
      'Create an invoice by saying "create invoice for jack.arc 50 USDC for design work".',
      'Invoices include recipient, amount, description, and invoice number.',
      'Invoice CSV uploads are supported on web and Telegram for one invoice row. The first row must contain invoice so the upload is not confused with BatchPay.',
      'Example invoice CSV: invoice then recipient,amount,currency,description then jack.arc,50,USDC,website work. AgentFlow generates the INV-* invoice number automatically.',
      'Check invoice status by saying "show my invoices".',
      'Invoices are settled in USDC on Arc.',
    ],
    keywords: ['invoice', 'invoices', 'bill', 'billing', 'receipt', 'payment request'],
  },
  {
    id: 'contacts',
    title: 'Contacts',
    summary: 'AgentFlow saves contacts so you can pay people by name instead of address.',
    facts: [
      'Save a contact by saying "save alice as alice.arc".',
      'Use contact names in payment commands: "send 10 USDC to alice".',
      'Show contacts by saying "show my contacts".',
      'Update or delete contacts anytime.',
      'Contacts are wallet-scoped and private to your account.',
    ],
    keywords: ['contact', 'contacts', 'address book', 'save', 'saved', 'name', 'alias'],
  },
  {
    id: 'arc-handles',
    title: '.arc handles',
    summary: '.arc handles are human-readable names for Arc wallets used in AgentPay.',
    facts: [
      '.arc handles are like usernames for Arc wallets e.g. snehal.arc or jack.arc.',
      'You can send USDC to any registered .arc handle.',
      'AgentFlow resolves .arc handles to wallet addresses automatically.',
      'If a handle is not registered on AgentPay it cannot receive payments.',
    ],
    keywords: ['arc handle', '.arc', 'handle', 'username', 'name', 'resolve', 'register'],
  },
  {
    id: 'prediction-markets',
    title: 'Prediction markets',
    summary: 'AgentFlow supports prediction market trading on Arc via natural language chat.',
    facts: [
      'Browse live prediction markets and see current outcome probabilities.',
      'Buy outcome shares with USDC using natural language like "bet 5 USDC on yes".',
      'Sell shares, redeem winnings on resolved markets, and refund cancelled markets.',
      'Markets use LMSR pricing and are settled in USDC on Arc.',
      'Say "show prediction markets" to browse, or "bet X USDC on yes for [market]" to trade.',
    ],
    keywords: ['prediction', 'market', 'markets', 'bet', 'betting', 'outcome', 'shares', 'redeem', 'refund', 'lmsr'],
  },
  {
    id: 'swap',
    title: 'Token swaps',
    summary: 'AgentFlow can swap between Arc tokens using the best available route.',
    facts: [
      'Swap USDC to EURC or EURC to USDC directly from chat.',
      'AgentFlow finds the best price automatically across available swap protocols.',
      'Say "swap 10 USDC to EURC" to get a preview, then confirm with YES.',
      'Slippage protection is applied automatically.',
      'Swaps execute via the AgentFlow execution wallet (DCW) on Arc.',
    ],
    keywords: ['swap', 'swaps', 'exchange', 'convert', 'trade', 'usdc', 'eurc', 'token', 'tokens'],
  },
  {
    id: 'vault',
    title: 'Vault and yield',
    summary: 'AgentFlow supports depositing USDC into yield-bearing vaults on Arc.',
    facts: [
      'Deposit USDC into vaults to earn yield.',
      'Withdraw from vaults anytime.',
      'Say "show vaults" to see available options.',
      'Say "deposit 100 USDC in vault" to get a preview, then confirm with YES.',
      'Vault positions are visible in your portfolio.',
    ],
    keywords: ['vault', 'vaults', 'yield', 'earn', 'deposit', 'withdraw', 'interest', 'apy'],
  },
  {
    id: 'portfolio-funds',
    title: 'Portfolio and funds',
    summary:
      'Portfolio and funds show the user execution wallet, Gateway reserve, balances, vault shares, recent activity, and PnL context.',
    facts: [
      'The AgentFlow execution wallet / DCW is the default wallet for in-chat execution.',
      'Gateway reserve is USDC liquidity used for x402 and agent-to-agent payments.',
      'Portfolio is for live holdings, vault shares, recent activity, and wallet-level PnL context.',
      'Funding moves Arc USDC between the execution wallet and Gateway reserve.',
    ],
    keywords: ['portfolio', 'funds', 'balance', 'balances', 'gateway', 'reserve', 'wallet', 'dcw', 'execution wallet', 'pnl'],
  },
  {
    id: 'gateway-dcw',
    title: 'Gateway and execution wallet',
    summary: 'AgentFlow uses a three-wallet model for safe execution.',
    facts: [
      'Connected wallet (EOA): your browser wallet used for login/session signing and Bridge to Arc source-chain signing.',
      'Gateway reserve: USDC staging area for funding agent execution.',
      'Execution wallet (DCW): the wallet agents use to execute swaps, payments, and trades.',
      'Move USDC from Gateway to execution wallet to fund onchain actions.',
      'Your connected wallet is not the default automated execution wallet; chat execution normally uses the DCW.',
    ],
    keywords: ['gateway', 'dcw', 'execution wallet', 'connected wallet', 'eoa', 'fund', 'funding', 'reserve'],
  },
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'How to start using AgentFlow.',
    facts: [
      'Connect your wallet to sign in.',
      'Fund your execution wallet by bridging USDC from a supported source chain to Arc.',
      'Start chatting -- just type what you want to do.',
      'AgentFlow is available at agentflow.one on web and via Telegram.',
      'No subscriptions -- you pay per task in USDC.',
    ],
    keywords: [
      'start',
      'getting started',
      'begin',
      'how to start',
      'how to use agentflow',
      'setup',
      'connect',
      'fund',
      'onboard',
    ],
  },
  {
    id: 'pricing',
    title: 'Pricing',
    summary: 'AgentFlow charges per task using Circle x402 nanopayments in USDC.',
    facts: [
      'You pay only when an agent does work. No subscription fees.',
      'Default task prices are configured per agent: research $0.005, analyst $0.003, writer $0.008, swap $0.010, vault $0.012, prediction markets $0.012, bridge $0.009, portfolio $0.015, invoice $0.025, schedule $0.005, split $0.005, batch $0.010, vision $0.004, and voice input $0.',
      'Research is paid agent work; the full research pipeline can use separate research, analyst, and writer stages.',
      'Product guidance and simple navigation answers can be free, but paid agent execution or analysis uses the x402 payment flow.',
      'Fees are paid through the configured x402 payer or execution wallet flow for that action.',
    ],
    keywords: ['price', 'pricing', 'cost', 'fee', 'fees', 'pay', 'payment', 'subscription', 'x402', 'nanopayment'],
  },
  {
    id: 'semantic-memory',
    title: 'Semantic memory',
    summary: 'AgentFlow remembers context, preferences, and past interactions across sessions.',
    facts: [
      'AgentFlow stores memory about your preferences, saved contacts, and past workflows.',
      'Memory persists across sessions so you do not need to repeat yourself.',
      'Memory is wallet-scoped and private to your account.',
      'AgentFlow uses memory to give more personalized and accurate responses over time.',
    ],
    keywords: ['memory', 'remember', 'remembers', 'context', 'preferences', 'history', 'persistent'],
  },
  {
    id: 'arc-network',
    title: 'Arc Network',
    summary: 'Arc is a stablecoin-native L1 blockchain by Circle where AgentFlow is deployed.',
    facts: [
      'Arc is built by Circle and uses USDC as its native currency.',
      'Gas fees on Arc are paid in USDC, not ETH.',
      'Arc is EVM-compatible.',
      'AgentFlow is currently on Arc Testnet.',
      'Arc Testnet explorer: testnet.arcscan.app',
    ],
    keywords: ['arc', 'arc network', 'blockchain', 'chain', 'testnet', 'mainnet', 'usdc', 'circle', 'evm'],
  },
  {
    id: 'about',
    title: 'About AgentFlow',
    summary: 'AgentFlow is an AI agent operating system for onchain work built on Arc Network.',
    facts: [
      'AgentFlow was built by Snehal (@SnehalRekt on X), a solo founder.',
      'AgentFlow uses Hermes Agent as its AI reasoning runtime.',
      'AgentFlow has 12 core system agents in the Agent Store plus support for published agents.',
      'Users pay per task using Circle x402 nanopayments in USDC.',
      'AgentFlow is available on web and Telegram.',
      'Live at agentflow.one',
    ],
    keywords: ['agentflow', 'about', 'built', 'founder', 'snehal', 'hermes', 'agents', 'os', 'operating system'],
  },
  {
    id: 'research',
    title: 'Research',
    summary:
      'Research is a multi-agent report pipeline for external topics and portfolio-aware analysis.',
    facts: [
      'The research pipeline runs Research, Analyst, and Writer steps.',
      'Research usually takes 1-2 minutes and uses live retrieval with source checks.',
      'External research uses live retrieval, source checks, and dated evidence before writing the final report.',
      'For private AgentFlow data such as portfolio, invoices, contacts, and payments, AgentFlow should use internal context first.',
      'Research reports do not use a fake YES confirmation unless the backend created a real pending confirmation.',
    ],
    keywords: ['research', 'report', 'analysis', 'analyst', 'writer', 'sources', 'portfolio impact'],
  },
  {
    id: 'execution-wallet',
    title: 'Execution wallet',
    summary:
      'AgentFlow separates connected EOA identity/signing from the Agent wallet / DCW execution mode.',
    facts: [
      'EOA is the connected wallet used for identity, session signing, and the bridge source-chain signature.',
      'DCW / Agent wallet is the default execution wallet for in-chat actions like swaps, vaults, prediction markets, and AgentPay workflows.',
      'When an action can move funds, AgentFlow should preview the real action and ask for explicit confirmation only after creating pending backend state.',
    ],
    keywords: ['eoa', 'dcw', 'execution mode', 'agent wallet', 'connected wallet', 'signing', 'confirm', 'yes'],
  },
  {
    id: 'image-analysis',
    title: 'Image and attachment analysis',
    summary:
      'Image and attachment analysis reads real attached screenshots, photos, text files, and single-page PDFs rather than guessing from text.',
    facts: [
      'Attach the file first, then ask AgentFlow to analyze, describe, summarize, or extract text.',
      'Vision should run on the actual attachment when the user asks about an uploaded image.',
      'The Vision agent supports screenshots, images, text files, and single-page PDFs.',
      'Vision has a guarded daily cap, defaulting to 5 attachment analyses per wallet per day unless configured otherwise.',
      'Image analysis is separate from mic dictation and voice to text.',
    ],
    keywords: ['image', 'vision', 'screenshot', 'photo', 'picture', 'attachment', 'ocr', 'pdf', 'file'],
  },
  {
    id: 'telegram',
    title: 'Telegram continuity',
    summary:
      'You can link AgentFlow to Telegram and continue the same wallet-backed workflows there.',
    facts: [
      'Connect the same wallet on the web app first so AgentFlow can carry your profile into Telegram.',
      'Then open AgentFlow in Telegram and continue using the same linked account.',
      'Swaps, research, and AgentPay features work in Telegram.',
      'Telegram supports BatchPay CSV and Split CSV uploads. Split CSV is detected by a split filename or a first row like split,30,dinner.',
      'Telegram payment confirmations preserve the original recipient, amount, and remark when formatting receipts.',
      'If Telegram is linked, AgentFlow can notify you there when longer research finishes.',
    ],
    keywords: ['telegram', 'continuity', 'bot', 'notification'],
  },
  {
    id: 'bridge-source-chains',
    title: 'Bridge source chains',
    summary: 'Bridge to Arc currently supports 21 source chains through the Circle source registry.',
    facts: [
      'Supported bridge sources are Ethereum Sepolia, Avalanche Fuji, OP Sepolia, Arbitrum Sepolia, Base Sepolia, Polygon Amoy, Unichain Sepolia, Linea Sepolia, Codex Testnet, Sonic Testnet, World Chain Sepolia, Monad Testnet, Sei Testnet, XDC Apothem, HyperEVM Testnet, Ink Testnet, Plume Testnet, EDGE Testnet, Injective Testnet, Morph Testnet, and Pharos Atlantic.',
      'The best source is usually the supported chain where the connected wallet already has USDC and enough native gas.',
      'Users can ask which bridge chains are supported before choosing a source, or name a specific source chain to start.',
      'Bridge uses CCTP-style source domains maintained in the bridge source registry.',
    ],
    keywords: ['bridge chains', 'source chains', 'supported chains', 'cctp', 'domains', 'codex', 'ink', 'fuji', 'amoy'],
  },
  {
    id: 'payment-links-qr',
    title: 'Payment links and QR receive',
    summary: 'AgentPay can create payment links and QR receive flows for USDC requests on Arc.',
    facts: [
      'Users can ask for a payment link or QR code to request USDC.',
      'Payment link and QR creation is a receive/request flow; it does not move funds by itself.',
      'If the amount is missing, AgentFlow should ask how much USDC to request.',
      'Payment links can use .arc handles, saved contacts, or wallet addresses when available.',
      'When the current user has a registered .arc name, payment links for their own address should prefer that .arc name; otherwise direct wallet addresses are allowed.',
      'Payment link remarks/notes are encoded in the link as remark and should prefill the payment page note/reference field.',
    ],
    keywords: ['payment link', 'pay link', 'qr', 'receive', 'request money', 'scan to pay'],
  },
  {
    id: 'agent-store',
    title: 'Agent Store',
    summary: 'The Agent Store lists core AgentFlow system agents and published agents with status, price, and reputation.',
    facts: [
      'Core system agents include Research, Swap, Vault, Prediction Markets, Bridge, Portfolio, Invoice, Vision, Voice Input, Schedule, Split, and Batch.',
      'The Agent Store merges built-in system agents with active or pending published agents.',
      'Each agent can show availability, category, USDC price, reputation score, owner wallet, token id, and agent card metadata.',
      'Voice Input appears as a free perception agent with guarded daily caps.',
    ],
    keywords: ['agent store', 'store', 'agents', 'published agents', 'reputation', 'agent card', 'leaderboard'],
  },
  {
    id: 'wallet-roles',
    title: 'Wallet roles',
    summary: 'AgentFlow separates user identity, source-chain signing, Gateway funding, and DCW execution.',
    facts: [
      'EOA refers to the connected browser wallet used for identity and Bridge to Arc source-chain signing.',
      'DCW refers to the AgentFlow execution wallet used by agents for normal chat execution.',
      'Gateway reserve holds USDC used for x402 and agent funding flows.',
      'Bridge source-chain signing happens from the connected EOA because gas and USDC are on the source chain.',
      'Swaps, vaults, prediction markets, and AgentPay workflows normally execute from the DCW on Arc.',
    ],
    keywords: ['wallet role', 'wallet mode', 'eoa mode', 'dcw mode', 'gateway', 'execution', 'source signing'],
  },
  {
    id: 'security-confirmations',
    title: 'Security and confirmations',
    summary: 'AgentFlow should only ask for YES after it has created a real pending action or preview.',
    facts: [
      'Money-moving actions preview first and require explicit YES confirmation before execution.',
      'If a user says YES without a pending action, AgentFlow should ask what action they want instead of guessing.',
      'The backend blocks direct confirmed swap or vault execution unless the user confirmed through chat.',
      'Emergency withdrawals require an explicit CONFIRM flow and wallet-signed ownership checks.',
      'Withdraw and emergency stop style actions are never blocked by normal pay-per-task rate limits.',
    ],
    keywords: ['confirm', 'confirmation', 'yes', 'preview', 'security', 'cancel', 'no', 'emergency withdraw'],
  },
  {
    id: 'limits-and-caps',
    title: 'Limits and caps',
    summary: 'AgentFlow has wallet-scoped rate limits and daily caps to keep paid agent work controlled.',
    facts: [
      'Default pay-per-task rate limits are 200 actions per wallet per day and 10 actions per wallet per minute unless configured otherwise.',
      'A maximum transaction size limit can be configured with PAY_PER_TASK_MAX_TX_USDC.',
      'Vision defaults to 5 attachment analyses per wallet per day unless VISION_DAILY_LIMIT is changed.',
      'Voice input defaults to 5 transcriptions per wallet per day unless TRANSCRIBE_DAILY_LIMIT is changed.',
      'Never-limited safety actions include withdraw, gateway withdraw, gateway-to-execution, emergency withdraw, vault withdraw, cancel DCA, and emergency stop.',
    ],
    keywords: ['limit', 'limits', 'cap', 'caps', 'daily limit', 'rate limit', 'quota', 'too many', '429'],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'Common AgentFlow errors usually come from missing context, missing funds, source-chain gas, or no pending confirmation.',
    facts: [
      'If bridge asks for gas, it means the connected wallet needs native gas on the selected source chain to sign the source-chain transaction.',
      'If AgentFlow says it did not catch an amount, the user can reply with a plain number like "1" after AgentFlow asks for the bridge amount.',
      'If YES is not understood, there may be no pending backend action; ask the user what action they want to confirm.',
      'If voice input is requested, guide the user to the mic button beside the send button instead of treating YES as a generic action.',
      'If a legacy bridge error appears, route the user to the native web bridge flow instead of retrying an outdated backend path.',
    ],
    keywords: ['troubleshoot', 'error', 'not working', 'gas', 'yes', 'amount', 'lunex', '404', 'voice'],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function docHaystack(doc: ProductKnowledgeDoc): string {
  return [doc.title, doc.summary, ...doc.facts, ...doc.keywords].join(' ');
}

function scoreDoc(doc: ProductKnowledgeDoc, query: string): number {
  const normalizedQuery = normalize(query);
  const queryTokens = unique(tokenize(query));
  const haystack = normalize(docHaystack(doc));
  const docTokens = unique(tokenize(haystack));

  let score = 0;
  for (const token of queryTokens) {
    if (docTokens.includes(token)) score += token.length > 4 ? 4 : 2;
    if (doc.keywords.some((keyword) => normalize(keyword).includes(token))) score += 3;
  }

  for (const keyword of doc.keywords) {
    const normalizedKeyword = normalize(keyword);
    if (normalizedKeyword && normalizedQuery.includes(normalizedKeyword)) {
      score += Math.max(6, normalizedKeyword.split(/\s+/).length * 5);
    }
  }

  if (normalizedQuery.includes(normalize(doc.title))) score += 12;
  if (/what can (?:you|agentflow) do|help with|capabilit/.test(normalizedQuery) && doc.id === 'capabilities') {
    score += 20;
  }
  if (/voice|mic|microphone|dictat|transcrib|speech/.test(normalizedQuery) && doc.id === 'voice-to-text') {
    score += 20;
  }
  if (/bridge|source chain|gas|arc/.test(normalizedQuery) && doc.id === 'bridge') {
    score += 12;
  }
  if (/payment|pay|send|request|invoice|split|batch|schedule/.test(normalizedQuery) && doc.id === 'agentpay') {
    score += 12;
  }
  if (/portfolio|fund|balance|gateway|wallet/.test(normalizedQuery) && doc.id === 'portfolio-funds') {
    score += 12;
  }
  if (/schedule|recurr|weekly|monthly|daily|frequency|cadence/.test(normalizedQuery) && doc.id === 'schedule-payments') score += 14;
  if (/schedule.*csv|csv.*schedule|scheduled.*csv/.test(normalizedQuery) && doc.id === 'schedule-payments') score += 18;
  if (/split|divide|between|equally/.test(normalizedQuery) && doc.id === 'split-payments') score += 14;
  if (/split.*csv|csv.*split/.test(normalizedQuery) && doc.id === 'split-payments') score += 18;
  if (/batch|bulk|payroll/.test(normalizedQuery) && doc.id === 'batch-payments') score += 14;
  if (/\bcsv\b/.test(normalizedQuery) && !/schedule|scheduled|split/.test(normalizedQuery) && doc.id === 'batch-payments') score += 14;
  if (/invoice|bill|receipt/.test(normalizedQuery) && doc.id === 'invoices') score += 14;
  if (/contact|address book|alias|save .* as/.test(normalizedQuery) && doc.id === 'contacts') score += 14;
  if (/\.arc|arc handle|handle|username/.test(normalizedQuery) && doc.id === 'arc-handles') score += 14;
  if (/predict|market|bet|outcome|redeem|refund|lmsr/.test(normalizedQuery) && doc.id === 'prediction-markets') score += 14;
  if (/swap|exchange|convert|eurc|token/.test(normalizedQuery) && doc.id === 'swap') score += 14;
  if (/vault|yield|apy|deposit|withdraw/.test(normalizedQuery) && doc.id === 'vault') score += 14;
  if (/price|pricing|cost|fee|x402|subscription/.test(normalizedQuery) && doc.id === 'pricing') score += 16;
  if (/remember|memory|preference|history|context/.test(normalizedQuery) && doc.id === 'semantic-memory') score += 14;
  if (/arc network|arc testnet|circle|evm|gas/.test(normalizedQuery) && doc.id === 'arc-network') score += 12;
  if (/start|get started|onboard|setup|fund/.test(normalizedQuery) && doc.id === 'getting-started') score += 12;
  if (/research|report|deep|fast|source/.test(normalizedQuery) && doc.id === 'research') score += 14;
  if (/image|attachment|vision|screenshot|pdf|ocr|file/.test(normalizedQuery) && doc.id === 'image-analysis') score += 14;
  if (/telegram|bot|notification/.test(normalizedQuery) && doc.id === 'telegram') score += 14;
  if (/source chain|supported chain|bridge chain|cctp|codex|ink|fuji|amoy/.test(normalizedQuery) && doc.id === 'bridge-source-chains') score += 16;
  if (/payment link|pay link|qr|receive|scan/.test(normalizedQuery) && doc.id === 'payment-links-qr') score += 16;
  if (/agent store|leaderboard|published agent|reputation|agent card/.test(normalizedQuery) && doc.id === 'agent-store') score += 16;
  if (/wallet mode|eoa|dcw|execution wallet|gateway/.test(normalizedQuery) && doc.id === 'wallet-modes') score += 14;
  if (/confirm|confirmation|yes|preview|security|cancel/.test(normalizedQuery) && doc.id === 'security-confirmations') score += 14;
  if (/limit|cap|quota|rate limit|too many|429/.test(normalizedQuery) && doc.id === 'limits-and-caps') score += 16;
  if (/troubleshoot|error|not working|404|lunex|didn.t catch|gas/.test(normalizedQuery) && doc.id === 'troubleshooting') score += 16;

  return score;
}

export function retrieveProductKnowledge(
  query: string,
  options: { limit?: number; minScore?: number } = {},
): Array<ProductKnowledgeDoc & { score: number }> {
  const limit = Math.max(1, Math.min(5, options.limit ?? 3));
  const minScore = options.minScore ?? 8;
  return PRODUCT_KNOWLEDGE
    .map((doc) => ({ ...doc, score: scoreDoc(doc, query) }))
    .filter((doc) => doc.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function isCapabilityQuestion(query: string): boolean {
  return /\b(?:what\s+can\s+(?:you|agentflow)\s+do|what\s+do\s+you\s+do|help\s+with|capabilit)/i.test(query);
}

function selectFacts(query: string, docs: ProductKnowledgeDoc[]): string[] {
  if (isCapabilityQuestion(query)) {
    return [
      'AgentPay: send, request, split, invoices, links, schedules',
      'Portfolio and funds: balances, Gateway reserve, vault shares, activity',
      'Trade and earn: swaps, provider vaults, prediction markets, Bridge to Arc',
      'Input helpers: image analysis and mic dictation',
    ];
  }

  const queryTokens = unique(tokenize(query));
  const facts: string[] = [];
  for (const doc of docs) {
    const ranked = doc.facts
      .map((fact) => ({
        fact,
        score: queryTokens.filter((token) => tokenize(fact).includes(token)).length,
      }))
      .sort((a, b) => b.score - a.score);
    for (const item of ranked.slice(0, 4)) {
      facts.push(item.fact);
    }
  }
  return unique(facts).slice(0, 7);
}

export function answerProductQuestion(query: string): ProductRagAnswer | null {
  const rankedDocs = retrieveProductKnowledge(query, { limit: isCapabilityQuestion(query) ? 1 : 3 });
  if (!rankedDocs.length) return null;

  const topScore = rankedDocs[0]?.score ?? 0;
  const docs = rankedDocs.filter((doc, index) => index === 0 || doc.score >= topScore - 8);
  if (!docs.length) return null;

  const facts = selectFacts(query, docs);
  if (!facts.length) return null;

  const confidence = Math.max(0, Math.min(1, topScore / 28));
  const sources = docs.map((doc) => `Product KB: ${doc.title}`);

  if (isCapabilityQuestion(query)) {
    return {
      answer:
        'I can help with DeFi and payments on Arc. You can swap tokens, bridge USDC from any EVM chain, deposit into vaults, trade prediction markets, send and request payments via registered AgentPay .arc handles or wallet addresses, schedule recurring payments, run batch payroll, create invoices, research any topic, and analyze images or voice notes.\n\nWhat do you want to do?',
      sources,
      confidence,
    };
  }

  const top = docs[0];
  return {
    answer: [
      top.summary,
      '',
      ...facts.map((fact) => `- ${fact}`),
    ].join('\n'),
    sources,
    confidence,
  };
}
