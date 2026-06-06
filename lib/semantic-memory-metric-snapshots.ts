import { adminDb } from '../db/client';
import type { SemanticMemoryMetricsReport } from './semantic-memory-metrics';

export type SemanticMemoryMetricSnapshot = {
  bucketStart: string;
  granularity: string;
  totalEvents: number;
  writesCount: number;
  retrievalsCount: number;
  profileIntentMismatchCount: number;
  zeroResultRecallLikeCount: number;
  averageReturnedCount: number;
};

function floorToSixHourBucket(date = new Date()): string {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  const hour = d.getUTCHours();
  d.setUTCHours(hour - (hour % 6));
  return d.toISOString();
}

export async function persistSemanticMemoryMetricsSnapshot(
  report: SemanticMemoryMetricsReport,
  bucketStart = floorToSixHourBucket(),
): Promise<void> {
  const payload = {
    bucket_start: bucketStart,
    granularity: '6h',
    total_events: report.totalEvents,
    writes_count: report.writes.count,
    retrievals_count: report.retrievals.count,
    profile_intent_mismatch_count: report.retrievals.profileIntentMismatchCount,
    zero_result_recall_like_count: report.retrievals.zeroResultRecallLikeCount,
    average_returned_count: report.retrievals.averageReturnedCount,
    payload: report,
  };

  const { error } = await adminDb.from('semantic_memory_metric_snapshots').upsert(payload, {
    onConflict: 'bucket_start',
  });

  if (error) {
    throw new Error(`[semantic-memory-snapshots] upsert failed: ${error.message}`);
  }
}

export async function loadRecentSemanticMemoryMetricsSnapshots(
  limit = 28,
): Promise<SemanticMemoryMetricSnapshot[]> {
  const { data, error } = await adminDb
    .from('semantic_memory_metric_snapshots')
    .select(
      'bucket_start, granularity, total_events, writes_count, retrievals_count, profile_intent_mismatch_count, zero_result_recall_like_count, average_returned_count',
    )
    .order('bucket_start', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`[semantic-memory-snapshots] load failed: ${error.message}`);
  }

  return (((data as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
    bucketStart: String(row.bucket_start ?? ''),
    granularity: String(row.granularity ?? '6h'),
    totalEvents: Number(row.total_events ?? 0),
    writesCount: Number(row.writes_count ?? 0),
    retrievalsCount: Number(row.retrievals_count ?? 0),
    profileIntentMismatchCount: Number(row.profile_intent_mismatch_count ?? 0),
    zeroResultRecallLikeCount: Number(row.zero_result_recall_like_count ?? 0),
    averageReturnedCount: Number(row.average_returned_count ?? 0),
  }))).reverse();
}
