# Phase D — Deploy Next.js frontend to Vercel

Get AgentFlow live on the internet: **frontend on Vercel**, **backend on Railway**.

## Prerequisites

- Backend already deployed on Railway (Facilitator + 3 agents + UI/SSE API).
- You have the Railway public URL, e.g. `https://your-app.railway.app`.

---

## Option A: Same repo (recommended)

Use your existing **agent-economy** repo. Vercel will build only the **`agentflow-frontend/`** folder.

### 1. Push code to GitHub

If not already done:

```bash
git add .
git commit -m "Phase D: ready for Vercel frontend deploy"
git remote add origin https://github.com/YOUR_USERNAME/agent-economy.git
git push -u origin main
```

### 2. Import in Vercel

1. Go to **[vercel.com](https://vercel.com)** and sign in with **GitHub**.
2. Click **Add New…** → **Project**.
3. **Import** your `agent-economy` (or your repo name) from GitHub.
4. **Configure:**
   - **Root Directory:** click **Edit**, set to **`agentflow-frontend`** (so Vercel builds only the Next.js app).
   - **Framework Preset:** Next.js (auto-detected).
   - **Build Command:** `npm run build` (default).
   - **Output Directory:** `.next` (default).

### 3. Environment variable

In the same import screen (or **Settings → Environment Variables**):

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_BACKEND_URL` | `https://your-railway-url.railway.app` |

Use your real Railway URL (no trailing slash). Example:  
`https://agentflow-backend.railway.app`

### 4. Deploy

Click **Deploy**. Vercel will build and give you a URL like:

**https://agentflow.vercel.app** (or your project name).

### 5. Share

- Share the Vercel URL with the community.
- Users connect wallet (e.g. MetaMask), switch to **Arc Testnet**, and use **Run AgentFlow**.

---

## Option B: Separate repo for frontend only

If you prefer a repo that contains only the Next.js app:

### 1. Copy `agentflow-frontend/` out of the monorepo

From the **agent-economy** repo, copy the **`agentflow-frontend/`** directory to a new folder (or use `git subtree split` / `git filter-repo` if you want only that history). Example:

```bash
# Example: copy the folder to a sibling directory
xcopy /E /I agentflow-frontend ..\agentflow-frontend-standalone
cd ..\agentflow-frontend-standalone
```

(Or create a new GitHub repo and add the contents of `agentflow-frontend/` as the initial commit.)

### 2. Create GitHub repo and push

1. On GitHub: **New repository** → name e.g. `agentflow-frontend` → Create (no README/license).
2. In your terminal (inside the copied app root):

```bash
git init
git add .
git commit -m "Initial frontend"
git remote add origin https://github.com/YOUR_USERNAME/agentflow-frontend.git
git push -u origin main
```

### 3. Deploy on Vercel

1. [vercel.com](https://vercel.com) → **Add New… → Project** → Import your **agentflow-frontend** repo.
2. No Root Directory change if the app is at the repo root.
3. Add **`NEXT_PUBLIC_BACKEND_URL`** = your Railway URL.
4. **Deploy**.

---

## Final architecture

| Layer | Where | What |
|-------|--------|------|
| **Frontend** | Vercel | Next.js + RainbowKit → `https://agentflow.vercel.app` |
| **Backend** | Railway | Facilitator + 3 agents + SSE API |
| **Blockchain** | Arc Testnet | Circle Gateway + USDC |
| **AI** | Hermes LLM | Research, Analyst, Writer agents |

**Goal:** AgentFlow live on the internet for the community to use.

---

## Troubleshooting

- **CORS:** Backend (Railway) must allow the Vercel origin. The active backend is the public API in `server.ts`; for production, restrict allowed origins to your Vercel domain.
- **WalletConnect:** For production wallets, add `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in Vercel (get one at [cloud.walletconnect.com](https://cloud.walletconnect.com)).
- **Backend URL:** Always use HTTPS and no trailing slash for `NEXT_PUBLIC_BACKEND_URL`.
