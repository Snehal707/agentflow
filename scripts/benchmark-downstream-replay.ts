import { fileURLToPath } from 'node:url';
import { buildSourceDiagnostics } from '../agents/research/deepPipeline';
import { buildLiveFacts } from '../agents/research/liveFacts';
import { synthesizeResearchReport } from '../agents/research/synthesizer';
import { verifyClaims } from '../agents/research/verifier';
import {
  claimsContentHash,
  loadClaimsFixture,
  loadFixture,
  saveDownstreamBenchmarkRun,
  type DownstreamBenchmarkRun,
} from './research-benchmark-utils';

export async function runDownstreamReplayBenchmark(
  fixtureName: string,
): Promise<DownstreamBenchmarkRun> {
  const sourceFixture = await loadFixture(fixtureName);
  const claimsFixture = await loadClaimsFixture(fixtureName);
  const totalStartedAt = Date.now();

  const diagnosticsStartedAt = Date.now();
  const sourceDiagnostics = buildSourceDiagnostics(sourceFixture.brief, sourceFixture.sources);
  const diagnosticsLatencyMs = Date.now() - diagnosticsStartedAt;

  const liveFactsStartedAt = Date.now();
  const liveFacts = buildLiveFacts(sourceFixture.sources);
  const liveFactsLatencyMs = Date.now() - liveFactsStartedAt;

  const verificationStartedAt = Date.now();
  const verified = await verifyClaims(sourceFixture.brief, claimsFixture.claims);
  const verificationLatencyMs = Date.now() - verificationStartedAt;

  const synthesisStartedAt = Date.now();
  const report = await synthesizeResearchReport({
    brief: sourceFixture.brief,
    claims: verified,
    liveFacts,
    sources: sourceFixture.sources,
    sourceDiagnostics,
  });
  const synthesisLatencyMs = Date.now() - synthesisStartedAt;

  const result: DownstreamBenchmarkRun = {
    fixture: fixtureName,
    mode: 'downstream-only',
    run_at: new Date().toISOString(),
    claim_fixture: claimsFixture.name,
    claim_fixture_content_hash: claimsContentHash(claimsFixture.claims),
    stages: {
      buildSourceDiagnostics: { latency_ms: diagnosticsLatencyMs },
      buildLiveFacts: { latency_ms: liveFactsLatencyMs },
      verification: {
        latency_ms: verificationLatencyMs,
        verified_count: verified.length,
      },
      synthesis: {
        latency_ms: synthesisLatencyMs,
        output_chars: report.length,
      },
    },
    total_latency_ms: Date.now() - totalStartedAt,
    input_claim_count: claimsFixture.claims.length,
    verified_count: verified.length,
    report_chars: report.length,
  };

  await saveDownstreamBenchmarkRun(result);
  return result;
}

async function main(): Promise<void> {
  const [fixtureName] = process.argv.slice(2);
  if (!fixtureName) {
    console.error('Usage: npx tsx scripts/benchmark-downstream-replay.ts <fixture-name>');
    process.exit(1);
  }

  const result = await runDownstreamReplayBenchmark(fixtureName);
  console.log(JSON.stringify(result, null, 2));
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
