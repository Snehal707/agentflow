import '../lib/loadEnv';
import { getRedis } from '../db/client';

(async () => {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'x402:attempt:*', 'COUNT', 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');

  const rows: any[] = [];
  for (const k of keys) {
    const raw = await redis.get(k);
    if (!raw) continue;
    try {
      rows.push(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }

  // Bridge + EOA-payer focus; newest first
  const bridge = rows
    .filter((r) => String(r.route || '').includes('/bridge/finalize') || String(r.route || '').includes('bridge'))
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));

  console.log(`total attempt keys: ${keys.length}, bridge-related: ${bridge.length}\n`);
  for (const r of bridge.slice(0, 12)) {
    console.log('—'.repeat(70));
    console.log('requestId :', r.requestId);
    console.log('route     :', r.route);
    console.log('payer     :', r.payer, ' chainId:', r.chainId);
    console.log('stage     :', r.stage, ' httpStatus:', r.httpStatus);
    console.log('error     :', r.error);
    console.log('updatedAt :', r.updatedAt || r.createdAt);
  }

  // Also any attempt whose error mentions a reason keyword
  const reasons = rows.filter((r) =>
    /self_transfer|insufficient|invalid|verification failed|reason/i.test(String(r.error || '')),
  );
  if (reasons.length) {
    console.log('\n==== attempts with reason-bearing errors (any agent) ====');
    for (const r of reasons.slice(0, 12)) {
      console.log(`[${r.stage}] ${r.route} payer=${r.payer} status=${r.httpStatus} :: ${r.error}`);
    }
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
