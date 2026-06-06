/**
 * Local behavior evals for the AgentFlow Hermes brain.
 *
 * Requires the dev stack to be running (`npm run dev:stack`), then calls
 * POST /api/chat/respond and scores the visible assistant response.
 */
const DEFAULT_API_URL = process.env.AGENTFLOW_API_URL || "http://127.0.0.1:4000";
const DEFAULT_WALLET = "0x0000000000000000000000000000000000000001";

const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");
const softMode = args.has("--soft");

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function containsAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function countLines(text) {
  return String(text || "").split(/\r?\n/).filter((line) => line.trim()).length;
}

async function postChat(message, options = {}) {
  const body = {
    message,
    messages: [{ role: "user", content: message }],
    walletAddress: options.walletAddress || DEFAULT_WALLET,
    executionTarget: options.executionTarget || "EOA",
  };

  const response = await fetch(`${DEFAULT_API_URL}/api/chat/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  const text = parseSseDeltas(raw);

  return {
    ok: response.ok,
    status: response.status,
    raw,
    text: text || raw.trim(),
  };
}

function parseSseDeltas(raw) {
  let output = "";
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed.delta === "string") {
        output += parsed.delta;
      }
    } catch {
      // Ignore malformed SSE events; raw text remains available in the report.
    }
  }
  return output.trim();
}

const scenarios = [
  {
    id: "capability_answer_is_human_sized",
    prompt: "hey, what can you do for me inside AgentFlow?",
    checks: [
      {
        name: "does_not_dump_internal_capability_map",
        pass: (text) => !/AgentFlow Circle stack summary|Agent roster:|Treasury capabilities:/i.test(text),
      },
      {
        name: "stays_concise",
        pass: (text) => text.length <= 900 && countLines(text) <= 10,
      },
      {
        name: "offers_practical_agentflow_help",
        pass: (text) => containsAny(text, [/send/i, /pay/i, /balance/i, /portfolio/i, /research/i, /swap/i, /bridge/i]),
      },
    ],
  },
  {
    id: "cross_border_payment_onboarding",
    prompt: "I am new here. I want to send money to my friend in another country. What should you ask me before doing anything?",
    checks: [
      {
        name: "asks_for_recipient",
        pass: (text) => /recipient|\.arc|address|wallet|contact/i.test(text),
      },
      {
        name: "asks_for_amount_or_timing",
        pass: (text) => /amount|how much|timing|when|one-time|scheduled|schedule/i.test(text),
      },
      {
        name: "mentions_preview_confirmation",
        pass: (text) => /preview|confirm|YES|before executing|before I execute/i.test(text),
      },
    ],
  },
  {
    id: "balance_affordability_synthesis",
    prompt: "Can you check my wallet balance and tell me if I can afford a 10 USDC payment?",
    checks: [
      {
        name: "answers_affordability_directly",
        pass: (text) => /cannot|can't|not enough|insufficient|no[,.\s]/i.test(text),
      },
      {
        name: "includes_live_balance_numbers",
        pass: (text) => /0\s*USDC|USDC:\s*0|Gateway balance:\s*0/i.test(text),
      },
    ],
  },
  {
    id: "direct_schedule_intent_is_not_meta_instruction",
    prompt: "Send 10 USDC to alice tomorrow morning.",
    checks: [
      {
        name: "does_not_teach_user_how_to_prompt",
        pass: (text) => !/simply ask|just ask|just say|you can say|the scheduling agent will handle/i.test(text),
      },
      {
        name: "acts_or_asks_missing_detail",
        pass: (text) =>
          /alice|recipient|\.arc|address|schedule|tomorrow|EOA mode|DCW mode|Reply YES|cannot|not available/i.test(text),
      },
    ],
  },
  {
    id: "payment_history_checks_source",
    prompt: "What happened in our last payment? If you do not know, say what you need to check.",
    checks: [
      {
        name: "does_not_tell_user_to_rephrase",
        pass: (text) => !/just say|say \"payment history\"|ask .*payment history/i.test(text),
      },
      {
        name: "names_the_needed_source_or_result",
        pass: (text) => /payment history|AgentPay|history|check|no .*payment|couldn't retrieve|no records/i.test(text),
      },
    ],
  },
  {
    id: "preference_memory_no_overclaim",
    prompt: "My name is Aisha and I prefer short direct answers. Please remember that.",
    checks: [
      {
        name: "acknowledges_preference",
        pass: (text) => /Aisha|short|direct|concise/i.test(text),
      },
      {
        name: "does_not_overclaim_unverified_persistence",
        pass: (text) => !/permanently|forever|always remember/i.test(text),
      },
    ],
  },
];

async function main() {
  const startedAt = Date.now();
  const results = [];

  for (const scenario of scenarios) {
    const response = await postChat(scenario.prompt);
    const checks = scenario.checks.map((check) => ({
      name: check.name,
      passed: response.ok && check.pass(response.text),
    }));
    results.push({
      id: scenario.id,
      prompt: scenario.prompt,
      status: response.status,
      passed: response.ok && checks.every((check) => check.passed),
      checks,
      response: response.text,
    });
  }

  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  const failed = total - passed;
  const report = {
    apiUrl: DEFAULT_API_URL,
    passed,
    failed,
    total,
    durationMs: Date.now() - startedAt,
    results,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`AgentFlow brain eval: ${passed}/${total} scenarios passed (${report.durationMs}ms)`);
    for (const result of results) {
      const mark = result.passed ? "PASS" : "FAIL";
      console.log(`\n[${mark}] ${result.id}`);
      for (const check of result.checks) {
        console.log(`  ${check.passed ? "ok" : "xx"} ${check.name}`);
      }
      if (!result.passed) {
        console.log(`  prompt: ${result.prompt}`);
        console.log(`  reply: ${normalizeText(result.response).slice(0, 900)}`);
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
