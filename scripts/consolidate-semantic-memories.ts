import '../lib/loadEnv';
import {
  consolidateAllSemanticMemories,
  consolidateSemanticMemories,
} from '../lib/semantic-memory-consolidator';

function argValue(flag: string): string | undefined {
  const index = process.argv.findIndex((item) => item === flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const wallet = argValue('--wallet');
  const dryRun = process.argv.includes('--dry-run');
  const maxPerGroupRaw = argValue('--max-per-group');
  const maxPerGroup = maxPerGroupRaw ? Number.parseInt(maxPerGroupRaw, 10) : undefined;

  if (wallet) {
    const result = await consolidateSemanticMemories(wallet, { dryRun, maxPerGroup });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const results = await consolidateAllSemanticMemories({ dryRun, maxPerGroup });
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
