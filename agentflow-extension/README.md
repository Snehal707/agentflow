# AgentFlow Research (Chrome extension)

Minimal **Manifest V3** extension: ask questions about the **current tab’s URL** (no content scripts, no passive DOM access). The active tab URL is read only when you click **Analyze**, via `chrome.tabs.query` after a user gesture.

Open source (MIT). Teams may copy this folder into its own repository if they prefer a separate OSS project.

## Backend

- **Analyze:** `POST /api/extension/analyze` with `Authorization: Bearer <JWT>` and JSON body `{ "url", "question" }` only.
- **Wallet / fund plans:** `GET /api/wallet/balance`, `GET /api/funds/plans` with the same header.

Configure the API base URL at build time (see below).

## Permissions

| Permission       | Why                                      |
|----------------|-------------------------------------------|
| `activeTab`    | Read the active tab URL when you analyze. |
| `storage`      | Store JWT and optional wallet for display. |

### `host_permissions` (important)

Cross-origin `fetch` from the extension service worker **requires** your API origin to be listed under `host_permissions`. This repo ships **localhost** entries for development:

- `http://localhost:4000/*`
- `http://127.0.0.1:4000/*`

**Before production or Web Store submission**, add your real API origin(s), e.g. `https://api.your-domain.com/*`, in `src/manifest.json`. Narrow scopes are store-friendly; avoid `https://*/*`.

Alternatively, you can use **`optional_host_permissions`** and `chrome.permissions.request` so the user grants the API host on first use (still user-consented).

`activeTab` does **not** grant network access to your backend by itself.

## Setup

```bash
cd agentflow-extension
npm install
cp .env.example .env
# Edit .env: VITE_BACKEND_URL, VITE_WEB_ORIGIN
npm run build
```

Load **unpacked** in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select `agentflow-extension/dist`.

Development with HMR:

```bash
npm run dev
```

Follow `@crxjs/vite-plugin` docs for loading the dev build if it differs from production `dist/`.

## Auth UX

Obtain a JWT from the AgentFlow web app (e.g. wallet sign-in). Paste the JWT (and optional wallet address for display) in the extension **Settings** and click **Save**.

Analyze uses JWT auth and server-side rate limits (pay-per-task model). Fund plan start/stop is done in the web app at `/funds`.

## Chrome Web Store

- Suggested category: **Productivity** (metadata only; not set in code).
- Add **icons** (16 / 48 / 128) under `public/` and reference them in `manifest.json` before submission.

## License

MIT — see [LICENSE](./LICENSE).
