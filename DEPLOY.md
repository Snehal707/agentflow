# Deploying AgentFlow (Railway, Nixpacks, Docker)

The project depends on a **private npm registry** (Cloudsmith) for `@circlefin/x402-batching`. The build will fail with **E401** unless the registry token is available during install.

## Required: set `CLOUDSMITH_TOKEN` at build time

### Railway

1. Open your project → **Variables**.
2. Add a variable:
   - **Name:** `CLOUDSMITH_TOKEN`
   - **Value:** your Cloudsmith token (from Circle / your team).
3. Ensure it is available at **build** time:
   - In Railway, variables are usually used for both build and runtime. If your platform has separate “Build” and “Runtime” variables, set `CLOUDSMITH_TOKEN` for **Build** (or both).

Without this, `npm ci` fails with:

```text
npm error code E401
npm error Incorrect or missing password.
```

### Other platforms (Render, Fly.io, etc.)

- Set the **CLOUDSMITH_TOKEN** environment variable so it is present when the build runs (e.g. when `npm ci` or `npm install` runs).
- Use the platform’s “Build environment variables” or “Secret env vars” and avoid committing the token.

### Local / CI

- Export before install: `export CLOUDSMITH_TOKEN=your_token` then `npm ci`.
- Or use the repo’s setup script so `.env` is loaded: `npm run setup` (see README).

## Database: fund plans migration (Supabase)

Canonical tables/columns are **`fund_plans`** and **`funds.plan_count`**. Older projects may still have `fund_subscriptions` / `subscriber_count` until the migration runs ([`db/migrations/20260421_rename_fund_subscriptions_to_fund_plans.sql`](db/migrations/20260421_rename_fund_subscriptions_to_fund_plans.sql)). Runtime code in [`lib/fund-plans.ts`](lib/fund-plans.ts) auto-detects either shape until you migrate.

### Apply in Supabase (recommended)

1. Open the Supabase project → **SQL Editor**.
2. Paste the **full** contents of `db/migrations/20260421_rename_fund_subscriptions_to_fund_plans.sql` and run it.
3. Verify (SQL Editor or Table Editor):
   - Table **`fund_plans`** exists (rows preserved from rename when applicable).
   - **`funds.plan_count`** exists and counts look correct.
   - Optional compat view **`fund_subscriptions`** may exist as `SELECT * FROM fund_plans` for old tooling.

### After migration

1. **Restart** the API (and any workers using `adminDb`) so in-process caches and Redis-backed caches (e.g. funds list) refresh.
2. Smoke-test (replace host and JWT as needed):
   - `npm run script:verify-funds-smoke` (with API up; optional `VERIFY_JWT=<token>` for authenticated `GET /api/funds/plans`).
   - `GET /api/funds` — public list; each fund should expose plan counts consistent with DB.
   - `GET /api/funds/plans` with `Authorization: Bearer <JWT>` — lists wallet plans.
   - `POST /api/funds/plans/start` and `POST /api/funds/plans/stop` with JWT and bodies matching [`api/funds.ts`](api/funds.ts).
3. In the web app, open **`/funds`** and confirm start/stop plan still works.

### Extension and legacy `/api/subscription`

The temporary **`GET /api/subscription/status`** compatibility route has been **removed**. Current code paths use **`GET /api/funds/plans`** (and start/stop from the web app). Older unpacked extension builds that still call `/api/subscription/status` will receive **404** until those users update the extension.

## Railway: backend for Vercel frontend

For the **agentflow-backend** service (used by the Vercel frontend):

1. **Start command:** Use the public API service: `npm run start:api`. Railway can also use the existing `railway.toml`, which already starts the API service.
2. **Port:** The backend listens on `process.env.PORT || 4000`. Railway sets `PORT`; in **Networking** set the exposed port to match.
3. **Variables:** Set `CLOUDSMITH_TOKEN`, `PRIVATE_KEY`, `SELLER_ADDRESS`, and Hermes keys. The Next frontend in `agentflow-frontend/` calls this service at `NEXT_PUBLIC_BACKEND_URL` (your Railway public URL).

If the Vercel app shows "Failed to fetch" on Deposit, confirm https://your-backend.up.railway.app/health returns `{"status":"ok"}`.

## Optional: root vs `agentflow-frontend/` only

- **Full stack (root):** Deploying the repo root runs `npm ci` at root; that’s where `@circlefin/x402-batching` is required, so **CLOUDSMITH_TOKEN** must be set for that build.
- **Frontend only (`agentflow-frontend/`):** If you deploy only the Next.js app under `agentflow-frontend/` (e.g. to Vercel with Root Directory set to that folder), the root private deps are not used; you only need `NEXT_PUBLIC_BACKEND_URL` pointing at your backend. No **CLOUDSMITH_TOKEN** needed for that build.
