/**
 * Read a single x402 attempt record from Redis (written by payProtectedResourceServer).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/probe-x402-attempt.ts <requestId>
 *   X402_ATTEMPT_REQUEST_ID=... npx tsx --env-file=.env scripts/probe-x402-attempt.ts
 */
import '../lib/loadEnv';
import { readX402AttemptRecord } from '../lib/x402AttemptLedger';

async function main(): Promise<void> {
  const rid = (process.argv[2] || process.env.X402_ATTEMPT_REQUEST_ID || '').trim();
  if (!rid) {
    console.error(
      'Usage: npx tsx --env-file=.env scripts/probe-x402-attempt.ts <requestId>\n' +
        '   or: X402_ATTEMPT_REQUEST_ID=<id> npx tsx --env-file=.env scripts/probe-x402-attempt.ts',
    );
    process.exit(1);
  }
  const rec = await readX402AttemptRecord(rid);
  if (!rec) {
    console.log(JSON.stringify({ requestId: rid, found: false }, null, 2));
    return;
  }
  console.log(JSON.stringify({ requestId: rid, found: true, record: rec }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
