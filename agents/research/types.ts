export type ResearchBrief = {
  query: string;
  intent: string;
  scope: 'broad' | 'narrow';
  time_sensitivity: 'live' | 'recent' | 'historical';
  required_freshness_days: number;
  geography: string[];
  domains_priority: string[];
  domains_avoid: string[];
  preferred_source_types: string[];
  must_answer: string[];
  avoid_drift: string[];
  minimum_source_diversity: number;
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

export type StructuredResearchFactStatus = 'confirmed' | 'reported' | 'analysis';
export type StructuredResearchConfidence = 'high' | 'medium' | 'low';

export type StructuredResearch = {
  topic: string;
  scope: {
    timeframe: string;
    entities: string[];
    questions: string[];
  };
  executive_summary: string;
  facts: Array<{
    claim: string;
    value: string;
    status: StructuredResearchFactStatus;
    date_or_period: string;
    confidence: StructuredResearchConfidence;
    support: string;
    source_name: string;
    source_url: string;
  }>;
  recent_developments: Array<{
    event: string;
    status: StructuredResearchFactStatus;
    date_or_period: string;
    importance: string;
    support: string;
    source_name: string;
    source_url: string;
  }>;
  metrics: Array<{
    name: string;
    value: string;
    unit: string;
    date_or_period: string;
    support: string;
    source_name: string;
    source_url: string;
  }>;
  comparisons: Array<{
    entity: string;
    strengths: string[];
    weaknesses: string[];
    evidence: string;
  }>;
  risks_or_caveats: string[];
  open_questions: string[];
  sources: Array<{
    name: string;
    url: string;
    used_for: string;
  }>;
};

export type SourceDiagnostics = {
  source_count: number;
  distinct_domains: number;
  required_distinct_sources: number;
  high_reliability_sources: number;
  medium_reliability_sources: number;
  low_reliability_sources: number;
  has_sufficient_diversity: boolean;
  drift_risk: 'low' | 'medium' | 'high';
  drift_reasons: string[];
  top_domains: string[];
};
