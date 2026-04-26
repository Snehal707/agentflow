import { createHash } from 'crypto';
import dotenv from 'dotenv';
import { adminDb } from '../db/client';
import { getCronState, upsertCronState } from '../lib/cron-state';

dotenv.config();

function anonymizeWallet(wallet: string, salt: string): string {
  const h = createHash('sha256').update(salt + wallet.toLowerCase()).digest('hex');
  return `anon_${h.slice(0, 40)}`;
}

/**
 * Export consented agent_interactions as anonymized JSONL to Supabase Storage.
 */
export async function runTrainingExport(): Promise<void> {
  const bucket = process.env.TRAINING_EXPORT_BUCKET?.trim();
  const salt = process.env.TRAINING_EXPORT_SALT?.trim();
  if (!bucket) {
    throw new Error('[training-export] TRAINING_EXPORT_BUCKET is required');
  }
  if (!salt) {
    throw new Error('[training-export] TRAINING_EXPORT_SALT is required');
  }

  const state = await getCronState('training_export');
  const since = state?.last_run_at ?? '1970-01-01T00:00:00.000Z';

  const { data: consentUsers, error: consentErr } = await adminDb
    .from('users')
    .select('wallet_address')
    .eq('training_consent', true);

  if (consentErr) {
    throw new Error(`[training-export] consent query: ${consentErr.message}`);
  }

  const addresses = (consentUsers ?? []).map((u) => u.wallet_address as string).filter(Boolean);
  if (addresses.length === 0) {
    console.log('[training-export] no users with training_consent; nothing to export.');
    return;
  }

  const { data: rows, error } = await adminDb
    .from('agent_interactions')
    .select('*')
    .in('wallet_address', addresses)
    .gt('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`[training-export] query failed: ${error.message}`);
  }

  const lines: string[] = [];
  let maxCreated: string | null = null;

  for (const row of rows ?? []) {
    const w = row.wallet_address as string;
    const created = row.created_at as string;
    if (!maxCreated || created > maxCreated) {
      maxCreated = created;
    }
    const anonymized = {
      ...row,
      wallet_address: anonymizeWallet(w, salt),
    };
    lines.push(JSON.stringify(anonymized));
  }

  const body = lines.length ? `${lines.join('\n')}\n` : '';
  const day = new Date().toISOString().slice(0, 10);
  const path = `exports/training-${day}.jsonl`;

  const { error: upErr } = await adminDb.storage.from(bucket).upload(path, body, {
    contentType: 'application/x-ndjson',
    upsert: true,
  });

  if (upErr) {
    throw new Error(`[training-export] storage upload failed: ${upErr.message}`);
  }

  if (maxCreated) {
    await upsertCronState({
      jobKey: 'training_export',
      lastRunAt: maxCreated,
    });
  }

  console.log(
    `[training-export] exported ${lines.length} rows to ${bucket}/${path} (since ${since})`,
  );
}

async function main(): Promise<void> {
  await runTrainingExport();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[training-export] failed:', err);
    process.exit(1);
  });
}
