import { getAdapter, type ExtractedQuery, type Source } from '../lib/source-adapters';
import { SOURCE_REGISTRY } from '../lib/source-registry';

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseArgs(): {
  sourceId: string;
  queryText: string;
  maxItems?: number;
  timeoutMs?: number;
  scrapeTimeoutMs?: number;
  urlOverride?: string;
  feedUrlOverride?: string;
  entities?: string[];
  topics?: string[];
} {
  const [sourceId, ...rest] = process.argv.slice(2);
  if (!sourceId) {
    throw new Error(
      'Usage: tsx --env-file=.env scripts/test-adapter.ts <source-id-or-name> <query> [--maxItems=3] [--timeoutMs=10000] [--url=https://example.com]',
    );
  }

  const queryParts: string[] = [];
  let maxItems: number | undefined;
  let timeoutMs: number | undefined;
  let scrapeTimeoutMs: number | undefined;
  let urlOverride: string | undefined;
  let feedUrlOverride: string | undefined;
  let entities: string[] | undefined;
  let topics: string[] | undefined;

  for (const part of rest) {
    if (part.startsWith('--maxItems=')) {
      maxItems = Number(part.slice('--maxItems='.length));
    } else if (part.startsWith('--timeoutMs=')) {
      timeoutMs = Number(part.slice('--timeoutMs='.length));
    } else if (part.startsWith('--scrapeTimeoutMs=')) {
      scrapeTimeoutMs = Number(part.slice('--scrapeTimeoutMs='.length));
    } else if (part.startsWith('--url=')) {
      urlOverride = part.slice('--url='.length);
    } else if (part.startsWith('--feedUrl=')) {
      feedUrlOverride = part.slice('--feedUrl='.length);
    } else if (part.startsWith('--entities=')) {
      entities = part.slice('--entities='.length).split(',').map((value) => value.trim()).filter(Boolean);
    } else if (part.startsWith('--topics=')) {
      topics = part.slice('--topics='.length).split(',').map((value) => value.trim()).filter(Boolean);
    } else {
      queryParts.push(part);
    }
  }

  return {
    sourceId,
    queryText: queryParts.join(' ').trim() || sourceId,
    maxItems: Number.isFinite(maxItems) ? maxItems : undefined,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
    scrapeTimeoutMs: Number.isFinite(scrapeTimeoutMs) ? scrapeTimeoutMs : undefined,
    urlOverride,
    feedUrlOverride,
    entities,
    topics,
  };
}

function findSource(sourceId: string): Source {
  const normalized = slug(sourceId);
  const source = SOURCE_REGISTRY.find(
    (candidate) => slug(candidate.name) === normalized || candidate.name.toLowerCase() === sourceId.toLowerCase(),
  );

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  return source;
}

function summarizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const source = findSource(args.sourceId);
  const adapter = getAdapter(source.method);
  const query: ExtractedQuery = {
    text: args.queryText,
    ...(args.entities ? { entities: args.entities } : {}),
    ...(args.topics ? { topics: args.topics } : {}),
  };
  const sourceForTest: Source = {
    ...source,
    ...(args.urlOverride ? { baseUrl: args.urlOverride } : {}),
    ...(args.feedUrlOverride ? { feed_url: args.feedUrlOverride, rssUrls: [args.feedUrlOverride] } : {}),
  };

  console.log(
    `[adapter-test] calling ${source.method} adapter for ${source.name} (${slug(source.name)}) query="${query.text}"`,
  );
  if (args.urlOverride) {
    console.log(`[adapter-test] url override: ${args.urlOverride}`);
  }
  if (args.feedUrlOverride) {
    console.log(`[adapter-test] feed URL override: ${args.feedUrlOverride}`);
  }

  const result = await adapter(sourceForTest, query, {
    maxItems: args.maxItems,
    timeoutMs: args.timeoutMs,
    scrapeTimeoutMs: args.scrapeTimeoutMs,
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        items: result.items.map((item) => ({
          title: item.title,
          url: item.url,
          published_at: item.published_at,
          metadata: item.metadata
            ? {
                scrape_success: item.metadata.scrape_success,
                scrape_error: item.metadata.scrape_error,
                feed_summary_length:
                  typeof item.metadata.feed_summary === 'string' ? item.metadata.feed_summary.length : undefined,
                keys: Object.keys(item.metadata).slice(0, 20),
              }
            : undefined,
          content_length: item.content.length,
          content_preview: summarizeContent(item.content),
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
