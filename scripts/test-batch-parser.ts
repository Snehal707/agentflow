import { parseBatchPaymentsFromMessage } from '../lib/csv-batch-parser';

type Case = {
  label: string;
  input: string;
  expected: Array<{ to: string; amount: string; remark?: string }>;
};

const CASES: Case[] = [
  {
    label: 'csv inline',
    input: 'batch pay\nalice.arc,100,salary\nbob.arc,100,salary',
    expected: [
      { to: 'alice.arc', amount: '100', remark: 'salary' },
      { to: 'bob.arc', amount: '100', remark: 'salary' },
    ],
  },
  {
    label: 'per-recipient natural language',
    input: 'batch pay jack.arc 10 and snehal.arc 20',
    expected: [
      { to: 'jack.arc', amount: '10' },
      { to: 'snehal.arc', amount: '20' },
    ],
  },
  {
    label: 'shared amount natural language',
    input: 'batch pay $1 to jack.arc and jack2.arc',
    expected: [
      { to: 'jack.arc', amount: '1' },
      { to: 'jack2.arc', amount: '1' },
    ],
  },
  {
    label: 'shared amount with remark',
    input: 'batchpay 2 usdc to jack.arc, jack2.arc for test payout',
    expected: [
      { to: 'jack.arc', amount: '2', remark: 'test payout' },
      { to: 'jack2.arc', amount: '2', remark: 'test payout' },
    ],
  },
  {
    label: 'shared amount each shorthand',
    input: 'batchpay 1$ each jack.arc, jack2.arc',
    expected: [
      { to: 'jack.arc', amount: '1' },
      { to: 'jack2.arc', amount: '1' },
    ],
  },
  {
    label: 'shared amount each shorthand with shared remark',
    input: 'batchpay 1$ each jack.arc, jack2.arc for testing',
    expected: [
      { to: 'jack.arc', amount: '1', remark: 'testing' },
      { to: 'jack2.arc', amount: '1', remark: 'testing' },
    ],
  },
  {
    label: 'shared amount each shorthand with per-recipient remarks',
    input: 'batchpay 1$ each jack.arc testing, jack2.arc coffee',
    expected: [
      { to: 'jack.arc', amount: '1', remark: 'testing' },
      { to: 'jack2.arc', amount: '1', remark: 'coffee' },
    ],
  },
];

for (const testCase of CASES) {
  const parsed = parseBatchPaymentsFromMessage(testCase.input);
  if (!Array.isArray(parsed)) {
    throw new Error(`[${testCase.label}] expected parsed payments, got error: ${parsed.error}`);
  }
  const actual = JSON.stringify(parsed);
  const expected = JSON.stringify(testCase.expected);
  if (actual !== expected) {
    throw new Error(`[${testCase.label}] mismatch\nexpected: ${expected}\nactual:   ${actual}`);
  }
}

console.log(`Batch parser checks passed: ${CASES.length}`);
