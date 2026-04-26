/**
 * Smoke test for AgentPay loading fixes:
 * - Client fetch timeout (liveProductClient fetchWithTimeout)
 * - Next proxy upstream abort (backendProxy)
 * - Pay page: no setMyChainArc(null) on error; balance in-flight guard
 *
 * Run: npx tsx scripts/smoke-agentpay-loading-fixes.ts
 * Optional: SMOKE_FRONTEND_URL=http://127.0.0.1:3005 (default)
 */
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testHungServerAbortsWithinMs(): Promise<void> {
  const server = http.createServer(() => {
    /* intentionally never respond */
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const addr = server.address() as import("node:net").AddressInfo;
  const url = `http://127.0.0.1:${addr.port}/hang`;
  const start = Date.now();
  try {
    await fetchWithTimeout(url, { cache: "no-store" }, 700);
    throw new Error("expected fetch to abort");
  } catch (e: unknown) {
    const elapsed = Date.now() - start;
    if (elapsed > 2_500) {
      throw new Error(`timeout too slow: ${elapsed}ms (expected ~700ms)`);
    }
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (name !== "AbortError" && !/aborted|AbortError/i.test(msg)) {
      throw new Error(`unexpected error: ${name} ${msg}`);
    }
  } finally {
    server.close();
  }
  console.log("PASS: hung upstream -> client abort ~700ms");
}

function assertSourceFixesPresent(): void {
  const clientPath = path.join(repoRoot, "agentflow-frontend", "lib", "liveProductClient.ts");
  const payPath = path.join(repoRoot, "agentflow-frontend", "app", "(app)", "pay", "page.tsx");
  const proxyPath = path.join(repoRoot, "agentflow-frontend", "lib", "backendProxy.ts");

  for (const p of [clientPath, payPath, proxyPath]) {
    if (!fs.existsSync(p)) {
      throw new Error(`missing file: ${p}`);
    }
  }

  const client = fs.readFileSync(clientPath, "utf8");
  if (!client.includes("fetchWithTimeout")) {
    throw new Error("liveProductClient: expected fetchWithTimeout");
  }
  if (!client.includes('fetchWithTimeout("/api/wallet/balance"')) {
    throw new Error("liveProductClient: balance should use fetchWithTimeout");
  }
  if (!client.includes('fetchWithTimeout("/api/pay/name/my"')) {
    throw new Error("liveProductClient: /name/my should use fetchWithTimeout");
  }
  if (!client.includes('fetchWithTimeout("/api/pay/context"')) {
    throw new Error("liveProductClient: /pay/context should use fetchWithTimeout");
  }

  const pay = fs.readFileSync(payPath, "utf8");
  if (pay.includes("setMyChainArc(null)")) {
    throw new Error("pay/page: should not call setMyChainArc(null) (wiped .arc on error)");
  }
  if (!pay.includes("balanceFetchInFlight")) {
    throw new Error("pay/page: expected balanceFetchInFlight guard");
  }
  if (!pay.includes("r.name ?? prev?.name")) {
    throw new Error("pay/page: expected merged .arc from /name/my + prior state");
  }

  const proxy = fs.readFileSync(proxyPath, "utf8");
  if (!proxy.includes("UPSTREAM_FETCH_MS") || !proxy.includes("ctrl.abort()")) {
    throw new Error("backendProxy: expected upstream AbortController + UPSTREAM_FETCH_MS");
  }

  console.log("PASS: source files contain loading-fix patterns");
}

async function testLiveNextUnauthUnderBudget(): Promise<void> {
  const base = (process.env.SMOKE_FRONTEND_URL || "http://127.0.0.1:3005").replace(/\/+$/, "");
  const paths = ["/api/wallet/balance", "/api/pay/name/my", "/api/pay/context"];
  for (const p of paths) {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetchWithTimeout(`${base}${p}`, { cache: "no-store" }, 30_000);
    } catch (e) {
      throw new Error(`${base}${p}: fetch failed: ${e instanceof Error ? e.message : e}`);
    }
    const dt = Date.now() - t0;
    if (dt > 32_000) {
      throw new Error(`${p}: took ${dt}ms (expected <= ~30s client budget)`);
    }
    if (![401, 403].includes(res.status)) {
      console.warn(`WARN ${p}: status ${res.status} (often 401 without Bearer)`);
    } else {
      console.log(`PASS: ${p} -> ${res.status} in ${dt}ms`);
    }
  }
}

async function main(): Promise<void> {
  assertSourceFixesPresent();
  await testHungServerAbortsWithinMs();
  await testLiveNextUnauthUnderBudget();
  console.log("\nsmoke-agentpay-loading-fixes: ALL OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
