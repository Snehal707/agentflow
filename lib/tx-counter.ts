import { getRedis } from '../db/client';

const TOTAL_KEY = 'tx:count:total';

export async function incrementTxCount(agentSlug: string): Promise<number> {
  const redis = getRedis();
  const key = `tx:count:${agentSlug}`;
  await redis.incr(key);
  const total = await redis.incr(TOTAL_KEY);
  return total;
}

const STATS_SLUGS = [
  'research',
  'analyst',
  'writer',
  'swap',
  'vault',
  'bridge',
  'portfolio',
  'invoice',
  'vision',
  'transcribe',
  'schedule',
  'split',
  'batch',
  'ascii',
  'agentpay',
] as const;

export async function getTxStats(): Promise<{
  total: number;
  byAgent: Record<string, number>;
}> {
  const redis = getRedis();

  const counts = await Promise.all(
    STATS_SLUGS.map(async (slug) => {
      const raw = await redis.get(`tx:count:${slug}`);
      return {
        slug,
        count: Number.parseInt(raw || '0', 10) || 0,
      };
    }),
  );

  const totalRaw = await redis.get(TOTAL_KEY);
  const total = Number.parseInt(totalRaw || '0', 10) || 0;

  const byAgent = counts.reduce<Record<string, number>>((acc, { slug, count }) => {
    if (count > 0) {
      acc[slug] = count;
    }
    return acc;
  }, {});

  return { total, byAgent };
}
