# Railway deployment (AgentFlow)

> See [railway-references-report.md](railway-references-report.md) for a full inventory of Railway files, `RAILWAY_*` usage, and VPS notes.

> **Apply code changes in Agent mode** — if edits to `server.ts`, `package.json`, and `railway.toml` are not yet in the repo, copy the snippets below.

## Two services

| Service | Config file | Start command |
|---------|-------------|----------------|
| **agentflow-api** | `railway.toml` | `npm run start:api` |
| **agentflow-agents** | `railway-agents.toml` | `npm run dev:agents` |

In Railway: create **two** services from the same GitHub repo.

- **agentflow-api**: default `railway.toml` is picked up automatically.
- **agentflow-agents**: **Settings → Config-as-code → Config file path** = `railway-agents.toml` (or paste equivalent **Start Command** / **Build** manually).

Enable **Private Networking** on both services so the API can call agent URLs on the internal hostname.

---

## 1. `railway.toml` (repo root — agentflow-api)

```toml
# agentflow-api — public API (uses Railway $PORT)
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm run start:api"
restartPolicyType = "ON_FAILURE"
```

---

## 2. `railway-agents.toml` (repo root — agentflow-agents)

```toml
# agentflow-agents — facilitator + V2 + V3 agents (one container, many ports)
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm run dev:agents"
restartPolicyType = "ON_FAILURE"
```

---

## 3. `package.json` scripts to add

Inside `"scripts"`:

```json
"start:api": "cross-env NODE_ENV=production EMBEDDED_AGENT_SERVERS=false tsx server.ts",
"dev:agents": "cross-env NODE_ENV=production concurrently -n f,r,a,w,sw,v,br,po -c blue,green,yellow,magenta,red,white,gray,black \"tsx facilitator/server.ts\" \"tsx agents/research/server.ts\" \"tsx agents/analyst/server.ts\" \"tsx agents/writer/server.ts\" \"tsx agents/swap/server.ts\" \"tsx agents/vault/server.ts\" \"tsx agents/bridge/server.ts\" \"tsx agents/portfolio/server.ts\""
```

Requires `cross-env` and `concurrently` (already devDependencies; `nixpacks.toml` uses `npm ci --include=dev` so they are installed).

---

## 4. `server.ts` — split-deploy URLs (production)

Replace hardcoded localhost URLs with env-aware defaults:

```typescript
/** Split deploy (e.g. Railway): set full URLs; defaults are local dev only. */
const FACILITATOR_URL =
  process.env.FACILITATOR_URL?.trim() || `http://127.0.0.1:${FACILITATOR_PORT}`;
const RESEARCH_URL =
  process.env.RESEARCH_AGENT_URL?.trim() ||
  `http://127.0.0.1:${RESEARCH_PORT}/run`;
const ANALYST_URL =
  process.env.ANALYST_AGENT_URL?.trim() ||
  `http://127.0.0.1:${ANALYST_PORT}/run`;
const WRITER_URL =
  process.env.WRITER_AGENT_URL?.trim() ||
  `http://127.0.0.1:${WRITER_PORT}/run`;
```

---

## 5. `nixpacks.toml`

No change required for new dependencies if you keep `npm ci --include=dev` (needed for `tsx`, `concurrently`, `cross-env`). Node 20 is already set.

---

## 6. Railway environment variables (dashboard)

### Both services
- `NODE_ENV=production`

### API service (agentflow-api) — add at minimum

| Variable | Notes |
|----------|--------|
| `SUPABASE_URL` | |
| `SUPABASE_SECRET_KEY` | |
| `SUPABASE_PUBLISHABLE_KEY` | |
| `REDIS_URL` | Production: `db/client.ts` uses `REDIS_URL` when `NODE_ENV=production` |
| `JWT_SECRET` | |
| `ALCHEMY_API_KEY` | |
| `ALCHEMY_ARC_RPC` | |
| `ALCHEMY_ARC_WSS` | |
| `FIRECRAWL_API_URL` | |
| `FIRECRAWL_API_KEY` | |
| `RESEND_API_KEY` | |
| `TELEGRAM_BOT_TOKEN` | |
| `AGENTFLOW_REGISTRY_ADDRESS` | |
| `SWAP_CONTRACT_ADDRESS` | |
| `VAULT_CONTRACT_ADDRESS` | |
| `WALLET_SET_ID` | |
| `TREASURY_WALLET_ADDRESS` | |
| `HERMES_MODEL_FAST` | |
| `HERMES_MODEL_DEEP` | |
| `HERMES_BASE_URL` | |
| `HERMES_API_KEY` | Required for `lib/hermes.ts` (not optional if agents use Hermes) |

**Split deploy — point API at agents service (replace `YOUR_AGENTS` with the agents service name, e.g. from private networking docs):**

| Variable | Example value |
|----------|----------------|
| `EMBEDDED_AGENT_SERVERS` | `false` (already implied by `start:api`; set explicitly if you use `npm start`) |
| `FACILITATOR_URL` | `http://YOUR_AGENTS.railway.internal:3000` |
| `RESEARCH_AGENT_URL` | `http://YOUR_AGENTS.railway.internal:3001/run` |
| `ANALYST_AGENT_URL` | `http://YOUR_AGENTS.railway.internal:3002/run` |
| `WRITER_AGENT_URL` | `http://YOUR_AGENTS.railway.internal:3003/run` |

Also set `PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY` / `SELLER_ADDRESS`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, etc., as your features require.

### Agents service (agentflow-agents)

Same secrets as needed for Hermes, Circle DCW, chain RPCs, and contract addresses for swap/vault/bridge/portfolio. **Facilitator URL** inside the same container defaults to `http://localhost:3000`; agents in `dev:agents` do not need `FACILITATOR_URL` unless you change ports.

---

## 7. Hardcoded localhost (frontend / extension)

These are **defaults** for local dev; set production envs in Vercel / extension build:

- `agentflow-frontend/lib/agentEndpoints.ts` — `NEXT_PUBLIC_*_AGENT_URL` and `NEXT_PUBLIC_BACKEND_URL`
- `agentflow-frontend/lib/hooks/useAgentJwt.ts`, `useGatewayBalance.ts`, `useStackHealth.ts` — `NEXT_PUBLIC_BACKEND_URL`
- `agentflow-extension` — `VITE_BACKEND_URL`

Production URLs should be your **public** Railway API hostname and (if you expose agents publicly) agent URLs; often only the **backend** URL is public and agents stay private behind the API.

---

## 8. Deploy commands summary

| Service | Command |
|---------|---------|
| **agentflow-api** | `npm run start:api` → `NODE_ENV=production` + `EMBEDDED_AGENT_SERVERS=false` + `tsx server.ts` |
| **agentflow-agents** | `npm run dev:agents` → `NODE_ENV=production` + `concurrently` running facilitator + 8 agents |

Equivalent Railway **Start Command** fields:

- **API:** `npm run start:api`
- **Agents:** `npm run dev:agents`
