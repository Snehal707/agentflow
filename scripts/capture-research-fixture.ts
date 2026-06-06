import { readFile } from 'node:fs/promises';
import { prepareDeepResearchInputs } from '../agents/research/deepPipeline';
import {
  domainDistribution,
  loadFixture,
  readRuntimeVersion,
  reliabilityDistribution,
  saveFixture,
  snippetLengthTotal,
  type ResearchFixture,
} from './research-benchmark-utils';

async function main(): Promise<void> {
  const [fixtureName, ...queryParts] = process.argv.slice(2);
  const query = queryParts.join(' ').trim();

  if (!fixtureName || !query) {
    console.error('Usage: npx tsx scripts/capture-research-fixture.ts <fixture-name> "<query>"');
    process.exit(1);
  }

  console.log(`[fixture-capture] start fixture=${fixtureName} query="${query}"`);
  const prepared = await prepareDeepResearchInputs({
    task: query,
    onStage: (stage) => console.log(`[fixture-capture] ${stage.stage} ${stage.status}`),
  });

  const fixture: ResearchFixture = {
    name: fixtureName,
    captured_at: new Date().toISOString(),
    task: prepared.task,
    brief: prepared.brief,
    queries: prepared.queries,
    sources: prepared.sources,
    captured_runtime_version: await readRuntimeVersion(),
  };

  await saveFixture(fixture);

  const raw = await readFile(`fixtures/research-fixtures/${fixtureName}.json`, 'utf8');
  JSON.parse(raw);
  const reloaded = await loadFixture(fixtureName);

  const domainCounts = domainDistribution(reloaded.sources).slice(0, 8);
  const summary = {
    sources: reloaded.sources.length,
    total_snippet_chars: snippetLengthTotal(reloaded.sources),
    reliability: reliabilityDistribution(reloaded.sources),
    intent: reloaded.brief.intent,
    scope: reloaded.brief.scope,
    topics_covered: reloaded.brief.domains_priority,
    top_domains: domainCounts,
  };

  console.log(`[fixture-capture] saved fixtures/research-fixtures/${fixtureName}.json`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
