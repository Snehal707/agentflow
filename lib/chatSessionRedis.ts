/**
 * Web chat sends `x-session-id: wallet-0xabc...` (lowercase hex). Hermes tools used to
 * fall back to bare `0x...`, producing a different Redis key — YES then found nothing.
 */
export function canonicalRedisSessionId(sessionId: string): string {
  const t = sessionId.trim();
  if (!t) {
    return t;
  }
  if (t.startsWith('wallet-')) {
    const rest = t.slice('wallet-'.length).trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(rest)) {
      return `wallet-${rest.toLowerCase()}`;
    }
    return t;
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) {
    return `wallet-${t.toLowerCase()}`;
  }
  return t;
}

/** Keys to try for legacy rows written before canonical IDs (bare 0x vs wallet-0x). */
export function pendingRedisKeyCandidates(prefix: string, sessionId: string): string[] {
  const canon = canonicalRedisSessionId(sessionId);
  const t = sessionId.trim();
  const keys = new Set<string>([`${prefix}${canon}`]);
  if (/^0x[a-fA-F0-9]{40}$/i.test(t)) {
    keys.add(`${prefix}${t.toLowerCase()}`);
  }
  if (t.startsWith('wallet-')) {
    keys.add(`${prefix}${t}`);
  }
  return [...keys];
}

export async function getFirstPendingRedisValue(
  getR: (key: string) => Promise<string | null>,
  prefix: string,
  sessionId: string,
): Promise<string | null> {
  for (const key of pendingRedisKeyCandidates(prefix, sessionId)) {
    const raw = await getR(key);
    if (raw) {
      return raw;
    }
  }
  return null;
}

export async function clearPendingRedisKeys(
  delR: (key: string) => Promise<unknown>,
  prefix: string,
  sessionId: string,
): Promise<void> {
  for (const key of pendingRedisKeyCandidates(prefix, sessionId)) {
    await delR(key);
  }
}

export async function redisPendingExists(
  getR: (key: string) => Promise<string | null>,
  prefix: string,
  sessionId: string,
): Promise<boolean> {
  const v = await getFirstPendingRedisValue(getR, prefix, sessionId);
  return Boolean(v);
}
