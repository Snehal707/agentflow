const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const apiBase = (process.env.BACKEND_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const runPaidChecks = /^(1|true|yes|on)$/i.test(String(process.env.QA_RUN_PAID || "").trim());
const hasTestWallet = Boolean((process.env.TEST_WALLET_ADDRESS || "").trim());
const hasAlchemy = Boolean((process.env.ALCHEMY_ARC_RPC || "").trim());

const requiredSteps = [
  {
    name: "Agent health matrix",
    command: "npx",
    args: ["tsx", "--env-file=.env", "scripts/verify-agent.ts"],
  },
  {
    name: "Prediction market list smoke",
    command: "npx",
    args: ["tsx", "--env-file=.env", "scripts/test-predmarket-list.ts"],
  },
];

const optionalSteps = [
  {
    name: "Portfolio smoke",
    enabled: hasAlchemy,
    skipReason: "ALCHEMY_ARC_RPC not set",
    command: "npx",
    args: ["tsx", "--env-file=.env", "scripts/test-portfolio.ts"],
  },
  {
    name: "Research paid pipeline",
    enabled: runPaidChecks && hasTestWallet,
    skipReason: !runPaidChecks
      ? "set QA_RUN_PAID=1 to include paid pipeline checks"
      : "TEST_WALLET_ADDRESS not set",
    command: "npx",
    args: ["tsx", "--env-file=.env", "scripts/verify-research-pipeline-run.ts"],
    env: {
      VERIFY_RESEARCH_SKIP_DB: process.env.VERIFY_RESEARCH_SKIP_DB || "1",
      VERIFY_RESEARCH_SKIP_REDIS: process.env.VERIFY_RESEARCH_SKIP_REDIS || "1",
    },
  },
];

function mark(ok) {
  return ok ? "PASS" : "FAIL";
}

function runStep(step) {
  console.log(`\n-- ${step.name} --`);
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...(step.env || {}) },
  });
  return {
    ...step,
    status: result.status ?? 1,
  };
}

async function checkHealth(name, url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      return { name, ok: false, detail: `HTTP ${response.status} from ${url}` };
    }
    return { name, ok: true, detail: url };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: `${url} (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

async function checkStackHealth() {
  try {
    const response = await fetch(`${apiBase}/health/stack`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status} from ${apiBase}/health/stack` };
    }
    return { ok: true, detail: JSON.stringify(body) };
  } catch (error) {
    return {
      ok: false,
      detail: `${apiBase}/health/stack (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

async function main() {
  console.log("Agent QA");
  console.log("Health");
  const healthChecks = await Promise.all([
    checkHealth("API", `${apiBase}/health`),
    checkStackHealth(),
  ]);

  const apiHealth = healthChecks[0];
  const stackHealth = healthChecks[1];
  console.log(`${mark(apiHealth.ok)}  API  ${apiHealth.detail}`);
  console.log(`${mark(stackHealth.ok)}  Stack  ${stackHealth.detail}`);

  if (!apiHealth.ok || !stackHealth.ok) {
    console.log("\nBlocked: agent stack is not ready.");
    console.log("Run: npm run dev:stack:clean");
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const results = [];

  for (const step of requiredSteps) {
    results.push(runStep(step));
  }

  const skipped = [];
  for (const step of optionalSteps) {
    if (!step.enabled) {
      skipped.push(step);
      continue;
    }
    results.push(runStep(step));
  }

  const failed = results.filter((result) => result.status !== 0);
  const durationMs = Date.now() - startedAt;

  console.log("\nSummary");
  for (const result of results) {
    console.log(`${mark(result.status === 0)}  ${result.name}`);
  }
  for (const step of skipped) {
    console.log(`SKIP  ${step.name}  ${step.skipReason}`);
  }
  console.log(`Time  ${(durationMs / 1000).toFixed(1)}s`);

  if (failed.length > 0) {
    console.log("\nBlocked by:");
    for (const result of failed) {
      console.log(`- ${result.name}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nReady: agent QA passed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
