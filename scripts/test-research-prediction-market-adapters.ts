import { getAdapter, type ExtractedQuery, type Source, type SourceResult } from '../lib/source-adapters';
import { SOURCE_REGISTRY } from '../lib/source-registry';

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findSource(name: string): Source {
  const normalized = slug(name);
  const source = SOURCE_REGISTRY.find(
    (candidate) => slug(candidate.name) === normalized || candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (!source) throw new Error(`Source not found: ${name}`);
  return source;
}

async function fetchSource(name: string, query: ExtractedQuery): Promise<SourceResult> {
  const source = findSource(name);
  const adapter = getAdapter(source.method);
  const result = await adapter(source, query, { maxItems: 3, timeoutMs: 15_000 });
  console.log(
    `[prediction-smoke] ${source.name}: success=${result.success} items=${result.items.length} latency=${result.latency_ms}ms error=${result.error ?? ''}`,
  );
  for (const item of result.items) {
    console.log(`  - ${item.title ?? '(untitled)'} :: ${item.url}`);
  }
  return result;
}

function hasRelevantItem(result: SourceResult, term: string): boolean {
  const needle = term.toLowerCase();
  return result.items.some((item) =>
    [item.title, item.url, item.content].filter(Boolean).join(' ').toLowerCase().includes(needle),
  );
}

async function main(): Promise<void> {
  const electionQuery: ExtractedQuery = {
    text: 'election prediction market',
    entities: ['election'],
    topics: ['prediction markets', 'politics'],
  };

  const polymarket = await fetchSource('Polymarket Gamma', electionQuery);
  if (!polymarket.success || !hasRelevantItem(polymarket, 'election')) {
    throw new Error('Polymarket Gamma did not return election-relevant prediction markets');
  }

  const manifold = await fetchSource('Manifold Markets', electionQuery);
  if (!manifold.success || !hasRelevantItem(manifold, 'election')) {
    throw new Error('Manifold Markets did not return election-relevant prediction markets');
  }

  const kalshiElection = await fetchSource('Kalshi', electionQuery);
  if (kalshiElection.items.length > 0 && !hasRelevantItem(kalshiElection, 'election')) {
    throw new Error('Kalshi returned unrelated fallback items for an election query');
  }

  const kalshiSports = await fetchSource('Kalshi', {
    text: 'sports prediction market',
    entities: ['sports'],
    topics: ['prediction markets', 'sports'],
  });
  if (!kalshiSports.success || !hasRelevantItem(kalshiSports, 'sports')) {
    throw new Error('Kalshi did not return sports-relevant markets');
  }

  console.log('[prediction-smoke] all prediction-market adapter checks passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
