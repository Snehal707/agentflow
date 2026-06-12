/**
 * Reproduces the chat "deposit -> YES" vault flow end-to-end so the REAL error
 * (hidden by tool-executor's catch-all "could not load provider vaults") surfaces.
 *
 * Run: AGENTFLOW_X402_DEBUG=true npx tsx scripts/test-vault-deposit-repro.ts
 */
import dotenv from 'dotenv';
import { getAddress } from 'viem';
import { generateJWT } from '../lib/auth';
import { executeUserPaidAgentViaX402, VAULT_AGENT_PRICE_LABEL, VAULT_RUN_URL } from '../lib/paidAgentX402';

dotenv.config();

const AMOUNT = '1';

async function vaultCall<T>(walletAddress: `0x${string}`, body: Record<string, unknown>): Promise<T> {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${generateJWT(walletAddress)}`,
  };
  if (internalKey) headers['x-agentflow-paid-internal'] = internalKey;
  const res = await fetch(VAULT_RUN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, walletAddress }),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* */ }
  if (!res.ok || !json) throw new Error(json?.error || `Vault request failed (http ${res.status}): ${text.slice(0, 300)}`);
  return json as T;
}

async function main(): Promise<void> {
  const wallet = getAddress((process.env.TEST_WALLET_ADDRESS || '').trim() as `0x${string}`);
  console.log('[vault] wallet       :', wallet);
  console.log('[vault] VAULT_RUN_URL:', VAULT_RUN_URL);
  console.log('[vault] internalKey  :', process.env.AGENTFLOW_BRAIN_INTERNAL_KEY ? 'set' : 'MISSING');

  console.log('\n[vault] step 1: list');
  const list = await vaultCall<{ vaults?: any[] }>(wallet, { action: 'list' });
  const vaults = list.vaults || [];
  console.log('[vault] vaults:', vaults.map((v) => `${v.vaultSymbol}@${v.provider} (${v.address})`).join(', ') || '(none)');
  const vault = vaults.find((v) => /usdc/i.test(v.assetSymbol || v.vaultSymbol)) || vaults[0];
  if (!vault) throw new Error('no vaults returned by agent');
  console.log('[vault] chosen:', vault.vaultSymbol, vault.provider, vault.address);

  console.log('\n[vault] step 2: preview deposit', AMOUNT);
  const preview = await vaultCall<{ preview?: any }>(wallet, {
    action: 'deposit', amount: AMOUNT, provider: vault.provider, vaultAddress: vault.address, confirmed: false,
  });
  console.log('[vault] preview assetAddress:', preview.preview?.assetAddress);

  console.log('\n[vault] step 3: EXECUTE deposit (paid x402) — the confirmed/YES path');
  try {
    const paid = await executeUserPaidAgentViaX402<any>({
      agent: 'vault',
      price: VAULT_AGENT_PRICE_LABEL,
      userWalletAddress: wallet,
      requestId: `repro_vault_${Date.now()}`,
      url: VAULT_RUN_URL,
      body: { action: 'deposit', amount: AMOUNT, provider: vault.provider, vaultAddress: vault.address, confirmed: true },
    });
    console.log('\n[vault] paid status:', paid.status);
    console.log('[vault] data.success:', paid.data?.success, ' txHash:', paid.data?.txHash, ' error:', paid.data?.error);
    console.log('[vault] data:', JSON.stringify(paid.data, null, 2).slice(0, 1500));
  } catch (err) {
    console.log('\n[vault] ❌ EXECUTE THREW — this is exactly what the chat catch-all hides:');
    console.log(err instanceof Error ? (err.stack || err.message) : String(err));
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.log('\n[vault] ❌ threw before execute (list/preview step):');
  console.error(e instanceof Error ? (e.stack || e.message) : e);
  process.exit(1);
});
