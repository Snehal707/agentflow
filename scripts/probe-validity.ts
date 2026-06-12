/**
 * Isolates the validity-window hypothesis: sign the SAME authorization two ways
 * — validBefore = now + maxTimeoutSeconds (what the BROWSER does) vs
 *   validBefore = now + max(maxTimeoutSeconds, 604800) + 600 (what the SERVER does) —
 * and ask the facilitator /v1/x402/verify directly. payer != payTo (no self_transfer).
 */
import dotenv from 'dotenv';
import { getAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';

dotenv.config();

const FAC = (process.env.FACILITATOR_URL || `http://127.0.0.1:${process.env.FACILITATOR_PORT || 3010}`).replace(/\/+$/, '');
const BRIDGE = (process.env.BRIDGE_AGENT_URL || 'http://127.0.0.1:3021').replace(/\/+$/, '');

const types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

async function getArcRequirement() {
  // Pull a fresh 402 from the bridge to get the exact ARC requirement bytes.
  const { generateJWT } = await import('../lib/auth');
  const payer = getAddress(privateKeyToAccount((process.env.DEPLOYER_PRIVATE_KEY!.startsWith('0x') ? process.env.DEPLOYER_PRIVATE_KEY! : `0x${process.env.DEPLOYER_PRIVATE_KEY}`) as Hex).address);
  const res = await fetch(`${BRIDGE}/bridge/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${generateJWT(payer)}` },
    body: JSON.stringify({ sourceChain: 'ethereum-sepolia', amount: 0.1, walletAddress: payer }),
  });
  const prHeader = res.headers.get('PAYMENT-REQUIRED')!;
  const decoded = JSON.parse(Buffer.from(prHeader, 'base64').toString('utf-8'));
  const arc = decoded.accepts.find((r: any) => r.network === 'eip155:5042002');
  if (!arc) throw new Error('no ARC requirement in 402');
  return { arc, resource: decoded.resource };
}

async function verifyWith(label: string, account: ReturnType<typeof privateKeyToAccount>, req: any, validBefore: number, validAfter: number, payTo: string, resource: any) {
  const chainId = Number(req.network.split(':')[1]);
  const authorization = {
    from: getAddress(account.address),
    to: getAddress(payTo as `0x${string}`),
    value: req.amount,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce: `0x${randomBytes(32).toString('hex')}` as Hex,
  };
  const signature = await account.signTypedData({
    domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: getAddress(req.extra.verifyingContract) },
    types,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce,
    },
  });
  const paymentPayload = { x402Version: 2, scheme: req.scheme, network: req.network, resource, accepted: req, payload: { authorization, signature } };
  // requirements must carry payTo == authorization.to for the signature to bind
  const paymentRequirements = { ...req, payTo: getAddress(payTo as `0x${string}`) };
  const r = await fetch(`${FAC}/v1/x402/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentPayload, paymentRequirements }),
  });
  const raw = await r.text();
  let body: any = {};
  try { body = JSON.parse(raw); } catch { /* */ }
  const windowDays = ((validBefore - validAfter) / 86400).toFixed(2);
  console.log(`\n[${label}] validBefore window = ${windowDays} days`);
  console.log(`  http ${r.status}  isValid=${body.isValid}  invalidReason=${body.invalidReason ?? '-'}`);
  if (r.status >= 400) console.log('  raw:', raw.slice(0, 600));
}

(async () => {
  const pk = process.env.DEPLOYER_PRIVATE_KEY!;
  const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as Hex);
  const payer = getAddress(account.address);
  // payTo MUST differ from payer to avoid self_transfer. Use the DCW wallet addr.
  const payTo = getAddress('0x0868ebd6c963C30e6aF346dbE76A98B22D75e1ac');
  console.log('payer :', payer, '(available 13.278 on Arc)');
  console.log('payTo :', payTo, '(distinct -> no self_transfer)');

  const { arc: req, resource } = await getArcRequirement();
  console.log('ARC requirement:', JSON.stringify({ amount: req.amount, maxTimeoutSeconds: req.maxTimeoutSeconds, verifyingContract: req.extra.verifyingContract }));
  const now = Math.floor(Date.now() / 1000);

  // BROWSER-style: validAfter = now-600, validBefore = now + maxTimeoutSeconds
  await verifyWith('BROWSER', account, req, now + Number(req.maxTimeoutSeconds), now - 600, payTo, resource);
  // SERVER-style: validAfter = now-30, validBefore = now + max(maxTimeout, 604800) + 600
  const required = Math.max(Number(req.maxTimeoutSeconds), 604800);
  await verifyWith('SERVER ', account, req, now + required + 600, now - 30, payTo, resource);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
