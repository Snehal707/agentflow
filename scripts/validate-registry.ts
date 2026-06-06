import { SOURCE_REGISTRY } from '../lib/source-registry-loader';

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printBreakdown(title: string, map: Map<string, number>): void {
  console.log(`\n${title}`);
  for (const [key, count] of [...map.entries()].sort((left, right) => {
    const countDelta = right[1] - left[1];
    return countDelta !== 0 ? countDelta : left[0].localeCompare(right[0]);
  })) {
    console.log(`- ${key}: ${count}`);
  }
}

const byMethod = new Map<string, number>();
const byTopic = new Map<string, number>();

for (const source of SOURCE_REGISTRY) {
  increment(byMethod, source.method);
  for (const topic of source.topics) {
    increment(byTopic, topic);
  }
}

console.log(`Source registry valid: ${SOURCE_REGISTRY.length} sources`);
printBreakdown('Sources by method', byMethod);
printBreakdown('Sources by topic', byTopic);
