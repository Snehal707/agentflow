import { callHermesFast } from '../../lib/hermes';
import type { Claim, Source } from './types';

const CLAIM_BATCH_SIZE = 5;
const CLAIM_BATCH_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CLAIM_BATCH_CONCURRENCY || '2', 10) || 2,
);
const CLAIM_BATCH_TIMEOUT_MS = Math.max(
  1,
  Number.parseInt(process.env.CLAIM_BATCH_TIMEOUT_MS || '45000', 10) || 45000,
);

export async function extractClaimsFromSources(sources: Source[]): Promise<Claim[]> {
  const batches: Source[][] = [];
  for (let index = 0; index < sources.length; index += CLAIM_BATCH_SIZE) {
    batches.push(sources.slice(index, index + CLAIM_BATCH_SIZE));
  }

  if (batches.length === 0) {
    return [];
  }

  const startedAt = Date.now();
  const results: Array<{ batchIndex: number; claims: Claim[] }> = [];
  const retryQueue: number[] = [];
  const inFlight = new Set<Promise<void>>();
  let parallelSucceeded = 0;
  let retrySucceeded = 0;

  const runBatch = async (batchIndex: number, attempt: 1 | 2): Promise<void> => {
    const batch = batches[batchIndex];
    const batchStartedAt = Date.now();
    try {
      const claims = await withTimeout(extractClaimBatch(batch), CLAIM_BATCH_TIMEOUT_MS);
      const latencyMs = Date.now() - batchStartedAt;
      results.push({ batchIndex, claims });
      if (attempt === 1) {
        parallelSucceeded += 1;
      } else {
        retrySucceeded += 1;
      }
      console.log(
        [
          '[research] claim batch completed',
          `batch=${batchIndex + 1}/${batches.length}`,
          `attempt=${attempt}`,
          `latency_ms=${latencyMs}`,
          `sources=${batch.length}`,
          `claims=${claims.length}`,
          'outcome=success',
        ].join(' '),
      );
    } catch (error) {
      const latencyMs = Date.now() - batchStartedAt;
      const reason = error instanceof Error ? error.message : String(error);
      const outcome = reason.startsWith('claim_batch_timeout_') ? 'timeout' : 'error';
      console.warn(
        [
          '[research] claim batch failed',
          `batch=${batchIndex + 1}/${batches.length}`,
          `attempt=${attempt}`,
          `latency_ms=${latencyMs}`,
          `sources=${batch.length}`,
          `outcome=${outcome}`,
          `error=${reason}`,
        ].join(' '),
      );
      if (attempt === 1) {
        retryQueue.push(batchIndex);
      }
    }
  };

  for (const [batchIndex] of batches.entries()) {
    while (inFlight.size >= CLAIM_BATCH_CONCURRENCY) {
      await Promise.race(inFlight);
    }

    let task: Promise<void>;
    task = runBatch(batchIndex, 1).finally(() => {
      inFlight.delete(task);
    });
    inFlight.add(task);
  }

  await Promise.allSettled([...inFlight]);

  for (const batchIndex of retryQueue) {
    await runBatch(batchIndex, 2);
  }

  const output = results
    .sort((left, right) => left.batchIndex - right.batchIndex)
    .flatMap((entry) => entry.claims);

  // retryQueue.length is the fixed snapshot captured after the parallel phase completes.
  const finalFailed = retryQueue.length - retrySucceeded;
  console.log(
    [
      '[research] claim extraction stage completed',
      `total_latency_ms=${Date.now() - startedAt}`,
      `batches=${batches.length}`,
      `parallel_succeeded=${parallelSucceeded}`,
      `retried=${retryQueue.length}`,
      `retry_succeeded=${retrySucceeded}`,
      `final_failed=${finalFailed}`,
      `claims=${output.length}`,
    ].join(' '),
  );

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`claim_batch_timeout_${timeoutMs}ms`)),
      timeoutMs,
    );
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
