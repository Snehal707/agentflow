import { adminDb } from '../db/client';
import type { SemanticMemoryRow, SemanticMemoryType } from './semantic-memory';

type ConsolidateOptions = {
  maxPerGroup?: number;
  dryRun?: boolean;
};

type ConsolidateSummary = {
  walletAddress: string;
  totalLoaded: number;
  supersededIds: string[];
  keptIds: string[];
  summaryWrites: number;
};

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9._-]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function jaccardSimilarity(a: string, b: string): number {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / (aSet.size + bSet.size - overlap);
}

function groupKey(row: SemanticMemoryRow): string {
  return `${row.memory_type}::${row.category ?? ''}`;
}

function sortNewestFirst(rows: SemanticMemoryRow[]): SemanticMemoryRow[] {
  return [...rows].sort((a, b) => {
    const aTs = Date.parse(a.updated_at ?? a.created_at ?? '') || 0;
    const bTs = Date.parse(b.updated_at ?? b.created_at ?? '') || 0;
    return bTs - aTs;
  });
}

function shouldSupersede(candidate: SemanticMemoryRow, keeper: SemanticMemoryRow): boolean {
  if ((candidate.id ?? '') === (keeper.id ?? '')) {
    return false;
  }
  const a = normalize(candidate.content);
  const b = normalize(keeper.content);
  if (!a || !b) return false;
  if (a === b) return true;
  if (candidate.memory_type === 'profile') {
    return true;
  }
  return jaccardSimilarity(a, b) >= 0.88;
}

function summarizeRows(rows: SemanticMemoryRow[]): string | null {
  if (rows.length < 3) return null;
  const latest = rows[0];
  const older = rows.slice(1, 4);
  const bullets = older
    .map((row) => row.content.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => `- ${text.slice(0, 180)}`);
  if (!bullets.length) return null;
  return [
    `Consolidated memory summary for ${latest.category || latest.memory_type}:`,
    `Latest: ${latest.content.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
    ...bullets,
  ].join('\n');
}

async function loadWalletMemories(walletAddress: string): Promise<SemanticMemoryRow[]> {
  const { data, error } = await adminDb
    .from('semantic_memories')
    .select(
      'id,wallet_address,session_id,memory_type,category,content,structured,keywords,source_user_message,source_assistant_message,confidence,supersedes_id,updated_at,created_at',
    )
    .eq('wallet_address', walletAddress)
    .is('supersedes_id', null)
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`[semantic-memory] load failed: ${error.message}`);
  }
  return (data as SemanticMemoryRow[] | null) ?? [];
}

async function markSuperseded(
  loserIds: string[],
  keeperId: string,
  dryRun: boolean,
): Promise<void> {
  if (!loserIds.length || dryRun) return;
  const { error } = await adminDb
    .from('semantic_memories')
    .update({ supersedes_id: keeperId, updated_at: new Date().toISOString() })
    .in('id', loserIds);

  if (error) {
    throw new Error(`[semantic-memory] supersede update failed: ${error.message}`);
  }
}

async function insertSummaryMemory(
  walletAddress: string,
  base: SemanticMemoryRow,
  content: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  const { error } = await adminDb.from('semantic_memories').insert({
    wallet_address: walletAddress,
    session_id: base.session_id ?? null,
    memory_type: 'session_summary' satisfies SemanticMemoryType,
    category: `summary:${base.category ?? base.memory_type}`,
    content,
    structured: {
      source_memory_type: base.memory_type,
      source_category: base.category ?? null,
    },
    confidence: 0.66,
    keywords: ['summary', ...(base.keywords ?? []).slice(0, 10)],
  });

  if (error) {
    throw new Error(`[semantic-memory] summary insert failed: ${error.message}`);
  }
}

export async function consolidateSemanticMemories(
  walletAddress: string,
  options: ConsolidateOptions = {},
): Promise<ConsolidateSummary> {
  const rows = await loadWalletMemories(walletAddress);
  const maxPerGroup = Math.max(1, Math.min(options.maxPerGroup ?? 3, 10));
  const dryRun = options.dryRun === true;

  const groups = new Map<string, SemanticMemoryRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  const supersededIds: string[] = [];
  const keptIds: string[] = [];
  let summaryWrites = 0;

  for (const [, groupRows] of groups) {
    const ordered = sortNewestFirst(groupRows);
    if (!ordered.length) continue;

    const keepers: SemanticMemoryRow[] = [];
    for (const row of ordered) {
      const duplicateOf = keepers.find((keeper) => shouldSupersede(row, keeper));
      if (duplicateOf?.id && row.id) {
        supersededIds.push(row.id);
        continue;
      }
      if (keepers.length >= maxPerGroup && row.id && keepers[0]?.id) {
        supersededIds.push(row.id);
        continue;
      }
      keepers.push(row);
    }

    keptIds.push(...keepers.map((row) => row.id!).filter(Boolean));

    const primaryKeeper = keepers[0];
    if (primaryKeeper?.id) {
      const losers = ordered
        .filter((row) => row.id && row.id !== primaryKeeper.id && supersededIds.includes(row.id))
        .map((row) => row.id!) ;
      await markSuperseded(losers, primaryKeeper.id, dryRun);
    }

    const summary = summarizeRows(ordered);
    if (summary && primaryKeeper) {
      await insertSummaryMemory(walletAddress, primaryKeeper, summary, dryRun);
      summaryWrites += 1;
    }
  }

  return {
    walletAddress,
    totalLoaded: rows.length,
    supersededIds,
    keptIds,
    summaryWrites,
  };
}

export async function consolidateAllSemanticMemories(
  options: ConsolidateOptions = {},
): Promise<ConsolidateSummary[]> {
  const { data, error } = await adminDb
    .from('semantic_memories')
    .select('wallet_address')
    .is('supersedes_id', null);

  if (error) {
    throw new Error(`[semantic-memory] wallet scan failed: ${error.message}`);
  }

  const wallets = [...new Set(((data as Array<{ wallet_address: string }> | null) ?? []).map((row) => row.wallet_address))];
  const results: ConsolidateSummary[] = [];
  for (const wallet of wallets) {
    results.push(await consolidateSemanticMemories(wallet, options));
  }
  return results;
}

export async function listWalletsEligibleForSemanticMemoryConsolidation(
  minimumActiveMemories = 8,
): Promise<string[]> {
  const { data, error } = await adminDb
    .from('semantic_memories')
    .select('wallet_address, supersedes_id')
    .is('supersedes_id', null);

  if (error) {
    throw new Error(`[semantic-memory] eligible wallet scan failed: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const row of ((data as Array<{ wallet_address: string; supersedes_id: string | null }> | null) ?? [])) {
    const wallet = row.wallet_address;
    counts.set(wallet, (counts.get(wallet) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minimumActiveMemories)
    .map(([wallet]) => wallet);
}
