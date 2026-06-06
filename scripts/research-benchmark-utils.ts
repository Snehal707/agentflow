import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Claim,
  ResearchBrief,
  Source,
  SourceDiagnostics,
  VerifiedClaim,
} from '../agents/research/types';

export type ResearchFixture = {
  name: string;
  captured_at: string;
  task: string;
  brief: ResearchBrief;
  queries: string[];
  sources: Source[];
  captured_runtime_version: string;
};

export type ClaimsFixture = {
  name: string;
  source_fixture: string;
  captured_at: string;
  captured_runtime_version: string;
  capture_notes: string;
  capture_config: {
    claim_batch_concurrency: number;
    claim_batch_timeout_ms: number;
  };
  claims_count: number;
  extraction_latency_ms: number;
  claims: Claim[];
};

export type BenchmarkRun = {
  fixture: string;
  mode?: 'full' | 'extraction-only';
  run_at: string;
  stages: {
    buildSourceDiagnostics: { latency_ms: number };
    buildLiveFacts: { latency_ms: number };
    claimExtraction: { latency_ms: number; claim_count: number; batch_count: number };
    verification: { latency_ms: number; verified_count: number };
    synthesis: { latency_ms: number; output_chars: number };
  };
  total_latency_ms: number;
  claim_count: number;
  report_chars: number;
};

export type DownstreamBenchmarkRun = {
  fixture: string;
  mode: 'downstream-only';
  run_at: string;
  claim_fixture: string;
  claim_fixture_content_hash: string;
  stages: {
    buildSourceDiagnostics: { latency_ms: number };
    buildLiveFacts: { latency_ms: number };
    verification: { latency_ms: number; verified_count: number };
    synthesis: { latency_ms: number; output_chars: number };
  };
  total_latency_ms: number;
  input_claim_count: number;
  verified_count: number;
  report_chars: number;
};

export type ReplayResult = BenchmarkRun & {
  task: string;
  brief: ResearchBrief;
  queries: string[];
  sources: Source[];
  sourceDiagnostics: SourceDiagnostics;
  claims: VerifiedClaim[];
  report: string;
};

export const FIXTURE_DIR = path.join('fixtures', 'research-fixtures');
export const CLAIMS_FIXTURE_DIR = path.join('fixtures', 'research-claims-fixtures');
export const BENCHMARK_RUN_DIR = path.join('tmp', 'benchmark-runs');
export const DOWNSTREAM_BENCHMARK_RUN_DIR = path.join('tmp', 'downstream-benchmark-runs');

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function readRuntimeVersion(): Promise<string> {
  const raw = await readFile('package.json', 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? '0.0.0';
}

export function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, `${name}.json`);
}

export function benchmarkRunPath(fixture: string, timestamp: string): string {
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  return path.join(BENCHMARK_RUN_DIR, `${fixture}-${safeTimestamp}.json`);
}

export function claimsFixturePath(name: string): string {
  return path.join(CLAIMS_FIXTURE_DIR, `${name}.json`);
}

export function downstreamBenchmarkRunPath(fixture: string, timestamp: string): string {
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  return path.join(DOWNSTREAM_BENCHMARK_RUN_DIR, `${fixture}-${safeTimestamp}.json`);
}

export async function saveFixture(fixture: ResearchFixture): Promise<void> {
  await ensureDir(FIXTURE_DIR);
  await writeFile(fixturePath(fixture.name), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
}

export async function loadFixture(name: string): Promise<ResearchFixture> {
  const raw = await readFile(fixturePath(name), 'utf8');
  return JSON.parse(raw) as ResearchFixture;
}

export async function saveClaimsFixture(fixture: ClaimsFixture): Promise<void> {
  await ensureDir(CLAIMS_FIXTURE_DIR);
  await writeFile(claimsFixturePath(fixture.name), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
}

export async function loadClaimsFixture(name: string): Promise<ClaimsFixture> {
  const raw = await readFile(claimsFixturePath(name), 'utf8');
  return JSON.parse(raw) as ClaimsFixture;
}

export async function saveBenchmarkRun(run: BenchmarkRun): Promise<string> {
  await ensureDir(BENCHMARK_RUN_DIR);
  const outPath = benchmarkRunPath(run.fixture, run.run_at);
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return outPath;
}

export async function saveDownstreamBenchmarkRun(run: DownstreamBenchmarkRun): Promise<string> {
  await ensureDir(DOWNSTREAM_BENCHMARK_RUN_DIR);
  const outPath = downstreamBenchmarkRunPath(run.fixture, run.run_at);
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return outPath;
}

export async function listFixtureNames(): Promise<string[]> {
  await ensureDir(FIXTURE_DIR);
  const entries = await readdir(FIXTURE_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/i, ''))
    .sort();
}

export function snippetLengthTotal(sources: Source[]): number {
  return sources.reduce((sum, source) => sum + source.snippet.length, 0);
}

export function reliabilityDistribution(sources: Source[]): Record<string, number> {
  return sources.reduce<Record<string, number>>((acc, source) => {
    acc[source.reliability] = (acc[source.reliability] ?? 0) + 1;
    return acc;
  }, {});
}

export function domainDistribution(sources: Source[]): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const source of sources) {
    counts.set(source.domain, (counts.get(source.domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((left, right) => right.count - left.count || left.domain.localeCompare(right.domain));
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function coefficientOfVariation(values: number[]): number {
  const avg = mean(values);
  if (!avg) return 0;
  return stddev(values) / avg;
}

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function readClaimCaptureConfigFromEnv(): ClaimsFixture['capture_config'] {
  return {
    claim_batch_concurrency: Math.max(
      1,
      Number.parseInt(process.env.CLAIM_BATCH_CONCURRENCY || '2', 10) || 2,
    ),
    claim_batch_timeout_ms: Math.max(
      1,
      Number.parseInt(process.env.CLAIM_BATCH_TIMEOUT_MS || '45000', 10) || 45000,
    ),
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function claimsContentHash(claims: Claim[]): string {
  const stableJson = stableStringify(claims);
  const digest = createHash('sha256').update(stableJson).digest('hex');
  return `sha256:${digest}`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, sortJsonValue(entryValue)]));
  }
  return value;
}
