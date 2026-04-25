/**
 * After each manual A2A test (see plan: A2A manual tests), run:
 *   npx tsx --env-file=.env scripts/probe-a2a-transactions.ts
 *
 * Expectations (latest rows, buyer_agent → seller_agent):
 *   1 swap→portfolio  2 vault→portfolio  3 vision→research  4 transcribe→research
 *   5 (none new transcribe→research)  6 invoice→research  7 batch→portfolio
 */
import '../lib/loadEnv';
import { adminDb } from '../db/client';

async function main(): Promise<void> {
  const { data, error } = await adminDb
    .from('transactions')
    .select('buyer_agent, seller_agent, amount, remark, created_at')
    .eq('action_type', 'agent_to_agent_payment')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('[probe-a2a]', error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
