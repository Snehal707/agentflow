/**
 * Probe each agent microservice GET /health (env-aware URLs).
 *   npx tsx --env-file=.env scripts/verify-agent.ts
 *
 * Exit 1 if any of research, portfolio, or batch fail (common A2A dependencies).
 */
import '../lib/loadEnv';
import { AGENT_DEFAULT_PORTS, getAgentHealthUrl } from '../lib/a2a-health';
import { checkHttpHealth } from '../lib/x402Health';

const CRITICAL_SLUGS = ['research', 'portfolio', 'batch'] as const;

async function main(): Promise<void> {
  const slugs = Object.keys(AGENT_DEFAULT_PORTS).sort();
  let failedCritical = false;

  for (const slug of slugs) {
    const url = getAgentHealthUrl(slug);
    const r = await checkHttpHealth(url, 2500);
    const line = `[verify-agent] ${slug.padEnd(12)} ${r.ok ? 'OK' : 'FAIL'} ${url}${r.error ? ` — ${r.error}` : ''}`;
    console.log(line);
    if (!r.ok && (CRITICAL_SLUGS as readonly string[]).includes(slug)) {
      failedCritical = true;
    }
  }

  if (failedCritical) {
    console.error('[verify-agent] One or more critical agents (research, portfolio, batch) are down.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
