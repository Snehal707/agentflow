import { adminDb } from '../../../db/client';

export interface SlippageInput {
  walletAddress: string;
  tokenPair: string;
  requestedSlippage: number;
}

export interface SlippageResult {
  optimalSlippage: number;
  memoryExecutions: number;
  averageObservedSlippage: number | null;
}

interface TraceShape {
  observedSlippage?: number;
  executedSlippage?: number;
}

export async function calculateOptimalSlippage(input: SlippageInput): Promise<SlippageResult> {
  const requested = clamp(input.requestedSlippage, 0.1, 10);

  const { data, error } = await adminDb
    .from('agent_interactions')
    .select('subagent_trace, created_at')
    .eq('wallet_address', input.walletAddress)
    .eq('agent_slug', 'swap')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`[swap/slippage] Failed loading recent executions: ${error.message}`);
  }

  const traces = (data ?? [])
    .map((row) => row.subagent_trace as TraceShape | null)
    .filter((trace): trace is TraceShape => Boolean(trace));

  const observed = traces
    .map((trace) => {
      const v = Number(trace.observedSlippage ?? trace.executedSlippage);
      return Number.isFinite(v) ? v : null;
    })
    .filter((v): v is number => v !== null);

  const averageObservedSlippage = observed.length
    ? observed.reduce((sum, value) => sum + value, 0) / observed.length
    : null;

  // Memory-aware adjustment: lean slightly toward recent observed market behavior.
  let optimal = requested;
  if (averageObservedSlippage !== null) {
    optimal = requested * 0.7 + averageObservedSlippage * 0.3;
  }

  // Token-pair guardrails for safety.
  if (input.tokenPair.toUpperCase().includes('USDC')) {
    optimal = Math.min(optimal, 2.5);
  }

  return {
    optimalSlippage: roundTo2(clamp(optimal, 0.1, 10)),
    memoryExecutions: traces.length,
    averageObservedSlippage:
      averageObservedSlippage === null ? null : roundTo2(averageObservedSlippage),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}
