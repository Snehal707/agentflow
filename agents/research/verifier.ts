import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

Do not collapse conflicting claims. Preserve disputes.
Return exactly one verification row per input claim.
Do not summarize, merge, or collapse multiple input claims into one row.
If you cannot fully verify a claim, still include one row for that claim using the best supported status, such as "Reported" or "Disputed" when appropriate.
The output array length should match the input claim count exactly.`;

  const traceEnabled = process.env.VERIFY_TRACE_ENABLED === '1';
  const fixtureName = process.env.VERIFY_TRACE_FIXTURE || 'unknown-fixture';
  const runAt = new Date().toISOString();
  const traceStartedAt = Date.now();

  // Approximation of input size; excludes chat template overhead
  // added by the provider. Useful for run-to-run comparison on
  // the same fixture; not exact token count.
  const promptPayload = JSON.stringify(
    {
      brief,
      claims,
    },
    null,
    2,
  );
  const inputPromptCharLength = systemPrompt.length + promptPayload.length;

  const hermesStartedAt = Date.now();
  const raw = await callHermesFast(
    systemPrompt,
    promptPayload,
  );
  const hermesBatchCallLatencyMs = Date.now() - hermesStartedAt;

  const parseStartedAt = Date.now();
  const parsed = parseVerifiedClaims(raw);
  const parseLatencyMs = Date.now() - parseStartedAt;

  let usedFallback = false;
  const parsedClaimCount = parsed.length;
  const coverageRatio = claims.length > 0 ? parsed.length / claims.length : 1;
  const coverageGuardrailTriggered = claims.length > 0 && coverageRatio < 0.5;
  let freshnessEnforcementLatencyMs = 0;
  let finalVerified: VerifiedClaim[];

  if (parsed.length > 0 && !coverageGuardrailTriggered) {
    const freshnessStartedAt = Date.now();
    finalVerified = enforceFreshness(parsed, brief.required_freshness_days);
    freshnessEnforcementLatencyMs = Date.now() - freshnessStartedAt;
  } else {
    usedFallback = true;
    const freshnessStartedAt = Date.now();
    finalVerified = enforceFreshness(
      claims.map((claim) => ({
        ...claim,
        supported_by_count: 1,
        is_current: true,
        conflicts_with: [],
        status: claim.stance === 'disputes' ? 'Disputed' : 'Reported',
      })),
      brief.required_freshness_days,
    );
    freshnessEnforcementLatencyMs = Date.now() - freshnessStartedAt;
  }

  const totalStageLatencyMs = Date.now() - traceStartedAt;

  if (traceEnabled) {
    await writeVerificationTrace({
      fixtureName,
      runAt,
      inputClaimCount: claims.length,
      inputPromptCharLength,
      hermesBatchCallLatencyMs,
      responseCharLength: raw.length,
      rawResponsePreview: buildRawResponsePreview(raw),
      parseLatencyMs,
      freshnessEnforcementLatencyMs,
      usedFallback,
      parsedClaimCount,
      coverageRatio,
      coverageGuardrailTriggered,
      finalVerifiedClaimCount: finalVerified.length,
      totalStageLatencyMs,
      perClaimOutcomes: finalVerified.map((claim, index) => ({
        claim_index: index,
        claim_preview: claim.claim.slice(0, 100),
        outcome: claim.status,
        source_url: claim.source_url,
      })),
    });
  }

  return finalVerified;
}

function parseVerifiedClaims(raw: string): VerifiedClaim[] {
  const candidate = unwrapJsonLikeResponse(raw);
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => normalizeVerifiedClaim(item))
        .filter((item): item is VerifiedClaim => item !== null);
    }
    const normalized = normalizeVerifiedClaim(parsed);
    return normalized ? [normalized] : [];
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

function unwrapJsonLikeResponse(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  let candidate = trimmed;

  const fencedMatch = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    candidate = fencedMatch[1].trim();
  } else {
    const firstFenceIndex = candidate.search(/```(?:json)?/i);
    if (firstFenceIndex >= 0) {
      const afterFence = candidate.slice(firstFenceIndex).replace(/^```(?:json)?\s*/i, '');
      const closingFenceIndex = afterFence.lastIndexOf('```');
      candidate =
        closingFenceIndex >= 0
          ? afterFence.slice(0, closingFenceIndex).trim()
          : afterFence.trim();
    }
  }

  const firstArray = candidate.indexOf('[');
  const firstObject = candidate.indexOf('{');
  const firstJsonIndex =
    firstArray === -1
      ? firstObject
      : firstObject === -1
        ? firstArray
        : Math.min(firstArray, firstObject);
  if (firstJsonIndex > 0) {
    candidate = candidate.slice(firstJsonIndex).trim();
  }

  const lastArray = candidate.lastIndexOf(']');
  const lastObject = candidate.lastIndexOf('}');
  const lastJsonIndex = Math.max(lastArray, lastObject);
  if (lastJsonIndex >= 0 && lastJsonIndex < candidate.length - 1) {
    candidate = candidate.slice(0, lastJsonIndex + 1).trim();
  }

  return candidate;
}

type VerificationTrace = {
  fixtureName: string;
  runAt: string;
  inputClaimCount: number;
  inputPromptCharLength: number;
  hermesBatchCallLatencyMs: number;
  responseCharLength: number;
  rawResponsePreview: string;
  parseLatencyMs: number;
  freshnessEnforcementLatencyMs: number;
  usedFallback: boolean;
  parsedClaimCount: number;
  coverageRatio: number;
  coverageGuardrailTriggered: boolean;
  finalVerifiedClaimCount: number;
  totalStageLatencyMs: number;
  perClaimOutcomes: Array<{
    claim_index: number;
    claim_preview: string;
    outcome: VerifiedClaim['status'];
    source_url: string;
  }>;
};

async function writeVerificationTrace(trace: VerificationTrace): Promise<void> {
  const dir = path.join('tmp', 'verification-detail-runs');
  await mkdir(dir, { recursive: true });
  const safeTimestamp = trace.runAt.replace(/[:.]/g, '-');
  const safeFixture = trace.fixtureName.replace(/[^a-z0-9-_]/gi, '-');
  const outPath = path.join(dir, `${safeFixture}-${safeTimestamp}.json`);
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        fixture: trace.fixtureName,
        run_at: trace.runAt,
        input_claim_count: trace.inputClaimCount,
        input_prompt_char_length: trace.inputPromptCharLength,
        hermes_batch_call_latency_ms: trace.hermesBatchCallLatencyMs,
        response_char_length: trace.responseCharLength,
        raw_response_preview: trace.rawResponsePreview,
        parse_latency_ms: trace.parseLatencyMs,
        freshness_enforcement_latency_ms: trace.freshnessEnforcementLatencyMs,
        used_fallback: trace.usedFallback,
        parsed_claim_count: trace.parsedClaimCount,
        coverage_ratio: trace.coverageRatio,
        coverage_guardrail_triggered: trace.coverageGuardrailTriggered,
        final_verified_claim_count: trace.finalVerifiedClaimCount,
        total_stage_latency_ms: trace.totalStageLatencyMs,
        per_claim_outcomes: trace.perClaimOutcomes,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function buildRawResponsePreview(raw: string): string {
  if (raw.length <= 3000) {
    return raw;
  }
  return `${raw.slice(0, 2000)}\n\n...[truncated-preview]...\n\n${raw.slice(-1000)}`;
}
