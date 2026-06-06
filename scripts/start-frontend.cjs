const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const frontendRoot = path.join(repoRoot, "agentflow-frontend");
const buildIdPath = path.join(frontendRoot, ".next", "BUILD_ID");

const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const requestedMode = (
  modeArg?.slice("--mode=".length) ||
  process.env.AGENTFLOW_FRONTEND_MODE ||
  "auto"
).toLowerCase();
const printOnly = process.argv.includes("--print");
const requestedStaleMode = (
  process.env.AGENTFLOW_FRONTEND_STALE_MODE ||
  "dev"
).toLowerCase();

const watchRoots = [
  "app",
  "components",
  "lib",
  "public",
];

const watchFiles = [
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  "tsconfig.json",
  "postcss.config.js",
  "postcss.config.mjs",
  "tailwind.config.js",
  "tailwind.config.ts",
  "eslint.config.mjs",
  ".env.local",
  ".env.local.example",
];

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function latestMtimeMs(targetPath) {
  const stat = safeStat(targetPath);
  if (!stat) return 0;
  if (stat.isFile()) return stat.mtimeMs;
  if (!stat.isDirectory()) return 0;

  let latest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".next-dev" ||
      entry.name === ".git"
    ) {
      continue;
    }
    const childPath = path.join(targetPath, entry.name);
    const childLatest = latestMtimeMs(childPath);
    if (childLatest > latest) {
      latest = childLatest;
    }
  }
  return latest;
}

function frontendBuildIsStale() {
  const buildStat = safeStat(buildIdPath);
  if (!buildStat) return true;

  let latestSourceChange = 0;
  for (const relativeDir of watchRoots) {
    latestSourceChange = Math.max(
      latestSourceChange,
      latestMtimeMs(path.join(frontendRoot, relativeDir)),
    );
  }

  for (const relativeFile of watchFiles) {
    latestSourceChange = Math.max(
      latestSourceChange,
      latestMtimeMs(path.join(frontendRoot, relativeFile)),
    );
  }

  return latestSourceChange > buildStat.mtimeMs;
}

function resolveStaleFrontendMode() {
  if (requestedStaleMode === "rebuild") {
    return {
      mode: "rebuild",
      reason: "frontend sources are newer than .next/BUILD_ID; AGENTFLOW_FRONTEND_STALE_MODE=rebuild",
      npmArgs: ["run", "serve:stable", "--prefix", "agentflow-frontend"],
      env: { ...process.env, NODE_ENV: "production" },
    };
  }

  return {
    mode: "dev",
    reason: "frontend sources are newer than .next/BUILD_ID; using fast dev mode",
    npmArgs: ["run", "dev", "--prefix", "agentflow-frontend"],
    env: process.env,
  };
}

function resolveFrontendPlan(mode) {
  if (mode === "dev") {
    return {
      mode: "dev",
      reason: "AGENTFLOW_FRONTEND_MODE=dev",
      npmArgs: ["run", "dev", "--prefix", "agentflow-frontend"],
      env: process.env,
    };
  }

  if (mode === "stable") {
    return {
      mode: "stable",
      reason: "AGENTFLOW_FRONTEND_MODE=stable",
      npmArgs: ["run", "start:3005", "--prefix", "agentflow-frontend"],
      env: { ...process.env, NODE_ENV: "production" },
    };
  }

  const stale = frontendBuildIsStale();
  if (stale) {
    return resolveStaleFrontendMode();
  }

  return {
    mode: "stable",
    reason: "existing production build is up to date",
    npmArgs: ["run", "start:3005", "--prefix", "agentflow-frontend"],
    env: { ...process.env, NODE_ENV: "production" },
  };
}

const plan = resolveFrontendPlan(requestedMode);

if (printOnly) {
  console.log(
    JSON.stringify(
      {
        requestedMode,
        selectedMode: plan.mode,
        reason: plan.reason,
        command: ["npm", ...plan.npmArgs].join(" "),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(`[frontend] mode: ${plan.mode}`);
console.log(`[frontend] reason: ${plan.reason}`);

const child = spawn("npm", plan.npmArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: plan.env,
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`[frontend] failed to start: ${error.message}`);
  process.exit(1);
});
