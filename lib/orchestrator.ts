export type OrchestratorStep = 'research' | 'analyst' | 'writer';

export type StepEvent =
  | { type: 'step_start'; step: OrchestratorStep; price: string }
  | { type: 'step_complete'; step: OrchestratorStep; tx: string; amount: string }
  | {
      type: 'receipt';
      total: string;
      researchTx: string;
      analystTx: string;
      writerTx: string;
    }
  | { type: 'report'; markdown: string; summary: string }
  | { type: 'error'; message: string; step?: OrchestratorStep };

export interface OrchestratorReceipt {
  total: string;
  researchPrice: string;
  analystPrice: string;
  writerPrice: string;
  researchTx: string;
  analystTx: string;
  writerTx: string;
}

export interface OrchestratorResult {
  report: string;
  summary: string;
  receipt: OrchestratorReceipt;
}

export async function runOrchestrator(
  _task: string,
  _onEvent?: (event: StepEvent) => void,
): Promise<OrchestratorResult> {
  throw new Error(
    'Server-side orchestrator payment signing has been removed. Run the browser flow, where each x402 payment is signed by the connected MetaMask wallet.',
  );
}

export const walletIntents = [
  {
    patterns: ['deposit to gateway', 'fund gateway', 'add usdc to gateway', 'fund my gateway'],
    action: 'GATEWAY_DEPOSIT_INFO',
  },
  {
    patterns: ['gateway balance', 'check gateway', 'how much in gateway'],
    action: 'GATEWAY_BALANCE',
  },
  {
    patterns: ['check my wallet', 'wallet balance', 'my balances', 'how much do i have'],
    action: 'ALL_BALANCES',
  },
  {
    patterns: ['move to execution', 'fund my agents', 'fund execution wallet', 'move usdc to execution'],
    action: 'GATEWAY_TO_EXECUTION',
  },
  {
    patterns: ['withdraw from gateway', 'gateway withdraw'],
    action: 'GATEWAY_WITHDRAW',
  },
  {
    patterns: ['emergency withdraw', 'withdraw everything', 'withdraw all'],
    action: 'EMERGENCY_WITHDRAW_CONFIRM',
  },
] as const;

export type WalletIntentAction = (typeof walletIntents)[number]['action'];

export function detectWalletIntent(message: string): WalletIntentAction | null {
  const normalized = message.trim().toLowerCase();
  for (const intent of walletIntents) {
    if (intent.patterns.some((pattern) => normalized.includes(pattern))) {
      return intent.action;
    }
  }
  return null;
}
