type PhraseSeed = {
  verbs: readonly string[];
  objects: readonly string[];
  suffixes: readonly string[];
};

type PhraseCorpus = Record<string, string[]>;

const AGENT_SEEDS: Record<string, PhraseSeed> = {
  balance: {
    verbs: ['show', 'check', 'pull', 'read', 'tell me'],
    objects: ['my balances', 'my USDC balance', 'my wallet funds', 'my Arc balances'],
    suffixes: ['right now', 'live', 'before I do anything', 'for this wallet', 'on Arc'],
  },
  portfolio: {
    verbs: ['show', 'generate', 'prepare', 'analyze', 'summarize'],
    objects: ['my portfolio', 'my holdings', 'my positions', 'my wallet report'],
    suffixes: ['after live scan', 'with current balances', 'as a report', 'for this wallet', 'on Arc'],
  },
  swap: {
    verbs: ['swap', 'convert', 'trade', 'exchange', 'move'],
    objects: ['1 USDC to EURC', '2 USDC for EURC', '0.5 EURC to USDC', '3 USDC into EURC'],
    suffixes: ['then wait for YES', 'with preview first', 'and simulate it', 'on Arc', 'for me'],
  },
  vault: {
    verbs: ['deposit', 'stake', 'withdraw', 'unstake', 'move'],
    objects: ['1 USDC in the vault', '2 USDC into yield', '3 USDC from vault', '5 USDC to the vault'],
    suffixes: ['with preview first', 'then wait for YES', 'on Arc', 'for yield', 'and show the result'],
  },
  bridge: {
    verbs: ['bridge', 'move', 'send', 'transfer', 'bring'],
    objects: [
      '1 USDC from eth sepolia to Arc',
      '2 USDC from eth sepolia to Arc',
      '3 USDC from eth sepolia to Arc',
      '4 USDC from eth sepolia to Arc',
      '5 USDC from eth sepolia to Arc',
      '6 USDC from eth sepolia to Arc',
      '7 USDC from eth sepolia to Arc',
      '8 USDC from eth sepolia to Arc',
      '9 USDC from eth sepolia to Arc',
      '10 USDC from eth sepolia to Arc',
      '1 USDC from ethereum sepolia to Arc',
      '2 USDC from ethereum sepolia to Arc',
      '10 USDC from ethereum sepolia to Arc',
      '1 USDC from eth-sepolia to Arc',
      '1 USDC from eth sep to Arc',
      '2 USDC from eth sep to Arc',
      '10 USDC from eth sep to Arc',
      '1 USDC from ethereum sep to Arc',
      '10 USDC from ethereum sep to Arc',
      '1 USDC from eth on sepolia to Arc',
      '1 USDC from ethereum on sepolia to Arc',
      '1 USDC from etherium sepolia to Arc',
      '1 USDC from eth sepolia into Arc',
      '1 USDC from ethereum sepolia into Arc',
      '1 USDC from base sepolia to Arc',
      '2 USDC from base sepolia to Arc',
      '5 USDC from base sepolia to Arc',
      '10 USDC from base sepolia to Arc',
      '1 USDC from base-sepolia to Arc',
      '1 USDC from base to Arc',
      '2 USDC from base to Arc',
      '10 USDC from base to Arc',
      '1 USDC from base sep to Arc',
      '2 USDC from base sep to Arc',
      '10 USDC from base sep to Arc',
      '1 USDC from base on sepolia to Arc',
      '0.5 USDC from eth sepolia to my Arc wallet',
      '0.5 USDC from ethereum sep to my Arc wallet',
      '0.5 USDC from eth sep to my Arc wallet',
      '0.5 USDC from ethereum sepolia to my Arc wallet',
      '2 USDC from base sep to my Arc wallet',
      '2 USDC from base to my Arc wallet',
      '2 USDC from base sepolia to my Arc wallet',
      '2 USDC from base on sepolia to my Arc wallet',
      '3 USDC off eth sepolia into Arc',
      '3 USDC off eth sep into Arc',
      '3 USDC off base sepolia into Arc',
      '3 USDC off base sep into Arc',
      'two USDC from eth sepolia to Arc',
      'three USDC from eth sepolia to Arc',
      'five USDC from eth sep to Arc',
      'ten USDC from eth sepolia to Arc',
      'a couple of USDC from eth sepolia to Arc',
      'half USDC from eth sepolia to Arc',
      '2 usdc from base on sepolia into arc wallet',
      '4 usdc over from eth sep to arc',
      '7 usdc off base into arc',
      '10 usdc from etherium sepolia into arc',
      '1o usdc from eth sepolia to arc',
      'all my USDC from eth sepolia to Arc',
      'all my USDC from base sepolia to Arc',
      'USDC from eth sepolia into Arc',
      'USDC from eth sep into Arc',
      'USDC from base into Arc',
      '1 USDC over from eth sep to Arc',
      '1 USDC over from base sep to Arc',
      '5 USDC from Ethereum Sepolia into Arc Testnet',
      '5 USDC from Base Sepolia into Arc Testnet',
    ],
    suffixes: ['', 'for me', 'right now'],
  },
  research: {
    verbs: ['research', 'analyze', 'prepare', 'generate', 'write'],
    objects: ['Arc Network', 'USDC markets', 'DeFi yields', 'Circle Gateway'],
    suffixes: ['as a sourced report', 'with live sources', 'deep mode', 'with analyst and writer', 'for me'],
  },
  agentpay_send: {
    verbs: ['pay', 'send', 'transfer', 'settle', 'move'],
    objects: ['1 USDC to alice.arc', '2 USDC to jack', '5 USDC to 0x1111111111111111111111111111111111111111', '3 USDC to my vendor'],
    suffixes: ['with preview first', 'then wait for YES', 'through AgentPay', 'from my DCW', 'and record it'],
  },
  agentpay_request: {
    verbs: ['request', 'ask for', 'charge', 'bill', 'collect'],
    objects: ['1 USDC from alice.arc', '5 USDC from jack', '10 USDC from the client', '2 USDC from my vendor'],
    suffixes: ['as a payment request', 'through AgentPay', 'with a note', 'for this wallet', 'and track it'],
  },
  contacts: {
    verbs: ['save', 'add', 'update', 'delete', 'show'],
    objects: ['alice as alice.arc', 'vendor as 0x1111111111111111111111111111111111111111', 'my contacts', 'alice address'],
    suffixes: ['in contacts', 'for payments', 'so I can pay by name', 'in my address book', 'for AgentPay'],
  },
  schedule: {
    verbs: ['schedule', 'automate', 'repeat', 'start', 'cancel'],
    objects: ['1 USDC to alice.arc weekly', '5 USDC to jack every month', 'my recurring payments', 'the weekly payment'],
    suffixes: ['through AgentPay', 'with preview first', 'from my DCW', 'and list it', 'if active'],
  },
  split: {
    verbs: ['split', 'divide', 'share', 'pay equally', 'send each'],
    objects: ['10 USDC between alice.arc and bob.arc', '30 USDC among three people', 'the bill with alice and bob', '5 USDC each to alice and bob'],
    suffixes: ['with preview first', 'then wait for YES', 'through split agent', 'equally', 'and record it'],
  },
  batch: {
    verbs: ['batch pay', 'payroll', 'bulk pay', 'pay multiple', 'send batch'],
    objects: ['alice.arc,1 and bob.arc,1', 'this CSV payout', 'the payroll rows', 'everyone in this list'],
    suffixes: ['with preview first', 'then wait for YES', 'through batch agent', 'from my DCW', 'and record payouts'],
  },
  invoice: {
    verbs: ['create invoice', 'send invoice', 'bill', 'make invoice', 'prepare invoice'],
    objects: ['alice.arc 10 USDC for design', 'vendor 25 USDC for services', 'client 5 USDC for testing', 'jack.arc 12 USDC for work'],
    suffixes: ['with preview first', 'then wait for YES', 'and request payment', 'through AgentPay', 'and track status'],
  },
  vision: {
    verbs: ['analyze', 'read', 'inspect', 'scan', 'review'],
    objects: ['this crypto image', 'this chart screenshot', 'this invoice image', 'this market graphic'],
    suffixes: ['with vision agent', 'and summarize it', 'and trigger research if useful', 'from the upload', 'for finance context'],
  },
  transcribe: {
    verbs: ['transcribe', 'convert', 'listen to', 'extract text from', 'summarize transcript of'],
    objects: ['this audio', 'this voice note', 'the uploaded clip', 'the recording'],
    suffixes: ['with transcribe agent', 'as text only', 'without research follow-up', 'from the upload', 'and return transcript'],
  },
  treasury: {
    verbs: ['check', 'show', 'run', 'inspect', 'top up'],
    objects: ['treasury stats', 'agent treasury', 'agent wallet funding', 'x402 owner balances'],
    suffixes: ['for all agents', 'from economy stats', 'for low agents', 'now', 'hourly'],
  },
};

const A2A_SEEDS: Record<string, PhraseSeed> = {
  swap_to_portfolio: {
    verbs: ['swap', 'convert', 'trade', 'exchange', 'move'],
    objects: ['1 USDC to EURC then portfolio report', '2 USDC to EURC and analyze my holdings', 'USDC to EURC then summarize portfolio', '1 USDC to EURC followed by wallet report'],
    suffixes: ['A2A', 'after confirmation', 'one by one', 'after the swap executes', 'with portfolio agent'],
  },
  vault_to_portfolio: {
    verbs: ['deposit', 'stake', 'withdraw', 'unstake', 'move'],
    objects: ['1 USDC into vault then portfolio report', '2 USDC to yield and summarize holdings', 'USDC from vault then show positions', '5 USDC vault deposit followed by portfolio'],
    suffixes: ['A2A', 'after confirmation', 'one by one', 'after vault execution', 'with portfolio agent'],
  },
  bridge_to_portfolio: {
    verbs: ['bridge', 'move', 'send', 'transfer', 'bring'],
    objects: [
      '1 USDC from Base Sepolia then portfolio report',
      'USDC from Ethereum Sepolia and scan holdings',
      '2 USDC to Arc followed by portfolio',
      '0.5 USDC from Base then wallet report',
      '1 USDC from eth sep then portfolio',
      '2 USDC from eth sep then portfolio',
      '5 USDC from eth sepolia then show my portfolio',
      '10 USDC from eth sepolia then explain my wallet',
      '1 USDC from ethereum sepolia and show holdings',
      '0.5 USDC from base sep then scan my wallet',
      '2 USDC from base on sepolia then portfolio report',
      'three USDC from eth sepolia then portfolio report',
      'ten USDC from base sep then portfolio report',
      '1o usdc from eth sepolia then show my holdings',
    ],
    suffixes: ['A2A', 'after confirmation', 'one by one', 'after bridge execution', 'with portfolio agent'],
  },
  split_to_portfolio: {
    verbs: ['split', 'divide', 'share', 'pay equally', 'send each'],
    objects: ['10 USDC between alice and bob then portfolio report', '30 USDC among recipients and summarize wallet', '5 USDC each then show positions', 'the bill then portfolio report'],
    suffixes: ['A2A', 'after confirmation', 'one by one', 'after split executes', 'with portfolio agent'],
  },
  batch_to_portfolio: {
    verbs: ['batch pay', 'payroll', 'bulk pay', 'pay multiple', 'send batch'],
    objects: ['the CSV then portfolio report', 'alice and bob payouts then scan holdings', 'payroll rows and summarize wallet', 'everyone then portfolio'],
    suffixes: ['A2A', 'after confirmation', 'one by one', 'after batch executes', 'with portfolio agent'],
  },
  invoice_to_research: {
    verbs: ['invoice', 'bill', 'create invoice for', 'send invoice to', 'prepare invoice for'],
    objects: ['vendor 20 USDC then research vendor', 'alice 25 USDC and verify reputation', 'supplier 50 USDC followed by risk report', 'client 15 USDC then background check'],
    suffixes: ['A2A', 'after confirmation', 'one by one', 'after invoice creation', 'with research agent'],
  },
  vision_to_research: {
    verbs: ['analyze', 'scan', 'inspect', 'review', 'read'],
    objects: ['this chart then research it', 'this crypto image and generate research', 'this finance screenshot then market report', 'uploaded image followed by research'],
    suffixes: ['A2A', 'if research-worthy', 'one by one', 'after vision analysis', 'with research agent'],
  },
  research_to_analyst: {
    verbs: ['research', 'investigate', 'retrieve sources for', 'deep research', 'look up'],
    objects: ['Arc then analyst review', 'USDC markets then analyze findings', 'Gateway sources followed by analyst', 'DeFi topic then analyst pass'],
    suffixes: ['A2A', 'pipeline', 'one by one', 'with analyst agent', 'before writer'],
  },
  analyst_to_writer: {
    verbs: ['analyze', 'review', 'structure', 'score', 'summarize'],
    objects: ['findings then write report', 'research notes followed by writer', 'analyst output then final report', 'source claims then writer pass'],
    suffixes: ['A2A', 'pipeline', 'one by one', 'with writer agent', 'after analyst'],
  },
};

function buildUniquePhrases(seed: PhraseSeed, count = 100): string[] {
  const phrases: string[] = [];
  for (const verb of seed.verbs) {
    for (const object of seed.objects) {
      for (const suffix of seed.suffixes) {
        phrases.push(`${verb} ${object} ${suffix}`.replace(/\s+/g, ' ').trim());
        if (phrases.length === count) return phrases;
      }
    }
  }
  return Array.from(new Set(phrases)).slice(0, count);
}

export const AGENTFLOW_AGENT_INTENT_PHRASES: PhraseCorpus = Object.fromEntries(
  Object.entries(AGENT_SEEDS).map(([key, seed]) => [key, buildUniquePhrases(seed)]),
);

export const AGENTFLOW_A2A_INTENT_PHRASES: PhraseCorpus = Object.fromEntries(
  Object.entries(A2A_SEEDS).map(([key, seed]) => [key, buildUniquePhrases(seed)]),
);

export function assertAgentFlowIntentPhraseCorpus(minimum = 100): void {
  const all = {
    ...AGENTFLOW_AGENT_INTENT_PHRASES,
    ...AGENTFLOW_A2A_INTENT_PHRASES,
  };
  for (const [key, phrases] of Object.entries(all)) {
    const unique = new Set(phrases);
    if (phrases.length < minimum || unique.size !== phrases.length) {
      throw new Error(
        `Intent phrase corpus ${key} has ${phrases.length} phrases and ${unique.size} unique phrases; expected ${minimum} unique phrases.`,
      );
    }
  }
}

export const AGENTFLOW_FASTPATH_INTENT_GUIDE = [
  'AgentFlow fast-path intent guide:',
  '- Interpret compound requests left-to-right. Execute the first state-changing action first; only run follow-up reports or A2A work after the required YES confirmation.',
  '- Phrases like "then", "after", "once done", "follow with", "and generate", "also show", and "A2A" indicate sequential work, not ambiguity.',
  '- Portfolio follow-ups after swap, vault, bridge, split, or batch mean the Portfolio Agent should run after the execution completes.',
  '- Vendor/reputation follow-ups after invoice creation mean Invoice Agent -> Research Agent after the invoice is confirmed.',
  '- Vision image follow-ups may trigger Vision Agent -> Research Agent when the image content is finance/crypto/research-worthy.',
  '- If the user explicitly asks for a follow-up report or A2A hop, return that downstream agent output in chat after the first action finishes. Do not hide it in background logs only.',
  '- For 2-3 task messages, preserve dependency order: preview the first money-moving action, wait for YES, execute it, then run the requested read/report/research hop, then continue any independent informational response.',
  '- If multiple money-moving actions are requested together, execute only the first preview-confirm action and tell the user the remaining transfers will wait for a separate confirmation after the first one completes.',
  '- Transcribe returns transcript text only; do not auto-trigger Transcribe -> Research.',
].join('\n');
