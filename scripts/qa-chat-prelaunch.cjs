const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const apiBase = (process.env.BACKEND_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const hermesBase = (process.env.AGENTFLOW_HERMES_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const scheduleBase = (process.env.SCHEDULE_AGENT_URL || "http://127.0.0.1:3018").replace(/\/+$/, "");

const steps = [
  {
    name: "Hermes guardrails",
    command: "npm",
    args: ["run", "test:hermes-chat-guardrails:soft"],
  },
  {
    name: "Hermes quality",
    command: "npm",
    args: ["run", "test:hermes-chat-quality:soft"],
  },
  {
    name: "Intent router natural language",
    command: "npm",
    args: ["run", "test:intent-router:natural"],
  },
  {
    name: "Weird language layer stress",
    command: "npx",
    args: ["tsx", "scripts/stress-weird-language-layers.ts", "--timeout-ms=90000"],
  },
  {
    name: "Live chat clarifications",
    command: "npm",
    args: ["run", "test:chat-clarifications"],
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
    env: process.env,
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

async function main() {
  console.log("Chat QA");
  console.log("Health");
  const healthChecks = await Promise.all([
    checkHealth("Hermes", `${hermesBase}/health`),
    checkHealth("API", `${apiBase}/api/chat/respond`),
    checkHealth("Schedule", `${scheduleBase}/health`),
  ]);

  // `/api/chat/respond` is POST-only, so 404/405 is still enough to prove the API is listening.
  const normalizedHealthChecks = healthChecks.map((check) => {
    if (
      check.name === "API" &&
      !check.ok &&
      /HTTP (404|405)/.test(check.detail)
    ) {
      return { ...check, ok: true };
    }
    return check;
  });

  for (const check of normalizedHealthChecks) {
    console.log(`${mark(check.ok)}  ${check.name}  ${check.detail}`);
  }

  const unhealthy = normalizedHealthChecks.filter((check) => !check.ok);
  if (unhealthy.length > 0) {
    console.log("\nBlocked: chat core is not ready.");
    console.log("Run: npm run dev:chat-core:clean");
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const results = steps.map(runStep);
  const failed = results.filter((result) => result.status !== 0);
  const durationMs = Date.now() - startedAt;

  console.log("\nSummary");
  for (const result of results) {
    console.log(`${mark(result.status === 0)}  ${result.name}`);
  }
  console.log(`Time  ${(durationMs / 1000).toFixed(1)}s`);
  console.log("Artifacts  tmp/*.json");

  if (failed.length > 0) {
    console.log("\nBlocked by:");
    for (const result of failed) {
      console.log(`- ${result.name}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nReady: chat QA passed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
