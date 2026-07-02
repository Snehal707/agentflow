import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress } from 'viem';

const DEFAULT_LINK_TTL_SECONDS = 600;
const PREFIX = 'AF-';
/** Payload = 20-byte wallet + 4-byte expiry. */
const PAYLOAD_BYTES = 24;
/** 128-bit HMAC tag — enough that forging a code is infeasible, not just impractical. */
const SIG_BYTES = 16;

function getSecret(): string {
  const secret =
    process.env.TELEGRAM_LINK_SECRET?.trim() || process.env.JWT_SECRET?.trim() || '';
  if (!secret) {
    throw new Error('[telegram-link-code] TELEGRAM_LINK_SECRET or JWT_SECRET is required');
  }
  return secret;
}

export function createTelegramLinkCode(
  walletAddress: string,
  ttlSeconds = DEFAULT_LINK_TTL_SECONDS,
): string {
  const normalized = getAddress(walletAddress);
  const expiresAtSeconds = Math.floor((Date.now() + ttlSeconds * 1000) / 1000);
  const walletBytes = Buffer.from(normalized.slice(2), 'hex');
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  walletBytes.copy(payload, 0);
  payload.writeUInt32BE(expiresAtSeconds, 20);
  const signature = createHmac('sha256', getSecret()).update(payload).digest().subarray(0, SIG_BYTES);
  return `${PREFIX}${Buffer.concat([payload, signature]).toString('base64url')}`;
}

export function parseTelegramLinkCode(input: string): {
  ok: boolean;
  walletAddress?: string;
  reason?: string;
} {
  const raw = input.trim().toUpperCase().startsWith(PREFIX)
    ? input.trim().slice(PREFIX.length)
    : input.trim();

  try {
    const decoded = Buffer.from(raw, 'base64url');
    if (decoded.length !== PAYLOAD_BYTES + SIG_BYTES) {
      return { ok: false, reason: 'invalid' };
    }
    const payload = decoded.subarray(0, PAYLOAD_BYTES);
    const signature = decoded.subarray(PAYLOAD_BYTES);
    const expectedSignature = createHmac('sha256', getSecret())
      .update(payload)
      .digest()
      .subarray(0, SIG_BYTES);
    // Constant-time compare (both are fixed-length SIG_BYTES buffers).
    if (signature.length !== expectedSignature.length || !timingSafeEqual(signature, expectedSignature)) {
      return { ok: false, reason: 'invalid' };
    }
    const walletAddress = `0x${payload.subarray(0, 20).toString('hex')}`;
    const expiresAtSeconds = payload.readUInt32BE(20);
    if (!isAddress(walletAddress)) {
      return { ok: false, reason: 'invalid' };
    }
    if (Math.floor(Date.now() / 1000) > expiresAtSeconds) {
      return { ok: false, reason: 'expired' };
    }

    return { ok: true, walletAddress: getAddress(walletAddress) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export default {
  createTelegramLinkCode,
  parseTelegramLinkCode,
};
