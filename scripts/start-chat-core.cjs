const path = require("path");
const { spawn, spawnSync } = require("child_process");
const dotenv = require("dotenv");

const repoRoot = path.resolve(__dirname, "..");
const repoNodeBin = path.join(repoRoot, "node_modules", ".bin");

dotenv.config({ path: path.join(repoRoot, ".env") });

const shouldClean =
  /^(1|true|yes|on)$/i.test(String(process.env.AGENTFLOW_STACK_CLEAN || "").trim()) ||
  process.argv.includes("--clean");

const corePorts = [4000, 8000, 3018];

function runPowerShell(command) {
  return spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function cleanupChatCore() {
  const portList = corePorts.join(",");
  const command = `
$targets = @()
$ports = @(${portList})
foreach ($port in $ports) {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $listeners) {
      if ($pid) { $targets += [int]$pid }
    }
  } catch {}
}
$targets = $targets | Sort-Object -Unique
foreach ($targetPid in $targets) {
  try {
    Stop-Process -Id $targetPid -Force -ErrorAction Stop
    Write-Output ("STOPPED:{0}" -f $targetPid)
  } catch {
    Write-Output ("FAILED:{0}:{1}" -f $targetPid, $_.Exception.Message)
  }
}
`;
  const result = runPowerShell(command);
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
}

function spawnCore(spec) {
  const child = spawn("cmd.exe", ["/d", "/s", "/c", spec.command], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      EMBEDDED_AGENT_SERVERS: "false",
      PATH: [repoNodeBin, process.env.PATH || ""].join(path.delimiter),
    },
    shell: false,
  });

  child.on("error", (err) => {
    console.error(`[chat-core] failed to spawn ${spec.name}:`, err.message);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`[chat-core] ${spec.name} killed (${signal})`);
    } else if (code !== 0) {
      console.error(`[chat-core] ${spec.name} exited with code ${code}`);
    }
  });

  return child;
}

if (shouldClean) {
  console.log("[chat-core] cleaning ports 4000, 8000, 3018...");
  cleanupChatCore();
} else {
  console.log("[chat-core] fast start mode: skipping cleanup");
}

console.log("[chat-core] starting Hermes (:8000), API (:4000), and schedule agent (:3018)...");

const children = [
  spawn(process.execPath, ["scripts/start-hermes.cjs"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    shell: false,
  }),
  spawnCore({ name: "schedule", command: "tsx agents/schedule/server.ts" }),
  spawnCore({ name: "api", command: "tsx server.ts" }),
];

function shutdown(signal) {
  for (const child of children) {
    if (child && !child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
