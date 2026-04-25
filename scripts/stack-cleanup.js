/**
 * Kill listeners on AgentFlow dev ports and matching repo Node processes (Windows PowerShell).
 * Used by `start-dev-stack.js` and `proof-a2a-demo.ts`.
 *
 * Run standalone: `node scripts/stack-cleanup.js`
 */
const path = require("path");
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
  "start-hermes\\.js",
  "gateway\\.run",
  "next(?:\\.exe)?\\s+(?:dev|start)",
];

function runPowerShell(command) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
}

function cleanupExistingStack() {
  const portKill = `
foreach ($port in @(${STACK_PORTS.join(",")})) {
  try {
    $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($listenerPid in $pids) {
      if ($listenerPid) { Stop-Process -Id ([int]$listenerPid) -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
}
Start-Sleep -Milliseconds 500
`;
  runPowerShell(portKill);

  const escapedRepoRoot = repoRoot.replace(/'/g, "''");
  const portList = STACK_PORTS.join(",");
  const patternFilter = STACK_PROCESS_PATTERNS.map(
    (pattern) => `($_.CommandLine -match '${pattern}')`,
  ).join(" -or ");

  const command = `
$targets = @()
$repoRoot = '${escapedRepoRoot}'
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

$repoProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne ${process.pid} -and
  $_.CommandLine -and
  $_.CommandLine -match [regex]::Escape($repoRoot) -and
  (${patternFilter})
}

$launcherProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne ${process.pid} -and
  $_.CommandLine -and
  (
    $_.CommandLine -match 'scripts[\\\\/]start-dev-stack\\.js' -or
    $_.CommandLine -match 'scripts[\\\\/]start-hermes\\.js'
  )
}

foreach ($proc in $repoProcesses) {
  $targets += [int]$proc.ProcessId
}

foreach ($proc in $launcherProcesses) {
  $targets += [int]$proc.ProcessId
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

module.exports = { cleanupExistingStack, STACK_PORTS };

if (require.main === module) {
  console.log("[stack-cleanup] stopping stale AgentFlow listeners / stack processes...");
  cleanupExistingStack();
  console.log("[stack-cleanup] done.");
}
