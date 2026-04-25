/**
 * x402 seller / gateway middleware uses a local key. Prefer PRIVATE_KEY; fall back to
 * DEPLOYER_PRIVATE_KEY so `npm run dev:stack` works with a single key in `.env`.
 */
export function resolveAgentPrivateKey(): `0x${string}` {
  const raw =
    process.env.PRIVATE_KEY?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error(
      'PRIVATE_KEY or DEPLOYER_PRIVATE_KEY must be set for this agent server.',
    );
  }
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
}
