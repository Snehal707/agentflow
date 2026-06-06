import type {
  ResearchBrief,
  Source,
  SourceDiagnostics,
  StructuredResearch,
  StructuredResearchConfidence,
  StructuredResearchFactStatus,
  VerifiedClaim,
} from './types';

type BuildStructuredResearchInput = {
  brief: ResearchBrief;
  verifiedClaims: VerifiedClaim[];
  sources: Source[];
  sourceDiagnostics: SourceDiagnostics;
  markdownReport: string;
};

type RankedClaim = VerifiedClaim & { rank: number };

export function buildStructuredResearch(
  input: BuildStructuredResearchInput,
): StructuredResearch {
  const rankedClaims = rankClaims(input.verifiedClaims);
  const usableClaims = rankedClaims.filter(
    (claim) =>
      claim.status !== 'Disputed' &&
      (input.brief.time_sensitivity === 'historical' || claim.status !== 'Outdated'),
  );
  const factClaims = usableClaims.slice(0, 6);
  const recentClaims = rankedClaims
    .filter((claim) => claim.is_current && isWithinFreshnessWindow(claim.date, input.brief.required_freshness_days))
    .slice(0, 3);
  const metricClaims = usableClaims.filter((claim) => claim.numbers.length > 0).slice(0, 6);
  const selectedItems = [...factClaims, ...recentClaims, ...metricClaims];
  const topEntities = collectTopEntities(rankedClaims).slice(0, 6);
  const sourceUsage = buildSourceUsage(selectedItems, input.sources);

  return {
    topic: input.brief.query,
    scope: {
      timeframe: deriveTimeframe(input.brief),
      entities: topEntities.length ? topEntities : fallbackEntities(input.brief),
      questions: dedupeStrings([...input.brief.must_answer, ...input.brief.sub_questions]).slice(0, 8),
    },
    executive_summary: deriveExecutiveSummary({
      markdownReport: input.markdownReport,
      topic: input.brief.query,
      topFact: factClaims[0],
      topDevelopment: recentClaims[0],
      sourceDiagnostics: input.sourceDiagnostics,
    }),
    facts: factClaims.slice(0, 6).map((claim) => ({
      claim: claim.claim,
      value: deriveClaimValue(claim),
      status: mapClaimStatus(claim.status),
      date_or_period: claim.date || 'Current reporting window',
      confidence: mapConfidence(claim.confidence),
      support: claim.supporting_snippet || claim.claim,
      source_name: sourceNameForUrl(claim.source_url, input.sources),
      source_url: claim.source_url,
    })),
    recent_developments: recentClaims.slice(0, 3).map((claim) => ({
      event: claim.claim,
      status: mapClaimStatus(claim.status),
      date_or_period: claim.date || 'Current reporting window',
      importance: deriveImportance(claim),
      support: claim.supporting_snippet || claim.claim,
      source_name: sourceNameForUrl(claim.source_url, input.sources),
      source_url: claim.source_url,
    })),
    metrics: metricClaims.slice(0, 6).map((claim) => ({
      name: deriveMetricName(claim),
      value: deriveMetricValue(claim),
      unit: deriveMetricUnit(claim),
      date_or_period: claim.date || 'Current reporting window',
      support: claim.supporting_snippet || claim.claim,
      source_name: sourceNameForUrl(claim.source_url, input.sources),
      source_url: claim.source_url,
    })),
    comparisons: [],
    risks_or_caveats: buildRisksOrCaveats(input, rankedClaims).slice(0, 3),
    open_questions: [],
    sources: sourceUsage.slice(0, 4).map((entry) => ({
      name: entry.source.title || entry.source.domain,
      url: entry.source.url,
      used_for: entry.usedFor.join('; '),
    })),
  };
}

function deriveTimeframe(brief: ResearchBrief): string {
  const days = brief.required_freshness_days;
  if (days <= 1) return 'today';
  if (days <= 7) return 'past 7 days';
  if (days <= 30) return 'past 30 days';
  if (brief.time_sensitivity === 'historical') return `historical context within ${days} days`;
  return `past ${days} days`;
}

function rankClaims(claims: VerifiedClaim[]): RankedClaim[] {
  return claims
    .map((claim) => ({
      ...claim,
      rank:
        statusRank(claim.status) * 1_000_000 +
        (claim.is_current ? 100_000 : 0) +
        claim.supported_by_count * 1_000 +
        Math.round(claim.confidence * 100) +
        recencyBonus(claim.date),
    }))
    .sort((left, right) => right.rank - left.rank || left.claim.localeCompare(right.claim));
}

function statusRank(status: VerifiedClaim['status']): number {
  switch (status) {
    case 'Confirmed':
      return 5;
    case 'Reported':
      return 4;
    case 'Insufficient':
      return 3;
    case 'Outdated':
      return 2;
    case 'Disputed':
      return 1;
    default:
      return 0;
  }
}

function recencyBonus(date: string): number {
  const ts = Date.parse(date);
  if (!Number.isFinite(ts)) return 0;
  const ageDays = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
  return Math.max(0, 365 - ageDays);
}

function isWithinFreshnessWindow(date: string, days: number): boolean {
  const ts = Date.parse(date);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= days * 86_400_000;
}

function collectTopEntities(claims: RankedClaim[]): string[] {
  const counts = new Map<string, number>();
  for (const claim of claims) {
    for (const entity of claim.entities) {
      const normalized = entity.trim();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([entity]) => entity);
}

function fallbackEntities(brief: ResearchBrief): string[] {
  return dedupeStrings([brief.query, ...brief.geography]).slice(0, 4);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function deriveExecutiveSummary(input: {
  markdownReport: string;
  topic: string;
  topFact?: VerifiedClaim;
  topDevelopment?: VerifiedClaim;
  sourceDiagnostics: SourceDiagnostics;
}): string {
  const extracted = extractSummarySection(input.markdownReport);
  if (extracted) {
    return extracted;
  }

  const parts = [input.topic.replace(/\s+/g, ' ').trim()];
  if (input.topFact) {
    parts.push(`Key finding: ${trimSentence(input.topFact.claim)}`);
  }
  if (input.topDevelopment && input.topDevelopment !== input.topFact) {
    parts.push(`Recent development: ${trimSentence(input.topDevelopment.claim)}`);
  }
  if (input.sourceDiagnostics.drift_risk !== 'low') {
    parts.push('Coverage is constrained by source diversity or retrieval drift.');
  }
  return parts.join(' ');
}

function extractSummarySection(markdownReport: string): string | null {
  const lines = markdownReport.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!/^#{2,3}\s+(summary|executive summary)\b/i.test(line)) {
      continue;
    }
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor];
      if (/^#{2,3}\s+/.test(next.trim())) {
        break;
      }
      body.push(next);
    }
    const cleaned = body.join(' ').replace(/\s+/g, ' ').trim();
    if (cleaned) {
      return cleaned;
    }
  }
  return null;
}

function trimSentence(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function deriveClaimValue(claim: VerifiedClaim): string {
  return claim.numbers[0] || claim.claim;
}

function mapClaimStatus(status: VerifiedClaim['status']): StructuredResearchFactStatus {
  switch (status) {
    case 'Confirmed':
      return 'confirmed';
    case 'Reported':
    case 'Outdated':
      return 'reported';
    case 'Disputed':
    case 'Insufficient':
    default:
      return 'analysis';
  }
}

function mapConfidence(confidence: number): StructuredResearchConfidence {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

function deriveImportance(claim: VerifiedClaim): string {
  if (claim.supported_by_count >= 2 && claim.confidence >= 0.8) {
    return 'High-confidence current development';
  }
  if (claim.confidence >= 0.6) {
    return 'Material recent development';
  }
  return 'Emerging development with limited confirmation';
}

function deriveMetricName(claim: VerifiedClaim): string {
  const match = claim.claim.match(/^([^:.-]{3,80})[:.-]/);
  if (match?.[1]) {
    return match[1].trim();
  }
  const entity = claim.entities[0];
  if (entity) {
    return entity;
  }
  return claim.claim.slice(0, 80).trim();
}

function deriveMetricValue(claim: VerifiedClaim): string {
  return claim.numbers[0] || claim.claim;
}

function deriveMetricUnit(claim: VerifiedClaim): string {
  const number = claim.numbers[0];
  if (!number) return '';
  const escaped = escapeRegExp(number);
  const unitMatch = claim.claim.match(new RegExp(`${escaped}\\s*([A-Za-z%$]+)`));
  return unitMatch?.[1] ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceNameForUrl(url: string, sources: Source[]): string {
  const direct = sources.find((source) => source.url === url);
  if (direct) {
    return direct.title || direct.domain;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function buildRisksOrCaveats(
  input: BuildStructuredResearchInput,
  rankedClaims: RankedClaim[],
): string[] {
  const caveats: string[] = [];
  const creatorMetricsQuery =
    /\b(subscribers?|followers?|views?|audience|reach)\b/i.test(input.brief.query) &&
    /\b(youtube|channel|creator|streamer|influencer|tiktok|instagram|x|twitter|mrbeast)\b/i.test(input.brief.query);
  if (input.sourceDiagnostics.drift_risk !== 'low') {
    caveats.push(...input.sourceDiagnostics.drift_reasons);
  }
  for (const claim of rankedClaims) {
    if (creatorMetricsQuery && claim.date) {
      const ts = Date.parse(claim.date);
      if (Number.isFinite(ts)) {
        const ageDays = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
        if (ageDays > 21) {
          caveats.push(`Freshness caveat: subscriber/audience evidence is older than three weeks (${claim.date}).`);
        }
      }
    }
    if (claim.status === 'Disputed') {
      caveats.push(`Disputed evidence: ${claim.claim}`);
    } else if (!claim.is_current && claim.status !== 'Confirmed') {
      caveats.push(`Freshness caveat: ${claim.claim}`);
    } else if (claim.confidence < 0.5) {
      caveats.push(`Low-confidence evidence: ${claim.claim}`);
    }
    if (caveats.length >= 3) {
      break;
    }
  }
  return dedupeStrings(caveats);
}

function buildSourceUsage(claims: VerifiedClaim[], sources: Source[]): Array<{
  source: Source;
  usedFor: string[];
  score: number;
}> {
  const byUrl = new Map(
    sources.map((source) => [source.url, { source, usedFor: [] as string[], score: sourceReliabilityScore(source) }]),
  );
  for (const claim of claims) {
    const entry = byUrl.get(claim.source_url);
    if (!entry) continue;
    entry.score += 10 + claim.supported_by_count;
    entry.usedFor.push(labelClaimUsage(claim));
  }
  return [...byUrl.values()]
    .filter((entry) => entry.usedFor.length > 0)
    .sort((left, right) => right.score - left.score || left.source.domain.localeCompare(right.source.domain))
    .map((entry) => ({
      ...entry,
      usedFor: dedupeStrings(entry.usedFor).slice(0, 3),
    }));
}

function sourceReliabilityScore(source: Source): number {
  switch (source.reliability) {
    case 'high':
      return 30;
    case 'medium':
      return 20;
    case 'low':
    default:
      return 10;
  }
}

function labelClaimUsage(claim: VerifiedClaim): string {
  if (claim.numbers.length > 0) {
    return `metric: ${claim.claim}`;
  }
  if (claim.is_current) {
    return `development: ${claim.claim}`;
  }
  return `fact: ${claim.claim}`;
}
