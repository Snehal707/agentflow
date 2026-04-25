import { callHermesFast } from '../../lib/hermes';
import type { Claim, Source } from './types';

export async function extractClaimsFromSources(sources: Source[]): Promise<Claim[]> {
  const output: Claim[] = [];

  for (let index = 0; index < sources.length; index += 5) {
    const batch = sources.slice(index, index + 5);
    const claims = await extractClaimBatch(batch);
    output.push(...claims);
  }

  return output;
}

async function extractClaimBatch(batch: Source[]): Promise<Claim[]> {
  const systemPrompt = `Return valid JSON only.

Extract 2-5 grounded claims per source.
Return an array of objects with this exact shape:
{
  "claim": string,
  "date": string,
  "source_url": string,
  "source_type": "official" | "news" | "blog" | "forum",
  "confidence": number,
  "supporting_snippet": string,
  "entities": string[],
  "numbers": string[],
  "stance": "confirms" | "disputes" | "neutral"
}

Only include claims supported by the provided source snippet/title/date.`;

  const userMessage = JSON.stringify(batch, null, 2);
  const raw = await callHermesFast(systemPrompt, userMessage);
  return parseClaims(raw);
}

function parseClaims(raw: string): Claim[] {
  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeClaim(item))
      .filter((item): item is Claim => item !== null);
  } catch {
    return [];
  }
}

function normalizeClaim(value: unknown): Claim | null {
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
  };
}
