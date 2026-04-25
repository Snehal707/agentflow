import { Router } from 'express';
import { adminDb } from '../db/client';

const router = Router();

type CoreAgentSlug =
  | 'ascii'
  | 'research'
  | 'analyst'
  | 'writer'
  | 'swap'
  | 'vault'
  | 'bridge'
  | 'portfolio'
  | 'invoice'
  | 'vision'
  | 'transcribe'
  | 'schedule'
  | 'split'
  | 'batch';

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
  source: 'system' | 'marketplace';
  arcHandle: string | null;
  devWallet: string | null;
  tokenId: string | null;
  agentCardUrl: string | null;
};

export const CORE_AGENT_SPECS: Array<{
  slug: CoreAgentSlug;
  name: string;
  description: string;
  category: string;
  envPriceKey: string;
  fallbackPrice: number;
}> = [
  {
    slug: 'ascii',
    name: 'ASCII Art',
    description: 'Generates paid ASCII banners and scene art through Hermes with strict style controls.',
    category: 'Custom',
    envPriceKey: 'ASCII_AGENT_PRICE',
    fallbackPrice: 0.001,
  },
  {
    slug: 'research',
    name: 'Research',
    description: 'Evidence-based research with live data, freshness checks, and structured reports.',
    category: 'Research',
    envPriceKey: 'RESEARCH_AGENT_PRICE',
    fallbackPrice: 0.005,
  },
  {
    slug: 'analyst',
    name: 'Analyst Agent',
    description:
      'Processes research findings and extracts key insights across multiple data sources. Part of the 3-agent research pipeline.',
    category: 'Research',
    envPriceKey: 'ANALYST_AGENT_PRICE',
    fallbackPrice: 0.003,
  },
  {
    slug: 'writer',
    name: 'Writer Agent',
    description:
      'Generates professional research reports using Hermes 405B. Produces structured markdown reports from analyst findings.',
    category: 'Research',
    envPriceKey: 'WRITER_AGENT_PRICE',
    fallbackPrice: 0.008,
  },
  {
    slug: 'swap',
    name: 'Swap',
    description: 'Quotes and executes live Arc USDC swap flows with guardrails and verification.',
    category: 'DeFi',
    envPriceKey: 'SWAP_AGENT_PRICE',
    fallbackPrice: 0.01,
  },
  {
    slug: 'vault',
    name: 'Vault',
    description: 'Deposits, withdraws, and monitors AgentFlow Vault positions on Arc.',
    category: 'DeFi',
    envPriceKey: 'VAULT_AGENT_PRICE',
    fallbackPrice: 0.012,
  },
  {
    slug: 'bridge',
    name: 'Bridge',
    description: 'Bridges USDC into Arc and streams CCTP progress in real time.',
    category: 'DeFi',
    envPriceKey: 'BRIDGE_AGENT_PRICE',
    fallbackPrice: 0.009,
  },
  {
    slug: 'portfolio',
    name: 'Portfolio',
    description: 'Analyzes Arc wallet balances, positions, transfers, and PnL.',
    category: 'Analytics',
    envPriceKey: 'PORTFOLIO_AGENT_PRICE',
    fallbackPrice: 0.015,
  },
  {
    slug: 'invoice',
    name: 'Invoice',
    description: 'Automates invoice review, approvals, and business settlement flows.',
    category: 'Custom',
    envPriceKey: 'INVOICE_AGENT_PRICE',
    fallbackPrice: 0.025,
  },
  {
    slug: 'vision',
    name: 'Vision',
    description: 'Analyzes screenshots, images, text files, and single-page PDFs with Hermes-first reasoning.',
    category: 'Perception',
    envPriceKey: 'VISION_AGENT_PRICE',
    fallbackPrice: 0.004,
  },
  {
    slug: 'transcribe',
    name: 'Transcribe',
    description: 'Converts short voice notes into chat-ready text with guarded daily caps.',
    category: 'Perception',
    envPriceKey: 'TRANSCRIBE_AGENT_PRICE',
    fallbackPrice: 0.002,
  },
  {
    slug: 'schedule',
    name: 'Schedule Agent',
    description:
      'Creates and manages recurring USDC payments on Arc. Supports daily, weekly, and monthly automated schedules.',
    category: 'Payments',
    envPriceKey: 'SCHEDULE_AGENT_PRICE',
    fallbackPrice: 0.005,
  },
  {
    slug: 'split',
    name: 'Split Agent',
    description:
      'Splits USDC equally between 2-10 recipients in one command. Executes all transfers automatically on Arc.',
    category: 'Payments',
    envPriceKey: 'SPLIT_AGENT_PRICE',
    fallbackPrice: 0.005,
  },
  {
    slug: 'batch',
    name: 'Batch Agent',
    description:
      'Processes bulk USDC payments from CSV. Perfect for payroll, DAO distributions, and team payments up to 500 recipients.',
    category: 'Payments',
    envPriceKey: 'BATCH_AGENT_PRICE',
    fallbackPrice: 0.01,
  },
];

router.get('/agents', async (_req, res) => {
  try {
    const [systemAgents, publishedAgents] = await Promise.all([
      fetchSystemAgents(),
      fetchPublishedAgents(),
    ]);

    return res.json({
      agents: mergeStoreAgents(systemAgents, publishedAgents),
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
    const mergedAgents = mergeStoreAgents(systemAgents, publishedAgents);

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

export default router;

function mergeStoreAgents(systemAgents: StoreAgent[], publishedAgents: StoreAgent[]): StoreAgent[] {
  const merged = new Map<string, StoreAgent>();

  for (const agent of systemAgents) {
    merged.set(agent.slug, agent);
  }
  for (const agent of publishedAgents) {
    merged.set(agent.slug, agent);
  }

  return Array.from(merged.values());
}

async function fetchPublishedAgents(): Promise<StoreAgent[]> {
  const { data: agents, error } = await adminDb
    .from('marketplace_agents')
    .select('*')
    .in('status', ['active', 'pending']);

  if (error) {
    throw new Error(error.message);
  }

  const rows = agents ?? [];
  const wallets = rows.map((a) => String(a.dev_wallet ?? '')).filter(Boolean);
  const scores = await fetchReputationScores(wallets);

  return rows.map((row) => normalizePublishedAgent(row, scores[String(row.dev_wallet ?? '')] ?? 0));
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

  const scores = await fetchReputationScores(
    Array.from(ownerWalletBySlug.values())
      .map((row) => row.address ?? '')
      .filter(Boolean),
  );

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
      priceUsdc: parseUsdcPrice(spec.envPriceKey, spec.fallbackPrice),
      reputationScore: owner?.address ? scores[owner.address] ?? 0 : 0,
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

async function fetchReputationScores(wallets: string[]): Promise<Record<string, number>> {
  if (!wallets.length) {
    return {};
  }

  const { data: rep } = await adminDb
    .from('reputation_cache')
    .select('agent_address, score')
    .in('agent_address', wallets);

  return Object.fromEntries(
    (rep ?? []).map((row) => [String(row.agent_address), Number(row.score ?? 0)]),
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
      card.description ?? 'Published AgentFlow listing routed from the Agent Store registry.',
    category: card.category ?? String(row.category ?? 'Custom'),
    priceUsdc: card.priceUsdc,
    reputationScore,
    status: String(row.status ?? 'pending'),
    available: String(row.status ?? '').toLowerCase() === 'active',
    source: 'marketplace',
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

function resolveHealthUrl(slug: CoreAgentSlug): string {
  switch (slug) {
    case 'ascii':
      return normalizeHealthUrl(
        process.env.ASCII_AGENT_URL?.trim(),
        'http://127.0.0.1:4000/agent/ascii/run',
      );
    case 'research':
      return normalizeHealthUrl(process.env.RESEARCH_AGENT_URL?.trim(), 'http://127.0.0.1:3001');
    case 'analyst':
      return normalizeHealthUrl(process.env.ANALYST_AGENT_URL?.trim(), 'http://127.0.0.1:3002');
    case 'writer':
      return normalizeHealthUrl(process.env.WRITER_AGENT_URL?.trim(), 'http://127.0.0.1:3003');
    case 'swap':
      return normalizeHealthUrl(process.env.SWAP_AGENT_URL?.trim(), 'http://127.0.0.1:3011');
    case 'vault':
      return normalizeHealthUrl(process.env.VAULT_AGENT_URL?.trim(), 'http://127.0.0.1:3012');
    case 'bridge':
      return normalizeHealthUrl(process.env.BRIDGE_AGENT_URL?.trim(), 'http://127.0.0.1:3013');
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

  const agents = [...systemAgents, ...publishedAgents];
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
