import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison. Returns false on length mismatch. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * True if `sentKey` matches `AGENTFLOW_BRAIN_INTERNAL_KEY` in constant time.
 * This key impersonates any wallet on the money endpoints, so treat it as a
 * high-value secret: never log it, rotate it if exposed, and keep it long/random.
 */
export function matchesBrainInternalKey(sentKey: string | undefined | null): boolean {
  const expected = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const sent = (sentKey ?? '').trim();
  if (!expected || !sent) return false;
  return timingSafeEqualStr(sent, expected);
}
