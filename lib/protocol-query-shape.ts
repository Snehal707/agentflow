export type ProtocolQueryShape = 'none' | 'weak_status' | 'strong_crypto';

const LEADING_QUERY_SCAFFOLD_RE =
  /^(?:make\s+a?\s*research\s+on|make\s+research\s+on|research\s+on|research|tell\s+me\s+about|give\s+me|what\s+is|what's|analyze|analysis\s+of|overview\s+of)\s+/i;

const STRONG_CRYPTO_CUE_RE =
  /\b(yield|yields|yielding|staking|liquidity|tvl|protocol|protocols|dex|exchange|perp|perps|vault|vaults|bridge|bridges|l2|layer 2|ecosystem|tokenomics|airdrop|onchain)\b/i;

const WEAK_STATUS_CUE_RE = /\b(current state|current status|status|state)\b/i;

const NON_PROTOCOL_DOMAIN_RE =
  /\b(argentina|ukraine|milei|ceasefire|semiconductor|semiconductors|fintech|regulations?|economy|tariffs?|sanctions?|fed|inflation|rates?|gdp|war|conflict|china|iran|israel|russia|shipping|hormuz|restrictions?)\b/i;

const GENERIC_HEAD_TOKENS = new Set([
  'a',
  'an',
  'about',
  'analysis',
  'analyze',
  'best',
  'compare',
  'comparison',
  'current',
  'defi',
  'ecosystem',
  'find',
  'for',
  'give',
  'how',
  'latest',
  'market',
  'news',
  'on',
  'opportunities',
  'overview',
  'price',
  'protocol',
  'research',
  'show',
  'state',
  'status',
  'tell',
  'the',
  'today',
  'vs',
  'what',
  'yield',
  'yields',
]);

function normalizeProtocolTask(task: string): string {
  return task
    .replace(/\bExecution context:[\s\S]*$/i, ' ')
    .replace(/[?.,:;()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(LEADING_QUERY_SCAFFOLD_RE, '')
    .trim()
    .toLowerCase();
}

function isBrandLikeToken(token: string, minLength = 4): boolean {
  if (!token || token.length < minLength) return false;
  if (!/[a-z]/i.test(token)) return false;
  if (GENERIC_HEAD_TOKENS.has(token)) return false;
  if (NON_PROTOCOL_DOMAIN_RE.test(token)) return false;
  return /^[a-z0-9-]+$/i.test(token);
}

function extractLeadingEntityTokens(normalizedTask: string): string[] {
  const tokens = normalizedTask.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const [first, second, third] = tokens;
  if (first && second === 'vs' && third) {
    return [first, third];
  }

  return first ? [first] : [];
}

export function detectProtocolQueryShape(task: string): ProtocolQueryShape {
  const normalizedTask = normalizeProtocolTask(task);
  if (!normalizedTask) return 'none';
  if (NON_PROTOCOL_DOMAIN_RE.test(normalizedTask)) return 'none';

  const entityTokens = extractLeadingEntityTokens(normalizedTask);
  if (entityTokens.length === 0) return 'none';

  if (
    STRONG_CRYPTO_CUE_RE.test(normalizedTask) &&
    entityTokens.every((token) => isBrandLikeToken(token))
  ) {
    return 'strong_crypto';
  }

  if (
    WEAK_STATUS_CUE_RE.test(normalizedTask) &&
    entityTokens.length === 1 &&
    isBrandLikeToken(entityTokens[0], 8)
  ) {
    return 'weak_status';
  }

  return 'none';
}

export function isProtocolShapedQuery(task: string): boolean {
  return detectProtocolQueryShape(task) !== 'none';
}
