import { classifyIntent } from '../lib/intent-router/index';
import { AgentFlowIntentName } from '../lib/intent-router/types';
import { validateIntent } from '../lib/intent-router/validator';

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

type NaturalCase = {
  id: string;
  message: string;
  expectedIntents: AgentFlowIntentName[];
  history?: HistoryMessage[];
  note?: string;
};

type NaturalResult = {
  id: string;
  message: string;
  expectedIntents: AgentFlowIntentName[];
  classifiedIntent: string;
  classifiedDomain: string;
  confidence: number;
  latencyMs: number;
  pass: boolean;
  validatorSeverity: 'pass' | 'soft' | 'hard' | 'n/a';
  validatorOk: boolean;
  validatorReason?: string;
  error?: string;
  historyLength: number;
};

const DELAY_MS = 250;

const CASES: NaturalCase[] = [
  {
    id: 'portfolio-natural',
    message: 'can you show me what im holding rn',
    expectedIntents: [AgentFlowIntentName.PortfolioReport],
  },
  {
    id: 'portfolio-how-to-question',
    message: 'how to check portfolio?',
    expectedIntents: [AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'portfolio-referential-question',
    message: 'is this my portfolio',
    expectedIntents: [AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'balance-slang',
    message: 'how much money do i got in here',
    expectedIntents: [AgentFlowIntentName.BalanceGet],
  },
  {
    id: 'swap-casual',
    message: 'i wanna flip 12 usdc into eurc',
    expectedIntents: [AgentFlowIntentName.SwapExecute],
  },
  {
    id: 'swap-super-casual',
    message: 'turn some usdc into eurc for me',
    expectedIntents: [AgentFlowIntentName.SwapExecute, AgentFlowIntentName.GeneralChat],
    note: 'natural but underspecified amount; classifier may route swap while validator should soften/harden on missing amount',
  },
  {
    id: 'vault-withdraw-casual',
    message: 'pull 8 bucks outta my vault',
    expectedIntents: [AgentFlowIntentName.VaultWithdraw],
  },
  {
    id: 'vault-position-natural',
    message: 'what do i have parked in vaults right now',
    expectedIntents: [AgentFlowIntentName.VaultPosition],
  },
  {
    id: 'bridge-precheck-natural',
    message: 'before we do anything can you check if i can bridge from base sepolia',
    expectedIntents: [AgentFlowIntentName.BridgePrecheck],
  },
  {
    id: 'bridge-execute-natural',
    message: 'i need to move 6 usdc from base sepolia over to arc',
    expectedIntents: [AgentFlowIntentName.BridgeExecute],
  },
  {
    id: 'bridge-vague-natural',
    message: 'can we get funds onto arc from base',
    expectedIntents: [AgentFlowIntentName.BridgeExecute, AgentFlowIntentName.BridgePrecheck, AgentFlowIntentName.GeneralChat],
    note: 'good natural-language ambiguity check',
  },
  {
    id: 'pred-list-natural',
    message: 'what prediction markets are live right now',
    expectedIntents: [AgentFlowIntentName.PredmarketList],
  },
  {
    id: 'pred-position-natural',
    message: 'what am i holding in prediction markets',
    expectedIntents: [AgentFlowIntentName.PredmarketPosition],
  },
  {
    id: 'pred-redeem-natural',
    message: 'cash out my winning market position on 0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96',
    expectedIntents: [AgentFlowIntentName.PredmarketRedeem],
  },
  {
    id: 'pred-help-natural',
    message: 'when can i redeem after winning one of these markets',
    expectedIntents: [AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'research-natural',
    message: 'look into arc mainnet launch and give me a report',
    expectedIntents: [AgentFlowIntentName.ResearchReport],
  },
  {
    id: 'research-short-natural',
    message: 'dig into circle gateway adoption',
    expectedIntents: [AgentFlowIntentName.ResearchReport],
  },
  {
    id: 'send-natural',
    message: 'send like 5 usdc to jack.arc',
    expectedIntents: [AgentFlowIntentName.AgentpaySend],
  },
  {
    id: 'send-underspecified-natural',
    message: 'pay jack for lunch',
    expectedIntents: [AgentFlowIntentName.AgentpaySend, AgentFlowIntentName.GeneralChat],
    note: 'recipient known but amount omitted; should expose validator behavior clearly',
  },
  {
    id: 'request-natural',
    message: 'can you ask alice.arc for 12 usdc for lunch',
    expectedIntents: [AgentFlowIntentName.AgentpayRequest],
  },
  {
    id: 'history-natural',
    message: 'show me my recent payments',
    expectedIntents: [AgentFlowIntentName.AgentpayHistory],
  },
  {
    id: 'payment-link-natural',
    message: 'make me a pay link for 8 usdc from alice.arc',
    expectedIntents: [AgentFlowIntentName.AgentpayPaymentLink],
  },
  {
    id: 'payment-link-vague-natural',
    message: 'i need something people can scan to pay me',
    expectedIntents: [AgentFlowIntentName.AgentpayPaymentLink, AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'schedule-natural',
    message: 'pay jack.arc 15 every friday morning',
    expectedIntents: [AgentFlowIntentName.ScheduleCreate],
  },
  {
    id: 'schedule-vague-natural',
    message: 'set up that payment every month',
    expectedIntents: [AgentFlowIntentName.ScheduleCreate, AgentFlowIntentName.GeneralChat],
    history: [
      { role: 'user', content: 'send 25 usdc to alice.arc' },
      { role: 'assistant', content: 'I can do that once or turn it into a recurring payment.' },
    ],
  },
  {
    id: 'split-natural',
    message: 'split 18 usdc between alice.arc and bob.arc',
    expectedIntents: [AgentFlowIntentName.SplitExecute],
  },
  {
    id: 'split-vague-natural',
    message: 'we need to split dinner between me and two friends',
    expectedIntents: [AgentFlowIntentName.SplitExecute, AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'batch-natural',
    message: 'run a batch and pay alice 10 bob 20 and charlie 30',
    expectedIntents: [AgentFlowIntentName.BatchExecute],
  },
  {
    id: 'invoice-natural',
    message: 'make an invoice for alice.arc for 40 usdc for design',
    expectedIntents: [AgentFlowIntentName.InvoiceCreate],
  },
  {
    id: 'treasury-status-natural',
    message: 'how are the agent wallets funded right now',
    expectedIntents: [AgentFlowIntentName.TreasuryStatus],
  },
  {
    id: 'treasury-topup-natural',
    message: 'top up the agent wallets',
    expectedIntents: [AgentFlowIntentName.TreasuryTopup],
  },
  {
    id: 'product-capability-natural',
    message: 'what all can i do in here',
    expectedIntents: [AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'product-scope-natural',
    message: 'nah i mean agentflow on arc specifically',
    expectedIntents: [AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'ambiguous-money-natural',
    message: 'move money around',
    expectedIntents: [AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'ambiguous-other-thing-natural',
    message: 'do the other thing',
    expectedIntents: [AgentFlowIntentName.GeneralChat],
  },
  {
    id: 'anchored-swap-no-amount',
    message: 'turn some usdc into eurc for me',
    expectedIntents: [AgentFlowIntentName.SwapExecute, AgentFlowIntentName.GeneralChat],
    note: 'anchored token pair may classify as swap, but validator must block execution until amount is provided',
  },
  {
    id: 'followup-yeah-go-research',
    message: 'yeah go',
    expectedIntents: [AgentFlowIntentName.ResearchReport],
    history: [
      { role: 'user', content: 'research arc stablecoin adoption for me' },
      { role: 'assistant', content: 'I can do that. Want me to start the research run now?' },
    ],
    note: 'short follow-up should resolve from current session context',
  },
  {
    id: 'followup-do-it-bridge',
    message: 'do it',
    expectedIntents: [AgentFlowIntentName.BridgeExecute],
    history: [
      { role: 'user', content: 'bridge 5 usdc from base sepolia to arc' },
      { role: 'assistant', content: 'I can prepare that bridge flow. Want me to go ahead?' },
    ],
  },
  {
    id: 'followup-what-about-other-one',
    message: 'what about the other one',
    expectedIntents: [AgentFlowIntentName.PredmarketDetail, AgentFlowIntentName.GeneralChat],
    history: [
      { role: 'user', content: 'show details for market 0xe1F30dd444A8A85cD8C7882e06abA26dBA894B96' },
      { role: 'assistant', content: 'That market is active and currently favors YES.' },
    ],
    note: 'this is intentionally ambiguous; general.chat is acceptable if the router refuses to guess',
  },
  {
    id: 'followup-show-me-that',
    message: 'show me that',
    expectedIntents: [AgentFlowIntentName.PortfolioReport],
    history: [
      { role: 'user', content: 'can you show my portfolio' },
      { role: 'assistant', content: 'Yes, I can summarize your holdings.' },
    ],
  },
  {
    id: 'followup-continue-schedule',
    message: 'continue',
    expectedIntents: [AgentFlowIntentName.ScheduleCreate],
    history: [
      { role: 'user', content: 'pay alice 10 every monday' },
      { role: 'assistant', content: 'I can set that recurring payment up. Want me to proceed?' },
    ],
  },
  {
    id: 'followup-do-that-payment-link',
    message: 'yeah make that',
    expectedIntents: [AgentFlowIntentName.AgentpayPaymentLink],
    history: [
      { role: 'user', content: 'i need something people can scan to pay me 10 usdc' },
      { role: 'assistant', content: 'I can make a payment link or QR-style request for that.' },
    ],
  },
  {
    id: 'followup-whats-next-after-balance',
    message: 'what about the rest',
    expectedIntents: [AgentFlowIntentName.PortfolioReport, AgentFlowIntentName.GeneralChat],
    history: [
      { role: 'user', content: 'show me my balance' },
      { role: 'assistant', content: 'You have balances available. I can also summarize your holdings if you want.' },
    ],
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCase(testCase: NaturalCase): Promise<NaturalResult> {
  const startedAt = Date.now();
  try {
    const result = await classifyIntent(testCase.message, testCase.history);
    const validation = validateIntent(result);
    const latencyMs = Date.now() - startedAt;
    return {
      id: testCase.id,
      message: testCase.message,
      expectedIntents: testCase.expectedIntents,
      classifiedIntent: result.intent,
      classifiedDomain: result.domain,
      confidence: result.confidence,
      latencyMs,
      pass: testCase.expectedIntents.includes(result.intent),
      validatorSeverity: validation.severity,
      validatorOk: validation.ok,
      validatorReason: validation.reason,
      historyLength: testCase.history?.length ?? 0,
    };
  } catch (error) {
    return {
      id: testCase.id,
      message: testCase.message,
      expectedIntents: testCase.expectedIntents,
      classifiedIntent: 'ERROR',
      classifiedDomain: 'ERROR',
      confidence: 0,
      latencyMs: Date.now() - startedAt,
      pass: false,
      validatorSeverity: 'n/a',
      validatorOk: false,
      error: error instanceof Error ? error.message : String(error),
      historyLength: testCase.history?.length ?? 0,
    };
  }
}

async function main(): Promise<void> {
  const results: NaturalResult[] = [];

  for (const testCase of CASES) {
    const result = await runCase(testCase);
    results.push(result);
    await sleep(DELAY_MS);
  }

  const passed = results.filter((result) => result.pass).length;
  const failed = results.filter((result) => !result.pass);
  const timedOut = failed.filter((result) => /timed out/i.test(result.error ?? '')).length;
  const misclassified = failed.filter((result) => !result.error).length;
  const validatorSoft = results.filter((result) => result.validatorSeverity === 'soft').length;
  const validatorHard = results.filter((result) => result.validatorSeverity === 'hard').length;

  console.log('\nNATURAL INTENT RESULTS');
  console.log('id | expected | classified | confidence | latency_ms | history | validator | status');
  for (const result of results) {
    console.log(
      [
        result.id,
        result.expectedIntents.join(','),
        result.classifiedIntent,
        result.confidence.toFixed(2),
        result.latencyMs,
        result.historyLength,
        result.validatorSeverity,
        result.pass ? 'pass' : result.error ? `fail:${result.error}` : 'fail',
      ].join(' | '),
    );
  }

  console.log('\nSUMMARY');
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Timed out: ${timedOut}`);
  console.log(`Misclassified (non-timeout): ${misclassified}`);
  console.log(`Validator soft: ${validatorSoft}`);
  console.log(`Validator hard: ${validatorHard}`);

  const validatorIssues = results.filter(
    (result) => result.validatorSeverity === 'soft' || result.validatorSeverity === 'hard',
  );
  if (validatorIssues.length > 0) {
    console.log('\nVALIDATOR ISSUES');
    for (const result of validatorIssues) {
      console.log(
        JSON.stringify(
          {
            id: result.id,
            message: result.message,
            classifiedIntent: result.classifiedIntent,
            validatorSeverity: result.validatorSeverity,
            validatorReason: result.validatorReason,
          },
          null,
          2,
        ),
      );
    }
  }

  if (failed.length > 0) {
    console.log('\nFAILURES');
    for (const result of failed) {
      console.log(
        JSON.stringify(
          {
            id: result.id,
            message: result.message,
            expectedIntents: result.expectedIntents,
            classifiedIntent: result.classifiedIntent,
            classifiedDomain: result.classifiedDomain,
            confidence: result.confidence,
            latencyMs: result.latencyMs,
            error: result.error,
          },
          null,
          2,
        ),
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
