<#
.SYNOPSIS
  Gateway / DCW diagnosis helpers (plan: gateway_dcw_log_diagnosis).

.DESCRIPTION
  NPM entry points (no logic here; they only invoke this file):
  - npm run diagnose:gateway-dcw
  - npm run diagnose:gateway-dcw:trigger   (same, plus optional POST /run when API is up)

  Capture API + agent logs while reproducing (Terminal 1), then run one of the npm commands above (Terminal 2).
  Default log path is $env:TEMP\agentflow.log (override with -LogPath).

  Logging / buffering (PowerShell, long-lived dev:stack):
  Tee-Object on a multi-process pipeline can buffer and look empty until the pipeline exits. Prefer one of:
  - Redirect:  npm run dev:stack > $env:TEMP\agentflow.log 2>&1
    then tail in another window:  Get-Content $env:TEMP\agentflow.log -Wait
  - Start-Transcript -Path $env:TEMP\agentflow.log  (before stack), Stop-Transcript after repro
  - Out-File -Append -Encoding utf8 inside a background job if you need async capture without Tee-Object

  Primary diagnosis signal: the line containing [x402] attempting payment: (payer address).
  Compare payer to the DCW address shown in AgentFlow Funding for the same EOA.
  payer != Funding DCW => wallet-swap path (lib/dcw.ts getOrCreateUserAgentWallet). Same address but 0 balance => Gateway env/domain or real liquidity gap.

  This script:
  - Writes masked GATEWAY_* / ARC_* / CHAIN_* lines from repo .env (if present).
  - Greps an existing capture file for gateway, x402, pipeline, research patterns.
  - Optional: POST /run "research on btc" using TEST_WALLET_ADDRESS from .env (not the browser session).

.PARAMETER LogPath
  Tee output path (default: $env:TEMP\agentflow.log per plan).

.PARAMETER ReportPath
  Where to write the diagnosis report (default: tmp/diagnosis-gateway-dcw-report.txt).

.PARAMETER TriggerResearchRun
  If API is up on 127.0.0.1:4000, POST SSE /run once (uses TEST_WALLET_ADDRESS from .env). Logs appear on the API process stdout (only in tee if you started stack with Tee-Object).

.PARAMETER ApiBase
  Base URL for TriggerResearchRun (default http://127.0.0.1:4000).
#>
param(
  [string]$LogPath = "$env:TEMP\agentflow.log",
  [string]$ReportPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "tmp\diagnosis-gateway-dcw-report.txt"),
  [switch]$TriggerResearchRun,
  [string]$ApiBase = "http://127.0.0.1:4000"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $repoRoot ".env"
$pattern = '\[gateway\]|\[research\]|\[research-consumer\]|\[chat-consumer\]|\[pipeline\]|\[x402\]|payProtectedResourceServer|getOrCreateUserAgentWallet|findBestRemoteUserAgentWallet|adoptRecoveredUserAgentWallet|Writer agent error|Analyst agent error|Final report validation|\[Research pipeline\]'

function Mask-Value([string]$key, [string]$val) {
  if ([string]::IsNullOrWhiteSpace($val)) { return "(empty)" }
  $v = $val.Trim()
  if ($key -match 'KEY|SECRET|TOKEN|PASSWORD|PRIVATE') {
    return "(set, len=$($v.Length), redacted)"
  }
  if ($key -match 'ADDRESS|WALLET' -and $v -match '^0x[a-fA-F0-9]{40}$') {
    return $v.Substring(0, 6) + '...' + $v.Substring($v.Length - 4)
  }
  if ($v.Length -le 24) { return $v }
  return $v.Substring(0, 12) + '...' + $v.Substring($v.Length - 6)
}

function Read-DotEnvKeys([string]$path, [string[]]$keys) {
  $out = @{}
  if (-not (Test-Path $path)) { return $out }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^\s*#' -or -not $line) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim()
    if ($keys -contains $k) { $out[$k] = $v }
  }
  return $out
}

$wantKeys = @(
  "GATEWAY_DOMAIN",
  "GATEWAY_API_BASE_URL",
  "ARC_RPC",
  "ARC_CHAIN_ID",
  "CHAIN_ID",
  "TEST_WALLET_ADDRESS",
  "FACILITATOR_URL",
  "FACILITATOR_PORT"
)

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("=== AgentFlow Gateway / DCW diagnosis $(Get-Date -Format o) ===")
$lines.Add("")
$lines.Add("--- Masked env (from .env; defaults apply when unset) ---")
$lines.Add("lib/gateway-balance.ts defaults: GATEWAY_API_BASE_URL=https://gateway-api-testnet.circle.com/v1 ; GATEWAY_DOMAIN=26")
$lines.Add("")

if (Test-Path $envFile) {
  $kv = Read-DotEnvKeys $envFile $wantKeys
  foreach ($k in $wantKeys) {
    if ($kv.ContainsKey($k)) {
      $lines.Add("$k=$(Mask-Value $k $kv[$k])")
    } else {
      $lines.Add("$k=(unset)")
    }
  }
} else {
  $lines.Add("(no .env at repo root)")
}

$lines.Add("")
$lines.Add("--- Tee log grep: $LogPath ---")
if (Test-Path $LogPath) {
  $hits = Select-String -Path $LogPath -Pattern $pattern -AllMatches
  if ($hits) {
    $hits | ForEach-Object { $lines.Add($_.Line) }
  } else {
    $lines.Add('(no lines matched; widen search or reproduce with: npm run dev:stack 2>&1 | Tee-Object -FilePath $env:TEMP\agentflow.log)')
  }
} else {
  $lines.Add('(log file missing - start stack with tee first, then repro in browser as 0x9C...fc7a)')
}

$lines.Add('')
$lines.Add('--- Compare (manual) ---')
$lines.Add('1) Open Funding/Wallet UI for the failing EOA; note DCW address + Gateway balance.')
$lines.Add('2) Find [x402] attempting payment: in log; compare payer field to UI DCW.')
$lines.Add('   payer != UI DCW  => Bug 1 (DCW swap / remote score path in lib/dcw.ts getOrCreateUserAgentWallet).')
$lines.Add('   payer == UI DCW but balance 0 => Bug 2 (GATEWAY_DOMAIN / GATEWAY_API_BASE_URL / chain) or empty Gateway.')
$lines.Add('')
$lines.Add('Note: adoptRecoveredUserAgentWallet has no success log today; mismatch detection relies on x402 payer vs UI.')

$dir = Split-Path $ReportPath -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$lines -join "`n" | Set-Content -Path $ReportPath -Encoding UTF8
Write-Host "Wrote report: $ReportPath"

if ($TriggerResearchRun) {
  $kv2 = Read-DotEnvKeys $envFile @("TEST_WALLET_ADDRESS")
  $addr = $kv2["TEST_WALLET_ADDRESS"]
  if (-not $addr) {
    Write-Warning "TEST_WALLET_ADDRESS not set in .env; skip POST /run."
    exit 0
  }
  $health = try { Invoke-WebRequest -Uri "$ApiBase/health" -UseBasicParsing -TimeoutSec 5 } catch { $null }
  if (-not $health -or $health.StatusCode -ne 200) {
    Write-Warning "API not reachable at $ApiBase/health; skip POST /run."
    exit 0
  }
  $bodyObj = @{ task = "research on btc"; userAddress = $addr.Trim() }
  $bodyJson = $bodyObj | ConvertTo-Json -Compress
  $tmpBody = Join-Path $env:TEMP "agentflow-diagnose-run-body.json"
  Set-Content -Path $tmpBody -Value $bodyJson -Encoding UTF8
  Write-Host "Triggering POST ${ApiBase}/run SSE max 300s with userAddress from TEST_WALLET_ADDRESS..."
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) {
    Write-Warning "curl.exe not found; install or trigger /run manually."
    exit 0
  }
  & curl.exe -sS -N --max-time 300 -X POST "$ApiBase/run" -H "Content-Type: application/json" --data-binary "@$tmpBody" | Out-Null
  Write-Host "POST /run finished (stream consumed). Re-run this script without -TriggerResearchRun to grep an updated tee log."
}
