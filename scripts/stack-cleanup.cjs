/**
 * Kill listeners on AgentFlow dev ports and matching repo Node processes (Windows PowerShell).
 * Used by `start-dev-stack.cjs` and `proof-a2a-demo.ts`.
 *
 * Run standalone: `node scripts/stack-cleanup.cjs`
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

const STACK_PORTS = [
  3000,
  3010,
  3001,
  3002,
  3003,
  3011,
  3012,
  3013,
  3021,
  3014,
  3015,
  3016,
  3017,
  3018,
  3019,
  3020,
  3005,
  4000,
  8000,
];

const STACK_PROCESS_PATTERNS = [
  "facilitator[\\\\/]server\\.ts",
  "agents[\\\\/]research[\\\\/]server\\.ts",
  "agents[\\\\/]analyst[\\\\/]server\\.ts",
  "agents[\\\\/]writer[\\\\/]server\\.ts",
  "agents[\\\\/]swap[\\\\/]server\\.ts",
  "agents[\\\\/]vault[\\\\/]server\\.ts",
  "agents[\\\\/]predmarket[\\\\/]server\\.ts",
  "agents[\\\\/]bridge[\\\\/]server\\.ts",
  "agents[\\\\/]portfolio[\\\\/]server\\.ts",
  "agents[\\\\/]invoice[\\\\/]server\\.ts",
  "agents[\\\\/]vision[\\\\/]server\\.ts",
  "agents[\\\\/]transcribe[\\\\/]server\\.ts",
  "agents[\\\\/]schedule[\\\\/]server\\.ts",
  "agents[\\\\/]split[\\\\/]server\\.ts",
  "agents[\\\\/]batch[\\\\/]server\\.ts",
  "lib[\\\\/]telegram-bot\\.ts",
  "server\\.ts",
  "start-hermes\\.(?:js|cjs)",
  "gateway\\.run",
  "next(?:\\.exe)?\\s+(?:dev|start)",
];

function runPowerShell(command) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    },
  );
}

function runTaskKill(pid) {
  return spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
}

/**
 * Fast, always-run first pass: free the stack ports via Get-NetTCPConnection (cheap)
 * and tree-kill their owners. This is what actually unblocks a restart. It is kept
 * SEPARATE from the slow Win32_Process command-line scan below so that, if that scan
 * times out under load, the ports have already been freed instead of being left bound.
 */
function freeStackPorts() {
  const portList = STACK_PORTS.join(",");
  const command = `
$pids = @()
foreach ($port in @(${portList})) {
  try {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { if ($_) { $pids += [int]$_ } }
  } catch {}
}
$pids | Sort-Object -Unique | ForEach-Object { Write-Output ("PORTPID:{0}" -f $_) }
`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { cwd: repoRoot, encoding: "utf8", timeout: 8000, windowsHide: true },
  );

  const pids = (result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^PORTPID:\d+$/.test(line))
    .map((line) => Number(line.slice("PORTPID:".length)))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

  for (const pid of pids) {
    runTaskKill(pid);
    process.stdout.write(`STOPPED:${pid} (port owner)\n`);
  }
}

function cleanupExistingStack() {
  // Phase 1: cheap port liberation (always completes, ~<1s).
  freeStackPorts();

  // Phase 2: best-effort command-line scan to catch orphans not bound to a port.
  const escapedRepoRoot = repoRoot.replace(/'/g, "''");
  const portList = STACK_PORTS.join(",");
  const patternFilter = STACK_PROCESS_PATTERNS.map(
    (pattern) => `($_.CommandLine -match '${pattern}')`,
  ).join(" -or ");

  const command = `
$targets = @()
$repoRoot = '${escapedRepoRoot}'
$ports = @(${portList})
$allProcesses = Get-CimInstance Win32_Process
$exclude = New-Object 'System.Collections.Generic.HashSet[int]'

function Add-ProcessTreeToExclude([int]$processId) {
  while ($processId -gt 0 -and $exclude.Add($processId)) {
    $proc = $allProcesses | Where-Object { $_.ProcessId -eq $processId } | Select-Object -First 1
    if (-not $proc) { break }
    $processId = [int]$proc.ParentProcessId
  }
}

Add-ProcessTreeToExclude ${process.pid}
Add-ProcessTreeToExclude $PID

foreach ($port in $ports) {
  try {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $listeners) {
      if ($pid) { $targets += [int]$pid }
    }
  } catch {}
}

$repoProcesses = $allProcesses | Where-Object {
  -not $exclude.Contains([int]$_.ProcessId) -and
  $_.CommandLine -and
  $_.CommandLine -match [regex]::Escape($repoRoot) -and
  (${patternFilter})
}

$launcherProcesses = $allProcesses | Where-Object {
  -not $exclude.Contains([int]$_.ProcessId) -and
  $_.CommandLine -and
  (
    $_.CommandLine -match 'scripts[\\\\/]start-dev-stack\\.(?:js|cjs)' -or
    $_.CommandLine -match 'scripts[\\\\/]start-hermes\\.(?:js|cjs)'
  )
}

foreach ($proc in $repoProcesses) {
  $targets += [int]$proc.ProcessId
}

foreach ($proc in $launcherProcesses) {
  $targets += [int]$proc.ProcessId
}

$targets = $targets | Sort-Object -Unique
$targets | ForEach-Object { Write-Output ("TARGET:{0}" -f $_) }
`;

  const result = runPowerShell(command);
  if (result.error?.code === "ETIMEDOUT") {
    process.stdout.write("WARN:cleanup scan timed out after 20s; continuing without process-pattern cleanup\n");
  } else if (result.error) {
    process.stdout.write(`WARN:cleanup scan failed: ${result.error.message}\n`);
  }

  const targetPids = (result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^TARGET:\d+$/.test(line))
    .map((line) => Number(line.slice("TARGET:".length)))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .sort((a, b) => b - a);

  for (const pid of targetPids) {
    const kill = runTaskKill(pid);
    const combined = `${kill.stdout || ""}${kill.stderr || ""}`.trim();
    if (kill.status === 0) {
      process.stdout.write(`STOPPED:${pid}\n`);
    } else if (combined && !/not found|no running instance|not recognized/i.test(combined)) {
      process.stdout.write(`FAILED:${pid}:${combined}\n`);
    } else {
      process.stdout.write(`FAILED:${pid}:not found\n`);
    }
  }

  if (result.stderr?.trim()) {
    process.stderr.write(result.stderr);
  }

  const hermesLock = path.join(repoRoot, "hermes-brain", "gateway_launcher.lock.json");
  try {
    fs.unlinkSync(hermesLock);
  } catch {
    /* ignore */
  }
}

module.exports = { cleanupExistingStack, STACK_PORTS };

if (require.main === module) {
  console.log("[stack-cleanup] stopping stale AgentFlow listeners / stack processes...");
  cleanupExistingStack();
  console.log("[stack-cleanup] done.");
}
