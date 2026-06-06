import { getCronState, upsertCronState } from './cron-state';
import {
  consolidateSemanticMemories,
  listWalletsEligibleForSemanticMemoryConsolidation,
} from './semantic-memory-consolidator';
import { buildSemanticMemoryMetricsReport } from './semantic-memory-metrics';
import { persistSemanticMemoryMetricsSnapshot } from './semantic-memory-metric-snapshots';

const JOB_KEY = 'semantic-memory-consolidation';

export async function runSemanticMemoryConsolidationJob(opts?: {
  minimumActiveMemories?: number;
  maxWalletsPerRun?: number;
}): Promise<void> {
  const minimumActiveMemories = Math.max(3, opts?.minimumActiveMemories ?? 8);
  const maxWalletsPerRun = Math.max(1, opts?.maxWalletsPerRun ?? 25);

  const startedAt = new Date().toISOString();
  const previous = await getCronState(JOB_KEY).catch(() => null);

  const wallets = await listWalletsEligibleForSemanticMemoryConsolidation(minimumActiveMemories);
  const selected = wallets.slice(0, maxWalletsPerRun);

  const results: Array<{
    wallet: string;
    totalLoaded: number;
    superseded: number;
    summaries: number;
    error?: string;
  }> = [];

  for (const wallet of selected) {
    try {
      const summary = await consolidateSemanticMemories(wallet, { maxPerGroup: 3 });
      results.push({
        wallet,
        totalLoaded: summary.totalLoaded,
        superseded: summary.supersededIds.length,
        summaries: summary.summaryWrites,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        wallet,
        totalLoaded: 0,
        superseded: 0,
        summaries: 0,
        error: message,
      });
      console.error('[semantic-memory-cron] wallet consolidation failed:', wallet, message);
    }
  }

  const metadata = {
    previous_last_run_at: previous?.last_run_at ?? null,
    minimum_active_memories: minimumActiveMemories,
    max_wallets_per_run: maxWalletsPerRun,
    eligible_wallet_count: wallets.length,
    processed_wallet_count: selected.length,
    results,
  };

  try {
    const report = await buildSemanticMemoryMetricsReport();
    await persistSemanticMemoryMetricsSnapshot(report);
  } catch (error) {
    console.warn(
      '[semantic-memory-cron] metrics snapshot persist failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  await upsertCronState({
    jobKey: JOB_KEY,
    lastRunAt: startedAt,
    metadata,
  });

  console.log('[semantic-memory-cron] run complete', {
    eligible_wallet_count: wallets.length,
    processed_wallet_count: selected.length,
    superseded_total: results.reduce((sum, item) => sum + item.superseded, 0),
    summaries_total: results.reduce((sum, item) => sum + item.summaries, 0),
  });
}
