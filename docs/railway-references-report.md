# Railway references report

Read-only inventory of Railway-specific files, environment variables, and string references in this repository. Use it when planning **VPS** (or other non-Railway) deployment.

## 1. `railway.toml` and `railway.json`

| File | Role |
|------|------|
| [../railway.toml](../railway.toml) | **agentflow-api**: Nixpacks, `startCommand = "npm run start:api"`, `restartPolicyType = "ON_FAILURE"`. Comment references Railway `$PORT`. |
| [../railway.json](../railway.json) | Nixpacks, `startCommand` (aligned with TOML for the API), `healthcheckPath: "/health"`, `restartPolicyType: "always"`. |
| [../railway-agents.toml](../railway-agents.toml) | **agentflow-agents**: Nixpacks, `startCommand = "npm run dev:agents"`, `ON_FAILURE`. |
| [railway-deploy.md](railway-deploy.md) | Two-service layout, env examples with `*.railway.internal` hostnames, copy-paste snippets. |

**Note:** [../railway.json](../railway.json) uses the same `start:api` command as [../railway.toml](../railway.toml). Railway’s precedence (TOML vs JSON) depends on the dashboard; if both are present, confirm which file the project uses.

## 2. `Procfile`

- **Not found** — no `Procfile` in the repository.

## 3. `RAILWAY_` environment variables (code / runtime)

| Location | Usage |
|----------|--------|
| [../db/client.ts](../db/client.ts) (lines 47–65) | `runningOnRailway` is true if any of: `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_PRIVATE_DOMAIN`. Used to pick **Redis URL** priority in production (`REDIS_URL` vs `REDIS_PUBLIC_URL` order and error messages). |

- **[../.env.example](../.env.example):** no `RAILWAY_*` variable definitions (optional on Railway; not required for local dev).

## 4. `package.json` (Railway-specific)

- **Root and `agentflow-frontend/package.json`:** no literal string `railway` in `package.json`. Scripts are generic: `start`, `start:api`, `dev:agents`, etc.

## 5. Hardcoded `railway.app` URLs

- **`lib/`, `api/`, `agents/` `*.ts`:** no matches for `railway.app`.
- **Elsewhere (docs / examples only):** [../DEPLOY.md](../DEPLOY.md) (e.g. `https://your-backend.up.railway.app/health`), [../PHASE_D_VERCEL.md](../PHASE_D_VERCEL.md) (`*.railway.app` for `NEXT_PUBLIC_BACKEND_URL`), [railway-deploy.md](railway-deploy.md).
- **Comments:** [../server.ts](../server.ts) — `/** Split deploy (e.g. Railway): ...` (no URL).

## 6. Other references

- [../README.md](../README.md) — Vercel + Railway / Nixpacks, `CLOUDSMITH_TOKEN` at build.
- [../DEPLOY.md](../DEPLOY.md) — Railway section, Nixpacks/Docker.
- [../scripts/bootstrap.ts](../scripts/bootstrap.ts) — log text: "Railway / .env".
- [../agentflow-v3-cursor-prompt.md](../agentflow-v3-cursor-prompt.md) — Railway env instructions (scattered).
- [../.cursor/rules/agentflow-v3.mdc](../.cursor/rules/agentflow-v3.mdc) — Railway env vars, two-Railway-services notes.

## 7. VPS-relevant takeaways

- **Platform config files to replace or ignore on a VPS:** `railway.toml`, `railway.json`, `railway-agents.toml` (use a process manager, Docker, or `systemd` + the same `npm` commands instead of Railway “config-as-code”).
- **Environment:** On Railway, `RAILWAY_*` and `PORT` are set automatically. On a VPS you usually set `PORT` yourself and **do not** set `RAILWAY_*` — [db/client.ts](../db/client.ts) then uses the **non-Railway** branch for Redis URL resolution. If you need different Redis ordering on VPS, adjust env (e.g. set `REDIS_URL` / `REDIS_PUBLIC_URL` explicitly) or extend that helper without faking `RAILWAY_*`.
- **Docs** use Railway URLs in examples only; there is no runtime hardcoding of `*.railway.app` in `lib/`, `api/`, or `agents/` TypeScript.
