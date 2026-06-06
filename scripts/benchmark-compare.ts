import { runReplayBenchmark } from './benchmark-replay';
import { runDownstreamReplayBenchmark } from './benchmark-downstream-replay';
import {
  coefficientOfVariation,
  globToRegExp,
  listFixtureNames,
  mean,
  median,
  percentile,
  stddev,
  type BenchmarkRun,
  type DownstreamBenchmarkRun,
} from './research-benchmark-utils';

type BenchmarkMode = 'full' | 'extraction-only' | 'downstream-only';
type ReplayStageKey = keyof BenchmarkRun['stages'];
type DownstreamStageKey = keyof DownstreamBenchmarkRun['stages'];

const REPLAY_STAGE_KEYS: ReplayStageKey[] = [
  'buildSourceDiagnostics',
  'buildLiveFacts',
  'claimExtraction',
  'verification',
  'synthesis',
];

const DOWNSTREAM_STAGE_KEYS: DownstreamStageKey[] = [
  'buildSourceDiagnostics',
  'buildLiveFacts',
  'verification',
  'synthesis',
];

function parseRunsArg(argv: string[]): number {
  const value = argv.find((entry) => entry.startsWith('--runs='))?.split('=')[1];
  const parsed = value ? Number.parseInt(value, 10) : 3;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function parseModeArg(argv: string[]): BenchmarkMode {
  const value = argv.find((entry) => entry.startsWith('--mode='))?.split('=')[1];
  if (value === 'extraction-only' || value === 'downstream-only') {
    return value;
  }
  return 'full';
}

function replayStageLatency(run: BenchmarkRun, stage: ReplayStageKey): number {
  return run.stages[stage].latency_ms;
}

function downstreamStageLatency(run: DownstreamBenchmarkRun, stage: DownstreamStageKey): number {
  return run.stages[stage].latency_ms;
}

async function main(): Promise<void> {
  const [fixtureGlob = '*'] = process.argv.slice(2);
  const mode = parseModeArg(process.argv.slice(2));
  const runs = parseRunsArg(process.argv.slice(2));
  const matcher = globToRegExp(fixtureGlob);
  const fixtures = (await listFixtureNames()).filter((name) => matcher.test(name));

  if (fixtures.length === 0) {
    console.error(`No fixtures matched "${fixtureGlob}"`);
    process.exit(1);
  }

  for (const fixture of fixtures) {
    console.log(`\n[benchmark-compare] fixture=${fixture} runs=${runs} mode=${mode}`);

    if (mode === 'downstream-only') {
      const results: DownstreamBenchmarkRun[] = [];
      for (let index = 0; index < runs; index += 1) {
        console.log(`[benchmark-compare] run ${index + 1}/${runs}`);
        results.push(await runDownstreamReplayBenchmark(fixture));
      }

      for (const stage of DOWNSTREAM_STAGE_KEYS) {
        const values = results.map((run) => downstreamStageLatency(run, stage));
        const cv = coefficientOfVariation(values);
        console.log(
          [
            `stage=${stage}`,
            `median_ms=${median(values).toFixed(1)}`,
            `p95_ms=${percentile(values, 95).toFixed(1)}`,
            `mean_ms=${mean(values).toFixed(1)}`,
            `stddev_ms=${stddev(values).toFixed(1)}`,
            `cv=${(cv * 100).toFixed(1)}%`,
            cv > 0.15 ? 'noisy=true' : 'noisy=false',
          ].join(' '),
        );
      }

      const totals = results.map((run) => run.total_latency_ms);
      const totalCv = coefficientOfVariation(totals);
      console.log(
        [
          'stage=total',
          `median_ms=${median(totals).toFixed(1)}`,
          `p95_ms=${percentile(totals, 95).toFixed(1)}`,
          `mean_ms=${mean(totals).toFixed(1)}`,
          `stddev_ms=${stddev(totals).toFixed(1)}`,
          `cv=${(totalCv * 100).toFixed(1)}%`,
          totalCv > 0.15 ? 'noisy=true' : 'noisy=false',
        ].join(' '),
      );
      continue;
    }

    const results: BenchmarkRun[] = [];
    for (let index = 0; index < runs; index += 1) {
      console.log(`[benchmark-compare] run ${index + 1}/${runs}`);
      results.push(await runReplayBenchmark(fixture, { stage: mode }));
    }

    for (const stage of REPLAY_STAGE_KEYS) {
      const values = results.map((run) => replayStageLatency(run, stage));
      const cv = coefficientOfVariation(values);
      console.log(
        [
          `stage=${stage}`,
          `median_ms=${median(values).toFixed(1)}`,
          `p95_ms=${percentile(values, 95).toFixed(1)}`,
          `mean_ms=${mean(values).toFixed(1)}`,
          `stddev_ms=${stddev(values).toFixed(1)}`,
          `cv=${(cv * 100).toFixed(1)}%`,
          cv > 0.15 ? 'noisy=true' : 'noisy=false',
        ].join(' '),
      );
    }

    const totals = results.map((run) => run.total_latency_ms);
    const totalCv = coefficientOfVariation(totals);
    console.log(
      [
        'stage=total',
        `median_ms=${median(totals).toFixed(1)}`,
        `p95_ms=${percentile(totals, 95).toFixed(1)}`,
        `mean_ms=${mean(totals).toFixed(1)}`,
        `stddev_ms=${stddev(totals).toFixed(1)}`,
        `cv=${(totalCv * 100).toFixed(1)}%`,
        totalCv > 0.15 ? 'noisy=true' : 'noisy=false',
      ].join(' '),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
