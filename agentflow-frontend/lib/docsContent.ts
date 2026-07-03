// User-facing documentation content.
//
// SOURCE OF TRUTH: this mirrors PRODUCT_KNOWLEDGE in the backend `lib/product-rag.ts`
// (the same facts the in-chat assistant answers from). The frontend is a separate
// Next.js app and cannot import the backend module directly, so the content is
// duplicated here. When you edit a topic in product-rag.ts, update it here too so
// the docs stay in sync with what the AI tells users.

export type DocTopic = {
  id: string;
  title: string;
  summary: string;
  facts: string[];
};

export type DocSection = {
  id: string;
  label: string;
  topics: DocTopic[];
};

export const DOC_INTRO = {
  eyebrow: "Documentation",
  title: "AgentFlow user guide",
  summary:
    "AgentFlow helps with payments, portfolio and funds, research, and guided onchain actions on Arc. AgentPay covers sends, requests, splits, batch payouts, invoices, payment links, QR receive flows, contacts, and scheduled payments. Onchain actions include swaps, provider vault flows, prediction markets, and Bridge to Arc. Input helpers include image analysis and mic dictation.",
};

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    label: "Getting started",
    topics: [
      {
        id: "getting-started",
        title: "Getting started",
        summary: "How to start using AgentFlow.",
        facts: [
          "Connect your wallet to sign in.",
          "Fund your execution wallet (DCW) on the Funding page by depositing USDC directly from your connected wallet (EOA), grabbing Arc test USDC from the Circle faucet, or bridging USDC in from another source chain.",
          "Start chatting — just type what you want to do.",
          "AgentFlow is available at agentflow.one on web and via Telegram.",
          "No subscriptions — you pay per task in USDC.",
        ],
      },
      {
        id: "about",
        title: "About AgentFlow",
        summary:
          "AgentFlow is an AI agent operating system for onchain work built on Arc Network.",
        facts: [
          "AgentFlow was built by Snehal (@SnehalRekt on X), a solo founder.",
          "AgentFlow uses Hermes Agent as its AI reasoning runtime.",
          "AgentFlow has 12 core system agents in the Agent Store plus support for published agents.",
          "Users pay per task using Circle x402 nanopayments in USDC.",
          "AgentFlow is available on web and Telegram.",
          "Live at agentflow.one",
        ],
      },
      {
        id: "hermes",
        title: "Hermes Agent (the AI runtime)",
        summary:
          "Hermes Agent is the AI reasoning runtime that powers AgentFlow — it understands your message, plans the action, and writes the reply.",
        facts: [
          "Hermes Agent is the AI brain behind AgentFlow; every core agent (swap, research, portfolio, and the rest) runs its reasoning through Hermes.",
          "Hermes reads your message together with your saved context and the product knowledge base, decides what to do, and generates the response.",
          "Hermes uses a fast mode for quick chat replies and a deeper mode for harder reasoning such as research and analysis.",
          "Hermes handles the natural-language understanding and planning; the actual onchain actions still execute through your execution wallet (DCW), with explicit confirmation for anything that moves funds.",
        ],
      },
      {
        id: "multilingual",
        title: "Languages and multilingual support",
        summary:
          "You can chat with AgentFlow and run actions in your own language. Conversational replies and research reports come back in your language; transaction receipts and the app interface are currently English.",
        facts: [
          'You can type requests in your own language — for example "1 USDC को EURC में स्वैप करें" — and AgentFlow understands and executes the action (swap, pay, bridge, research, and more).',
          "Conversational chat replies are written in the same language you wrote in.",
          "Research reports are translated into the language you asked in.",
          "Deterministic transaction receipts and action confirmations — for example swap quote and swap receipt cards — currently display in English.",
          'The app interface (buttons, page labels, and card headers such as "SETTLED ON ARC") is currently English only.',
          "Language coverage is reliable for widely-spoken languages and best-effort beyond them. The underlying Hermes model officially supports 8 languages: English, German, French, Italian, Portuguese, Hindi, Spanish, and Thai.",
          "To confirm a previewed money-moving action, reply with the literal word YES even when the rest of the conversation is in another language.",
        ],
      },
      {
        id: "pricing",
        title: "Pricing",
        summary:
          "AgentFlow charges per task using Circle x402 nanopayments in USDC.",
        facts: [
          "You pay only when an agent does work. No subscription fees.",
          "Default task prices are configured per agent: research $0.005, analyst $0.003, writer $0.008, swap $0.010, vault $0.012, prediction markets $0.012, bridge $0.009, portfolio $0.015, invoice $0.025, schedule $0.005, split $0.005, batch $0.010, vision $0.004, and voice input $0.",
          "Research is paid agent work; the full research pipeline can use separate research, analyst, and writer stages.",
          "Product guidance and simple navigation answers can be free, but paid agent execution or analysis uses the x402 payment flow.",
          "Fees are paid through the configured x402 payer or execution wallet flow for that action.",
        ],
      },
    ],
  },
  {
    id: "arc",
    label: "Arc & handles",
    topics: [
      {
        id: "arc-network",
        title: "Arc Network",
        summary:
          "Arc is a stablecoin-native L1 blockchain by Circle where AgentFlow is deployed.",
        facts: [
          "Arc is built by Circle and uses USDC as its native currency.",
          "Gas fees on Arc are paid in USDC, not ETH.",
          "Arc is EVM-compatible.",
          "AgentFlow is currently on Arc Testnet.",
          "Arc Testnet explorer: testnet.arcscan.app",
        ],
      },
      {
        id: "arc-handles",
        title: ".arc handles",
        summary:
          ".arc handles are human-readable names for Arc wallets used in AgentPay.",
        facts: [
          ".arc handles are like usernames for Arc wallets e.g. snehal.arc or jack.arc.",
          "You can send USDC to any registered .arc handle.",
          "AgentFlow resolves .arc handles to wallet addresses automatically.",
          "If a handle is not registered on AgentPay it cannot receive payments.",
        ],
      },
    ],
  },
  {
    id: "payments",
    label: "Payments",
    topics: [
      {
        id: "agentpay",
        title: "AgentPay",
        summary:
          "AgentPay is the payments surface for sending, requesting, receiving, scheduling, and tracking USDC payments.",
        facts: [
          "AgentPay can send USDC to .arc names, saved contacts, or wallet addresses.",
          "It can create payment requests, links, QR receive flows, invoices, splits, batch payouts, and scheduled payments.",
          "Risky money-moving actions preview first and require explicit confirmation before execution.",
          "Chat can also help check payment history, pending requests, invoices, contacts, and scheduled payments.",
        ],
      },
      {
        id: "payment-links-qr",
        title: "Payment links and QR receive",
        summary:
          "AgentPay can create payment links and QR receive flows for USDC requests on Arc.",
        facts: [
          "Users can ask for a payment link or QR code to request USDC.",
          "Payment link and QR creation is a receive/request flow; it does not move funds by itself.",
          "If the amount is missing, AgentFlow should ask how much USDC to request.",
          "Payment links can use .arc handles, saved contacts, or wallet addresses when available.",
          "When the current user has a registered .arc name, payment links for their own address should prefer that .arc name; otherwise direct wallet addresses are allowed.",
          "Payment link remarks/notes are encoded in the link as remark and should prefill the payment page note/reference field.",
        ],
      },
      {
        id: "payment-requests",
        title: "Payment requests",
        summary:
          "AgentPay can request USDC from a person, .arc handle, or wallet address without moving funds immediately.",
        facts: [
          'Say "request 10 USDC from alice.arc" to create a payment request.',
          "Payment requests notify the payer and let them approve or decline later.",
          "Payment requests do not move funds immediately and do not need YES confirmation.",
          "If you want a shareable request flow, ask for a payment link or QR code instead.",
          "Payment requests can include a remark or note for context.",
        ],
      },
      {
        id: "invoices",
        title: "Invoices",
        summary: "AgentFlow can create, send, and manage USDC invoices.",
        facts: [
          'Create an invoice by saying "create invoice for jack.arc 50 USDC for design work".',
          "Invoices include recipient, amount, description, and invoice number.",
          "Invoice CSV uploads are supported on web and Telegram for one invoice row. The first row must contain invoice so the upload is not confused with BatchPay.",
          "Example invoice CSV: invoice then recipient,amount,currency,description then jack.arc,50,USDC,website work. AgentFlow generates the INV-* invoice number automatically.",
          'Check invoice status by saying "show my invoices".',
          "Invoices are settled in USDC on Arc.",
        ],
      },
      {
        id: "contacts",
        title: "Contacts",
        summary:
          "AgentFlow saves contacts so you can pay people by name instead of address.",
        facts: [
          'Save a contact by saying "save alice as alice.arc".',
          'Use contact names in payment commands: "send 10 USDC to alice".',
          'Show contacts by saying "show my contacts".',
          "Update or delete contacts anytime.",
          "Contacts are wallet-scoped and private to your account.",
        ],
      },
    ],
  },
  {
    id: "bulk-recurring",
    label: "Bulk & recurring",
    topics: [
      {
        id: "schedule-payments",
        title: "Scheduled payments",
        summary: "AgentFlow can create recurring USDC payments on a schedule.",
        facts: [
          "Schedule daily, weekly, or monthly USDC payments to any .arc handle or address.",
          "You can create a scheduled payment directly from chat; CSV is optional on web, not required.",
          'Say "pay jack.arc 10 USDC every monday" to create a schedule.',
          'Example schedule payment chat command: "pay jack.arc 10 USDC every friday" or "send 25 USDC to alice.arc every month".',
          'Say "show my scheduled payments" to see active schedules.',
          'Say "cancel my weekly payment to jack.arc" to cancel.',
          "Scheduled payments run automatically from your execution wallet when the cron worker processes due payments.",
          "Due scheduled payments are processed by the cron worker at 09:00 UTC daily; schedules are date-based, not exact user-selected hour based.",
          "Schedule CSV uploads are also supported on web for a single schedule row with columns such as recipient, amount, currency, frequency, day, remark.",
          "Example schedule CSV: recipient,amount,currency,frequency,day,remark then jack.arc,10,USDC,weekly,Monday,cleaning.",
          "Schedule CSV may include schedule_name as an optional first column; it is not BatchPay CSV.",
        ],
      },
      {
        id: "split-payments",
        title: "Split payments",
        summary:
          "AgentFlow can split a USDC amount across multiple recipients in one command.",
        facts: [
          "Split payments across 2 to 10 recipients.",
          'Say "split 30 USDC between alice.arc and bob.arc" to split equally.',
          'You can add a shared remark in chat, for example: "split 30 USDC between alice.arc and bob.arc for dinner".',
          "You can run a split directly from chat; CSV is optional when you prefer uploading a recipient list.",
          'Example chat command: "split 90 USDC between alice.arc, bob.arc, and charlie.arc for team lunch".',
          "Each recipient gets an equal share by default.",
          "Split payments preview first and require YES confirmation.",
          'For split CSV uploads, provide one total amount to divide, e.g. first line "split,30,dinner", then a recipient header and recipient rows.',
          'Example Split CSV: first line "split,30,dinner", second line "recipient", then rows like "alice.arc" and "bob.arc".',
          "Do not put per-recipient amounts in split CSV; use BatchPay when each row has its own amount.",
          'Telegram and web detect Split CSV when the filename contains "split" or the first row starts with "split,...". The total amount and optional remark come from the first row, not from the filename.',
        ],
      },
      {
        id: "batch-payments",
        title: "Batch payments",
        summary:
          "AgentFlow supports bulk USDC payouts to multiple recipients in one run.",
        facts: [
          "You can start a batch directly from chat by naming multiple recipients and amounts in one message.",
          'Example chat command: "batch pay alice.arc 10, bob.arc 20, and charlie.arc 30".',
          "CSV upload is optional on web when you already have a payroll or payout sheet.",
          "BatchPay CSV format is recipient,amount,remark with one payment amount per recipient row.",
          "Do not use BatchPay CSV for schedule creation or equal split totals; use Schedule CSV or Split CSV for those workflows.",
          "Supports up to 500 recipients in one batch.",
          "Used for DAO payroll, team salaries, and contractor payouts.",
          'Say "batch pay alice.arc 10 and bob.arc 20" to start from chat, or upload a CSV file.',
          "Batch payments preview total and recipient count before execution.",
        ],
      },
    ],
  },
  {
    id: "trade-earn",
    label: "Trade & earn",
    topics: [
      {
        id: "swap",
        title: "Token swaps",
        summary:
          "AgentFlow can swap between Arc tokens using the best available route.",
        facts: [
          "Swap USDC to EURC or EURC to USDC directly from chat.",
          "AgentFlow finds the best price automatically across available swap protocols.",
          'Say "swap 10 USDC to EURC" to get a preview, then confirm with YES.',
          "Slippage protection is applied automatically.",
          "Swaps execute via the AgentFlow execution wallet (DCW) on Arc.",
        ],
      },
      {
        id: "vault",
        title: "Vault and yield",
        summary:
          "AgentFlow supports depositing USDC into yield-bearing vaults on Arc.",
        facts: [
          "Deposit USDC into vaults to earn yield.",
          "Withdraw from vaults anytime.",
          'Say "show vaults" to see available options.',
          'Say "deposit 100 USDC in vault" to get a preview, then confirm with YES.',
          "Vault positions are visible in your portfolio.",
        ],
      },
      {
        id: "prediction-markets",
        title: "Prediction markets",
        summary:
          "AgentFlow supports prediction market trading on Arc via natural language chat.",
        facts: [
          "Browse live prediction markets and see current outcome probabilities.",
          'Buy outcome shares with USDC using natural language like "bet 5 USDC on yes".',
          "Sell shares, redeem winnings on resolved markets, and refund cancelled markets.",
          "Markets use LMSR pricing and are settled in USDC on Arc.",
          'Say "show prediction markets" to browse, or "bet X USDC on yes for [market]" to trade.',
        ],
      },
    ],
  },
  {
    id: "bridge",
    label: "Bridge",
    topics: [
      {
        id: "bridge",
        title: "Bridge to Arc",
        summary:
          "Bridge to Arc uses the web app native Circle BridgeKit flow from a connected EOA on the source chain.",
        facts: [
          "Bridge to Arc moves USDC from a supported source chain into the user AgentFlow wallet on Arc.",
          "The source chain wallet must have USDC and enough native gas to approve and sign the source-chain transaction.",
          "The bridge starts from the connected wallet on the source chain, then AgentFlow completes the Arc receive step.",
          'Users can ask how bridge works, ask for supported source chains, or start directly with a request like "bridge 1 USDC from Base Sepolia to Arc".',
          "If the user names only a source chain, AgentFlow asks for the amount next.",
        ],
      },
      {
        id: "bridge-source-chains",
        title: "Bridge source chains",
        summary:
          "Bridge to Arc currently supports 21 source chains through the Circle source registry.",
        facts: [
          "Supported bridge sources are Ethereum Sepolia, Avalanche Fuji, OP Sepolia, Arbitrum Sepolia, Base Sepolia, Polygon Amoy, Unichain Sepolia, Linea Sepolia, Codex Testnet, Sonic Testnet, World Chain Sepolia, Monad Testnet, Sei Testnet, XDC Apothem, HyperEVM Testnet, Ink Testnet, Plume Testnet, EDGE Testnet, Injective Testnet, Morph Testnet, and Pharos Atlantic.",
          "The best source is usually the supported chain where the connected wallet already has USDC and enough native gas.",
          "Users can ask which bridge chains are supported before choosing a source, or name a specific source chain to start.",
          "Bridge uses CCTP-style source domains maintained in the bridge source registry.",
        ],
      },
    ],
  },
  {
    id: "wallets-funds",
    label: "Wallets & funds",
    topics: [
      {
        id: "portfolio-funds",
        title: "Portfolio and funds",
        summary:
          "Portfolio and funds show the user execution wallet, Gateway reserve, balances, vault shares, recent activity, and PnL context.",
        facts: [
          "The AgentFlow execution wallet / DCW is the default wallet for in-chat execution.",
          "Gateway reserve is USDC liquidity used for x402 and agent-to-agent payments.",
          "Portfolio is for live holdings, vault shares, recent activity, and wallet-level PnL context.",
          "The Funding page moves USDC directly between your connected wallet (EOA) and your execution wallet (DCW) on Arc.",
        ],
      },
      {
        id: "funding",
        title: "Funding (deposit and withdraw)",
        summary:
          "The Funding page moves USDC directly between your connected wallet (EOA) and your AgentFlow execution wallet (DCW) on Arc, and links the testnet faucet.",
        facts: [
          "Deposit sends USDC from your connected wallet (EOA) straight to your execution wallet (DCW) as a normal Arc USDC transfer.",
          "Withdraw sends USDC from your execution wallet (DCW) back to your connected wallet (EOA).",
          "Both wallets must be on Arc; the page prompts you to switch your wallet to Arc Testnet if needed.",
          "Use the Circle testnet faucet to get Arc test USDC into your EOA, then deposit it to the DCW.",
          "Funding moves your own USDC between EOA and DCW; it is separate from Bridge, which brings USDC in from another source chain.",
          "The Funding page no longer routes through the Gateway reserve; deposits and withdrawals are direct EOA-to-DCW transfers.",
        ],
      },
      {
        id: "gateway-dcw",
        title: "Gateway and execution wallet",
        summary: "AgentFlow uses a three-wallet model for safe execution.",
        facts: [
          "Connected wallet (EOA): your browser wallet used for login/session signing and Bridge to Arc source-chain signing.",
          "Gateway reserve: USDC staging area for funding agent execution.",
          "Execution wallet (DCW): the wallet agents use to execute swaps, payments, and trades.",
          "Fund the execution wallet (DCW) by depositing USDC from your connected wallet (EOA) on the Funding page; the Gateway reserve is used for x402 and agent-to-agent payments, not for the EOA-to-DCW funding flow.",
          "Your connected wallet is not the default automated execution wallet; chat execution normally uses the DCW.",
          "Gateway auto top-up: when you run a paid agent and your Gateway reserve is too low to cover the x402 payment, AgentFlow automatically moves USDC from your execution wallet (DCW) into the Gateway to cover it.",
          "The Gateway auto top-up refills to a small target balance (about 10 USDC by default, configurable) so you do not have to fund the Gateway manually before each paid action.",
        ],
      },
      {
        id: "execution-wallet",
        title: "Execution wallet",
        summary:
          "AgentFlow separates connected EOA identity/signing from the Agent wallet / DCW execution mode.",
        facts: [
          "EOA is the connected wallet used for identity, session signing, and the bridge source-chain signature.",
          "DCW / Agent wallet is the default execution wallet for in-chat actions like swaps, vaults, prediction markets, and AgentPay workflows.",
          "When an action can move funds, AgentFlow should preview the real action and ask for explicit confirmation only after creating pending backend state.",
        ],
      },
      {
        id: "wallet-roles",
        title: "Wallet roles",
        summary:
          "AgentFlow separates user identity, source-chain signing, Gateway funding, and DCW execution.",
        facts: [
          "EOA refers to the connected browser wallet used for identity and Bridge to Arc source-chain signing.",
          "DCW refers to the AgentFlow execution wallet used by agents for normal chat execution.",
          "Gateway reserve holds USDC used for x402 and agent funding flows.",
          "Bridge source-chain signing happens from the connected EOA because gas and USDC are on the source chain.",
          "Swaps, vaults, prediction markets, and AgentPay workflows normally execute from the DCW on Arc.",
        ],
      },
    ],
  },
  {
    id: "ai-features",
    label: "AI features",
    topics: [
      {
        id: "research",
        title: "Research",
        summary:
          "Research is a multi-agent report pipeline for external topics and portfolio-aware analysis.",
        facts: [
          "The research pipeline runs Research, Analyst, and Writer steps.",
          "Research usually takes 1-2 minutes and uses live retrieval with source checks.",
          "External research uses live retrieval, source checks, and dated evidence before writing the final report.",
          "For private AgentFlow data such as portfolio, invoices, contacts, and payments, AgentFlow should use internal context first.",
          "Research answers are informational by default and do not ask you to confirm anything unless you later start a real action.",
        ],
      },
      {
        id: "image-analysis",
        title: "Image and attachment analysis",
        summary:
          "Image and attachment analysis reads real attached screenshots, photos, text files, and single-page PDFs rather than guessing from text.",
        facts: [
          "Attach the file first, then ask AgentFlow to analyze, describe, summarize, or extract text.",
          "Vision should run on the actual attachment when the user asks about an uploaded image.",
          "The Vision agent supports screenshots, images, text files, and single-page PDFs.",
          "Vision has a guarded daily cap, defaulting to 5 attachment analyses per wallet per day unless configured otherwise.",
          "Image analysis is separate from mic dictation and voice to text.",
        ],
      },
      {
        id: "voice-to-text",
        title: "Voice to text",
        summary:
          "Voice to text is the mic dictation feature in the chat composer. It turns spoken audio into editable chat text.",
        facts: [
          "Click the mic icon beside the send button to start recording.",
          "Allow microphone permission if the browser asks.",
          "Speak naturally, then click the mic again to stop.",
          "AgentFlow transcribes the recording into the input box so the user can edit or send it.",
          "Use the small dropdown beside the mic icon to choose a different microphone input.",
          "Voice to text is not an upload/research/analyzer workflow; it is for composing chat messages by speaking.",
        ],
      },
      {
        id: "semantic-memory",
        title: "Semantic memory",
        summary:
          "AgentFlow remembers context, preferences, and past interactions across sessions.",
        facts: [
          "AgentFlow stores memory about your preferences, saved contacts, and past workflows.",
          "Memory persists across sessions so you do not need to repeat yourself.",
          "Memory is wallet-scoped and private to your account.",
          "AgentFlow uses memory to give more personalized and accurate responses over time.",
        ],
      },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    topics: [
      {
        id: "agent-store",
        title: "Agent Store",
        summary:
          "The Agent Store lists core AgentFlow system agents and published agents with status, price, and reputation.",
        facts: [
          "Core system agents include Research, Swap, Vault, Prediction Markets, Bridge, Portfolio, Invoice, Vision, Voice Input, Schedule, Split, and Batch.",
          "The Agent Store merges built-in system agents with active or pending published agents.",
          "Each agent can show availability, category, USDC price, reputation score, owner wallet, token id, and agent card metadata.",
          "Every agent has its own on-chain identity on Arc: a dedicated agent wallet address and a unique ERC-8004 agent ID (token id), shown on its agent card.",
          "The agent wallet address is where that agent receives x402 payments; the ERC-8004 agent ID is what its on-chain reputation and ratings are recorded against.",
          "Voice Input appears as a free perception agent with guarded daily caps.",
        ],
      },
      {
        id: "reputation",
        title: "Reputation and ratings (ERC-8004)",
        summary:
          "AgentFlow records agent reputation on-chain through the ERC-8004 Reputation Registry on Arc, built from real buyer ratings of paid tasks.",
        facts: [
          "After a paid task, you can rate the agent from 1 to 5 stars; each star maps to a score out of 100 (5 stars = 100).",
          "Ratings are written on-chain as ERC-8004 feedback, so every rating is a verifiable on-chain trace, not just a database row.",
          "Each paid task can be rated once, and a rating is tied to the real settlement of that task — you can only rate paid work that belongs to your wallet.",
          "Ratings are web-chat only for now; internal research pipeline sub-agents (analyst and writer) are not separately user-rated.",
          "An agent only accepts ratings once it is ERC-8004 registered (it has an on-chain agent id).",
          "The reputation score shown in the Agent Store is the true on-chain ERC-8004 aggregate of all buyer feedback for that agent; agents with no on-chain feedback show 0.",
          "Reputation is buyer-and-seller verifiable: every paid run, agent-to-agent payment, and rating settles in USDC and leaves an on-chain trace.",
        ],
      },
      {
        id: "telegram",
        title: "Telegram continuity",
        summary:
          "You can link AgentFlow to Telegram and continue the same wallet-backed workflows there.",
        facts: [
          "Connect the same wallet on the web app first so AgentFlow can carry your profile into Telegram.",
          "Then open AgentFlow in Telegram and continue using the same linked account.",
          "Swaps, research, and AgentPay features work in Telegram.",
          'Telegram supports BatchPay CSV and Split CSV uploads. Split CSV is detected when the filename contains "split" or the first row starts like split,30,dinner. The amount and optional remark are read from the first row.',
          "Telegram payment confirmations preserve the original recipient, amount, and remark when formatting receipts.",
          "If Telegram is linked, AgentFlow can notify you there when longer research finishes.",
        ],
      },
    ],
  },
  {
    id: "safety-limits",
    label: "Safety & limits",
    topics: [
      {
        id: "security-confirmations",
        title: "Security and confirmations",
        summary:
          "AgentFlow should only ask for YES after it has created a real pending action or preview.",
        facts: [
          "Money-moving actions preview first and require explicit YES confirmation before execution.",
          "If a user says YES without a pending action, AgentFlow should ask what action they want instead of guessing.",
          "The backend blocks direct confirmed swap or vault execution unless the user confirmed through chat.",
          "Emergency withdrawals require an explicit CONFIRM flow and wallet-signed ownership checks.",
          "Withdraw and emergency stop style actions are never blocked by normal pay-per-task rate limits.",
        ],
      },
      {
        id: "limits-and-caps",
        title: "Limits and caps",
        summary:
          "AgentFlow has wallet-scoped rate limits and daily caps to keep paid agent work controlled.",
        facts: [
          "Default pay-per-task rate limits are 50 actions per wallet per day and 10 actions per wallet per minute unless configured otherwise.",
          "A maximum transaction size limit can be configured with PAY_PER_TASK_MAX_TX_USDC.",
          "Vision defaults to 5 attachment analyses per wallet per day unless VISION_DAILY_LIMIT is changed.",
          "Voice input defaults to 5 transcriptions per wallet per day unless TRANSCRIBE_DAILY_LIMIT is changed.",
          "Never-limited safety actions include withdraw, gateway withdraw, gateway-to-execution, emergency withdraw, vault withdraw, and emergency stop.",
        ],
      },
      {
        id: "troubleshooting",
        title: "Troubleshooting",
        summary:
          "Common AgentFlow errors usually come from missing context, missing funds, source-chain gas, or no pending confirmation.",
        facts: [
          "If bridge asks for gas, it means the connected wallet needs native gas on the selected source chain to sign the source-chain transaction.",
          'If AgentFlow says it did not catch an amount, the user can reply with a plain number like "1" after AgentFlow asks for the bridge amount.',
          "If YES is not understood, there may be no pending backend action; ask the user what action they want to confirm.",
          "If voice input is requested, guide the user to the mic button beside the send button instead of treating YES as a generic action.",
          "If a legacy bridge error appears, route the user to the native web bridge flow instead of retrying an outdated backend path.",
        ],
      },
    ],
  },
];
