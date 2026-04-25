import { getAddress, parseUnits } from 'viem';
import { adminDb } from '../db/client';
import { executeTransaction, getOrCreateUserAgentWallet, waitForTransaction } from './dcw';

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;

const EXPLORER_TX_BASE =
  process.env.ARC_EXPLORER_TX_URL?.trim() || 'https://testnet.arcscan.app/tx';

export function explorerLinkTx(txHash: string): string {
  const base = EXPLORER_TX_BASE.replace(/\/+$/, '');
  const h = String(txHash).trim();
  return `${base}/${h}`;
}

export function extractTxId(tx: unknown): string | null {
  const obj = tx as { data?: { transaction?: { id?: string }; id?: string } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}

export async function executeUsdcTransfer(params: {
  payerEoa: string;
  toAddress: string;
  amountUsdc: number;
  remark: string | null;
  actionType: string;
}): Promise<{ txHash: `0x${string}` }> {
  const payer = getAddress(params.payerEoa);
  const payee = getAddress(params.toAddress);
  if (payer === payee) {
    throw new Error('Cannot send to the same wallet');
  }
  const userAgent = await getOrCreateUserAgentWallet(payer);
  if (!userAgent?.wallet_id?.trim()) {
    throw new Error(
      'Agent wallet not ready. Complete AgentFlow wallet setup (user agent wallet) before sending.',
    );
  }
  const amountRaw = parseUnits(params.amountUsdc.toFixed(6), 6);

  const tx = await executeTransaction({
    walletId: userAgent.wallet_id,
    contractAddress: ARC_USDC,
    abiFunctionSignature: 'transfer(address,uint256)',
    abiParameters: [payee, amountRaw.toString()],
    feeLevel: 'HIGH',
    usdcAmount: params.amountUsdc,
  });

  const txId = extractTxId(tx);
  if (!txId) {
    throw new Error('[agentpay] Missing Circle transaction id');
  }

  const polled = await waitForTransaction(txId, 'agentpay');
  if (polled.state !== 'COMPLETE' || !polled.txHash) {
    throw new Error(
      `[agentpay] Transfer failed: ${polled.errorReason ?? polled.state ?? 'unknown'}`,
    );
  }

  const hash = polled.txHash as `0x${string}`;
  const fromDcw = getAddress(userAgent.address as `0x${string}`);

  const { error } = await adminDb.from('transactions').insert({
    from_wallet: fromDcw,
    to_wallet: payee,
    amount: params.amountUsdc,
    arc_tx_id: hash,
    agent_slug: 'agentpay',
    action_type: params.actionType,
    status: 'complete',
    remark: params.remark ? params.remark.slice(0, 500) : null,
  });

  if (error) {
    throw new Error(`[agentpay] Ledger insert failed: ${error.message}`);
  }

  return { txHash: hash };
}

export async function executeOwnerWalletUsdcTransfer(params: {
  fromWalletId: string;
  fromAddress: string;
  toAddress: string;
  amountUsdc: number;
  remark: string | null;
  actionType: string;
  agentSlug: string;
  label?: string;
}): Promise<{ txHash: `0x${string}` }> {
  const fromDcw = getAddress(params.fromAddress);
  const payee = getAddress(params.toAddress);
  if (fromDcw === payee) {
    throw new Error('Cannot send to the same wallet');
  }
  if (!Number.isFinite(params.amountUsdc) || params.amountUsdc <= 0) {
    throw new Error('Transfer amount must be greater than zero');
  }

  const amountRaw = parseUnits(params.amountUsdc.toFixed(6), 6);
  const tx = await executeTransaction({
    walletId: params.fromWalletId,
    contractAddress: ARC_USDC,
    abiFunctionSignature: 'transfer(address,uint256)',
    abiParameters: [payee, amountRaw.toString()],
    feeLevel: 'HIGH',
    usdcAmount: params.amountUsdc,
  });

  const txId = extractTxId(tx);
  if (!txId) {
    throw new Error('[agentpay] Missing Circle transaction id');
  }

  const polled = await waitForTransaction(txId, params.label ?? 'agent-owner-payment');
  if (polled.state !== 'COMPLETE' || !polled.txHash) {
    throw new Error(
      `[agentpay] Owner wallet transfer failed: ${polled.errorReason ?? polled.state ?? 'unknown'}`,
    );
  }

  const hash = polled.txHash as `0x${string}`;
  const { error } = await adminDb.from('transactions').insert({
    from_wallet: fromDcw,
    to_wallet: payee,
    amount: params.amountUsdc,
    arc_tx_id: hash,
    agent_slug: params.agentSlug,
    action_type: params.actionType,
    status: 'complete',
    remark: params.remark ? params.remark.slice(0, 500) : null,
  });

  if (error) {
    throw new Error(`[agentpay] Ledger insert failed: ${error.message}`);
  }

  return { txHash: hash };
}
