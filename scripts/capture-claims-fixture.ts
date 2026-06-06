import { readFile } from 'node:fs/promises';
import { extractClaimsFromSources } from '../agents/research/claimExtractor';
import {
  loadClaimsFixture,
  loadFixture,
  readClaimCaptureConfigFromEnv,
  readRuntimeVersion,
  saveClaimsFixture,
  type ClaimsFixture,
} from './research-benchmark-utils';

function parseNotesArg(argv: string[]): string {
  const value = argv.find((entry) => entry.startsWith('--notes='))?.split('=')[1];
  return value?.trim() || 'initial_capture';
}

async function main(): Promise<void> {
  const [fixtureName] = process.argv.slice(2);
  if (!fixtureName) {
    console.error('Usage: npx tsx scripts/capture-claims-fixture.ts <fixture-name> [--notes=initial_capture]');
    process.exit(1);
  }

  const captureNotes = parseNotesArg(process.argv.slice(2));
  const sourceFixture = await loadFixture(fixtureName);
  const captureConfig = readClaimCaptureConfigFromEnv();

  console.log(
    [
      '[claims-fixture-capture] start',
      `fixture=${fixtureName}`,
      `claim_batch_concurrency=${captureConfig.claim_batch_concurrency}`,
      `claim_batch_timeout_ms=${captureConfig.claim_batch_timeout_ms}`,
      `notes=${captureNotes}`,
    ].join(' '),
  );

  const extractionStartedAt = Date.now();
  const claims = await extractClaimsFromSources(sourceFixture.sources);
  const extractionLatencyMs = Date.now() - extractionStartedAt;

  const fixture: ClaimsFixture = {
    name: fixtureName,
    source_fixture: fixtureName,
    captured_at: new Date().toISOString(),
    captured_runtime_version: await readRuntimeVersion(),
    capture_notes: captureNotes,
    capture_config: captureConfig,
    claims_count: claims.length,
    extraction_latency_ms: extractionLatencyMs,
    claims,
  };

  await saveClaimsFixture(fixture);

  const raw = await readFile(`fixtures/research-claims-fixtures/${fixtureName}.json`, 'utf8');
  JSON.parse(raw);
  const reloaded = await loadClaimsFixture(fixtureName);

  const summary = {
    source_fixture: reloaded.source_fixture,
    claims_count: reloaded.claims_count,
    extraction_latency_ms: reloaded.extraction_latency_ms,
    capture_notes: reloaded.capture_notes,
    capture_config: reloaded.capture_config,
    first_claim: reloaded.claims[0]?.claim ?? null,
  };

  console.log(`[claims-fixture-capture] saved fixtures/research-claims-fixtures/${fixtureName}.json`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
