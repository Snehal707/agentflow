import { randomBytes } from 'node:crypto';
import { getAddress } from 'viem';
import { getRedis } from '../db/client';

/**
 * Server-issued, single-use challenge nonces for wallet-signature flows.
 *
 * Prevents signature replay: a signature is only accepted once, must carry a
 * nonce this server minted for that exact wallet, and expires quickly. Used by
 * login (`/api/auth/verify-signature`) and emergency withdrawal.
 */

export type AuthNoncePurpose = 'login' | 'emergency-withdraw';

const NONCE_TTL_SECONDS = Number(process.env.AUTH_NONCE_TTL_SECONDS || 300);
const AUTH_DOMAIN = (process.env.AUTH_SIGN_DOMAIN?.trim() || 'agentflow.one');

function nonceKey(purpose: AuthNoncePurpose, wallet: string): string {
  return `auth:nonce:${purpose}:${getAddress(wallet).toLowerCase()}`;
}

/** Human-readable message the wallet signs. The nonce + domain are what bind it. */
export function buildSignInMessage(input: {
  purpose: AuthNoncePurpose;
  walletAddress: string;
  nonce: string;
  issuedAt: string;
}): string {
  const action =
    input.purpose === 'emergency-withdraw'
      ? 'Emergency-withdraw all funds to this wallet'
      : 'Sign in to AgentFlow';
  return [
    'AgentFlow',
    action,
    `Domain: ${AUTH_DOMAIN}`,
    `Wallet: ${getAddress(input.walletAddress)}`,
    `Nonce: ${input.nonce}`,
    `Issued-At: ${input.issuedAt}`,
  ].join('\n');
}

/** Mint a nonce for `wallet`, store it (single-use, short TTL), return the message to sign. */
export async function issueAuthChallenge(
  purpose: AuthNoncePurpose,
  wallet: string,
): Promise<{ nonce: string; issuedAt: string; message: string }> {
  const walletAddress = getAddress(wallet);
  const nonce = randomBytes(24).toString('hex');
  const issuedAt = new Date().toISOString();
  await getRedis().set(nonceKey(purpose, walletAddress), nonce, 'EX', NONCE_TTL_SECONDS);
  const message = buildSignInMessage({ purpose, walletAddress, nonce, issuedAt });
  return { nonce, issuedAt, message };
}

/**
 * Validate a signed challenge message: the wallet's stored nonce must match the
 * one embedded in the message, and it is consumed (single-use) on success.
 * Returns false on any mismatch, absence, or malformed input.
 */
export async function consumeAuthChallenge(
  purpose: AuthNoncePurpose,
  wallet: string,
  message: string,
): Promise<boolean> {
  if (!message || typeof message !== 'string') return false;

  const domainMatch = message.match(/^Domain:\s*(.+)$/m);
  if (!domainMatch || domainMatch[1].trim() !== AUTH_DOMAIN) return false;

  const walletMatch = message.match(/^Wallet:\s*(0x[0-9a-fA-F]{40})$/m);
  if (!walletMatch) return false;
  try {
    if (getAddress(walletMatch[1]) !== getAddress(wallet)) return false;
  } catch {
    return false;
  }

  const nonceMatch = message.match(/^Nonce:\s*([0-9a-f]{48})$/m);
  if (!nonceMatch) return false;
  const presentedNonce = nonceMatch[1];

  // Atomic get-and-delete so a nonce can never be consumed twice concurrently.
  const stored = await getRedis().getdel(nonceKey(purpose, wallet));
  return Boolean(stored) && stored === presentedNonce;
}
