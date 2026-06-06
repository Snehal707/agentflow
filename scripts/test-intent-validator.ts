import { validateIntent } from '../lib/intent-router/validator';
import {
  AgentFlowDomain,
  AgentFlowIntent,
  AgentFlowIntentName,
} from '../lib/intent-router/types';

type Case = {
  name: string;
  intent: AgentFlowIntent;
  expectOk: boolean;
  expectSeverity: 'pass' | 'soft' | 'hard';
};

function makeIntent(
  domain: AgentFlowDomain,
  intent: AgentFlowIntentName,
  slots: Record<string, unknown>,
): AgentFlowIntent {
  return {
    domain,
    intent,
    slots,
    confidence: 0.95,
    source: 'llm_router',
    raw_message: `test:${intent}`,
  } as AgentFlowIntent;
}

const CASES: Case[] = [
  {
    name: 'balance always passes',
    intent: makeIntent(AgentFlowDomain.Balance, AgentFlowIntentName.BalanceGet, {}),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'swap valid',
    intent: makeIntent(AgentFlowDomain.Swap, AgentFlowIntentName.SwapExecute, {
      amount: { value: 10, currency: 'USDC' },
      token_in: { symbol: 'USDC' },
      token_out: { symbol: 'EURC' },
      confirmed: false,
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'swap soft missing currency',
    intent: makeIntent(AgentFlowDomain.Swap, AgentFlowIntentName.SwapExecute, {
      amount: { value: 10 },
      token_in: { symbol: 'USDC' },
      token_out: { symbol: 'EURC' },
      confirmed: false,
    }),
    expectOk: true,
    expectSeverity: 'soft',
  },
  {
    name: 'swap hard missing token out',
    intent: makeIntent(AgentFlowDomain.Swap, AgentFlowIntentName.SwapExecute, {
      amount: { value: 10, currency: 'USDC' },
      token_in: { symbol: 'USDC' },
      confirmed: false,
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'vault deposit valid',
    intent: makeIntent(AgentFlowDomain.Vault, AgentFlowIntentName.VaultDeposit, {
      amount: { value: 5, currency: 'USDC' },
      confirmed: false,
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'vault withdraw hard zero amount',
    intent: makeIntent(AgentFlowDomain.Vault, AgentFlowIntentName.VaultWithdraw, {
      amount: { value: 0, currency: 'USDC' },
      confirmed: false,
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'bridge precheck passes',
    intent: makeIntent(AgentFlowDomain.Bridge, AgentFlowIntentName.BridgePrecheck, {}),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'bridge execute hard missing source',
    intent: makeIntent(AgentFlowDomain.Bridge, AgentFlowIntentName.BridgeExecute, {
      amount: { value: 5, currency: 'USDC' },
      chain: { target: 'arc' },
      confirmed: false,
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'predmarket detail valid',
    intent: makeIntent(AgentFlowDomain.Predmarket, AgentFlowIntentName.PredmarketDetail, {
      market: { address: '0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96' },
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'predmarket detail hard invalid address',
    intent: makeIntent(AgentFlowDomain.Predmarket, AgentFlowIntentName.PredmarketDetail, {
      market: { address: 'abc' },
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'predmarket buy valid',
    intent: makeIntent(AgentFlowDomain.Predmarket, AgentFlowIntentName.PredmarketBuy, {
      market: { address: '0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96' },
      outcome: { label: 'yes' },
      amount: { value: 1, currency: 'USDC' },
      confirmed: false,
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'predmarket buy hard missing outcome',
    intent: makeIntent(AgentFlowDomain.Predmarket, AgentFlowIntentName.PredmarketBuy, {
      market: { address: '0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96' },
      amount: { value: 1, currency: 'USDC' },
      confirmed: false,
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'predmarket sell valid shares',
    intent: makeIntent(AgentFlowDomain.Predmarket, AgentFlowIntentName.PredmarketSell, {
      market: { address: '0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96' },
      outcome: { label: 'no' },
      shares: { value: 2 },
      confirmed: false,
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'research hard empty task',
    intent: makeIntent(AgentFlowDomain.Research, AgentFlowIntentName.ResearchReport, {
      task: '   ',
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'agentpay send soft unresolved handle',
    intent: makeIntent(AgentFlowDomain.AgentPay, AgentFlowIntentName.AgentpaySend, {
      recipient: { handle: 'Jack.Arc' },
      amount: { value: 5, currency: 'USDC' },
    }),
    expectOk: true,
    expectSeverity: 'soft',
  },
  {
    name: 'agentpay send hard confirmed unresolved handle',
    intent: makeIntent(AgentFlowDomain.AgentPay, AgentFlowIntentName.AgentpaySend, {
      recipient: { handle: 'jack.arc' },
      amount: { value: 5, currency: 'USDC' },
      confirmed: true,
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'agentpay send pass direct address',
    intent: makeIntent(AgentFlowDomain.AgentPay, AgentFlowIntentName.AgentpaySend, {
      recipient: { address: '0x79FD75a3fC633259aDD60885f927d973d3A3642b' },
      amount: { value: 5, currency: 'USDC' },
      confirmed: true,
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'agentpay request hard missing recipient',
    intent: makeIntent(AgentFlowDomain.AgentPay, AgentFlowIntentName.AgentpayRequest, {
      amount: { value: 5, currency: 'USDC' },
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'payment link soft missing amount',
    intent: makeIntent(
      AgentFlowDomain.AgentPay,
      AgentFlowIntentName.AgentpayPaymentLink,
      { recipient: { handle: 'jack.arc' } },
    ),
    expectOk: true,
    expectSeverity: 'soft',
  },
  {
    name: 'contacts create valid',
    intent: makeIntent(AgentFlowDomain.Contacts, AgentFlowIntentName.ContactsCreate, {
      name: 'Jack',
      recipient: { handle: 'Jack.Arc' },
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'contacts update hard missing recipient',
    intent: makeIntent(AgentFlowDomain.Contacts, AgentFlowIntentName.ContactsUpdate, {
      name: 'jack',
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'contacts delete hard missing name',
    intent: makeIntent(AgentFlowDomain.Contacts, AgentFlowIntentName.ContactsDelete, {}),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'schedule create valid',
    intent: makeIntent(AgentFlowDomain.Schedule, AgentFlowIntentName.ScheduleCreate, {
      recipient: { handle: 'alice.arc' },
      amount: { value: 10 },
      schedule: { cadence: 'every monday' },
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'schedule cancel valid payment id',
    intent: makeIntent(AgentFlowDomain.Schedule, AgentFlowIntentName.ScheduleCancel, {
      payment_id: 'sched_123',
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'schedule cancel hard ambiguous',
    intent: makeIntent(AgentFlowDomain.Schedule, AgentFlowIntentName.ScheduleCancel, {
      recipient_filter: { handle: 'alice.arc' },
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'split valid',
    intent: makeIntent(AgentFlowDomain.Split, AgentFlowIntentName.SplitExecute, {
      total_amount: { value: 30, currency: 'USDC' },
      recipients: [{ handle: 'alice.arc' }, { handle: 'bob.arc' }],
      confirmed: false,
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'split hard one recipient',
    intent: makeIntent(AgentFlowDomain.Split, AgentFlowIntentName.SplitExecute, {
      total_amount: { value: 30, currency: 'USDC' },
      recipients: [{ handle: 'alice.arc' }],
      confirmed: false,
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'batch valid',
    intent: makeIntent(AgentFlowDomain.Batch, AgentFlowIntentName.BatchExecute, {
      payments: [{ recipient: { handle: 'alice.arc' }, amount: { value: 10 } }],
      confirmed: false,
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'batch hard missing payment amount',
    intent: makeIntent(AgentFlowDomain.Batch, AgentFlowIntentName.BatchExecute, {
      payments: [{ recipient: { handle: 'alice.arc' } }],
      confirmed: false,
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'invoice create valid',
    intent: makeIntent(AgentFlowDomain.Invoice, AgentFlowIntentName.InvoiceCreate, {
      recipient: { handle: 'jack.arc' },
      amount: { value: 50, currency: 'USDC' },
      description: 'design work',
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'invoice create hard missing description',
    intent: makeIntent(AgentFlowDomain.Invoice, AgentFlowIntentName.InvoiceCreate, {
      recipient: { handle: 'jack.arc' },
      amount: { value: 50, currency: 'USDC' },
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'vision analyze valid',
    intent: makeIntent(AgentFlowDomain.Vision, AgentFlowIntentName.VisionAnalyze, {
      attachment: { kind: 'image', id: 'img_1' },
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'vision analyze hard wrong kind',
    intent: makeIntent(AgentFlowDomain.Vision, AgentFlowIntentName.VisionAnalyze, {
      attachment: { kind: 'audio', id: 'aud_1' },
    }),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'transcribe valid',
    intent: makeIntent(
      AgentFlowDomain.Transcribe,
      AgentFlowIntentName.TranscribeTranscribe,
      { attachment: { kind: 'audio', id: 'aud_1' } },
    ),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'transcribe hard missing attachment',
    intent: makeIntent(
      AgentFlowDomain.Transcribe,
      AgentFlowIntentName.TranscribeTranscribe,
      {},
    ),
    expectOk: false,
    expectSeverity: 'hard',
  },
  {
    name: 'treasury topup passes',
    intent: makeIntent(AgentFlowDomain.Treasury, AgentFlowIntentName.TreasuryTopup, {}),
    expectOk: true,
    expectSeverity: 'pass',
  },
  {
    name: 'general chat passes',
    intent: makeIntent(AgentFlowDomain.General, AgentFlowIntentName.GeneralChat, {
      topic_hint: 'greeting',
    }),
    expectOk: true,
    expectSeverity: 'pass',
  },
];

async function main(): Promise<void> {
  let passed = 0;

  for (const testCase of CASES) {
    const result = validateIntent(testCase.intent);
    const ok =
      result.ok === testCase.expectOk && result.severity === testCase.expectSeverity;

    if (!ok) {
      console.error(
        JSON.stringify(
          {
            name: testCase.name,
            expected: {
              ok: testCase.expectOk,
              severity: testCase.expectSeverity,
            },
            actual: {
              ok: result.ok,
              severity: result.severity,
              reason: result.reason,
              clarification: result.clarification,
            },
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }

    passed += 1;
  }

  console.log(`Validator tests passed: ${passed}/${CASES.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
