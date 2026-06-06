import dotenv from 'dotenv';
import { evaluateStableRateBand, evaluateSwapSanity } from '../lib/swap-sanity';

dotenv.config();

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ARC_EURC = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;

function resultLabel(ok: boolean): string {
  return ok ? 'ok=true' : 'ok=false';
}

function runEurcCase(rate: number): string {
  const amountInRaw = 1_000_000n;
  const amountOutRaw = BigInt(Math.round(rate * 1_000_000));
  const result = evaluateSwapSanity({
    amountInRaw,
    amountOutRaw,
    tokenIn: ARC_USDC,
    tokenOut: ARC_EURC,
    tokenInDecimals: 6,
    tokenOutDecimals: 6,
    priceImpactPct: null,
    provider: 'test',
  });
  return `USDC/EURC @ ${rate} -> ${resultLabel(result.ok)}${result.ok ? '' : ` | ${result.reason}`}`;
}

function runBandCase(pairKey: string, rate: number): string {
  const result = evaluateStableRateBand({ pairKey, quotedRate: rate });
  return `${pairKey} @ ${rate} -> ${resultLabel(result.ok)}${
    result.ok ? '' : ` | min=${result.min} max=${result.max}`
  }`;
}

const lines = [
  runEurcCase(0.907),
  runEurcCase(0.852),
  runEurcCase(0.819),
  runEurcCase(0.5),
  runEurcCase(1.5),
  runBandCase('USDC-USDT', 0.95),
  runBandCase('USDC-USDT', 0.85),
];

for (const line of lines) {
  console.log(line);
}
