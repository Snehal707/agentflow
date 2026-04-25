export type ResearchBrief = {
  query: string;
  intent: string;
  time_sensitivity: 'live' | 'recent' | 'historical';
  required_freshness_days: number;
  geography: string[];
  domains_priority: string[];
  domains_avoid: string[];
  sub_questions: string[];
  evaluation_rubric: string;
};

export type Source = {
  url: string;
  title: string;
  date: string;
  snippet: string;
  domain: string;
  reliability: 'high' | 'medium' | 'low';
};

export type Claim = {
  claim: string;
  date: string;
  source_url: string;
  source_type: 'official' | 'news' | 'blog' | 'forum';
  confidence: number;
  supporting_snippet: string;
  entities: string[];
  numbers: string[];
  stance: 'confirms' | 'disputes' | 'neutral';
};

export type VerifiedClaim = Claim & {
  supported_by_count: number;
  is_current: boolean;
  conflicts_with: string[];
  status: 'Confirmed' | 'Reported' | 'Disputed' | 'Outdated' | 'Insufficient';
};

export type LiveFacts = {
  latest_events: Array<{
    date: string;
    event: string;
    source: string;
  }>;
  market_data: Record<string, unknown>;
  prices: Record<string, unknown>;
  timestamps: Record<string, string>;
};
