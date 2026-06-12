import { Router } from 'express';
import { adminDb } from '../db/client';
import { fetchOnChainReputationByAgentIds } from '../lib/reputation';
import { CORE_AGENT_SPECS, type CoreAgentSlug } from '../lib/coreAgentSpecs';

export { CORE_AGENT_SPECS };

const router = Router();

/**
 * Overwrites each agent's reputationScore with its true ERC-8004 on-chain aggregate
 * (keyed by erc8004 token id). Agents with no on-chain feedback get 0.
 */
async function applyOnChainReputation(agents: StoreAgent[]): Promise<StoreAgent[]> {
  const ids = agents
    .map((a) => a.tokenId)
    .filter((t): t is string => Boolean(t && String(t).trim()));
  if (!ids.length) {
    return agents;
  }
  const scores = await fetchOnChainReputationByAgentIds(ids);
  return agents.map((a) =>
    a.tokenId && scores[a.tokenId]
      ? { ...a, reputationScore: scores[a.tokenId].score }
      : a,
  );
}

type StoreAgent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  priceUsdc: number | null;
  reputationScore: number;
  status: string;
  available: boolean;
  source: 'system' | 'published';
  arcHandle: string | null;
  devWallet: string | null;
  tokenId: string | null;
  agentCardUrl: string | null;
};

type AgentStatsResponse = {
  agent: StoreAgent;
  stats: {
    completedTasks: number;
    totalRuns: number;
    successRate: number;
    nanopaymentCount: number;
    nanopaymentVolumeUsdc: number;
    rating: number;
    priceLabel: string;
    scopeLabel: string;
  };
};

// CORE_AGENT_SPECS now lives in lib/coreAgentSpecs.ts (a pure, side-effect-free
// module) so guards/scripts can import it without booting Supabase/Redis.
// It is imported and re-exported at the top of this file.

router.get('/agents', async (_req, res) => {
  try {
    const [systemAgents, publishedAgents] = await Promise.all([
      fetchSystemAgents(),
      fetchPublishedAgents(),
    ]);

    const merged = mergeStoreAgents(systemAgents, publishedAgents);
    return res.json({
      agents: await applyOnChainReputation(merged),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'agent store list failed' });
  }
});

router.get('/agent/:slug', async (req, res) => {
  try {
    const raw = String(req.params.slug ?? '').trim().toLowerCase();
    if (!raw) {
      return res.status(400).json({ error: 'slug required' });
    }

    const [systemAgents, publishedAgents] = await Promise.all([
      fetchSystemAgents(),
      fetchPublishedAgents(),
    ]);
    const mergedAgents = await applyOnChainReputation(
      mergeStoreAgents(systemAgents, publishedAgents),
    );

    const agent =
      mergedAgents.find((item) => item.slug === raw || item.id === raw);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json({ agent });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'agent lookup failed' });
  }
});

router.get('/agent/:slug/stats', async (req, res) => {
  try {
    const raw = String(req.params.slug ?? '').trim().toLowerCase();
    if (!raw) {
      return res.status(400).json({ error: 'slug required' });
    }

    const [systemAgents, publishedAgents] = await Promise.all([
      fetchSystemAgents(),
      fetchPublishedAgents(),
    ]);
    const mergedAgents = await applyOnChainReputation(
      mergeStoreAgents(systemAgents, publishedAgents),
    );
    const agent = mergedAgents.find((item) => item.slug === raw || item.id === raw);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const scopedSlugs = raw === 'research' ? ['research', 'analyst', 'writer'] : [raw];

    // Run stats come from the economy ledger — every paid execution where this agent
    // is the seller (user-paid + agent-to-agent). agent_interactions is swap-only, so
    // it cannot be used for cross-agent run counts. Use exact counts (head:true) so
    // high-volume agents aren't capped at the 1000-row fetch limit.
    const [totalRunsRes, completedRes, volumeRes] = await Promise.all([
      adminDb
        .from('agent_economy_ledger')
        .select('*', { count: 'exact', head: true })
        .in('seller_agent', scopedSlugs),
      adminDb
        .from('agent_economy_ledger')
        .select('*', { count: 'exact', head: true })
        .in('seller_agent', scopedSlugs)
        .eq('status', 'complete'),
      adminDb
        .from('agent_economy_ledger')
        .select('amount')
        .in('seller_agent', scopedSlugs),
    ]);

    for (const r of [totalRunsRes, completedRes, volumeRes]) {
      if (r.error) {
        throw new Error(r.error.message);
      }
    }

    const totalRuns = totalRunsRes.count ?? 0;
    const completedTasks = completedRes.count ?? 0;
    const successRate = totalRuns > 0 ? Number(((completedTasks / totalRuns) * 100).toFixed(2)) : 0;
    const nanopaymentCount = totalRuns;
    const nanopaymentVolumeUsdc = Number(
      (volumeRes.data ?? [])
        .reduce((sum, row) => {
          const amount = Number(row.amount ?? 0);
          return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0)
        .toFixed(3),
    );

    return res.json({
      agent,
      stats: {
        completedTasks,
        totalRuns,
        successRate,
        nanopaymentCount,
        nanopaymentVolumeUsdc,
        rating: Number((agent.reputationScore / 20).toFixed(1)),
        priceLabel: raw === 'research' ? 'Pipeline total' : 'Per run',
        scopeLabel: raw === 'research' ? 'Research + Analyst + Writer' : 'Single agent',
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'agent stats lookup failed' });
  }
});

export default router;

function mergeStoreAgents(systemAgents: StoreAgent[], publishedAgents: StoreAgent[]): StoreAgent[] {
  const merged = new Map<string, StoreAgent>();

  for (const agent of systemAgents) {
    merged.set(agent.slug, applyCorePresentationOverrides(agent));
  }
  for (const agent of publishedAgents) {
    merged.set(agent.slug, applyCorePresentationOverrides(agent));
  }

  return Array.from(merged.values());
}

function applyCorePresentationOverrides(agent: StoreAgent): StoreAgent {
  if (agent.slug === 'transcribe') {
    return {
      ...agent,
      name: 'Voice Input',
      description: 'Converts short voice notes into chat-ready text with guarded daily caps.',
      category: 'Perception',
      priceUsdc: 0,
    };
  }
  return agent;
}

async function fetchPublishedAgents(): Promise<StoreAgent[]> {
  const primary = await selectPublishedAgentsFrom('agent_store_agents');
  const result = isMissingTableError(primary.error)
    ? await selectPublishedAgentsFrom('marketplace_agents')
    : primary;

  if (isMissingTableError(result.error)) {
    return [];
  }

  if (result.error) {
    throw new Error(result.error.message);
  }

  const rows = result.data ?? [];
  const slugs = rows.map((a) => String(a.arc_handle ?? a.id ?? '').trim()).filter(Boolean);
  const scores = await fetchUserRatingScoresBySlug(slugs);

  return rows.map((row) => {
    const slug = String(row.arc_handle ?? row.id ?? '').trim();
    return normalizePublishedAgent(row, scores[slug] ?? 0);
  });
}

function selectPublishedAgentsFrom(table: 'agent_store_agents' | 'marketplace_agents') {
  return adminDb
    .from(table)
    .select('*')
    .in('status', ['active', 'pending']);
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }
  const message = String(error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('not found') ||
    message.includes('schema cache') ||
    message.includes('could not find the table')
  );
}

async function fetchSystemAgents(): Promise<StoreAgent[]> {
  const slugs = CORE_AGENT_SPECS.map((spec) => spec.slug);
  const { data: wallets, error } = await adminDb
    .from('wallets')
    .select('agent_slug, address, erc8004_token_id')
    .eq('purpose', 'owner')
    .in('agent_slug', slugs);

  if (error) {
    throw new Error(error.message);
  }

  const ownerWalletBySlug = new Map<string, { address: string | null; tokenId: string | null }>();
  for (const row of wallets ?? []) {
    ownerWalletBySlug.set(String(row.agent_slug ?? ''), {
      address: row.address ? String(row.address) : null,
      tokenId: row.erc8004_token_id ? String(row.erc8004_token_id) : null,
    });
  }

  const scores = await fetchUserRatingScoresBySlug(slugs);

  const healthChecks = await Promise.all(
    CORE_AGENT_SPECS.map(async (spec) => {
      const ok = await checkHealth(resolveHealthUrl(spec.slug));
      return [spec.slug, ok] as const;
    }),
  );

  const healthBySlug = new Map<CoreAgentSlug, boolean>(healthChecks);

  return CORE_AGENT_SPECS.map((spec) => {
    const owner = ownerWalletBySlug.get(spec.slug);
    const available = healthBySlug.get(spec.slug) ?? false;
    return {
      id: `system:${spec.slug}`,
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      category: spec.category,
      priceUsdc: resolveSystemAgentPrice(spec),
      reputationScore: scores[spec.slug] ?? 0,
      status: available ? 'live' : 'unavailable',
      available,
      source: 'system',
      arcHandle: null,
      devWallet: owner?.address ?? null,
      tokenId: owner?.tokenId ?? null,
      agentCardUrl: null,
    } satisfies StoreAgent;
  });
}

async function fetchUserRatingScoresBySlug(slugs: string[]): Promise<Record<string, number>> {
  if (!slugs.length) {
    return {};
  }

  const { data, error } = await adminDb
    .from('agent_ratings')
    .select('agent_slug, score')
    .eq('status', 'confirmed')
    .in('agent_slug', slugs);

  if (isMissingTableError(error)) {
    return {};
  }
  if (error) {
    throw new Error(error.message);
  }

  const sums = new Map<string, { total: number; count: number }>();
  for (const row of data ?? []) {
    const slug = String(row.agent_slug ?? '');
    const score = Number(row.score ?? 0);
    if (!slug || !Number.isFinite(score)) continue;
    const current = sums.get(slug) ?? { total: 0, count: 0 };
    sums.set(slug, { total: current.total + score, count: current.count + 1 });
  }

  return Object.fromEntries(
    Array.from(sums.entries()).map(([slug, value]) => [
      slug,
      value.count > 0 ? value.total / value.count : 0,
    ]),
  );
}

function normalizePublishedAgent(row: Record<string, unknown>, reputationScore: number): StoreAgent {
  const card = parseAgentCardJson(row.agent_card_json);
  const slug = String(row.arc_handle ?? row.id ?? '').trim();

  return {
    id: String(row.id ?? slug),
    slug,
    name: card.name || slug || 'Published Agent',
    description:
      card.description ?? 'Published AgentFlow agent routed from the Agent Store registry.',
    category: card.category ?? String(row.category ?? 'Custom'),
    priceUsdc: card.priceUsdc,
    reputationScore,
    status: String(row.status ?? 'pending'),
    available: String(row.status ?? '').toLowerCase() === 'active',
    source: 'published',
    arcHandle: row.arc_handle ? String(row.arc_handle) : null,
    devWallet: row.dev_wallet ? String(row.dev_wallet) : null,
    tokenId: row.erc8004_token_id ? String(row.erc8004_token_id) : null,
    agentCardUrl: row.agent_card_url ? String(row.agent_card_url) : null,
  };
}

function parseAgentCardJson(value: unknown): {
  name: string | null;
  description: string | null;
  category: string | null;
  priceUsdc: number | null;
} {
  const card =
    typeof value === 'string'
      ? safeParseObject(value)
      : value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;

  const priceValue = card?.priceUsdc ?? card?.price ?? null;
  const parsedPrice =
    typeof priceValue === 'number'
      ? priceValue
      : typeof priceValue === 'string'
        ? Number(priceValue.replace(/^\$/, ''))
        : null;

  return {
    name: typeof card?.name === 'string' ? card.name : null,
    description: typeof card?.description === 'string' ? card.description : null,
    category: typeof card?.category === 'string' ? card.category : null,
    priceUsdc: Number.isFinite(parsedPrice ?? NaN) ? parsedPrice : null,
  };
}

function safeParseObject(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseUsdcPrice(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  const candidate = raw ? Number(raw.replace(/^\$/, '')) : fallback;
  return Number.isFinite(candidate) ? candidate : fallback;
}

function resolveSystemAgentPrice(
  spec: (typeof CORE_AGENT_SPECS)[number],
): number | null {
  if (spec.slug === 'transcribe') {
    return 0;
  }

  if (spec.slug === 'research') {
    return [
      parseUsdcPrice('RESEARCH_AGENT_PRICE', 0.005),
      parseUsdcPrice('ANALYST_AGENT_PRICE', 0.003),
      parseUsdcPrice('WRITER_AGENT_PRICE', 0.008),
    ].reduce((sum, value) => sum + value, 0);
  }

  return parseUsdcPrice(spec.envPriceKey, spec.fallbackPrice);
}

function resolveHealthUrl(slug: CoreAgentSlug): string {
  switch (slug) {
    case 'research':
      return normalizeHealthUrl(process.env.RESEARCH_AGENT_URL?.trim(), 'http://127.0.0.1:3001');
    case 'swap':
      return normalizeHealthUrl(process.env.SWAP_AGENT_URL?.trim(), 'http://127.0.0.1:3011');
    case 'vault':
      return normalizeHealthUrl(process.env.VAULT_AGENT_URL?.trim(), 'http://127.0.0.1:3012');
    case 'predmarket':
      return normalizeHealthUrl(
        process.env.PREDMARKET_AGENT_URL?.trim(),
        'http://127.0.0.1:3013',
      );
    case 'bridge':
      return normalizeHealthUrl(process.env.BRIDGE_AGENT_URL?.trim(), 'http://127.0.0.1:3021');
    case 'portfolio':
      return normalizeHealthUrl(process.env.PORTFOLIO_AGENT_URL?.trim(), 'http://127.0.0.1:3014');
    case 'invoice':
      return normalizeHealthUrl(process.env.INVOICE_AGENT_URL?.trim(), 'http://127.0.0.1:3015');
    case 'vision':
      return normalizeHealthUrl(process.env.VISION_AGENT_URL?.trim(), 'http://127.0.0.1:3016');
    case 'transcribe':
      return normalizeHealthUrl(
        process.env.TRANSCRIBE_AGENT_URL?.trim(),
        'http://127.0.0.1:3017',
      );
    case 'schedule':
      return normalizeHealthUrl(process.env.SCHEDULE_AGENT_URL?.trim(), 'http://127.0.0.1:3018');
    case 'split':
      return normalizeHealthUrl(process.env.SPLIT_AGENT_URL?.trim(), 'http://127.0.0.1:3019');
    case 'batch':
      return normalizeHealthUrl(process.env.BATCH_AGENT_URL?.trim(), 'http://127.0.0.1:3020');
  }
}

function normalizeHealthUrl(configured: string | undefined, fallback: string): string {
  const value = (configured || fallback).trim();
  try {
    const url = new URL(value);
    url.pathname = '/health';
    url.search = '';
    return url.toString();
  } catch {
    const base = value.replace(/\/+$/, '');
    return `${base}/health`;
  }
}

async function checkHealth(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

router.get('/leaderboard', async (_req, res) => {
  try {
    const { getRedis } = await import('../db/client');
    const redis = getRedis();
    const cacheKey = 'leaderboard:v1';
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const leaderboard = await buildLeaderboard();
    await redis.set(cacheKey, JSON.stringify(leaderboard), 'EX', 300);
    return res.json(leaderboard);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'leaderboard failed' });
  }
});

type LeaderboardRow = {
  rank: number;
  slug: string;
  name: string;
  totalExecutions: number;
  successRate: number;
  totalVolumeUsdc: number;
  reputationScore: number;
  erc8004AgentId: number;
};

async function buildLeaderboard(): Promise<LeaderboardRow[]> {
  const [systemAgents, publishedAgents, interactionsRes, txRes] = await Promise.all([
    fetchSystemAgents(),
    fetchPublishedAgents(),
    adminDb.from('agent_interactions').select('agent_slug, agent_output'),
    adminDb.from('transactions').select('agent_slug, amount'),
  ]);

  if (interactionsRes.error) {
    throw new Error(interactionsRes.error.message);
  }
  if (txRes.error) {
    throw new Error(txRes.error.message);
  }

  const agents = await applyOnChainReputation([...systemAgents, ...publishedAgents]);
  const metadataBySlug = new Map(
    agents.map((agent) => [
      agent.slug,
      {
        slug: agent.slug,
        name: agent.name,
        reputationScore: agent.reputationScore,
        erc8004AgentId: Number.parseInt(agent.tokenId ?? '0', 10) || 0,
      },
    ]),
  );

  const executionStats = new Map<string, { totalExecutions: number; successfulExecutions: number }>();
  for (const row of interactionsRes.data ?? []) {
    const slug = String(row.agent_slug ?? '').trim().toLowerCase();
    if (!slug) continue;
    const current = executionStats.get(slug) ?? { totalExecutions: 0, successfulExecutions: 0 };
    current.totalExecutions += 1;
    if (row.agent_output !== null && row.agent_output !== undefined) {
      current.successfulExecutions += 1;
    }
    executionStats.set(slug, current);
  }

  const volumeStats = new Map<string, number>();
  for (const row of txRes.data ?? []) {
    const slug = String(row.agent_slug ?? '').trim().toLowerCase();
    if (!slug) continue;
    const amount = Number(row.amount ?? 0);
    volumeStats.set(slug, (volumeStats.get(slug) ?? 0) + (Number.isFinite(amount) ? amount : 0));
  }

  const slugs = new Set<string>([
    ...metadataBySlug.keys(),
    ...executionStats.keys(),
    ...volumeStats.keys(),
  ]);

  const rows = Array.from(slugs)
    .map((slug) => {
      const meta = metadataBySlug.get(slug);
      const execution = executionStats.get(slug) ?? { totalExecutions: 0, successfulExecutions: 0 };
      const totalExecutions = execution.totalExecutions;
      const successRate =
        totalExecutions > 0 ? execution.successfulExecutions / totalExecutions : 0;

      return {
        rank: 0,
        slug,
        name: meta?.name ?? slug,
        totalExecutions,
        successRate,
        totalVolumeUsdc: Number((volumeStats.get(slug) ?? 0).toFixed(6)),
        reputationScore: meta?.reputationScore ?? 0,
        erc8004AgentId: meta?.erc8004AgentId ?? 0,
      } satisfies LeaderboardRow;
    })
    .sort((a, b) => {
      if (b.reputationScore !== a.reputationScore) {
        return b.reputationScore - a.reputationScore;
      }
      if (b.totalExecutions !== a.totalExecutions) {
        return b.totalExecutions - a.totalExecutions;
      }
      return b.totalVolumeUsdc - a.totalVolumeUsdc;
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      successRate: Number((row.successRate * 100).toFixed(2)),
      totalVolumeUsdc: Number(row.totalVolumeUsdc.toFixed(2)),
    }));

  return rows;
}
