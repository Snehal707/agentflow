import { mkdir, writeFile } from 'node:fs/promises';
import { runDeepResearchCore } from '../agents/research/deepPipeline';

const DEFAULT_TASKS = [
  'Bitcoin price today and crypto market drivers',
  'CISA exploited vulnerability latest advisory',
  'OpenAI latest model research',
];

const tasks = (process.env.REPORT_SMOKE_TASKS?.trim()
  ? process.env.REPORT_SMOKE_TASKS.split('|').map((task) => task.trim()).filter(Boolean)
  : DEFAULT_TASKS
).slice(0, Number(process.env.REPORT_SMOKE_LIMIT ?? DEFAULT_TASKS.length));

type ReportSmokeResult = {
  task: string;
  ok: boolean;
  latencyMs: number;
  sourceCount: number;
  distinctDomains: number;
  claimCount: number;
  reportChars: number;
  preview: string;
  error?: string;
};

function safeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function main(): Promise<void> {
  await mkdir('tmp/research-report-smoke', { recursive: true });
  const results: ReportSmokeResult[] = [];

  for (const task of tasks) {
    const startedAt = Date.now();
    console.log(`[report-smoke] start: ${task}`);
    try {
      const result = await runDeepResearchCore({
        task,
        onStage: (stage) => console.log(`[report-smoke] ${task}: ${stage.stage} ${stage.status}`),
      });
      const domains = new Set(result.sources.map((source) => source.domain));
      const reportPath = `tmp/research-report-smoke/${safeFileName(task)}.md`;
      await writeFile(reportPath, result.markdownReport, 'utf8');
      const stat: ReportSmokeResult = {
        task,
        ok: result.sources.length >= 2 && domains.size >= 2 && result.markdownReport.length >= 1000,
        latencyMs: Date.now() - startedAt,
        sourceCount: result.sources.length,
        distinctDomains: domains.size,
        claimCount: result.claims.length,
        reportChars: result.markdownReport.length,
        preview: result.markdownReport.replace(/\s+/g, ' ').slice(0, 500),
      };
      results.push(stat);
      console.log(
        `[report-smoke] done: ok=${stat.ok} sources=${stat.sourceCount} domains=${stat.distinctDomains} claims=${stat.claimCount} chars=${stat.reportChars} latency=${stat.latencyMs}ms path=${reportPath}`,
      );
    } catch (error) {
      const stat: ReportSmokeResult = {
        task,
        ok: false,
        latencyMs: Date.now() - startedAt,
        sourceCount: 0,
        distinctDomains: 0,
        claimCount: 0,
        reportChars: 0,
        preview: '',
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(stat);
      console.log(`[report-smoke] failed: ${task}: ${stat.error}`);
    }
  }

  await writeFile('tmp/research-report-smoke/results.json', `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  const passed = results.filter((result) => result.ok).length;
  console.log(`\nResearch report smoke summary: ${passed}/${results.length} passed`);
  console.log('Output: tmp/research-report-smoke/results.json');
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
