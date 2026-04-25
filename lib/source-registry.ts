export type SourceMethod =
  | 'rss'
  | 'rss_plus_scrape'
  | 'scrape'
  | 'official_api'
  | 'scrape_or_api'
  | 'scrape_or_rss';

export type SourceTrust = 'high' | 'medium_high' | 'medium' | 'low_medium';

export interface SourceConfig {
  name: string;
  baseUrl: string;
  topics: string[];
  trust: SourceTrust;
  method: SourceMethod;
  cost: 'low' | 'medium' | 'high';
  speed: 'fast' | 'medium' | 'slow';
  rssUrls?: string[];
  priority: number;
  enabled: boolean;
}

export const SOURCE_REGISTRY: SourceConfig[] = [
  // High trust news
  {
    name: 'Reuters',
    baseUrl: 'https://www.reuters.com',
    topics: ['world', 'politics', 'economy', 'business', 'markets', 'geopolitics'],
    trust: 'high',
    method: 'rss',
    cost: 'low',
    speed: 'fast',
    rssUrls: [
      'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best',
      'https://www.reutersagency.com/feed/?best-topics=technology&post_type=best',
      'https://www.reutersagency.com/feed/?best-topics=world&post_type=best',
    ],
    priority: 10,
    enabled: true,
  },
  {
    name: 'BBC',
    baseUrl: 'https://www.bbc.com',
    topics: ['world', 'politics', 'science', 'technology', 'business'],
    trust: 'high',
    method: 'rss',
    cost: 'low',
    speed: 'fast',
    rssUrls: [
      'http://feeds.bbci.co.uk/news/world/rss.xml',
      'http://feeds.bbci.co.uk/news/technology/rss.xml',
      'http://feeds.bbci.co.uk/news/business/rss.xml',
    ],
    priority: 9,
    enabled: true,
  },
  // Tech
  {
    name: 'TechCrunch',
    baseUrl: 'https://techcrunch.com',
    topics: ['ai', 'startups', 'tech', 'funding', 'saas', 'product'],
    trust: 'medium_high',
    method: 'rss_plus_scrape',
    cost: 'low',
    speed: 'fast',
    rssUrls: ['https://techcrunch.com/feed/'],
    priority: 9,
    enabled: true,
  },
  {
    name: 'Ars Technica',
    baseUrl: 'https://arstechnica.com',
    topics: ['ai', 'tech', 'science', 'security', 'gadgets'],
    trust: 'medium_high',
    method: 'rss_plus_scrape',
    cost: 'low',
    speed: 'fast',
    rssUrls: ['https://feeds.arstechnica.com/arstechnica/index'],
    priority: 8,
    enabled: true,
  },
  // Cybersecurity
  {
    name: 'The Hacker News',
    baseUrl: 'https://thehackernews.com',
    topics: ['cybersecurity', 'malware', 'cve', 'breach', 'exploit', 'threat'],
    trust: 'medium_high',
    method: 'rss',
    cost: 'low',
    speed: 'fast',
    rssUrls: ['https://feeds.feedburner.com/TheHackersNews'],
    priority: 10,
    enabled: true,
  },
  {
    name: 'BleepingComputer',
    baseUrl: 'https://www.bleepingcomputer.com',
    topics: ['cybersecurity', 'windows', 'malware', 'breach', 'vulnerability'],
    trust: 'medium_high',
    method: 'rss_plus_scrape',
    cost: 'low',
    speed: 'fast',
    rssUrls: ['https://www.bleepingcomputer.com/feed/'],
    priority: 9,
    enabled: true,
  },
  {
    name: 'Krebs on Security',
    baseUrl: 'https://krebsonsecurity.com',
    topics: ['cybersecurity', 'fraud', 'breach', 'crime'],
    trust: 'medium_high',
    method: 'rss',
    cost: 'low',
    speed: 'fast',
    rssUrls: ['https://krebsonsecurity.com/feed/'],
    priority: 8,
    enabled: true,
  },
  // Research / AI
  {
    name: 'arXiv',
    baseUrl: 'https://arxiv.org',
    topics: ['ai', 'ml', 'research', 'science', 'llm'],
    trust: 'high',
    method: 'official_api',
    cost: 'low',
    speed: 'medium',
    rssUrls: [
      'https://export.arxiv.org/rss/cs.AI',
      'https://export.arxiv.org/rss/cs.LG',
    ],
    priority: 10,
    enabled: true,
  },
  // Community
  {
    name: 'Hacker News',
    baseUrl: 'https://news.ycombinator.com',
    topics: ['tech', 'ai', 'startups', 'dev_tools', 'community'],
    trust: 'medium',
    method: 'scrape',
    cost: 'low',
    speed: 'fast',
    priority: 7,
    enabled: true,
  },
  // DeFi / Crypto
  {
    name: 'CoinGecko',
    baseUrl: 'https://www.coingecko.com',
    topics: ['crypto', 'defi', 'token', 'bitcoin', 'ethereum', 'markets'],
    trust: 'high',
    method: 'official_api',
    cost: 'low',
    speed: 'fast',
    priority: 10,
    enabled: true,
  },
  {
    name: 'DefiLlama',
    baseUrl: 'https://defillama.com',
    topics: ['defi', 'tvl', 'protocol', 'yield', 'arc', 'blockchain'],
    trust: 'high',
    method: 'official_api',
    cost: 'low',
    speed: 'fast',
    priority: 10,
    enabled: true,
  },
  {
    name: 'Arc Network',
    baseUrl: 'https://arc.network',
    topics: ['arc', 'circle', 'stablecoin', 'l1', 'blockchain'],
    trust: 'high',
    method: 'scrape',
    cost: 'low',
    speed: 'fast',
    priority: 10,
    enabled: true,
  },
];

export interface TopicClassification {
  labels: string[];
  intent: 'news' | 'research' | 'market' | 'community' | 'defi' | 'mixed';
}

const RULES: Array<{
  pattern: RegExp;
  labels: string[];
  intent: TopicClassification['intent'];
}> = [
  {
    pattern:
      /\b(cyber|malware|ransomware|cve|exploit|breach|phishing|vulnerabilit|threats?|hack|attack|security)\b/i,
    labels: ['cybersecurity'],
    intent: 'news',
  },
  {
    // Do not use bare "research" — it matches the verb in "research cybersecurity…"
    // and wrongly tags security queries as AI. Require ML/LLM signals or academic phrasing.
    pattern:
      /\b(ai|llm|agents?\b|gpt|claude|nous|hackathon|machine learning|deep learning|neural|arxiv|research paper|peer review|scientific study|language model)\b/i,
    labels: ['ai', 'research'],
    intent: 'research',
  },
  {
    pattern: /\b(startup|funding|vc|saas|product launch|acquisition|series)\b/i,
    labels: ['startups', 'tech'],
    intent: 'news',
  },
  {
    pattern: /\b(bitcoin|ethereum|crypto|defi|token|nft|web3|blockchain)\b/i,
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
      /\b(market|macro|economy|rates|inflation|fed|gdp|geopolitics|oil|war)\b/i,
    labels: ['markets', 'economy', 'world'],
    intent: 'market',
  },
  {
    pattern:
      /\b(reddit|community|sentiment|opinion|discussion|people think)\b/i,
    labels: ['community'],
    intent: 'community',
  },
];

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

export function selectSources(query: string, maxSources = 5): SourceConfig[] {
  const { labels } = classifyTopic(query);
  const queryLower = query.toLowerCase();
  const topicMatchHaystack = stripLeadingResearchVerb(query).toLowerCase();

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
    score += overlap * 3;

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

    return { source: s, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const result = scored.slice(0, maxSources).map((s) => s.source);

  const hasHighTrust = result.some((s) => s.trust === 'high');
  if (!hasHighTrust && scored.length > 0) {
    const highTrust = scored.find((s) => s.source.trust === 'high');
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
