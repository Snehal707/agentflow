# Builds a single-folder monorepo for "Agentic Economy on Arc" hackathon submission
# (backend at repo root + agentflow-frontend/ in-tree, not a nested git).
# Re-run this after code changes, then: cd ..\agentic-economy-arc; git add -A; git commit; git push

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Out = Join-Path $Root "agentic-economy-arc"

if (Test-Path $Out) {
  Remove-Item -Recurse -Force $Out
}
New-Item -ItemType Directory -Path $Out -Force | Out-Null

# Any directory with one of these names is skipped (any depth)
$ExcludeDirs = @(
  "node_modules", ".git", ".next", ".next-dev", "out", "build", "dist", ".turbo", ".vercel", "coverage",
  "agentic-economy-arc", ".agentflow-memory", ".codex-logs", "test-results", "tmp", "output",
  ".claude", ".vs", "stitch_extracted", "stitch_extracted2", ".husky", ".github",
  ".agent", ".cursor"
)
$xd = @()
foreach ($d in $ExcludeDirs) { $xd += @("/XD", $d) }

# Skip heavy / local DB noise; keep Hermes code and config
$xf = @(
  "/XF", ".env", "state.db", "state.db-wal", "state.db-shm", "frontend-live.log", "frontend-runtime.log",
  "wallets.json"
)

# /COPY:DT = data + times only (avoids Windows attribute errors on some junctions)
& robocopy $Root $Out *.* /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NC /NS /COPY:DT /DCOPY:DA $xd $xf
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed: exit $rc" }

# Monorepo .gitignore: do not ignore the in-repo frontend
$g = Join-Path $Out ".gitignore"
if (Test-Path $g) {
  (Get-Content -Raw $g) -replace "(?m)^agentflow-frontend\r?\n", "" | Set-Content -NoNewline $g
}

# Template without Unicode dashes (avoids mojibake on Windows)
$readmeSubmit = @'
# Agentic Economy on Arc - Hackathon submission (single repo)

This is the **all-in-one** monorepo for the hackathon form: **backend at the root** and **`agentflow-frontend/`** as the Next.js app in the same tree.

- Ongoing work may still use: [agentflow-backend](https://github.com/Snehal707/agentflow-backend) and [agentflow-frontend](https://github.com/Snehal707/agentflow-frontend).
- **This repository** = one URL for the submission form.

## Run locally

1. From this repo root: copy `.env.example` to `.env` and set secrets.
2. `npm install` (root)
3. `npm install` inside `agentflow-frontend/`
4. `npm run dev:stack` from the root (API, agents, Hermes, frontend; UI on port 3005).

## Publish (first time)

Create a new empty GitHub repository, then: `git remote add origin <url>` and `git push -u origin main`.

**Note:** Rebuilding with `scripts/build-hackathon-monorepo.ps1` **deletes** this folder; commit and push first.
'@
$hackPath = Join-Path $Out "HACKATHON-SUBMIT.md"
[System.IO.File]::WriteAllText($hackPath, $readmeSubmit, [System.Text.UTF8Encoding]::new($false))

Write-Host "Wrote: $Out"
Write-Host "Next: cd $Out; git init; git add -A; git commit -m \"...\"; git remote add origin <URL>; git push -u origin main"
