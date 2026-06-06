import '../lib/loadEnv';
import { buildSemanticMemoryMetricsReport } from '../lib/semantic-memory-metrics';

async function main(): Promise<void> {
  const report = await buildSemanticMemoryMetricsReport();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
