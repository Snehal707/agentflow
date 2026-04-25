import { adminDb } from '../db/client';

export interface CronStateRow {
  job_key: string;
  last_run_at: string | null;
  metadata: Record<string, unknown> | null;
}

export async function getCronState(jobKey: string): Promise<CronStateRow | null> {
  const { data, error } = await adminDb
    .from('cron_state')
    .select('job_key, last_run_at, metadata')
    .eq('job_key', jobKey)
    .maybeSingle();

  if (error) {
    throw new Error(`[cron-state] read failed: ${error.message}`);
  }
  return (data as CronStateRow) ?? null;
}

export async function upsertCronState(input: {
  jobKey: string;
  lastRunAt?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const existing = await getCronState(input.jobKey);
  const metadata =
    input.metadata !== undefined ? input.metadata : (existing?.metadata ?? {});
  const last_run_at =
    input.lastRunAt ?? existing?.last_run_at ?? new Date().toISOString();

  const { error } = await adminDb.from('cron_state').upsert(
    {
      job_key: input.jobKey,
      last_run_at,
      metadata,
    },
    {
      onConflict: 'job_key',
    },
  );

  if (error) {
    throw new Error(`[cron-state] upsert failed: ${error.message}`);
  }
}
