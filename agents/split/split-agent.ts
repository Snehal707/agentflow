import { getRedis } from '../../db/client';
import { resolvePayee } from '../../lib/agentpay-payee';
import { executeUsdcTransfer } from '../../lib/agentpay-transfer';

const SPLIT_PENDING_PREFIX = 'split:pending:';
const SPLIT_TTL_SECONDS = 300;

export interface SplitAgentResponse {
  action: 'preview' | 'success' | 'error';
  message: string;
  confirmId?: string;
  confirmLabel?: string;
  results?: Array<{
    recipient: string;
    amount: string;
    status: 'success' | 'failed';
    txHash?: string;
    error?: string;
  }>;
}

interface ResolvedRecipient {
  name: string;
  address: string;
}

interface SplitPendingPayload {
  walletAddress: string;
  recipients: ResolvedRecipient[];
  perPerson: string;
  remark?: string;
}

/**
 * Preview a split payment: resolve all recipients and store pending state in Redis.
 */
export async function previewSplit(params: {
  sessionId: string;
  walletAddress: string;
  recipients: string[];
  totalAmount: string;
  remark?: string;
}): Promise<SplitAgentResponse> {
  const { sessionId, walletAddress, recipients, totalAmount, remark } = params;

  // Validate recipient count
  if (recipients.length < 2) {
    return { action: 'error', message: 'Need at least 2 recipients for a split payment.' };
  }
  if (recipients.length > 10) {
    return { action: 'error', message: 'Maximum 10 recipients per split payment.' };
  }

  // Validate amount
  const total = parseFloat(totalAmount);
  if (!Number.isFinite(total) || total <= 0) {
    return { action: 'error', message: `Invalid total amount: "${totalAmount}". Must be a positive number.` };
  }

  const count = recipients.length;
  const perPerson = Math.round((total / count) * 1_000_000) / 1_000_000;

  // Resolve all recipients
  const resolved: ResolvedRecipient[] = [];
  const errors: string[] = [];

  await Promise.all(
    recipients.map(async (name) => {
      try {
        const address = await resolvePayee(name.trim(), walletAddress);
        resolved.push({ name: name.trim(), address });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${name.trim()}: ${msg}`);
      }
    }),
  );

  if (errors.length > 0) {
    return {
      action: 'error',
      message: `Could not resolve the following recipients:\n${errors.map((e) => `- ${e}`).join('\n')}\n\nCheck that the names are registered on AgentPay.`,
    };
  }

  // Store pending payload in Redis
  const confirmId = sessionId || `split-${Date.now()}`;
  const payload: SplitPendingPayload = {
    walletAddress,
    recipients: resolved,
    perPerson: perPerson.toFixed(6),
    remark,
  };

  await getRedis().set(
    `${SPLIT_PENDING_PREFIX}${confirmId}`,
    JSON.stringify(payload),
    'EX',
    SPLIT_TTL_SECONDS,
  );

  // Build preview message
  const lines = [
    `Split payment preview — ${perPerson} USDC each (${total} USDC total):`,
    '',
    ...resolved.map((r, i) => `${i + 1}. ${r.name} → ${r.address.slice(0, 6)}...${r.address.slice(-4)}`),
    '',
    remark ? `Remark: ${remark}` : null,
    'Confirm to send all transfers on Arc.',
  ].filter((l): l is string => l !== null);

  return {
    action: 'preview',
    message: lines.join('\n'),
    confirmId,
    confirmLabel: `Confirm split (${count} × ${perPerson} USDC)`,
  };
}

/**
 * Execute a previously previewed split payment.
 */
export async function executeSplit(
  confirmId: string,
  walletAddress: string,
): Promise<SplitAgentResponse> {
  // Load pending payload from Redis
  const raw = await getRedis().get(`${SPLIT_PENDING_PREFIX}${confirmId}`).catch(() => null);
  if (!raw) {
    return {
      action: 'error',
      message: 'Split confirmation expired or not found. Please start the split request again.',
    };
  }

  let payload: SplitPendingPayload;
  try {
    payload = JSON.parse(raw) as SplitPendingPayload;
  } catch {
    return { action: 'error', message: 'Invalid split confirmation data. Please start again.' };
  }

  if (payload.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    return { action: 'error', message: 'Wallet address mismatch.' };
  }

  const perPerson = parseFloat(payload.perPerson);
  if (!Number.isFinite(perPerson) || perPerson <= 0) {
    return { action: 'error', message: 'Invalid per-person amount in pending payload.' };
  }

  // Clear Redis key immediately to prevent double-execution
  await getRedis().del(`${SPLIT_PENDING_PREFIX}${confirmId}`).catch(() => null);

  // Execute transfers — partial failures do not abort the loop
  const results: NonNullable<SplitAgentResponse['results']> = [];

  for (const recipient of payload.recipients) {
    try {
      const { txHash } = await executeUsdcTransfer({
        payerEoa: payload.walletAddress,
        toAddress: recipient.address,
        amountUsdc: perPerson,
        remark: payload.remark || null,
        actionType: 'split_payment',
      });
      results.push({
        recipient: recipient.name,
        amount: payload.perPerson,
        status: 'success',
        txHash,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        recipient: recipient.name,
        amount: payload.perPerson,
        status: 'failed',
        error: msg,
      });
    }
  }

  const successCount = results.filter((r) => r.status === 'success').length;
  const failCount = results.filter((r) => r.status === 'failed').length;

  // Build receipt message
  const lines: string[] = ['Split complete!\n'];

  const successes = results.filter((r) => r.status === 'success');
  if (successes.length) {
    lines.push(`Sent (${successes.length}):`);
    for (const r of successes) {
      const hash = r.txHash ?? '';
      const short = hash.length > 12 ? `${hash.slice(0, 10)}...` : hash;
      lines.push(`- ${r.recipient}: ${r.amount} USDC | tx: ${short}`);
    }
  }

  const failures = results.filter((r) => r.status === 'failed');
  if (failures.length) {
    lines.push(`\nFailed (${failures.length}):`);
    for (const r of failures) {
      lines.push(`- ${r.recipient}: ${r.error}`);
    }
  }

  const action = failCount > 0 && successCount === 0 ? 'error' : 'success';

  return {
    action,
    message: lines.join('\n'),
    results,
  };
}
