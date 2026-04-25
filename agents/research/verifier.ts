import { callHermesFast } from '../../lib/hermes';
import type { Claim, ResearchBrief, VerifiedClaim } from './types';

export async function verifyClaims(
  brief: ResearchBrief,
  claims: Claim[],
): Promise<VerifiedClaim[]> {
  if (!claims.length) {
    return [];
  }

  const systemPrompt = `Return valid JSON only.

Verify and classify claims.
Return an array with this exact shape:
{
  "claim": string,
  "date": string,
  "source_url": string,
  "source_type": "official" | "news" | "blog" | "forum",
  "confidence": number,
  "supporting_snippet": string,
  "entities": string[],
  "numbers": string[],
  "stance": "confirms" | "disputes" | "neutral",
  "supported_by_count": number,
  "is_current": boolean,
  "conflicts_with": string[],
  "status": "Confirmed" | "Reported" | "Disputed" | "Outdated" | "Insufficient"
}

Do not collapse conflicting claims. Preserve disputes.`;

  const raw = await callHermesFast(
    systemPrompt,
    JSON.stringify(
      {
        brief,
        claims,
      },
      null,
      2,
    ),
  );

  const parsed = parseVerifiedClaims(raw);
  if (parsed.length > 0) {
    return enforceFreshness(parsed, brief.required_freshness_days);
  }

  return enforceFreshness(
    claims.map((claim) => ({
      ...claim,
      supported_by_count: 1,
      is_current: true,
      conflicts_with: [],
      status: claim.stance === 'disputes' ? 'Disputed' : 'Reported',
    })),
    brief.required_freshness_days,
  );
}

function parseVerifiedClaims(raw: string): VerifiedClaim[] {
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeVerifiedClaim(item))
      .filter((item): item is VerifiedClaim => item !== null);
  } catch {
    return [];
  }
}

function normalizeVerifiedClaim(value: unknown): VerifiedClaim | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const row = value as Record<string, unknown>;
  const claim = typeof row.claim === 'string' ? row.claim.trim() : '';
  const sourceUrl = typeof row.source_url === 'string' ? row.source_url.trim() : '';
  if (!claim || !sourceUrl) {
    return null;
  }

  return {
    claim,
    date: typeof row.date === 'string' ? row.date : '',
    source_url: sourceUrl,
    source_type:
      row.source_type === 'official' ||
      row.source_type === 'news' ||
      row.source_type === 'blog' ||
      row.source_type === 'forum'
        ? row.source_type
        : 'news',
    confidence:
      typeof row.confidence === 'number' && Number.isFinite(row.confidence)
        ? Math.max(0, Math.min(1, row.confidence))
        : 0.5,
    supporting_snippet:
      typeof row.supporting_snippet === 'string' ? row.supporting_snippet : '',
    entities: Array.isArray(row.entities)
      ? row.entities.filter((item): item is string => typeof item === 'string')
      : [],
    numbers: Array.isArray(row.numbers)
      ? row.numbers.filter((item): item is string => typeof item === 'string')
      : [],
    stance:
      row.stance === 'confirms' || row.stance === 'disputes' || row.stance === 'neutral'
        ? row.stance
        : 'neutral',
    supported_by_count:
      typeof row.supported_by_count === 'number' && Number.isFinite(row.supported_by_count)
        ? Math.max(0, Math.round(row.supported_by_count))
        : 1,
    is_current: Boolean(row.is_current),
    conflicts_with: Array.isArray(row.conflicts_with)
      ? row.conflicts_with.filter((item): item is string => typeof item === 'string')
      : [],
    status:
      row.status === 'Confirmed' ||
      row.status === 'Reported' ||
      row.status === 'Disputed' ||
      row.status === 'Outdated' ||
      row.status === 'Insufficient'
        ? row.status
        : 'Reported',
  };
}

function enforceFreshness(
  claims: VerifiedClaim[],
  requiredFreshnessDays: number,
): VerifiedClaim[] {
  return claims.map((claim) => {
    const isCurrent = isClaimCurrent(claim.date, requiredFreshnessDays);
    if (!isCurrent) {
      return {
        ...claim,
        is_current: false,
        status: 'Outdated',
      };
    }
    return {
      ...claim,
      is_current: claim.is_current || isCurrent,
    };
  });
}

function isClaimCurrent(date: string, requiredFreshnessDays: number): boolean {
  if (!date) {
    return true;
  }
  const ts = Date.parse(date);
  if (!Number.isFinite(ts)) {
    return true;
  }
  const ageDays = Math.floor((Date.now() - ts) / 86_400_000);
  return ageDays <= requiredFreshnessDays;
}
