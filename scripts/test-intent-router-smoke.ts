import { classifyIntent } from '../lib/intent-router/index';

const CASES = [
  {
    raw_message: "what's my balance",
    expected_intent: 'balance.get',
  },
  {
    raw_message: 'swap 10 USDC to EURC',
    expected_intent: 'swap.execute',
  },
  {
    raw_message: 'show all markets',
    expected_intent: 'predmarket.list',
  },
] as const;

async function main(): Promise<void> {
  for (const testCase of CASES) {
    const startedAt = Date.now();
    const result = await classifyIntent(testCase.raw_message);
    const latency_ms = Date.now() - startedAt;

    console.log(
      JSON.stringify(
        {
          raw_message: testCase.raw_message,
          intent_json: result,
          latency_ms,
        },
        null,
        2,
      ),
    );

    if (result.intent !== testCase.expected_intent) {
      throw new Error(
        `Expected ${testCase.expected_intent} for "${testCase.raw_message}", got ${result.intent}`,
      );
    }

    if (
      testCase.expected_intent === 'swap.execute' &&
      result.slots &&
      'confirmed' in result.slots &&
      result.slots.confirmed !== false
    ) {
      throw new Error('Expected swap.execute smoke case to return confirmed=false');
    }

    if (
      testCase.expected_intent === 'predmarket.list' &&
      result.slots &&
      'pagination' in result.slots &&
      typeof result.slots.pagination === 'object' &&
      result.slots.pagination !== null &&
      'mode' in result.slots.pagination &&
      result.slots.pagination.mode !== 'all'
    ) {
      throw new Error('Expected predmarket.list smoke case to return pagination.mode=all');
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
