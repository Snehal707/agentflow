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
    id: 'payment-requests',
    title: 'Payment requests',
    summary:
      'AgentPay can request USDC from a person, .arc handle, or wallet address without moving funds immediately.',
    facts: [
      'Say "request 10 USDC from alice.arc" to create a payment request.',
      'Example request with remark: "request 10 USDC from alice.arc for dinner".',
      'Payment requests notify the payer and let them approve or decline later.',
      'Payment requests do not move funds immediately and do not need YES confirmation.',
      'If you want a shareable request flow, ask for a payment link or QR code instead.',
      'Payment requests can include a remark or note for context.',
    ],
    keywords: ['payment request', 'payment requests', 'request money', 'request usdc', 'collect money', 'bill', 'ask to pay'],
  },
  {
    id: 'schedule-payments',
    title: 'Scheduled payments',
    summary: 'AgentFlow can create recurring USDC payments on a schedule.',
    facts: [
      'Schedule daily, weekly, or monthly USDC payments to any .arc handle or address.',
      'You can create a scheduled payment directly from chat; CSV is optional on web, not required.',
      'Say "pay jack.arc 10 USDC every monday" to create a schedule.',
      'Example schedule payment chat command: "pay jack.arc 10 USDC every friday" or "send 25 USDC to alice.arc every month".',
      'Say "show my scheduled payments" to see active schedules.',
      'Say "cancel my weekly payment to jack.arc" to cancel.',
      'Scheduled payments run automatically from your execution wallet when the cron worker processes due payments.',
      'Due scheduled payments are processed by the cron worker at 09:00 UTC daily; schedules are date-based, not exact user-selected hour based.',
      'Schedule CSV uploads are also supported on web for a single schedule row with columns such as recipient, amount, currency, frequency, day, remark.',
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
      'You can add a shared remark in chat, for example: "split 30 USDC between alice.arc and bob.arc for dinner".',
      'You can run a split directly from chat; CSV is optional when you prefer uploading a recipient list.',
      'Example chat command: "split 90 USDC between alice.arc, bob.arc, and charlie.arc for team lunch".',
      'Each recipient gets an equal share by default.',
      'Split payments preview first and require YES confirmation.',
      'For split CSV uploads, provide one total amount to divide, e.g. first line "split,30,dinner", then a recipient header and recipient rows.',
      'Example Split CSV: first line "split,30,dinner", second line "recipient", then rows like "alice.arc" and "bob.arc".',
      'Do not put per-recipient amounts in split CSV; use BatchPay when each row has its own amount.',
      'Telegram and web detect Split CSV when the filename contains "split" or the first row starts with "split,...". The total amount and optional remark come from the first row, not from the filename.',
    ],
    keywords: ['split', 'divide', 'share', 'recipients', 'equally', 'between'],
  },
  {
    id: 'batch-payments',
    title: 'Batch payments',
    summary: 'AgentFlow supports bulk USDC payouts to multiple recipients in one run.',
    facts: [
      'You can start a batch directly from chat by naming multiple recipients and amounts in one message.',
      'Example chat command: "batch pay alice.arc 10, bob.arc 20, and charlie.arc 30".',
      'CSV upload is optional on web when you already have a payroll or payout sheet.',
      'BatchPay CSV format is recipient,amount,remark with one payment amount per recipient row.',
      'Do not use BatchPay CSV for schedule creation or equal split totals; use Schedule CSV or Split CSV for those workflows.',
      'Supports up to 500 recipients in one batch.',
      'Used for DAO payroll, team salaries, and contractor payouts.',
      'Say "batch pay alice.arc 10 and bob.arc 20" to start from chat, or upload a CSV file.',
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
      'The Funding page moves USDC directly between your connected wallet (EOA) and your execution wallet (DCW) on Arc.',
    ],
    keywords: ['portfolio', 'funds', 'balance', 'balances', 'gateway', 'reserve', 'wallet', 'dcw', 'execution wallet', 'pnl'],
  },
  {
    id: 'funding',
    title: 'Funding (deposit and withdraw)',
    summary:
      'The Funding page moves USDC directly between your connected wallet (EOA) and your AgentFlow execution wallet (DCW) on Arc, and links the testnet faucet.',
    facts: [
      'Deposit sends USDC from your connected wallet (EOA) straight to your execution wallet (DCW) as a normal Arc USDC transfer.',
      'Withdraw sends USDC from your execution wallet (DCW) back to your connected wallet (EOA).',
      'Both wallets must be on Arc; the page prompts you to switch your wallet to Arc Testnet if needed.',
      'Use the Circle testnet faucet to get Arc test USDC into your EOA, then deposit it to the DCW.',
      'Funding moves your own USDC between EOA and DCW; it is separate from Bridge, which brings USDC in from another source chain.',
      'The Funding page no longer routes through the Gateway reserve; deposits and withdrawals are direct EOA-to-DCW transfers.',
    ],
    keywords: ['funding', 'fund', 'deposit', 'withdraw', 'eoa', 'dcw', 'execution wallet', 'faucet', 'top up', 'move usdc', 'add funds'],
  },
  {
    id: 'gateway-dcw',
    title: 'Gateway and execution wallet',
    summary: 'AgentFlow uses a three-wallet model for safe execution.',
    facts: [
      'Connected wallet (EOA): your browser wallet used for login/session signing and Bridge to Arc source-chain signing.',
      'Gateway reserve: USDC staging area for funding agent execution.',
      'Execution wallet (DCW): the wallet agents use to execute swaps, payments, and trades.',
      'Fund the execution wallet (DCW) by depositing USDC from your connected wallet (EOA) on the Funding page; the Gateway reserve is used for x402 and agent-to-agent payments, not for the EOA-to-DCW funding flow.',
      'Your connected wallet is not the default automated execution wallet; chat execution normally uses the DCW.',
      'Gateway auto top-up: when you run a paid agent and your Gateway reserve is too low to cover the x402 payment, AgentFlow automatically moves USDC from your execution wallet (DCW) into the Gateway to cover it.',
      'The Gateway auto top-up refills to a small target balance (about 10 USDC by default, configurable) so you do not have to fund the Gateway manually before each paid action.',
    ],
    keywords: ['gateway', 'dcw', 'execution wallet', 'connected wallet', 'eoa', 'fund', 'funding', 'reserve', 'auto top-up', 'auto topup', 'top up', 'refill'],
  },
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'How to start using AgentFlow.',
    facts: [
      'Connect your wallet to sign in.',
      'Fund your execution wallet (DCW) on the Funding page by depositing USDC directly from your connected wallet (EOA), grabbing Arc test USDC from the Circle faucet, or bridging USDC in from another source chain.',
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
    id: 'hermes',
    title: 'Hermes Agent (the AI runtime)',
    summary:
      'Hermes Agent is the AI reasoning runtime that powers AgentFlow — it understands your message, plans the action, and writes the reply.',
    facts: [
      'Hermes Agent is the AI brain behind AgentFlow; every core agent (swap, research, portfolio, and the rest) runs its reasoning through Hermes.',
      'Hermes reads your message together with your saved context and the product knowledge base, decides what to do, and generates the response.',
      'Hermes uses a fast mode for quick chat replies and a deeper mode for harder reasoning such as research and analysis.',
      'Hermes handles the natural-language understanding and planning; the actual onchain actions still execute through your execution wallet (DCW), with explicit confirmation for anything that moves funds.',
    ],
    keywords: ['hermes', 'hermes agent', 'ai', 'model', 'reasoning', 'runtime', 'brain', 'llm', 'nous', 'which ai'],
  },
  {
    id: 'multilingual',
    title: 'Languages and multilingual support',
    summary:
      'You can chat with AgentFlow and run actions in your own language. Conversational replies and research reports come back in your language; transaction receipts and the app interface are currently English.',
    facts: [
      'You can type requests in your own language — for example "1 USDC को EURC में स्वैप करें" — and AgentFlow understands and executes the action (swap, pay, bridge, research, and more).',
      'Conversational chat replies are written in the same language you wrote in.',
      'Research reports are translated into the language you asked in.',
      'Deterministic transaction receipts and action confirmations — for example swap quote and swap receipt cards — currently display in English.',
      'The app interface (buttons, page labels, and card headers such as "SETTLED ON ARC") is currently English only.',
      'Language coverage is reliable for widely-spoken languages and best-effort beyond them. The underlying Hermes model officially supports 8 languages: English, German, French, Italian, Portuguese, Hindi, Spanish, and Thai.',
      'To confirm a previewed money-moving action, reply with the literal word YES even when the rest of the conversation is in another language.',
    ],
    keywords: ['language', 'languages', 'multilingual', 'translation', 'translate', 'hindi', 'spanish', 'french', 'german', 'thai', 'portuguese', 'italian', 'native language', 'local language', 'i18n', 'localization', 'how many languages'],
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
      'Research answers are informational by default and do not ask you to confirm anything unless you later start a real action.',
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
      'Telegram supports BatchPay CSV and Split CSV uploads. Split CSV is detected when the filename contains "split" or the first row starts like split,30,dinner. The amount and optional remark are read from the first row.',
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
      'Every agent has its own on-chain identity on Arc: a dedicated agent wallet address and a unique ERC-8004 agent ID (token id), shown on its agent card.',
      'The agent wallet address is where that agent receives x402 payments; the ERC-8004 agent ID is what its on-chain reputation and ratings are recorded against.',
      'Voice Input appears as a free perception agent with guarded daily caps.',
    ],
    keywords: ['agent store', 'store', 'agents', 'published agents', 'reputation', 'agent card', 'leaderboard', 'agent address', 'agent wallet', 'agent id', 'token id', 'erc-8004 id'],
  },
  {
    id: 'reputation',
    title: 'Reputation and ratings (ERC-8004)',
    summary:
      'AgentFlow records agent reputation on-chain through the ERC-8004 Reputation Registry on Arc, built from real buyer ratings of paid tasks.',
    facts: [
      'After a paid task, you can rate the agent from 1 to 5 stars; each star maps to a score out of 100 (5 stars = 100).',
      'Ratings are written on-chain as ERC-8004 feedback, so every rating is a verifiable on-chain trace, not just a database row.',
      'Each paid task can be rated once, and a rating is tied to the real settlement of that task — you can only rate paid work that belongs to your wallet.',
      'Ratings are web-chat only for now; internal research pipeline sub-agents (analyst and writer) are not separately user-rated.',
      'An agent only accepts ratings once it is ERC-8004 registered (it has an on-chain agent id).',
      'The reputation score shown in the Agent Store is the true on-chain ERC-8004 aggregate of all buyer feedback for that agent; agents with no on-chain feedback show 0.',
      'Reputation is buyer-and-seller verifiable: every paid run, agent-to-agent payment, and rating settles in USDC and leaves an on-chain trace.',
    ],
    keywords: ['reputation', 'rating', 'ratings', 'rate', 'stars', 'erc-8004', 'erc8004', '8004', 'feedback', 'score', 'trust', 'review', 'reputation registry'],
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
      'Never-limited safety actions include withdraw, gateway withdraw, gateway-to-execution, emergency withdraw, vault withdraw, and emergency stop.',
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
  if (/deposit|withdraw|top up|add funds|move usdc|faucet|fund (?:my |the )?(?:dcw|execution|wallet)/.test(normalizedQuery) && doc.id === 'funding') {
    score += 16;
  }
  if (/hermes|which ai|what ai|ai model|reasoning|\bllm\b|ai brain|nous/.test(normalizedQuery) && doc.id === 'hermes') {
    score += 16;
  }
  if (/language|languages|multiling|translat|hindi|spanish|french|german|thai|portuguese|italian|my own language|local language|how many languages/.test(normalizedQuery) && doc.id === 'multilingual') {
    score += 16;
  }
  if (/auto top.?up|auto.?topup|gateway.*(refill|top.?up)|(refill|top.?up).*gateway/.test(normalizedQuery) && doc.id === 'gateway-dcw') {
    score += 14;
  }
  if (/schedule|recurr|weekly|monthly|daily|frequency|cadence|schedulepayments?/.test(normalizedQuery) && doc.id === 'schedule-payments') score += 14;
  if (/schedule.*csv|csv.*schedule|scheduled.*csv/.test(normalizedQuery) && doc.id === 'schedule-payments') score += 18;
  if (/split|divide|between|equally|splitpayments?/.test(normalizedQuery) && doc.id === 'split-payments') score += 14;
  if (/split.*csv|csv.*split/.test(normalizedQuery) && doc.id === 'split-payments') score += 18;
  if (/batch|bulk|payroll|batchpayments?/.test(normalizedQuery) && doc.id === 'batch-payments') score += 14;
  if (/\bcsv\b/.test(normalizedQuery) && !/schedule|scheduled|split/.test(normalizedQuery) && doc.id === 'batch-payments') score += 14;
  if (/payment request|payment requests|request money|request usdc|collect money|\bbill\b|ask .* to pay/.test(normalizedQuery) && doc.id === 'payment-requests') score += 18;
  if (/\brequest\b/.test(normalizedQuery) && doc.id === 'payment-requests') score += 10;
  if (/\brequest\b.*\b(?:remark|note|notes)\b|\b(?:remark|note|notes)\b.*\brequest\b/.test(normalizedQuery) && doc.id === 'payment-requests') score += 18;
  if (/invoice|bill|receipt/.test(normalizedQuery) && doc.id === 'invoices') score += 14;
  if (/\b(?:difference|compare|vs\.?|versus)\b.*\brequest\b.*\binvoice\b|\b(?:difference|compare|vs\.?|versus)\b.*\binvoice\b.*\brequest\b|\brequest\b.*\binvoice\b/.test(normalizedQuery) && (doc.id === 'payment-requests' || doc.id === 'invoices')) score += 18;
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
  if (/agent store|leaderboard|published agent|agent card/.test(normalizedQuery) && doc.id === 'agent-store') score += 16;
  if (/reputation|rating|ratings|\brate\b|stars|erc.?8004|\b8004\b|feedback|review|trust score/.test(normalizedQuery) && doc.id === 'reputation') score += 18;
  if (/wallet mode|wallet role|eoa|dcw|execution wallet|gateway/.test(normalizedQuery) && doc.id === 'wallet-roles') score += 14;
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

const GENERIC_PRODUCT_DOC_IDS = new Set(['agentpay', 'capabilities', 'about', 'getting-started']);

const SPECIFIC_DOC_PRIORITY: Array<{ id: string; pattern: RegExp }> = [
  { id: 'schedule-payments', pattern: /\b(?:schedule|scheduled|recurring|weekly|monthly|daily|cadence|schedulepayments?)\b/ },
  { id: 'batch-payments', pattern: /\b(?:batch|bulk|payroll|batchpayments?)\b/ },
  { id: 'split-payments', pattern: /\b(?:split|divide|splitpayments?)\b/ },
  { id: 'payment-links-qr', pattern: /\b(?:payment link|pay link|qr|scan to pay)\b/ },
  { id: 'payment-requests', pattern: /\b(?:payment request|payment requests|request money|request usdc|collect money|\bbill\b|ask\b.+\bpay)\b/ },
  { id: 'invoices', pattern: /\b(?:invoice|invoices|billing)\b/ },
  { id: 'contacts', pattern: /\bcontacts?\b/ },
  { id: 'arc-handles', pattern: /\b(?:\.arc|arc handle|arc handles|handle|handles)\b/ },
  { id: 'telegram', pattern: /\btelegram\b/ },
  { id: 'voice-to-text', pattern: /\b(?:voice|mic|microphone|dictat|transcrib|speech)\b/ },
  { id: 'semantic-memory', pattern: /\b(?:remember|memory|preferences|past chats|history)\b/ },
  { id: 'prediction-markets', pattern: /\b(?:prediction|market|markets|bet|betting)\b/ },
  { id: 'research', pattern: /\bresearch\b/ },
];

function choosePrimaryDoc(
  query: string,
  rankedDocs: Array<ProductKnowledgeDoc & { score: number }>,
): (ProductKnowledgeDoc & { score: number }) | null {
  if (!rankedDocs.length) return null;
  const normalizedQuery = normalize(query);
  for (const candidate of SPECIFIC_DOC_PRIORITY) {
    if (!candidate.pattern.test(normalizedQuery)) continue;
    const match = rankedDocs.find((doc) => doc.id === candidate.id);
    if (match) return match;
  }
  return rankedDocs[0] ?? null;
}

function selectSupportingDocs(
  rankedDocs: Array<ProductKnowledgeDoc & { score: number }>,
  primaryDoc: ProductKnowledgeDoc & { score: number },
): Array<ProductKnowledgeDoc & { score: number }> {
  const strictSingleDoc = new Set([
    'schedule-payments',
    'split-payments',
    'batch-payments',
    'payment-requests',
    'payment-links-qr',
    'invoices',
    'telegram',
    'voice-to-text',
    'semantic-memory',
    'prediction-markets',
    'research',
  ]);
  if (strictSingleDoc.has(primaryDoc.id)) {
    return [primaryDoc];
  }

  const relatedDocAllowlist: Partial<Record<string, string[]>> = {
    contacts: ['contacts', 'arc-handles'],
    'arc-handles': ['arc-handles', 'contacts'],
  };
  const allowed = relatedDocAllowlist[primaryDoc.id];
  if (allowed?.length) {
    return rankedDocs.filter((doc) => allowed.includes(doc.id));
  }

  const nearPrimary = rankedDocs.filter(
    (doc) => doc.id === primaryDoc.id || doc.score >= primaryDoc.score - 8,
  );
  if (GENERIC_PRODUCT_DOC_IDS.has(primaryDoc.id)) {
    return nearPrimary;
  }
  const specificOnly = nearPrimary.filter((doc) => !GENERIC_PRODUCT_DOC_IDS.has(doc.id));
  return specificOnly.length ? specificOnly : [primaryDoc];
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

  const normalizedQuery = normalize(query);
  const queryTokens = unique(tokenize(query));
  const facts: string[] = [];
  for (const doc of docs) {
    if (doc.id === 'payment-requests') {
      if (/\bremark\b|\bnote\b|\bnotes\b/i.test(normalizedQuery)) {
        facts.push('Payment requests can include a remark or note for context.');
        facts.push('Example request with remark: "request 10 USDC from alice.arc for dinner".');
      }
    }

    if (doc.id === 'schedule-payments') {
      if (/\bhow\b|\bwork\b|\bworks\b|\bworking\b/i.test(normalizedQuery)) {
        facts.push('You can create a scheduled payment directly from chat; CSV is optional on web, not required.');
        facts.push('Example schedule payment chat command: "pay jack.arc 10 USDC every friday" or "send 25 USDC to alice.arc every month".');
      }
    }

    if (doc.id === 'split-payments') {
      if (/\bremark\b|for\s+\w+|\bnote\b/i.test(normalizedQuery)) {
        facts.push(
          'You can add a shared remark in chat, for example: "split 30 USDC between alice.arc and bob.arc for dinner".',
        );
      }
      if (/\bcsv\b|\bformat\b|\btemplate\b|\bexample\b|\bsample\b/i.test(normalizedQuery)) {
        facts.push(
          'For split CSV uploads, provide one total amount to divide, e.g. first line "split,30,dinner", then a recipient header and recipient rows.',
        );
        facts.push(
          'Example Split CSV: first line "split,30,dinner", second line "recipient", then rows like "alice.arc" and "bob.arc".',
        );
        facts.push(
          'Do not put per-recipient amounts in split CSV; use BatchPay when each row has its own amount.',
        );
      }
    }

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
  const normalizedQuery = normalize(query);
  if (
    /\b(?:difference|compare|vs|versus)\b/.test(normalizedQuery) &&
    /\brequest\b/.test(normalizedQuery) &&
    /\binvoice\b/.test(normalizedQuery)
  ) {
    return {
      answer: [
        'Payment requests and invoices are similar, but they are used a bit differently.',
        '',
        '- Payment request: a lightweight ask to pay, for example "request 10 USDC from alice.arc for dinner".',
        '- Invoice: a more formal bill with an invoice number, recipient, amount, and description, for example "create invoice for alice.arc 50 USDC for design work".',
        '- Both do not move funds immediately; the payer handles payment afterward.',
        '- Use a request for simple collections between people, and use an invoice when you want formal billing and invoice tracking.',
      ].join('\n'),
      sources: ['Product KB: Payment requests', 'Product KB: Invoices'],
      confidence: 0.92,
    };
  }

  const rankedDocs = retrieveProductKnowledge(query, { limit: isCapabilityQuestion(query) ? 1 : 3 });
  if (!rankedDocs.length) return null;

  const primaryDoc = choosePrimaryDoc(query, rankedDocs);
  if (!primaryDoc) return null;

  const docs = selectSupportingDocs(rankedDocs, primaryDoc);
  if (!docs.length) return null;

  const facts = selectFacts(query, docs);
  if (!facts.length) return null;

  const confidence = Math.max(0, Math.min(1, primaryDoc.score / 28));
  const sources = docs.map((doc) => `Product KB: ${doc.title}`);

  if (isCapabilityQuestion(query)) {
    return {
      answer:
        'I can help with DeFi and payments on Arc. You can swap tokens, bridge USDC from any EVM chain, deposit into vaults, trade prediction markets, send and request payments via registered AgentPay .arc handles or wallet addresses, schedule recurring payments, run batch payroll, create invoices, research any topic, and analyze images or voice notes.\n\nWhat do you want to do?',
      sources,
      confidence,
    };
  }

  return {
    answer: [
      primaryDoc.summary,
      '',
      ...facts.map((fact) => `- ${fact}`),
    ].join('\n'),
    sources,
    confidence,
  };
}
