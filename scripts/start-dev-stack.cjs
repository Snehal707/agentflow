const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const net = require("net");
const dotenv = require("dotenv");

const { cleanupExistingStack } = require("./stack-cleanup.cjs");

const repoRoot = path.resolve(__dirname, "..");
const repoNodeBin = path.join(repoRoot, "node_modules", ".bin");
const frontendNodeBin = path.join(repoRoot, "agentflow-frontend", "node_modules", ".bin");
const supervisorLockPath = path.join(repoRoot, ".dev-stack.lock.json");
dotenv.config({ path: path.join(repoRoot, ".env") });

const shouldClean =
  /^(1|true|yes|on)$/i.test(String(process.env.AGENTFLOW_STACK_CLEAN || "").trim()) ||
  process.argv.includes("--clean");

function isPidAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists but not signalable
  }
}

/**
 * Refuse to start a second supervisor. Two `npm run dev:stack` invocations both
 * respawn all 17 agents, colliding on every port and producing the endless-respawn
 * / orphan-pileup we used to see. A stale lock (dead PID) is reclaimed automatically.
 */
function ensureSingleSupervisor() {
  try {
    const raw = fs.readFileSync(supervisorLockPath, "utf8");
    const lock = JSON.parse(raw);
    if (lock?.pid && lock.pid !== process.pid && isPidAlive(lock.pid)) {
      console.error(
        `[dev:stack] another supervisor is already running (pid ${lock.pid}). ` +
          `Stop it first, or run \`taskkill /PID ${lock.pid} /T /F\`. Exiting.`,
      );
      return false;
    }
  } catch {
    /* no lock or unreadable — fall through and claim it */
  }
  try {
    fs.writeFileSync(
      supervisorLockPath,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
  } catch (err) {
    console.warn("[dev:stack] could not write supervisor lock:", err.message);
  }
  return true;
}

function clearSupervisorLock() {
  try {
    const lock = JSON.parse(fs.readFileSync(supervisorLockPath, "utf8"));
    if (!lock || lock.pid === process.pid) {
      fs.rmSync(supervisorLockPath, { force: true });
    }
  } catch {
    /* ignore */
  }
}

const backendCommands = [
  { name: "facilitator", command: "tsx facilitator/server.ts" },
  { name: "research", command: "tsx agents/research/server.ts" },
  { name: "analyst", command: "tsx agents/analyst/server.ts" },
  { name: "writer", command: "tsx agents/writer/server.ts" },
  { name: "api", command: "tsx server.ts" },
  { name: "swap", command: "tsx agents/swap/server.ts" },
  { name: "vault", command: "tsx agents/vault/server.ts" },
  { name: "predmarket", command: "tsx agents/predmarket/server.ts" },
  { name: "bridge", command: "tsx agents/bridge/server.ts" },
  { name: "portfolio", command: "tsx agents/portfolio/server.ts" },
  { name: "invoice", command: "tsx agents/invoice/server.ts" },
  { name: "vision", command: "tsx agents/vision/server.ts" },
  { name: "transcribe", command: "tsx agents/transcribe/server.ts" },
  { name: "schedule", command: "tsx agents/schedule/server.ts" },
  { name: "split", command: "tsx agents/split/server.ts" },
  { name: "batch", command: "tsx agents/batch/server.ts" },
  { name: "bot", command: "tsx lib/telegram-bot.ts" },
];
const RESTART_DELAY_MS = 3000;
const HEALTH_CHECK_DELAY_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const DEFAULT_STARTUP_GRACE_MS = 45_000;
const CRITICAL_HEALTH_TARGETS = [
  {
    name: "frontend",
    url: "http://127.0.0.1:3005/api/health",
    port: 3005,
    startupGraceMs: 120_000,
    healthTimeoutMs: 15_000,
    allowPortLiveness: true,
    starter: () => startFrontend(),
  },
  {
    name: "hermes",
    url: "http://127.0.0.1:8000/health",
    port: 8000,
    startupGraceMs: 60_000,
    starter: () => startHermes(),
  },
  {
    name: "facilitator",
    url: "http://127.0.0.1:3010/health",
    port: 3010,
    starter: () => startBackendProcess({ name: "facilitator", command: "tsx facilitator/server.ts" }),
  },
  {
    name: "research",
    url: "http://127.0.0.1:3001/health",
    port: 3001,
    starter: () => startBackendProcess({ name: "research", command: "tsx agents/research/server.ts" }),
  },
  {
    name: "analyst",
    url: "http://127.0.0.1:3002/health",
    port: 3002,
    starter: () => startBackendProcess({ name: "analyst", command: "tsx agents/analyst/server.ts" }),
  },
  {
    name: "writer",
    url: "http://127.0.0.1:3003/health",
    port: 3003,
    starter: () => startBackendProcess({ name: "writer", command: "tsx agents/writer/server.ts" }),
  },
  {
    name: "api",
    url: "http://127.0.0.1:4000/health",
    port: 4000,
    startupGraceMs: 60_000,
    starter: () => startBackendProcess({ name: "api", command: "tsx server.ts" }),
  },
];
const criticalHealthTargetByName = new Map(
  CRITICAL_HEALTH_TARGETS.map((target) => [target.name, target]),
);
const managedChildren = new Map();
let shuttingDown = false;
const pendingRestarts = new Map();
const criticalHealthFailures = new Map();

async function probeHealth(url, timeoutMs = HEALTH_CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(value);
    };

    socket.setTimeout(1500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "127.0.0.1");
  });
}

async function isTargetResponsive(target) {
  const healthOk = await probeHealth(
    target.url,
    target.healthTimeoutMs ?? HEALTH_CHECK_TIMEOUT_MS,
  );
  if (healthOk) {
    return { ok: true, mode: "health" };
  }
  if (target.allowPortLiveness && target.port) {
    const portAlive = await isPortListening(target.port);
    if (portAlive) {
      return { ok: true, mode: "port" };
    }
  }
  return { ok: false, mode: "down" };
}

/**
 * Windows-safe process termination. `child.kill()` calls TerminateProcess on the
 * DIRECT child only — for our `cmd.exe -> tsx shim -> tsx loader` (and
 * `node -> npm -> next`) trees that orphans the real server holding the port, which
 * then survives every shutdown/restart and masquerades as "healthy" on its port.
 * `taskkill /T` walks the whole tree, so nothing is left behind.
 */
function killTree(child, signal = "SIGTERM") {
  if (!child || child.killed || typeof child.pid !== "number") return;
  if (process.platform === "win32") {
    const res = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      encoding: "utf8",
    });
    if (res.status === 0 || /not found|no running instance/i.test(`${res.stdout}${res.stderr}`)) {
      return;
    }
    // Fall through to child.kill() if taskkill could not run at all.
  }
  try {
    child.kill(signal);
  } catch {}
}

function registerManagedChild(name, child, restartFactory) {
  const target = criticalHealthTargetByName.get(name);
  managedChildren.set(name, {
    child,
    restartFactory,
    startedAt: Date.now(),
    startupGraceMs: target?.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS,
  });

  child.on("exit", (code, signal) => {
    const current = managedChildren.get(name);
    if (!current || current.child !== child) return;

    if (signal) {
      console.error(`[dev:stack] ${name} killed (${signal})`);
    } else if (code !== 0) {
      console.error(`[dev:stack] ${name} exited with code ${code}`);
    }

    managedChildren.delete(name);
    if (!shuttingDown) {
      const target = criticalHealthTargetByName.get(name);
      if (target) {
        isTargetResponsive(target)
          .then((status) => {
            if (status.ok) {
              const detail =
                status.mode === "port"
                  ? `port ${target.port} is still live`
                  : `${target.url} is still healthy`;
              console.log(`[dev:stack] ${name} wrapper exited, but ${detail}; skipping restart.`);
              return;
            }
            scheduleRestart(name, restartFactory);
          })
          .catch(() => scheduleRestart(name, restartFactory));
        return;
      }
      scheduleRestart(name, restartFactory);
    }
  });

  return child;
}

function scheduleRestart(name, restartFactory) {
  if (pendingRestarts.has(name)) return;
  console.warn(`[dev:stack] ${name} is down; restarting in ${Math.round(RESTART_DELAY_MS / 1000)}s...`);
  const timer = setTimeout(() => {
    pendingRestarts.delete(name);
    if (shuttingDown) return;
    const target = criticalHealthTargetByName.get(name);
    if (target) {
      isTargetResponsive(target)
        .then((status) => {
          if (status.ok) {
            const detail =
              status.mode === "port"
                ? `port ${target.port} is already live`
                : `${target.url} is already healthy`;
            console.log(`[dev:stack] ${name} ${detail}; skipping restart.`);
            return;
          }
          const child = restartFactory();
          registerManagedChild(name, child, restartFactory);
        })
        .catch(() => {
          const child = restartFactory();
          registerManagedChild(name, child, restartFactory);
        });
      return;
    }
    const child = restartFactory();
    registerManagedChild(name, child, restartFactory);
  }, RESTART_DELAY_MS);
  pendingRestarts.set(name, timer);
}

async function verifyCriticalServices() {
  for (const target of CRITICAL_HEALTH_TARGETS) {
    const status = await isTargetResponsive(target);
    if (status.ok) {
      criticalHealthFailures.delete(target.name);
      if (status.mode === "port") {
        console.warn(
          `[dev:stack] ${target.name} port ${target.port} is live but health is still warming up; skipping restart.`,
        );
      }
      continue;
    }
    const managed = managedChildren.get(target.name);
    const startupGraceMs = target.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
    if (managed && Date.now() - managed.startedAt < startupGraceMs) {
      const secondsRemaining = Math.ceil(
        (startupGraceMs - (Date.now() - managed.startedAt)) / 1000,
      );
      criticalHealthFailures.delete(target.name);
      console.warn(
        `[dev:stack] ${target.name} is still within startup grace (${secondsRemaining}s left); skipping restart check for ${target.url}.`,
      );
      continue;
    }
    if (managedChildren.has(target.name) || pendingRestarts.has(target.name)) {
      const failures = (criticalHealthFailures.get(target.name) ?? 0) + 1;
      criticalHealthFailures.set(target.name, failures);
      if (failures < 2 || pendingRestarts.has(target.name)) {
        console.warn(
          `[dev:stack] ${target.name} health check failed at ${target.url}; waiting for one more failed probe before restart.`,
        );
        continue;
      }
      console.warn(`[dev:stack] ${target.name} health check failed at ${target.url}; scheduling restart.`);
      const current = managedChildren.get(target.name);
      if (current?.child && !current.child.killed) {
        killTree(current.child, "SIGTERM");
      } else {
        scheduleRestart(target.name, target.starter);
      }
      continue;
    }
    console.warn(`[dev:stack] ${target.name} missing at ${target.url}; starting it now.`);
    const child = target.starter();
    registerManagedChild(target.name, child, target.starter);
  }
}

/**
 * Next.js is started outside concurrently. On Windows, the concurrently parent
 * often exits with code 4294967295 while children die — which took down the
 * frontend on :3005. A sibling process keeps the dev server alive when that happens.
 */
function startFrontend() {
  // Reuse the smart frontend launcher so stack starts do not serve stale builds.
  return spawn(process.execPath, ["scripts/start-frontend.cjs"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
}

function startHermes() {
  console.log("[dev:stack] starting Hermes sibling on :8000");
  return spawn(process.execPath, ["scripts/start-hermes.cjs"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
}

function startBackendProcess(spec) {
  const child = spawn("cmd.exe", ["/d", "/s", "/c", spec.command], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      EMBEDDED_AGENT_SERVERS: "false",
      PATH: [repoNodeBin, frontendNodeBin, process.env.PATH || ""].join(path.delimiter),
    },
    shell: false,
  });

  child.on("error", (err) => {
    console.error(`[dev:stack] failed to spawn ${spec.name}:`, err.message);
  });

  return child;
}

let feChild = null;
let hermesChild = null;
let backendChildren = [];

async function bootstrap() {
  if (!ensureSingleSupervisor()) {
    // Hard-exit: the module-level health-check timers below would otherwise keep
    // this rejected duplicate alive instead of letting it exit.
    process.exit(1);
  }
  if (shouldClean) {
    console.log("[dev:stack] cleaning stale AgentFlow listeners and processes...");
    cleanupExistingStack();
  } else {
    console.log("[dev:stack] fast start mode: skipping deep cleanup");
  }
  console.log("[dev:stack] starting full stack...");
  console.log(
    "[dev:stack] Frontend: http://localhost:3005 (quick health: http://localhost:3005/api/health)",
  );

  const frontendStatus = await isTargetResponsive(criticalHealthTargetByName.get("frontend"));
  if (frontendStatus.ok) {
    console.log(
      frontendStatus.mode === "port"
        ? "[dev:stack] frontend already owns :3005; letting health warm up without respawn."
        : "[dev:stack] frontend already healthy on :3005; reusing existing process.",
    );
  } else {
    const fe = startFrontend();
    fe.on("error", (err) => {
      console.error("[dev:stack] failed to spawn frontend:", err.message);
    });
    feChild = registerManagedChild("frontend", fe, () => startFrontend());
  }

  if ((await isTargetResponsive(criticalHealthTargetByName.get("hermes"))).ok) {
    console.log("[dev:stack] Hermes already healthy on :8000; reusing existing process.");
  } else {
    const hermes = startHermes();
    hermes.on("error", (err) => {
      console.error("[dev:stack] failed to spawn Hermes:", err.message);
    });
    hermesChild = registerManagedChild("hermes", hermes, () => startHermes());
  }

  backendChildren = backendCommands.map((spec) =>
    registerManagedChild(spec.name, startBackendProcess(spec), () => startBackendProcess(spec)),
  );
}

function shutdown(signal) {
  shuttingDown = true;
  for (const timer of pendingRestarts.values()) {
    clearTimeout(timer);
  }
  pendingRestarts.clear();
  if (feChild && !feChild.killed) {
    killTree(feChild, signal);
  }
  if (hermesChild && !hermesChild.killed) {
    killTree(hermesChild, signal);
  }
  for (const child of backendChildren) {
    if (child && !child.killed) {
      killTree(child, signal);
    }
  }
  clearSupervisorLock();
  // The health-check setInterval keeps the event loop alive; exit explicitly so
  // Ctrl+C actually stops the supervisor instead of leaving it hanging.
  setTimeout(() => process.exit(0), 500);
}

process.on("exit", clearSupervisorLock);
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
bootstrap().catch((err) => {
  console.error("[dev:stack] failed to bootstrap stack:", err.message);
  process.exitCode = 1;
});
setTimeout(() => {
  verifyCriticalServices().catch((err) => {
    console.error("[dev:stack] critical service verification failed:", err.message);
  });
}, HEALTH_CHECK_DELAY_MS);
setInterval(() => {
  if (shuttingDown) return;
  verifyCriticalServices().catch((err) => {
    console.error("[dev:stack] critical service verification failed:", err.message);
  });
}, HEALTH_CHECK_INTERVAL_MS);
