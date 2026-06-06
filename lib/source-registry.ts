import {
  SOURCE_REGISTRY,
  type SourceConfig,
  type SourceMethod,
  type SourceTrust,
} from './source-registry-loader';
import { detectProtocolQueryShape } from './protocol-query-shape';

export { SOURCE_REGISTRY } from './source-registry-loader';
export type { SourceConfig, SourceMethod, SourceTrust } from './source-registry-loader';
export interface TopicClassification {
  labels: string[];
  intent: 'news' | 'research' | 'market' | 'community' | 'defi' | 'mixed';
}

const EXACT_CRYPTO_ASSET_RULES: Array<{ asset: string; pattern: RegExp }> = [
  { asset: 'bitcoin', pattern: /\b(bitcoin|btc)\b/i },
  { asset: 'ethereum', pattern: /\b(ethereum|eth)\b/i },
  { asset: 'solana', pattern: /\b(solana|sol)\b/i },
  { asset: 'xrp', pattern: /\b(xrp|ripple)\b/i },
  { asset: 'bnb', pattern: /\b(bnb|binance coin)\b/i },
  { asset: 'dogecoin', pattern: /\b(dogecoin|doge)\b/i },
  { asset: 'litecoin', pattern: /\b(litecoin|ltc)\b/i },
  { asset: 'cardano', pattern: /\b(cardano|ada)\b/i },
  { asset: 'avalanche', pattern: /\b(avalanche|avax)\b/i },
  { asset: 'chainlink', pattern: /\b(chainlink|link)\b/i },
];

const BROAD_REPORT_CUE_RE =
  /\b(report|analysis|overview|brief|summary|status|market|price|outlook|news|latest|current)\b/i;

const SPECIALIZED_CRYPTO_SOURCE_TOPICS = new Set([
  'bridges',
  'derivatives',
  'indexing',
  'yield',
  'protocol',
  'exchange',
]);

const PREDICTION_MARKET_CUE_RE = /\b(prediction|forecast|odds|probability|polymarket|kalshi|manifold)\b/i;
const STABLECOIN_CUE_RE = /\b(stablecoin|stablecoins|usdc|usdt|dai|eurc)\b/i;

const RULES: Array<{
  pattern: RegExp;
  labels: string[];
  intent: TopicClassification['intent'];
}> = [
  {
    pattern:
      /\b(cyber|malware|ransomware|cve|exploits?|exploited|breach|phishing|vulnerabilit(?:y|ies)?|threats?|hack|attack|security)\b/i,
    labels: ['cybersecurity'],
    intent: 'news',
  },
  {
    // Do not use bare "research" — it matches the verb in "research cybersecurity…"
    // and wrongly tags security queries as AI. Require ML/LLM signals or academic phrasing.
    pattern:
      /\b(ai|llm|agents?\b|gpt|claude|openai|anthropic|deepmind|mistral|hugging face|nous|hackathon|machine learning|deep learning|neural|arxiv|research paper|peer review|scientific study|language model)\b/i,
    labels: ['ai', 'research'],
    intent: 'research',
  },
  {
    pattern:
      /\b(x402|payments?|payment rails?|merchant acceptance|checkout|processor|processors|fintech|commerce|billing|invoice payments?|micropayments?)\b/i,
    labels: ['payments', 'fintech', 'commerce', 'finance'],
    intent: 'research',
  },
  {
    pattern: /\b(startup|funding|vc|saas|product launch|acquisition|series)\b/i,
    labels: ['startups', 'tech'],
    intent: 'news',
  },
  {
    pattern:
      /\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|bnb|crypto|defi|token|tokens|nft|web3|blockchain|stablecoins?|altcoins?)\b|(?=.*\b(?:crypto|blockchain|chain|token|tokens|defi|bitcoin|btc|ethereum|eth|solana|sol|xrp|bnb)\b)\b(?:l1|l2|layer 1|layer 2)\b/i,
    labels: ['crypto', 'defi'],
    intent: 'defi',
  },
  {
    pattern: /\b(arc|circle|usdc|eurc|stablecoin|cctp|dcw)\b/i,
    labels: ['arc', 'defi', 'stablecoin'],
    intent: 'defi',
  },
  {
    pattern:
      /\b(market|macro|economy|rates|inflation|fed|gdp|geopolitics|oil|war|stock|stocks|equity|earnings|treasury|bond|bonds|forex|fx|central bank)\b/i,
    labels: ['markets', 'economy', 'world'],
    intent: 'market',
  },
  {
    pattern:
      /\b(india|rbi|sebi|nse|bse|mumbai|delhi|rupee)\b/i,
    labels: ['india', 'markets', 'economy'],
    intent: 'market',
  },
  {
    pattern:
      /\b(health|medical|drug|trial|clinical|disease|cdc|who|fda)\b/i,
    labels: ['health', 'medical'],
    intent: 'research',
  },
  {
    pattern:
      /\b(climate|weather|emission|carbon|energy|oil|gas|commodity|commodities)\b/i,
    labels: ['climate', 'energy', 'environment'],
    intent: 'research',
  },
  {
    pattern:
      /\b(legal|court|law|regulation|sanction|sec|cftc|federal register|congress)\b/i,
    labels: ['legal', 'government', 'regulation'],
    intent: 'research',
  },
  {
    pattern:
      /\b(reddit|community|sentiment|opinion|discussion|people think)\b/i,
    labels: ['community'],
    intent: 'community',
  },
];

const GENERIC_FALLBACK_TOPICS = new Set([
  'world',
  'news',
  'politics',
  'business',
  'economy',
  'research',
  'reference',
  'government',
  'law',
  'data',
]);

const SPECIALIZED_FALLBACK_TOPICS = new Set([
  'ai',
  'arc',
  'blockchain',
  'crypto',
  'cybersecurity',
  'defi',
  'ethereum',
  'llm',
  'malware',
  'markets',
  'model',
  'onchain',
  'security',
  'stablecoin',
  'stocks',
  'threat',
  'token',
  'vulnerability',
  'web3',
]);

const GENERAL_FALLBACK_SOURCE_NAMES = new Set([
  'Reuters',
  'BBC',
  'AP News',
  'The Guardian',
  'NPR',
  'Wikipedia',
]);

const CRYPTO_BACKGROUND_SOURCE_NAMES = new Set([
  'Wikipedia',
  'Reuters',
  'BBC',
  'AP News',
  'The Guardian',
]);

const ACADEMIC_OR_STRUCTURED_REFERENCE_SOURCE_NAMES = new Set([
  'Wikidata',
  'OpenAlex',
  'Semantic Scholar',
]);

const CRYPTO_FALLBACK_TOPICS = new Set([
  'crypto',
  'defi',
  'blockchain',
  'token',
  'web3',
  'onchain',
  'stablecoin',
  'ethereum',
  'l2',
]);

export function classifyTopic(query: string): TopicClassification {
  const matched: string[] = [];
  let intent: TopicClassification['intent'] = 'mixed';

  for (const rule of RULES) {
    if (rule.pattern.test(query)) {
      matched.push(...rule.labels);
      intent = rule.intent;
    }
  }

  return {
    labels: [...new Set(matched)],
    intent: matched.length > 0 ? intent : 'mixed',
  };
}

function stripLeadingResearchVerb(q: string): string {
  // "research cybersecurity …" should not score arXiv's topic "research" via substring match.
  return q.replace(/^\s*research\s+/i, '').trim();
}

function detectExactCryptoAsset(query: string): string | null {
  for (const rule of EXACT_CRYPTO_ASSET_RULES) {
    if (rule.pattern.test(query)) return rule.asset;
  }
  return null;
}

function isBroadAssetResearchQuery(query: string): boolean {
  return BROAD_REPORT_CUE_RE.test(query) || query.trim().split(/\s+/).length <= 4;
}

function isGeneralMarketOrReferenceSource(source: SourceConfig): boolean {
  return (
    source.topics.includes('markets') ||
    CRYPTO_BACKGROUND_SOURCE_NAMES.has(source.name)
  );
}

export function selectSources(query: string, maxSources = 5): SourceConfig[] {
  const { labels } = classifyTopic(query);
  const protocolQueryShape = detectProtocolQueryShape(query);
  const queryLower = query.toLowerCase();
  const topicMatchHaystack = stripLeadingResearchVerb(query).toLowerCase();
  const exactCryptoAsset = detectExactCryptoAsset(query);
  const broadAssetResearch = exactCryptoAsset ? isBroadAssetResearchQuery(query) : false;

  const scored = SOURCE_REGISTRY.filter((s) => s.enabled).map((s) => {
    let score = 0;

    const overlap = s.topics.filter((t) => {
      if (labels.includes(t)) return true;
      if (t.length < 3) return false;
      try {
        return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
          topicMatchHaystack,
        );
      } catch {
        return topicMatchHaystack.includes(t);
      }
    }).length;
    if (queryLower.includes(s.name.toLowerCase())) {
      score += 6;
    }
    score += overlap * 3;

    if (exactCryptoAsset && s.topics.includes(exactCryptoAsset)) {
      score += 8;
    }
    if (exactCryptoAsset && broadAssetResearch && isGeneralMarketOrReferenceSource(s)) {
      score += 4;
    }
    if (exactCryptoAsset && broadAssetResearch && CRYPTO_BACKGROUND_SOURCE_NAMES.has(s.name)) {
      score += 6;
    }
    if (exactCryptoAsset && broadAssetResearch && s.name === 'Wikipedia') {
      score += 5;
    }
    if (
      exactCryptoAsset &&
      broadAssetResearch &&
      ACADEMIC_OR_STRUCTURED_REFERENCE_SOURCE_NAMES.has(s.name)
    ) {
      score -= 7;
    }
    if (
      exactCryptoAsset &&
      broadAssetResearch &&
      !s.topics.includes(exactCryptoAsset) &&
      s.topics.some((topic) => SPECIALIZED_CRYPTO_SOURCE_TOPICS.has(topic))
    ) {
      score -= 6;
    }
    if (
      exactCryptoAsset &&
      broadAssetResearch &&
      !PREDICTION_MARKET_CUE_RE.test(query) &&
      s.topics.includes('prediction markets')
    ) {
      score -= 8;
    }
    if (
      exactCryptoAsset &&
      broadAssetResearch &&
      !STABLECOIN_CUE_RE.test(query) &&
      s.topics.includes('stablecoin')
    ) {
      score -= 5;
    }

    const trustScore: Record<SourceTrust, number> = {
      high: 4,
      medium_high: 3,
      medium: 2,
      low_medium: 1,
    };
    score += trustScore[s.trust];

    if (s.speed === 'fast') score += 2;
    if (s.speed === 'medium') score += 1;

    if (s.cost === 'low') score += 1;

    score += s.priority * 0.5;

    return { source: s, score, overlap };
  });

  let topicMatched =
    labels.length > 0
      ? scored.filter(
          (s) =>
            s.overlap > 0 ||
            Boolean(
              exactCryptoAsset &&
                broadAssetResearch &&
                isGeneralMarketOrReferenceSource(s.source),
            ),
        )
      : protocolQueryShape !== 'none'
        ? scored.filter((s) => s.source.topics.some((topic) => CRYPTO_FALLBACK_TOPICS.has(topic)))
      : scored.filter((s) => GENERAL_FALLBACK_SOURCE_NAMES.has(s.source.name));

  if (labels.length === 0 && topicMatched.length === 0) {
    topicMatched = scored.filter(
      (s) =>
        s.source.topics.some((topic) => GENERIC_FALLBACK_TOPICS.has(topic)) &&
        !s.source.topics.some((topic) => SPECIALIZED_FALLBACK_TOPICS.has(topic)),
    );
  }
  const pool = topicMatched.length > 0 ? topicMatched : scored;

  pool.sort((a, b) => b.score - a.score);

  const result = pool.slice(0, maxSources).map((s) => s.source);

  const hasHighTrust = result.some((s) => s.trust === 'high');
  if (!hasHighTrust && pool.length > 0) {
    const highTrust = pool.find((s) => s.source.trust === 'high');
    if (highTrust) {
      result[result.length - 1] = highTrust.source;
    }
  }

  return result;
}

export function scoreArticle(article: {
  relevance: number;
  trust: SourceTrust;
  freshness: number;
  uniqueness: number;
  extractionConfidence: number;
}): number {
  const trustNum: Record<SourceTrust, number> = {
    high: 1.0,
    medium_high: 0.8,
    medium: 0.6,
    low_medium: 0.4,
  };

  return (
    0.4 * article.relevance +
    0.25 * trustNum[article.trust] +
    0.2 * article.freshness +
    0.1 * article.uniqueness +
    0.05 * article.extractionConfidence
  );
}
