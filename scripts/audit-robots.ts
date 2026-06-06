import { SOURCE_REGISTRY } from '../lib/source-registry';

type RobotsStatus = 'allows_root' | 'blocks_root' | 'no_robots' | 'fetch_failed' | 'invalid_url';

type RobotsResult = {
  source: string;
  method: string;
  baseUrl: string;
  robotsUrl?: string;
  status: RobotsStatus;
  httpStatus?: number;
  crawlDelay?: string;
  matchedRules: string[];
  error?: string;
};

const SCRAPE_METHODS = new Set(['scrape', 'rss_plus_scrape']);
const CONCURRENCY = Number(process.env.ROBOTS_AUDIT_CONCURRENCY ?? '8');
const TIMEOUT_MS = Number(process.env.ROBOTS_AUDIT_TIMEOUT_MS ?? '8000');

function robotsUrlFor(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl);
    return new URL('/robots.txt', url.origin).href;
  } catch {
    return undefined;
  }
}

function parseRobots(body: string, userAgent = 'AgentFlow-Research'): {
  blocksRoot: boolean;
  matchedRules: string[];
  crawlDelay?: string;
} {
  const target = userAgent.toLowerCase();
  const groups: Array<{ agents: string[]; rules: string[]; crawlDelay?: string }> = [];
  let current: { agents: string[]; rules: string[]; crawlDelay?: string } | undefined;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line || !line.includes(':')) continue;

    const [rawKey, ...rawValue] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(':').trim();

    if (key === 'user-agent') {
      if (!current || current.rules.length > 0 || current.crawlDelay) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (!current) continue;
    if (key === 'disallow' || key === 'allow') current.rules.push(`${key}: ${value}`);
    if (key === 'crawl-delay') current.crawlDelay = value;
  }

  const matchingGroups = groups.filter((group) =>
    group.agents.some((agent) => agent === '*' || target.includes(agent) || agent.includes(target)),
  );
  const selected = matchingGroups.find((group) => group.agents.some((agent) => agent !== '*')) ?? matchingGroups[0];
  if (!selected) return { blocksRoot: false, matchedRules: [] };

  const rootRules = selected.rules.filter((rule) => /^(allow|disallow):\s*\/\s*$/i.test(rule));
  const lastRootRule = rootRules[rootRules.length - 1];
  return {
    blocksRoot: /^disallow:/i.test(lastRootRule ?? ''),
    matchedRules: selected.rules.slice(0, 20),
    crawlDelay: selected.crawlDelay,
  };
}

async function fetchRobots(source: { name: string; baseUrl: string; method: string }): Promise<RobotsResult> {
  const robotsUrl = robotsUrlFor(source.baseUrl);
  if (!robotsUrl) {
    return {
      source: source.name,
      method: source.method,
      baseUrl: source.baseUrl,
      status: 'invalid_url',
      matchedRules: [],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(robotsUrl, {
      headers: { 'User-Agent': 'AgentFlow-Research/1.0' },
      signal: controller.signal,
    });
    if (response.status === 404) {
      return {
        source: source.name,
        method: source.method,
        baseUrl: source.baseUrl,
        robotsUrl,
        status: 'no_robots',
        httpStatus: response.status,
        matchedRules: [],
      };
    }
    if (!response.ok) {
      return {
        source: source.name,
        method: source.method,
        baseUrl: source.baseUrl,
        robotsUrl,
        status: 'fetch_failed',
        httpStatus: response.status,
        matchedRules: [],
      };
    }

    const parsed = parseRobots(await response.text());
    return {
      source: source.name,
      method: source.method,
      baseUrl: source.baseUrl,
      robotsUrl,
      status: parsed.blocksRoot ? 'blocks_root' : 'allows_root',
      httpStatus: response.status,
      crawlDelay: parsed.crawlDelay,
      matchedRules: parsed.matchedRules,
    };
  } catch (error) {
    return {
      source: source.name,
      method: source.method,
      baseUrl: source.baseUrl,
      robotsUrl,
      status: 'fetch_failed',
      matchedRules: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runPool<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

function printGroup(title: string, results: RobotsResult[], limit = 30): void {
  console.log(`\n${title} (${results.length})`);
  for (const result of results.slice(0, limit)) {
    const extra = result.crawlDelay ? ` crawl-delay=${result.crawlDelay}` : '';
    console.log(`- ${result.source} [${result.method}] ${result.status}${extra} :: ${result.robotsUrl ?? result.baseUrl}`);
    if (result.matchedRules.length > 0) console.log(`  rules: ${result.matchedRules.slice(0, 4).join(' | ')}`);
  }
  if (results.length > limit) console.log(`... ${results.length - limit} more`);
}

async function main(): Promise<void> {
  const sources = SOURCE_REGISTRY
    .filter((source) => source.enabled && SCRAPE_METHODS.has(source.method))
    .map((source) => ({ name: source.name, baseUrl: source.baseUrl, method: source.method }));

  console.log(`[robots-audit] checking ${sources.length} scrape-style sources`);
  const results = await runPool(sources, fetchRobots);
  const byStatus = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.status] = (acc[result.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log('\nRobots audit summary');
  for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${status}: ${count}`);
  }

  printGroup('Blocked at root - defer or use official/API/feed path', results.filter((result) => result.status === 'blocks_root'));
  printGroup('Fetch failed - manually verify before relying on scrape', results.filter((result) => result.status === 'fetch_failed'));
  printGroup('No robots.txt - not blocked by robots file, still respect ToS/rate limits', results.filter((result) => result.status === 'no_robots'), 15);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
