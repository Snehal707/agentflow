import { getAddress, isAddress } from 'viem';

const DEFAULT_USDC = '0x3600000000000000000000000000000000000000';
const DEFAULT_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

function envAddr(envName: string, fallback: string): `0x${string}` {
  const v = process.env[envName]?.trim();
  if (v && isAddress(v)) {
    return getAddress(v) as `0x${string}`;
  }
  return getAddress(fallback) as `0x${string}`;
}

function normalizeTokenSymbol(symbol: string): string {
  return symbol.trim().replace(/[!?.…,;:.]+$/u, '').trim().toUpperCase();
}

/** Arc testnet USDC / EURC — env overrides optional. */
export function resolveArcTokenSymbol(symbol: string): `0x${string}` | null {
  const s = normalizeTokenSymbol(symbol);
  if (s === 'USDC') {
    return envAddr('ARC_USDC_ADDRESS', DEFAULT_USDC);
  }
  if (s === 'EURC') {
    return envAddr('ARC_EURC_ADDRESS', DEFAULT_EURC);
  }
  return null;
}

export function parseSwapTokenSymbols(
  fromSym: string,
  toSym: string,
): { tokenIn: `0x${string}`; tokenOut: `0x${string}` } | null {
  const tokenIn = resolveArcTokenSymbol(fromSym);
  const tokenOut = resolveArcTokenSymbol(toSym);
  if (!tokenIn || !tokenOut) {
    return null;
  }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    return null;
  }
  return { tokenIn, tokenOut };
}
