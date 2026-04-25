import { createPublicClient, defineChain, getAddress, http, parseUnits } from 'viem';
import { adminDb } from '../../../db/client';
import { ARC } from '../../../lib/arc-config';
import { executeTransaction, getOrCreateUserAgentWallet, waitForTransaction } from '../../../lib/dcw';

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

export interface ExecutePaymentInput {
  payerWalletAddress: string;
  payeeWalletAddress: string;
  amountUsdc: number;
  invoiceId: string;
}

export interface ExecutePaymentResult {
  txHash: `0x${string}`;
  txId: string;
}

/**
 * DCW transfer from payer's user-agent wallet to payee; confirm via Transfer event; mark invoice settled.
 */
export async function executeInvoicePayment(input: ExecutePaymentInput): Promise<ExecutePaymentResult> {
  const payer = getAddress(input.payerWalletAddress);
  const payee = getAddress(input.payeeWalletAddress);
  const amountRaw = parseUnits(input.amountUsdc.toFixed(6), 6);

  const userAgent = await getOrCreateUserAgentWallet(payer);

  const tx = await executeTransaction({
    walletId: userAgent.wallet_id,
    contractAddress: ARC_USDC,
    abiFunctionSignature: 'transfer(address,uint256)',
    abiParameters: [payee, amountRaw.toString()],
    feeLevel: 'HIGH',
    usdcAmount: input.amountUsdc,
  });

  const txId = extractTxId(tx);
  if (!txId) {
    throw new Error('[invoice/executor] Missing Circle transaction id');
  }

  const polled = await waitForTransaction(txId, 'invoice-pay');
  if (polled.state !== 'COMPLETE' || !polled.txHash) {
    throw new Error(
      `[invoice/executor] DCW failed: ${polled.errorReason ?? polled.state ?? 'unknown'}`,
    );
  }

  const hash = polled.txHash as `0x${string}`;
  const client = createPublicClient({ chain, transport: http(ARC.rpc) });
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error('[invoice/executor] On-chain receipt not successful');
  }

  const { error } = await adminDb
    .from('invoices')
    .update({
      status: 'settled',
      settled_at: new Date().toISOString(),
      arc_tx_id: hash,
    })
    .eq('id', input.invoiceId);

  if (error) {
    throw new Error(`[invoice/executor] invoice update failed: ${error.message}`);
  }

  await adminDb.from('transactions').insert({
    from_wallet: payer,
    to_wallet: payee,
    amount: input.amountUsdc,
    arc_tx_id: hash,
    agent_slug: 'invoice',
    invoice_id: input.invoiceId,
    action_type: 'invoice_pay',
    status: 'complete',
  });

  return { txHash: hash, txId };
}

function extractTxId(tx: unknown): string | null {
  const obj = tx as { data?: { transaction?: { id?: string }; id?: string } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}
