import { createPublicClient, formatUnits, getAddress, http, parseAbi } from 'viem';
import { adminDb, getRedis } from '../../db/client';
import { resolvePayee } from '../../lib/agentpay-payee';
import { executeUsdcTransfer } from '../../lib/agentpay-transfer';
import { resolveArcRpcUrl } from '../../lib/arc-config';
import { getOrCreateUserAgentWallet } from '../../lib/dcw';
import { sendTelegramText } from '../../lib/telegram-notify';

const BATCH_PENDING_PREFIX = 'batch:pending:';
const BATCH_TTL_SECONDS = 600;

const ARC_RPC_URL = resolveArcRpcUrl();
const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);

function getPublicClient() {
  return createPublicClient({ transport: http(ARC_RPC_URL) });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BatchPayment {
  to: string;
  amount: string;
  remark?: string;
}

interface ResolvedPayment {
  displayName: string;
  address: string;
  amount: string;
  remark?: string;
}

interface BatchPendingPayload {
  walletAddress: string;
  payments: ResolvedPayment[];
  total: string;
  shortId: string;
}

function generateShortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface BatchAgentResponse {
  action: 'preview' | 'success' | 'error';
  message: string;
  confirmId?: string;
  confirmLabel?: string;
  total?: string;
  count?: number;
  unresolved?: number;
  payments?: Array<{
    to: string;
    displayName: string;
    amount: string;
    remark?: string;
    resolved: boolean;
  }>;
  results?: Array<{
    to: string;
    amount: string;
    remark?: string;
    status: 'success' | 'failed';
    txHash?: string;
    error?: string;
  }>;
}

export async function previewBatch(params: {
  sessionId: string;
  walletAddress: string;
  payments: BatchPayment[];
}): Promise<BatchAgentResponse> {
  const { sessionId, walletAddress, payments } = params;

  if (payments.length < 2) {
    return { action: 'error', message: 'Batch requires at least 2 payments.' };
  }
  if (payments.length > 500) {
    return { action: 'error', message: 'Batch maximum is 500 payments per run.' };
  }

  // Validate all amounts
  for (let i = 0; i < payments.length; i++) {
    const amt = parseFloat(payments[i].amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { action: 'error', message: `Row ${i + 1}: invalid amount "${payments[i].amount}". Must be a positive number.` };
    }
  }

  // Resolve all recipients (parallel)
  const resolveResults = await Promise.all(
    payments.map(async (p, i) => {
      try {
        const address = await resolvePayee(p.to.trim(), walletAddress);
        return { index: i, displayName: p.to.trim(), address, amount: p.amount, remark: p.remark, resolved: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { index: i, displayName: p.to.trim(), address: '', amount: p.amount, remark: p.remark, resolved: false, error: msg };
      }
    }),
  );

  const unresolved = resolveResults.filter((r) => !r.resolved);
  if (unresolved.length > 0) {
    const names = unresolved.map((r) => `• ${r.displayName}: ${(r as any).error}`).join('\n');
    return {
      action: 'error',
      message: `${unresolved.length} recipient(s) could not be resolved:\n${names}\n\nCheck that names are registered on AgentPay.`,
      unresolved: unresolved.length,
    };
  }

  const resolvedPayments: ResolvedPayment[] = resolveResults.map((r) => ({
    displayName: r.displayName,
    address: r.address,
    amount: r.amount,
    remark: r.remark,
  }));

  const total = resolvedPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const totalStr = total.toFixed(6);

  // Balance check — read payer's DCW USDC balance
  try {
    const userAgent = await getOrCreateUserAgentWallet(walletAddress);
    const client = getPublicClient();
    const balanceRaw = await client.readContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(userAgent.address as `0x${string}`)],
    }) as bigint;
    const balance = parseFloat(formatUnits(balanceRaw, 6));

    if (balance < total) {
      const shortfall = (total - balance).toFixed(2);
      return {
        action: 'error',
        message: `Insufficient balance. Need ${total.toFixed(2)} USDC, agent wallet has ${balance.toFixed(2)} USDC. Top up ${shortfall} USDC first.`,
      };
    }
  } catch (err) {
    // Non-fatal: balance check failed, proceed without blocking (same as split)
    console.warn('[batch] Balance pre-check failed:', err instanceof Error ? err.message : String(err));
  }

  const confirmId = sessionId || `batch-${Date.now()}`;
  const shortId = generateShortId();
  const payload: BatchPendingPayload = {
    walletAddress,
    payments: resolvedPayments,
    total: totalStr,
    shortId,
  };

  await getRedis().set(
    `${BATCH_PENDING_PREFIX}${confirmId}`,
    JSON.stringify(payload),
    'EX',
    BATCH_TTL_SECONDS,
  );

  // Build preview message
  const lines: string[] = [
    `Batch payment preview (${payments.length} recipients, ${total.toFixed(2)} USDC total):`,
    '',
    ...resolvedPayments.map(
      (p, i) =>
        `${i + 1}. ${p.displayName} → ${p.amount} USDC${p.remark ? ` (${p.remark})` : ''}`,
    ),
    '',
    `Total: ${total.toFixed(2)} USDC across ${payments.length} recipients.`,
    `Batch ID: ${shortId}`,
    'Confirm to execute all transfers on Arc.',
  ];

  return {
    action: 'preview',
    message: lines.join('\n'),
    confirmId,
    confirmLabel: `Send ${payments.length} payments (${total.toFixed(2)} USDC)`,
    total: totalStr,
    count: payments.length,
    unresolved: 0,
    payments: resolvedPayments.map((p) => ({
      to: p.address,
      displayName: p.displayName,
      amount: p.amount,
      remark: p.remark,
      resolved: true,
    })),
  };
}

export async function executeBatch(
  confirmId: string,
  walletAddress: string,
): Promise<BatchAgentResponse> {
  const raw = await getRedis().get(`${BATCH_PENDING_PREFIX}${confirmId}`).catch(() => null);
  if (!raw) {
    return {
      action: 'error',
      message: 'Batch confirmation expired or not found. Please run the batch preview again.',
    };
  }

  let payload: BatchPendingPayload;
  try {
    payload = JSON.parse(raw) as BatchPendingPayload;
  } catch {
    return { action: 'error', message: 'Invalid batch confirmation data. Please start again.' };
  }

  if (payload.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    return { action: 'error', message: 'Wallet address mismatch.' };
  }

  // Prevent double-execution
  await getRedis().del(`${BATCH_PENDING_PREFIX}${confirmId}`).catch(() => null);

  const shortId = payload.shortId || generateShortId();
  const results: NonNullable<BatchAgentResponse['results']> = [];

  for (let i = 0; i < payload.payments.length; i++) {
    const p = payload.payments[i];
    const amountUsdc = parseFloat(p.amount);
    const remarkStr = p.remark ? `batch:${shortId} · ${p.remark}` : `batch:${shortId}`;

    try {
      const { txHash } = await executeUsdcTransfer({
        payerEoa: payload.walletAddress,
        toAddress: p.address,
        amountUsdc,
        remark: remarkStr,
        actionType: 'batch_payment',
      });
      results.push({
        to: p.displayName,
        amount: p.amount,
        remark: p.remark,
        status: 'success',
        txHash,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        to: p.displayName,
        amount: p.amount,
        remark: p.remark,
        status: 'failed',
        error: msg,
      });
    }

    // 500ms between transfers to avoid rate limits
    if (i < payload.payments.length - 1) {
      await sleep(500);
    }
  }

  const successCount = results.filter((r) => r.status === 'success').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const totalSent = results
    .filter((r) => r.status === 'success')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0);

  // Build receipt message
  const lines: string[] = [`Batch payment complete!\n`];
  lines.push(`✅ Sent: ${successCount}/${results.length}`);
  lines.push(`💰 Total: ${totalSent.toFixed(2)} USDC`);

  const successes = results.filter((r) => r.status === 'success');
  if (successes.length) {
    lines.push('\nSent:');
    for (const r of successes) {
      const hash = r.txHash ?? '';
      const short = hash.length > 12 ? `${hash.slice(0, 10)}...` : hash;
      const explorerUrl = hash ? `https://testnet.arcscan.app/tx/${hash}` : '';
      const txCell = explorerUrl
        ? `[\`${short}\`](${explorerUrl})`
        : `\`${short}\``;
      lines.push(
        `  • ${r.to}: ${r.amount} USDC${r.remark ? ` (${r.remark})` : ''} — tx: ${txCell}`,
      );
    }
  }

  if (failedCount > 0) {
    lines.push(`\n❌ Failed (${failedCount}):`);
    for (const r of results.filter((r) => r.status === 'failed')) {
      lines.push(`  • ${r.to}: ${r.error}`);
    }
  }

  // Telegram summary to payer
  try {
    const { data: user } = await adminDb
      .from('users')
      .select('telegram_id')
      .eq('wallet_address', walletAddress.toLowerCase())
      .single();

    if (user?.telegram_id) {
      const tgLines = [
        `📦 Batch Payment Complete`,
        `✅ Sent: ${successCount}/${results.length} payments`,
        `💰 Total: ${totalSent.toFixed(2)} USDC`,
      ];
      if (failedCount > 0) {
        tgLines.push(`❌ Failed: ${failedCount}`);
      }
      await sendTelegramText(user.telegram_id, tgLines.join('\n'));
    }
  } catch {
    // Non-fatal
  }

  const action = failedCount > 0 && successCount === 0 ? 'error' : 'success';

  return {
    action,
    message: lines.join('\n'),
    results,
    count: results.length,
    total: totalSent.toFixed(6),
  };
}
