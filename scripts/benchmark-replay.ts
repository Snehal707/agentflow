import { fileURLToPath } from 'node:url';
import { buildSourceDiagnostics } from '../agents/research/deepPipeline';
import { extractClaimsFromSources } from '../agents/research/claimExtractor';
import { buildLiveFacts } from '../agents/research/liveFacts';
import { synthesizeResearchReport } from '../agents/research/synthesizer';
import { verifyClaims } from '../agents/research/verifier';
import {
  loadFixture,
  saveBenchmarkRun,
  type ReplayResult,
} from './research-benchmark-utils';

type ReplayStage = 'full' | 'extraction-only';

function parseStageArg(argv: string[]): ReplayStage {
  const value = argv.find((entry) => entry.startsWith('--stage='))?.split('=')[1];
  return value === 'extraction-only' ? 'extraction-only' : 'full';
}

function toUnverifiedReplayClaims(result: Awaited<ReturnType<typeof extractClaimsFromSources>>): ReplayResult['claims'] {
  return result.map((claim) => ({
    ...claim,
    supported_by_count: 0,
    is_current: false,
    conflicts_with: [],
    status: 'Insufficient',
  }));
}

export async function runReplayBenchmark(
  fixtureName: string,
  options?: { stage?: ReplayStage },
): Promise<ReplayResult> {
  const stage = options?.stage ?? 'full';
  const fixture = await loadFixture(fixtureName);
  const totalStartedAt = Date.now();

  const diagnosticsStartedAt = Date.now();
  const sourceDiagnostics = buildSourceDiagnostics(fixture.brief, fixture.sources);
  const diagnosticsLatencyMs = Date.now() - diagnosticsStartedAt;

  const liveFactsStartedAt = Date.now();
  const liveFacts = buildLiveFacts(fixture.sources);
  const liveFactsLatencyMs = Date.now() - liveFactsStartedAt;

  const claimStartedAt = Date.now();
  const claims = await extractClaimsFromSources(fixture.sources);
  const claimLatencyMs = Date.now() - claimStartedAt;

  if (stage === 'extraction-only') {
    const replayClaims = toUnverifiedReplayClaims(claims);
    const result: ReplayResult = {
      fixture: fixture.name,
      mode: 'extraction-only',
      run_at: new Date().toISOString(),
      task: fixture.task,
      brief: fixture.brief,
      queries: fixture.queries,
      sources: fixture.sources,
      sourceDiagnostics,
      claims: replayClaims,
      report: '',
      stages: {
        buildSourceDiagnostics: { latency_ms: diagnosticsLatencyMs },
        buildLiveFacts: { latency_ms: liveFactsLatencyMs },
        claimExtraction: {
          latency_ms: claimLatencyMs,
          claim_count: claims.length,
          batch_count: Math.ceil(fixture.sources.length / 5),
        },
        verification: {
          latency_ms: 0,
          verified_count: 0,
        },
        synthesis: {
          latency_ms: 0,
          output_chars: 0,
        },
      },
      total_latency_ms: Date.now() - totalStartedAt,
      claim_count: claims.length,
      report_chars: 0,
    };

    await saveBenchmarkRun(result);
    return result;
  }

  const verificationStartedAt = Date.now();
  const verified = await verifyClaims(fixture.brief, claims);
  const verificationLatencyMs = Date.now() - verificationStartedAt;

  const synthesisStartedAt = Date.now();
  const report = await synthesizeResearchReport({
    brief: fixture.brief,
    claims: verified,
    liveFacts,
    sources: fixture.sources,
    sourceDiagnostics,
  });
  const synthesisLatencyMs = Date.now() - synthesisStartedAt;

  const result: ReplayResult = {
    fixture: fixture.name,
    mode: 'full',
    run_at: new Date().toISOString(),
    task: fixture.task,
    brief: fixture.brief,
    queries: fixture.queries,
    sources: fixture.sources,
    sourceDiagnostics,
    claims: verified,
    report,
    stages: {
      buildSourceDiagnostics: { latency_ms: diagnosticsLatencyMs },
      buildLiveFacts: { latency_ms: liveFactsLatencyMs },
      claimExtraction: {
        latency_ms: claimLatencyMs,
        claim_count: claims.length,
        batch_count: Math.ceil(fixture.sources.length / 5),
      },
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
    claim_count: claims.length,
    report_chars: report.length,
  };

  await saveBenchmarkRun(result);
  return result;
}

async function main(): Promise<void> {
  const [fixtureName] = process.argv.slice(2);
  if (!fixtureName) {
    console.error('Usage: npx tsx scripts/benchmark-replay.ts <fixture-name> [--stage=full|extraction-only]');
    process.exit(1);
  }

  const stage = parseStageArg(process.argv.slice(2));
  const result = await runReplayBenchmark(fixtureName, { stage });
  console.log(JSON.stringify(result, null, 2));
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
