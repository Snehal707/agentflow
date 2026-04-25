const path = require("path");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const dotenv = require("dotenv");

const repoRoot = path.resolve(__dirname, "..");
const hermesHome = path.join(repoRoot, "hermes-brain");
const hermesPython = path.join(hermesHome, ".venv", "Scripts", "python.exe");
const launcherLockPath = path.join(hermesHome, "gateway_launcher.lock.json");
const MAX_RESTARTS_PER_MINUTE = 5;

dotenv.config({ path: path.join(repoRoot, ".env") });

function runPowerShell(command) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    { encoding: "utf8" },
  );
}

function cleanupExistingHermes() {
  const command = `
$targets = @()
$gateway = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^python(\\.exe)?$' -and $_.CommandLine -match 'gateway\\.run'
}
foreach ($proc in $gateway) {
  $targets += $proc.ProcessId
}
$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($listener) {
  $targets += $listener
}
$targets = $targets | Sort-Object -Unique
foreach ($targetPid in $targets) {
  try {
    Stop-Process -Id $targetPid -Force -ErrorAction Stop
    Write-Output "STOPPED:$targetPid"
  } catch {
    Write-Output ("FAILED:{0}:{1}" -f $targetPid, $_.Exception.Message)
  }
}
`;

  const result = runPowerShell(command);
  if (result.stdout?.trim()) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr?.trim()) {
    process.stderr.write(result.stderr);
  }
}

function findOtherLauncherPids() {
  const command = `
$launchers = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^node(\\.exe)?$' -and
  $_.CommandLine -match 'start-hermes\\.js' -and
  $_.ProcessId -ne ${process.pid}
}
$launchers | Select-Object -ExpandProperty ProcessId
`;

  const result = runPowerShell(command);
  if (!result.stdout?.trim()) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

// Hermes api_server: binding 0.0.0.0 requires API_SERVER_KEY; use loopback for local dev otherwise.
const apiServerHost =
  process.env.API_SERVER_HOST ||
  (process.env.API_SERVER_KEY ? "0.0.0.0" : "127.0.0.1");

const hermesEnv = {
  ...process.env,
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  FIRECRAWL_API_URL: process.env.FIRECRAWL_API_URL,
  HERMES_API_KEY: process.env.HERMES_API_KEY,
  HERMES_BASE_URL: process.env.HERMES_BASE_URL,
  HERMES_HOME: hermesHome,
  API_SERVER_ENABLED: "true",
  API_SERVER_HOST: apiServerHost,
  API_SERVER_PORT: "8000",
  PYTHONUTF8: "1",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_ALLOWED_USERS: "",
  TELEGRAM_ALLOW_ALL_USERS: "",
  TELEGRAM_HOME_CHANNEL: "",
  TELEGRAM_REPLY_TO_MODE: "",
  TELEGRAM_FALLBACK_IPS: "",
};

const pythonCommand = fs.existsSync(hermesPython) ? hermesPython : "python";
let currentHermes = null;
let shuttingDown = false;
let restartTimestamps = [];
let currentHermesStartedAt = 0;

function isPidAlive(pid) {
  if (!pid || Number.isNaN(Number(pid))) {
    return false;
  }

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function readLauncherLock() {
  try {
    if (!fs.existsSync(launcherLockPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(launcherLockPath, "utf8"));
  } catch (error) {
    console.warn("[hermes] could not read launcher lock:", error.message);
    return null;
  }
}

function writeLauncherLock() {
  try {
    fs.writeFileSync(
      launcherLockPath,
      JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
  } catch (error) {
    console.warn("[hermes] could not write launcher lock:", error.message);
  }
}

function clearLauncherLock() {
  try {
    const lock = readLauncherLock();
    if (!lock || lock.pid === process.pid) {
      fs.rmSync(launcherLockPath, { force: true });
    }
  } catch (error) {
    console.warn("[hermes] could not clear launcher lock:", error.message);
  }
}

function ensureSingleLauncher() {
  const existingLock = readLauncherLock();
  if (existingLock?.pid && existingLock.pid !== process.pid && isPidAlive(existingLock.pid)) {
    console.log(`[hermes] launcher already running (pid ${existingLock.pid}), exiting duplicate launcher.`);
    return false;
  }

  const otherLaunchers = findOtherLauncherPids();
  if (otherLaunchers.length > 0) {
    console.log(`[hermes] launcher already running (pid ${otherLaunchers[0]}), exiting duplicate launcher.`);
    return false;
  }

  writeLauncherLock();
  return true;
}

function removeStaleState() {
  for (const staleFile of ["gateway.pid", "gateway_state.json"]) {
    const stalePath = path.join(hermesHome, staleFile);
    try {
      if (fs.existsSync(stalePath)) {
        fs.unlinkSync(stalePath);
      }
    } catch (error) {
      console.warn(`[dev:hermes] could not remove stale ${staleFile}:`, error.message);
    }
  }
}

function scheduleRestart(reason) {
  if (shuttingDown) {
    return;
  }

  const now = Date.now();
  restartTimestamps = restartTimestamps.filter((timestamp) => now - timestamp < 60_000);
  restartTimestamps.push(now);

  if (restartTimestamps.length > MAX_RESTARTS_PER_MINUTE) {
    console.error("[hermes] too many restarts in 60s, stopping to avoid a restart loop.");
    clearLauncherLock();
    process.exit(1);
  }

  console.warn(`[hermes] ${reason}, restarting in 3s...`);
  setTimeout(() => {
    if (!shuttingDown) {
      startHermes();
    }
  }, 3000);
}

function startHermes() {
  if (!ensureSingleLauncher()) {
    process.exit(0);
    return null;
  }

  console.log("[hermes] starting...");
  cleanupExistingHermes();
  removeStaleState();
  currentHermesStartedAt = Date.now();

  const proc = spawn(pythonCommand, ["-m", "gateway.run"], {
    cwd: hermesHome,
    env: hermesEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  currentHermes = proc;
  let restartScheduled = false;

  proc.stdout.on("data", (data) => {
    console.log("[hermes]", data.toString());
  });

  proc.stderr.on("data", (data) => {
    console.error("[hermes-err]", data.toString());
  });

  proc.on("exit", (code, signal) => {
    const uptimeSeconds = ((Date.now() - currentHermesStartedAt) / 1000).toFixed(1);

    if (signal && !shuttingDown) {
      if (!restartScheduled) {
        restartScheduled = true;
        scheduleRestart(`exited from signal ${signal} after ${uptimeSeconds}s`);
      }
      return;
    }

    if (shuttingDown) {
      process.exit(code ?? 0);
      return;
    }

    if (!restartScheduled) {
      restartScheduled = true;
      scheduleRestart(`exited with code ${code ?? 0} after ${uptimeSeconds}s`);
    }
  });

  proc.on("error", (error) => {
    console.error("[hermes] error:", error);
    if (!restartScheduled) {
      restartScheduled = true;
      scheduleRestart("failed to start");
    }
  });

  return proc;
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (currentHermes && !currentHermes.killed) {
    currentHermes.kill(signal);
    return;
  }
  process.exit(0);
}

process.on("exit", clearLauncherLock);
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startHermes();
