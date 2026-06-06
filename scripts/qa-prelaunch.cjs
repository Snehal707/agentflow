const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const phases = [
  {
    name: "Chat QA",
    command: "npm",
    args: ["run", "qa:chat-prelaunch"],
  },
  {
    name: "Agent QA",
    command: "npm",
    args: ["run", "qa:agents-prelaunch"],
  },
];

function mark(ok) {
  return ok ? "PASS" : "FAIL";
}

function runPhase(phase) {
  console.log(`\n-- ${phase.name} --`);
  const result = spawnSync(phase.command, phase.args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  return {
    ...phase,
    status: result.status ?? 1,
  };
}

function main() {
  const startedAt = Date.now();
  console.log("Prelaunch QA");
  const results = phases.map(runPhase);
  const failed = results.filter((result) => result.status !== 0);
  const durationMs = Date.now() - startedAt;

  console.log("\nSummary");
  for (const result of results) {
    console.log(`${mark(result.status === 0)}  ${result.name}`);
  }
  console.log(`Time  ${(durationMs / 1000).toFixed(1)}s`);

  if (failed.length === 0) {
    console.log("\nVerdict  READY FOR MANUAL QA");
    return;
  }

  console.log("\nVerdict  BLOCKED");
  console.log("Blocked by:");
  for (const result of failed) {
    console.log(`- ${result.name}`);
  }
  process.exitCode = 1;
}

main();
