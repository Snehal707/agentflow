import { callHermesFast } from './hermes';

export type TelegramIntentAction =
  | 'swap'
  | 'bridge'
  | 'vault'
  | 'balance'
  | 'portfolio'
  | 'help'
  | 'unknown';

export type TelegramIntent = {
  action: TelegramIntentAction;
  amount: number | null;
  tokenIn: 'USDC' | 'EURC' | null;
  tokenOut: 'USDC' | 'EURC' | null;
  sourceChain: 'ethereum-sepolia' | 'base-sepolia' | null;
  vaultAction: 'deposit' | 'withdraw' | 'usyc_deposit' | 'usyc_withdraw' | null;
  confidence: 'high' | 'medium' | 'low';
};

const PARSER_SYSTEM_PROMPT = [
  'You are a DeFi intent parser for AgentFlow on Arc Network.',
  "Extract the user's intent from their message.",
  'Be flexible with chain names, token names, and phrasing.',
  '',
  'Chain name normalization:',
  '- sepolia, eth sep, eth sepolia, eth-sepolia, ethereum sep, ethereum sepolia, ethereum-sepolia -> ethereum-sepolia',
  '- base, base sep, base sepolia, base-sepolia -> base-sepolia',
  '- arc, arc testnet, arc network -> arc (destination, always arc)',
  '',
  'Token normalization:',
  '- usdc, USDC, usd coin -> USDC',
  '- eurc, EURC, euro coin -> EURC',
  '',
  'Action normalization:',
  '- swap, trade, exchange, convert, buy, sell -> swap',
  '- bridge, transfer, move, send cross-chain -> bridge',
  '- deposit, stake, put in vault, earn -> vault deposit',
  '- withdraw, unstake, take out, remove -> vault withdraw',
  '- stake in usyc, usyc deposit, buy usyc -> vault usyc_deposit',
  '- redeem usyc -> vault usyc_withdraw',
  '- balance, how much, funds, wallet -> balance',
  '- portfolio, holdings, pnl, performance -> portfolio',
  '',
  'Return ONLY valid JSON. No explanation. No markdown.',
  'Schema:',
  '{',
  '  "action": "swap" | "bridge" | "vault" | "balance" | "portfolio" | "help" | "unknown",',
  '  "amount": number | null,',
  '  "tokenIn": "USDC" | "EURC" | null,',
  '  "tokenOut": "USDC" | "EURC" | null,',
  '  "sourceChain": "ethereum-sepolia" | "base-sepolia" | null,',
  '  "vaultAction": "deposit" | "withdraw" | "usyc_deposit" | "usyc_withdraw" | null,',
  '  "confidence": "high" | "medium" | "low"',
  '}',
  '',
  'If you can reasonably understand what the user wants,',
  'use confidence: high or medium.',
  'Only use confidence: low if truly ambiguous.',
  'Never fail on informal phrasing.',
].join('\n');

const PARSER_TIMEOUT_MS = 3_000;

const DEFAULT_UNKNOWN_INTENT: TelegramIntent = {
  action: 'unknown',
  amount: null,
  tokenIn: null,
  tokenOut: null,
  sourceChain: null,
  vaultAction: null,
  confidence: 'low',
};

export async function parseTelegramIntent(message: string): Promise<TelegramIntent | null> {
  const prompt = [
    'Examples:',
    '"bridge 1 usdc from sepolia to arc" -> {"action":"bridge","amount":1,"tokenIn":"USDC","tokenOut":null,"sourceChain":"ethereum-sepolia","vaultAction":null,"confidence":"high"}',
    '"bridge 0.5 from base to arc" -> {"action":"bridge","amount":0.5,"tokenIn":"USDC","tokenOut":null,"sourceChain":"base-sepolia","vaultAction":null,"confidence":"high"}',
    '"swap 10 usdc to eurc" -> {"action":"swap","amount":10,"tokenIn":"USDC","tokenOut":"EURC","sourceChain":null,"vaultAction":null,"confidence":"high"}',
    '"trade 5 usdc for eurc" -> {"action":"swap","amount":5,"tokenIn":"USDC","tokenOut":"EURC","sourceChain":null,"vaultAction":null,"confidence":"high"}',
    '"put 10 usdc in the vault" -> {"action":"vault","amount":10,"tokenIn":"USDC","tokenOut":null,"sourceChain":null,"vaultAction":"deposit","confidence":"high"}',
    '"take out 5 from vault" -> {"action":"vault","amount":5,"tokenIn":"USDC","tokenOut":null,"sourceChain":null,"vaultAction":"withdraw","confidence":"high"}',
    '"stake 100 in usyc" -> {"action":"vault","amount":100,"tokenIn":"USDC","tokenOut":null,"sourceChain":null,"vaultAction":"usyc_deposit","confidence":"high"}',
    '"redeem 50 usyc" -> {"action":"vault","amount":50,"tokenIn":null,"tokenOut":null,"sourceChain":null,"vaultAction":"usyc_withdraw","confidence":"high"}',
    '"how much do i have" -> {"action":"balance","amount":null,"tokenIn":null,"tokenOut":null,"sourceChain":null,"vaultAction":null,"confidence":"high"}',
    '"show my portfolio" -> {"action":"portfolio","amount":null,"tokenIn":null,"tokenOut":null,"sourceChain":null,"vaultAction":null,"confidence":"high"}',
    '"what is arc network" -> {"action":"unknown","amount":null,"tokenIn":null,"tokenOut":null,"sourceChain":null,"vaultAction":null,"confidence":"medium"}',
    '"should i swap now" -> {"action":"unknown","amount":null,"tokenIn":null,"tokenOut":null,"sourceChain":null,"vaultAction":null,"confidence":"medium"}',
    '',
    `User message: ${message}`,
  ].join('\n');

  try {
    const raw = await withTimeout(callHermesFast(PARSER_SYSTEM_PROMPT, prompt), PARSER_TIMEOUT_MS);
    const parsed = safeParseJson(raw);
    if (!parsed) {
      return DEFAULT_UNKNOWN_INTENT;
    }
    return normalizeIntent(parsed);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function safeParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeIntent(input: unknown): TelegramIntent {
  if (!input || typeof input !== 'object') {
    return DEFAULT_UNKNOWN_INTENT;
  }
  const value = input as Record<string, unknown>;
  const normalized: TelegramIntent = {
    action: normalizeAction(value.action),
    amount: normalizeAmount(value.amount),
    tokenIn: normalizeToken(value.tokenIn),
    tokenOut: normalizeToken(value.tokenOut),
    sourceChain: normalizeSourceChain(value.sourceChain),
    vaultAction: normalizeVaultAction(value.vaultAction),
    confidence: normalizeConfidence(value.confidence),
  };

  if (normalized.action === 'vault' && !normalized.vaultAction) {
    const actionText = stringify(value.action);
    const vaultText = stringify(value.vaultAction);
    const full = `${actionText} ${vaultText}`.toLowerCase();
    if (containsAny(full, ['usyc', 'us yc'])) {
      if (containsAny(full, ['redeem', 'withdraw', 'sell', 'cash out'])) {
        normalized.vaultAction = 'usyc_withdraw';
      } else {
        normalized.vaultAction = 'usyc_deposit';
      }
    } else if (containsAny(actionText, ['withdraw']) || containsAny(vaultText, ['withdraw', 'unstake', 'take out', 'remove'])) {
      normalized.vaultAction = 'withdraw';
    } else if (
      containsAny(actionText, ['deposit']) ||
      containsAny(vaultText, ['deposit', 'stake', 'put in vault', 'earn'])
    ) {
      normalized.vaultAction = 'deposit';
    }
  }

  return normalized;
}

function normalizeAction(value: unknown): TelegramIntentAction {
  const text = stringify(value);
  if (!text) return 'unknown';
  if (containsAny(text, ['swap', 'trade', 'exchange', 'convert', 'buy', 'sell'])) return 'swap';
  if (containsAny(text, ['bridge', 'transfer', 'move', 'send cross-chain'])) return 'bridge';
  if (containsAny(text, ['vault', 'deposit', 'withdraw', 'unstake', 'stake', 'earn', 'take out', 'remove'])) return 'vault';
  if (containsAny(text, ['balance', 'how much', 'funds', 'wallet'])) return 'balance';
  if (containsAny(text, ['portfolio', 'holdings', 'pnl', 'performance'])) return 'portfolio';
  if (containsAny(text, ['help'])) return 'help';
  if (text === 'unknown') return 'unknown';
  return 'unknown';
}

function normalizeAmount(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? Math.abs(amount) : null;
}

function normalizeToken(value: unknown): 'USDC' | 'EURC' | null {
  const token = stringify(value);
  if (!token) return null;
  if (containsAny(token, ['usdc', 'usd coin'])) return 'USDC';
  if (containsAny(token, ['eurc', 'euro coin'])) return 'EURC';
  return null;
}

function normalizeSourceChain(value: unknown): 'ethereum-sepolia' | 'base-sepolia' | null {
  const chain = stringify(value);
  if (!chain) return null;
  if (containsAny(chain, ['base', 'base sep', 'base sepolia', 'base-sepolia'])) {
    return 'base-sepolia';
  }
  if (
    containsAny(chain, ['sepolia', 'eth sep', 'eth sepolia', 'eth-sepolia', 'ethereum sep', 'ethereum sepolia', 'ethereum-sepolia']) &&
    !containsAny(chain, ['base'])
  ) {
    return 'ethereum-sepolia';
  }
  if (containsAny(chain, ['arc', 'arc testnet', 'arc network'])) {
    return null;
  }
  return null;
}

function normalizeVaultAction(value: unknown): TelegramIntent['vaultAction'] {
  const text = stringify(value);
  if (!text) return null;
  if (containsAny(text, ['usyc_deposit', 'usyc-deposit', 'usyc deposit'])) return 'usyc_deposit';
  if (containsAny(text, ['usyc_withdraw', 'usyc-withdraw', 'usyc withdraw'])) return 'usyc_withdraw';
  if (containsAny(text, ['usyc', 'us yc'])) {
    if (containsAny(text, ['redeem', 'withdraw', 'sell'])) return 'usyc_withdraw';
    return 'usyc_deposit';
  }
  if (containsAny(text, ['withdraw', 'unstake', 'take out', 'remove'])) return 'withdraw';
  if (containsAny(text, ['deposit', 'stake', 'put in vault', 'earn'])) return 'deposit';
  return null;
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  const text = stringify(value);
  if (text === 'high' || text === 'medium' || text === 'low') return text;
  return 'low';
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}
