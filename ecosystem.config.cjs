/**
 * PM2 process manager — AgentFlow VPS deployment.
 *
 * Runs every always-on service with NODE_ENV=production. This is what makes the
 * "permanent fix" work: crons/index.ts only starts its scheduler when
 * NODE_ENV=production, so the semantic-memory health snapshot (and treasury
 * top-up, daily reports, scheduled payments, etc.) stay fresh automatically
 * every 6 hours — no more "Snapshot freshness: Degraded".
 *
 * NOTE: this file is .cjs on purpose — the repo is an ES module
 * ("type": "module" in package.json), so a .js PM2 config would fail to load.
 *
 * First-time setup on the VPS (Linux):
 *   cd /path/to/agent-economy
 *   npm install
 *   cd agentflow-frontend && npm install && npm run build && cd ..
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup        # survive reboots (run the printed command)
 *
 * Everyday use:
 *   pm2 status
 *   pm2 logs agentflow-cron        # confirm the scheduler started
 *   pm2 restart agentflow-backend
 *   pm2 reload all                 # after a deploy
 */

const path = require("path");

const root = __dirname;
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const next = path.join(root, "agentflow-frontend", "node_modules", ".bin", "next");

module.exports = {
  apps: [
    {
      // Public API + embedded facilitator/research/analyst/writer (server.ts)
      // on port 4000.
      name: "agentflow-backend",
      cwd: root,
      script: tsx,
      args: "server.ts",
      interpreter: "none", // tsx is the launcher; run it directly
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "1500M",
      time: true,
    },
    {
      // Paid/DCW swap agent on :3011.
      name: "agentflow-swap",
      cwd: root,
      script: tsx,
      args: "agents/swap/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Vault agent on :3012.
      name: "agentflow-vault",
      cwd: root,
      script: tsx,
      args: "agents/vault/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Portfolio agent on :3014.
      name: "agentflow-portfolio",
      cwd: root,
      script: tsx,
      args: "agents/portfolio/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Vision agent on :3016.
      name: "agentflow-vision",
      cwd: root,
      script: tsx,
      args: "agents/vision/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Transcribe agent on :3017.
      name: "agentflow-transcribe",
      cwd: root,
      script: tsx,
      args: "agents/transcribe/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Bridge agent on :3021.
      name: "agentflow-bridge",
      cwd: root,
      script: tsx,
      args: "agents/bridge/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Invoice agent on :3015.
      name: "agentflow-invoice",
      cwd: root,
      script: tsx,
      args: "agents/invoice/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Split agent on :3019.
      name: "agentflow-split",
      cwd: root,
      script: tsx,
      args: "agents/split/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Batch agent on :3020.
      name: "agentflow-batch",
      cwd: root,
      script: tsx,
      args: "agents/batch/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Schedule agent on :3018.
      name: "agentflow-schedule",
      cwd: root,
      script: tsx,
      args: "agents/schedule/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Prediction market agent on :3013.
      name: "agentflow-predmarket",
      cwd: root,
      script: tsx,
      args: "agents/predmarket/server.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Scheduler. THIS is the snapshot-freshness fix: semantic-memory
      // consolidation (every 6h), treasury top-up (hourly), daily reports,
      // scheduled USDC payments, yield monitor, training export, monthly digest.
      name: "agentflow-cron",
      cwd: root,
      script: tsx,
      args: "crons/index.ts",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      time: true,
    },
    {
      // Next.js frontend on port 3005. Requires `npm run build` (in
      // agentflow-frontend) BEFORE starting. Delete this block if you host the
      // frontend elsewhere (e.g. Vercel).
      name: "agentflow-frontend",
      cwd: path.join(root, "agentflow-frontend"),
      script: next,
      args: "start -p 3005",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      autorestart: true,
      max_memory_restart: "1000M",
      time: true,
    },
  ],
};
