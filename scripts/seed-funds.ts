import '../lib/loadEnv';
import { adminDb } from '../db/client';
import { CANONICAL_FUNDS, CANONICAL_FUND_IDS } from '../lib/funds-defaults';

async function seedFunds(): Promise<void> {
  const { error: upsertError } = await adminDb
    .from('funds')
    .upsert(CANONICAL_FUNDS, { onConflict: 'id' });

  if (upsertError) {
    throw new Error(`[seed-funds] Failed to upsert funds: ${upsertError.message}`);
  }

  const { data, error: verifyError } = await adminDb
    .from('funds')
    .select('id, name, is_active')
    .in('id', CANONICAL_FUND_IDS)
    .eq('is_active', true);

  if (verifyError) {
    throw new Error(`[seed-funds] Failed to verify funds: ${verifyError.message}`);
  }

  const activeIds = new Set((data ?? []).map((row) => String(row.id)));
  const missingIds = CANONICAL_FUND_IDS.filter((id) => !activeIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(`[seed-funds] Missing active canonical IDs after upsert: ${missingIds.join(', ')}`);
  }

  console.log('[seed-funds] Canonical funds ready.');
  for (const row of data ?? []) {
    console.log(`- ${row.id} ${row.name} (active=${row.is_active})`);
  }
}

seedFunds()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
