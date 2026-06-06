import { mkdir, writeFile } from 'node:fs/promises';
import { SOURCE_REGISTRY, selectSources } from '../lib/source-registry';
import { retrieveSources } from '../agents/research/retriever';
import type { ResearchBrief, Source } from '../agents/research/types';

type TopicStat = {
  topic: string;
  registryCount: number;
  selectedCount: number;
  selectedSources: string[];
  methods: Record<string, number>;
  selectionOk: boolean;
};

type RetrievalStat = TopicStat & {
  sourceCount: number;
  distinctDomains: number;
  highReliability: number;
  mediumReliability: number;
  lowReliability: number;
  totalSnippetChars: number;
  reportReady: boolean;
  domains: string[];
  error?: string;
  latencyMs: number;
};

const DEFAULT_FETCH_LIMIT = 30;
const FETCH_LIMIT = Number(process.env.SOAK_FETCH_LIMIT ?? DEFAULT_FETCH_LIMIT);
const OUT_PATH = process.env.SOAK_OUT_PATH ?? 'tmp/research-topic-soak.json';

function countBy<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function uniqueTopics(): Array<{ topic: string; count: number }> {
  const counts = new Map<string, number>();
  for (const source of SOURCE_REGISTRY) {
    if (!source.enabled) continue;
    for (const topic of source.topics) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((left, right) => right.count - left.count || left.topic.localeCompare(right.topic));
}

function selectionStat(topic: string, registryCount: number): TopicStat {
  const selected = selectSources(`research report on ${topic}`, 8);
  return {
    topic,
    registryCount,
    selectedCount: selected.length,
    selectedSources: selected.map((source) => source.name),
    methods: countBy(selected.map((source) => source.method)),
    selectionOk: selected.length > 0,
  };
}

function briefForTopic(topic: string): ResearchBrief {
  return {
    query: `research report on ${topic}`,
    intent: 'research',
    scope: 'broad',
    time_sensitivity: 'recent',
    required_freshness_days: 30,
    geography: [],
    domains_priority: [topic],
    domains_avoid: [],
    preferred_source_types: ['official_api', 'rss', 'rss_plus_scrape', 'scrape'],
    must_answer: [`What are the most important current facts about ${topic}?`],
    avoid_drift: [`Do not drift away from ${topic}.`],
    minimum_source_diversity: 2,
    sub_questions: [`latest developments in ${topic}`, `${topic} data and evidence`],
    evaluation_rubric: 'Use at least two relevant source domains where possible.',
  };
}

function retrievalStat(base: TopicStat, sources: Source[], latencyMs: number): RetrievalStat {
  const domains = [...new Set(sources.map((source) => source.domain))].sort();
  const reliability = countBy(sources.map((source) => source.reliability));
  const totalSnippetChars = sources.reduce((sum, source) => sum + source.snippet.length, 0);
  return {
    ...base,
    sourceCount: sources.length,
    distinctDomains: domains.length,
    highReliability: reliability.high ?? 0,
    mediumReliability: reliability.medium ?? 0,
    lowReliability: reliability.low ?? 0,
    totalSnippetChars,
    reportReady: sources.length >= 2 && domains.length >= 2 && totalSnippetChars >= 500,
    domains,
    latencyMs,
  };
}

function fetchSampleTopics(topics: Array<{ topic: string; count: number }>): Array<{ topic: string; count: number }> {
  const mustInclude = new Set([
    'crypto',
    'markets',
    'finance',
    'cybersecurity',
    'ai',
    'science',
    'sports',
    'politics',
    'geopolitics',
    'health',
    'legal',
    'weather',
    'prediction markets',
    'shipping',
    'culture',
    'climate',
  ]);
  const selected: Array<{ topic: string; count: number }> = [];
  for (const entry of topics) {
    if (mustInclude.has(entry.topic)) selected.push(entry);
  }
  for (const entry of topics) {
    if (selected.length >= FETCH_LIMIT) break;
    if (!selected.some((existing) => existing.topic === entry.topic)) selected.push(entry);
  }
  return selected.slice(0, FETCH_LIMIT);
}

async function main(): Promise<void> {
  const topics = uniqueTopics();
  const selection = topics.map((entry) => selectionStat(entry.topic, entry.count));
  const selectionFailures = selection.filter((entry) => !entry.selectionOk);
  const sample = fetchSampleTopics(topics);
  const retrieval: RetrievalStat[] = [];

  console.log(`[research-soak] topics=${topics.length} selection_failures=${selectionFailures.length}`);
  console.log(`[research-soak] live retrieval sample=${sample.length} timeout=${process.env.RESEARCH_TIMEOUT_MS ?? 'default'}ms`);

  for (const entry of sample) {
    const base = selectionStat(entry.topic, entry.count);
    const startedAt = Date.now();
    try {
      const sources = await retrieveSources(briefForTopic(entry.topic), [`research report on ${entry.topic}`]);
      const stat = retrievalStat(base, sources, Date.now() - startedAt);
      retrieval.push(stat);
      console.log(
        `[research-soak] ${entry.topic}: ready=${stat.reportReady} sources=${stat.sourceCount} domains=${stat.distinctDomains} latency=${stat.latencyMs}ms`,
      );
    } catch (error) {
      const stat: RetrievalStat = {
        ...base,
        sourceCount: 0,
        distinctDomains: 0,
        highReliability: 0,
        mediumReliability: 0,
        lowReliability: 0,
        totalSnippetChars: 0,
        reportReady: false,
        domains: [],
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      };
      retrieval.push(stat);
      console.log(`[research-soak] ${entry.topic}: ERROR ${stat.error}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    topicCount: topics.length,
    selectionFailures,
    retrievalSampleCount: retrieval.length,
    retrievalReadyCount: retrieval.filter((entry) => entry.reportReady).length,
    retrievalFailures: retrieval.filter((entry) => !entry.reportReady),
    selection,
    retrieval,
  };

  await mkdir('tmp', { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log('\nResearch topic soak summary');
  console.log(`- topics selection-tested: ${summary.topicCount}`);
  console.log(`- selection failures: ${summary.selectionFailures.length}`);
  console.log(`- retrieval sample tested: ${summary.retrievalSampleCount}`);
  console.log(`- report-ready retrievals: ${summary.retrievalReadyCount}`);
  console.log(`- output: ${OUT_PATH}`);

  if (selectionFailures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
