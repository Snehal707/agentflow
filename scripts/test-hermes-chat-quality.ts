import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { runAgentBrain } from '../lib/agent-brain';

const DEFAULT_WALLET = '0x1111111111111111111111111111111111111111';
const DEFAULT_EXECUTION_WALLET = '0x2222222222222222222222222222222222222222';
const HERMES_API_URL = (process.env.AGENTFLOW_HERMES_URL || 'http://127.0.0.1:8000').replace(
  /\/+$/,
  '',
);

type Check = {
  name: string;
  pass: (text: string) => boolean;
};

type Scenario = {
  id: string;
  prompt: string;
  checks: Check[];
};

type ScenarioResult = {
  id: string;
  prompt: string;
  passed: boolean;
  checks: Array<{ name: string; passed: boolean }>;
  guards: string[];
  response: string;
};

type LoopRun = {
  run: number;
  passed: number;
  failed: number;
  total: number;
  results: ScenarioResult[];
};

const args = new Set(process.argv.slice(2));
const jsonMode = args.has('--json');
const softMode = args.has('--soft');
const loopArg = process.argv.slice(2).find((arg) => arg.startsWith('--loops='));
const loops = Math.max(1, Number(loopArg?.split('=')[1] || '1') || 1);
const tmpDir = path.resolve(process.cwd(), 'tmp');

const walletCtx = {
  walletAddress: DEFAULT_WALLET,
  executionTarget: 'DCW' as const,
  executionWalletAddress: DEFAULT_EXECUTION_WALLET,
  profileContext: 'Wallet profile: Hermes chat quality harness only.',
};

function normalizeText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function wordCount(text: string): number {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

async function ensureHermesAlive(): Promise<void> {
  const response = await fetch(`${HERMES_API_URL}/health`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    throw new Error(`Hermes health check failed with ${response.status}`);
  }
}

async function runPrompt(prompt: string, sessionId: string): Promise<{ text: string; guards: string[] }> {
  let text = '';
  const guards: string[] = [];

  for await (const chunk of runAgentBrain(prompt, [], walletCtx, sessionId)) {
    if (chunk.type === 'delta') {
      text += chunk.delta;
      continue;
    }
    if (chunk.type === 'guard') {
      guards.push(chunk.guard);
    }
  }

  return { text: normalizeText(text), guards };
}

const scenarios: Scenario[] = [
  {
    id: 'greeting_is_short',
    prompt: 'hey',
    checks: [
      { name: 'keeps_greeting_short', pass: (text) => wordCount(text) <= 14 },
      { name: 'does_not_dump_capabilities', pass: (text) => !containsAny(text, [/portfolio/i, /research/i, /AgentPay/i, /swap/i]) },
    ],
  },
  {
    id: 'small_talk_is_natural',
    prompt: 'hey how are you',
    checks: [
      { name: 'sounds_like_small_talk', pass: (text) => containsAny(text, [/good|well|here|doing|help/i]) },
      { name: 'does_not_switch_to_product_tour', pass: (text) => !containsAny(text, [/what I can do/i, /balances and portfolio/i, /AgentPay/i, /research requests/i]) },
      { name: 'stays_brief', pass: (text) => wordCount(text) <= 22 },
    ],
  },
  {
    id: 'capability_answer_is_human_sized',
    prompt: 'what can you do here?',
    checks: [
      { name: 'stays_brief', pass: (text) => wordCount(text) <= 45 },
      { name: 'mentions_only_user_facing_capabilities', pass: (text) => containsAny(text, [/balances?|portfolio|AgentPay|research|product guidance/i]) },
      { name: 'avoids_architecture_terms', pass: (text) => !containsAny(text, [/toolset/i, /session_search/i, /deterministic backend/i, /A2A/i, /x402/i, /specialized agents/i]) },
    ],
  },
  {
    id: 'identity_answer_is_simple',
    prompt: 'what are you exactly?',
    checks: [
      { name: 'names_agentflow_chat', pass: (text) => containsAny(text, [/AgentFlow chat/i, /conversation layer/i, /assistant inside AgentFlow/i]) },
      { name: 'avoids_long_platform_spec', pass: (text) => wordCount(text) <= 35 },
      { name: 'avoids_workstation_language', pass: (text) => !containsAny(text, [/workstation/i, /admin console/i, /Hermes CLI/i]) },
    ],
  },
  {
    id: 'memory_ack_is_not_overclaimed',
    prompt: 'my name is Aisha and I prefer short direct answers. remember that.',
    checks: [
      { name: 'acknowledges_preference', pass: (text) => containsAny(text, [/Aisha/i, /short/i, /direct/i]) },
      { name: 'does_not_overclaim_persistence', pass: (text) => !containsAny(text, [/forever/i, /permanently/i, /always remember/i]) },
      { name: 'stays_concise', pass: (text) => wordCount(text) <= 28 },
    ],
  },
  {
    id: 'product_question_stays_user_facing',
    prompt: 'what is AgentFlow?',
    checks: [
      { name: 'explains_product_briefly', pass: (text) => containsAny(text, [/AgentFlow/i, /payments|portfolio|research|assistant/i]) },
      { name: 'avoids_internal_architecture', pass: (text) => !containsAny(text, [/Hermes/i, /toolset/i, /backend/i, /specialized agents/i, /session_search/i]) },
      { name: 'stays_brief', pass: (text) => wordCount(text) <= 40 },
    ],
  },
  {
    id: 'correction_is_not_defensive',
    prompt: 'you are acting weird',
    checks: [
      { name: 'acknowledges_without_wall_of_text', pass: (text) => wordCount(text) <= 28 },
      { name: 'avoids_policy_dump', pass: (text) => !containsAny(text, [/rules/i, /guardrails/i, /policy/i, /internal/i]) },
    ],
  },
  {
    id: 'casual_reentry_is_warm',
    prompt: 'yo',
    checks: [
      { name: 'stays_brief', pass: (text) => wordCount(text) <= 14 },
      { name: 'sounds_casual', pass: (text) => containsAny(text, [/yo|hey|here|help/i]) },
    ],
  },
  {
    id: 'simple_capability_question_not_mechanical',
    prompt: 'can you help me here?',
    checks: [
      { name: 'sounds_human', pass: (text) => !containsAny(text, [/capability map/i, /tool inventory/i, /exact count/i]) },
      { name: 'stays_short', pass: (text) => wordCount(text) <= 35 },
    ],
  },
  {
    id: 'name_recall_is_simple',
    prompt: 'do you know my name?',
    checks: [
      { name: 'does_not_invent_name', pass: (text) => !containsAny(text, [/Aisha/i, /my name is/i]) || containsAny(text, [/don't know/i, /not sure/i, /if you tell me/i]) },
      { name: 'stays_brief', pass: (text) => wordCount(text) <= 24 },
    ],
  },
  {
    id: 'product_help_not_architecture',
    prompt: 'how does AgentFlow work?',
    checks: [
      { name: 'user_facing_summary', pass: (text) => containsAny(text, [/payments|portfolio|research|chat|assistant/i]) },
      { name: 'avoids_backend_words', pass: (text) => !containsAny(text, [/backend/i, /toolset/i, /session_search/i, /Hermes/i, /deterministic/i]) },
      { name: 'stays_reasonably_short', pass: (text) => wordCount(text) <= 45 },
    ],
  },
  {
    id: 'confused_user_reply_is_supportive',
    prompt: 'i am confused',
    checks: [
      { name: 'acknowledges_confusion', pass: (text) => containsAny(text, [/help/i, /tell me/i, /what are you trying/i, /we can/i]) },
      { name: 'stays_brief', pass: (text) => wordCount(text) <= 26 },
    ],
  },
  {
    id: 'simple_product_question_not_salesy',
    prompt: 'what can i do with AgentFlow?',
    checks: [
      { name: 'mentions_real_features', pass: (text) => containsAny(text, [/payments|portfolio|research|AgentPay|balances/i]) },
      { name: 'avoids_long_list', pass: (text) => wordCount(text) <= 42 },
    ],
  },
];

function writeReportArtifact(suite: string, report: unknown): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(tmpDir, `${suite}-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  await ensureHermesAlive();
  const runs: LoopRun[] = [];
  for (let loop = 0; loop < loops; loop += 1) {
    const results: ScenarioResult[] = [];
    for (const [index, scenario] of scenarios.entries()) {
      const response = await runPrompt(scenario.prompt, `hermes-quality-${loop + 1}-${index + 1}`);
      const checks = scenario.checks.map((check) => ({
        name: check.name,
        passed: check.pass(response.text),
      }));
      results.push({
        id: scenario.id,
        prompt: scenario.prompt,
        passed: checks.every((check) => check.passed) && response.guards.length === 0,
        checks,
        guards: response.guards,
        response: response.text,
      });
    }
    runs.push({
      run: loop + 1,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      total: results.length,
      results,
    });
  }

  const total = scenarios.length;
  const finalResults = runs[runs.length - 1]?.results ?? [];
  const passed = finalResults.filter((result) => result.passed).length;
  const failed = total - passed;
  const flaky = scenarios.map((scenario) => {
    const passes = runs.filter((run) => run.results.find((r) => r.id === scenario.id)?.passed).length;
    return {
      id: scenario.id,
      passes,
      failures: loops - passes,
      flaky: passes > 0 && passes < loops,
    };
  });
  const report = {
    hermesApiUrl: HERMES_API_URL,
    loops,
    passed,
    failed,
    total,
    durationMs: Date.now() - startedAt,
    flaky,
    runs,
  };
  const artifactPath = writeReportArtifact('hermes-chat-quality', report);

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Hermes chat quality: ${passed}/${total} scenarios passed on latest run (${report.durationMs}ms, loops=${loops})`);
    console.log(`artifact: ${artifactPath}`);
    const flakyCount = flaky.filter((item) => item.flaky).length;
    console.log(`flaky scenarios across loops: ${flakyCount}/${flaky.length}`);
    for (const result of finalResults) {
      const mark = result.passed ? 'PASS' : 'FAIL';
      console.log(`\n[${mark}] ${result.id}`);
      for (const check of result.checks) {
        console.log(`  ${check.passed ? 'ok' : 'xx'} ${check.name}`);
      }
      if (result.guards.length > 0) {
        console.log(`  guards: ${result.guards.join(', ')}`);
      }
      if (!result.passed) {
        console.log(`  prompt: ${result.prompt}`);
        console.log(`  reply: ${result.response.slice(0, 900)}`);
      }
    }
  }

  if (failed > 0 && !softMode) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
