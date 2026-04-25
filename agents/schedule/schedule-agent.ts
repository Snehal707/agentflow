import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../../db/client';
import { callHermesFast } from '../../lib/hermes';
import {
  getScheduledPayments,
  createScheduledPayment,
  cancelScheduledPayment,
  parseSchedulePhrase,
  calculateFirstNextRun,
} from '../../lib/scheduled-payments';
import { resolvePayee } from '../../lib/agentpay-payee';

const SCHEDULE_CONFIRM_PREFIX = 'schedule:confirm:';
const CONFIRM_TTL_SECONDS = 600; // 10 minutes

export interface ScheduleAgentResponse {
  action: 'preview' | 'cancel_confirm' | 'list' | 'disambiguate' | 'success' | 'error';
  message: string;
  payments?: Array<Record<string, unknown>>;
  confirmId?: string;
  confirmLabel?: string;
  choices?: Array<{ id: string; label: string; confirmId: string }>;
}

type PendingConfirmPayload =
  | {
      type: 'create';
      walletAddress: string;
      to: string;
      resolvedAddress: string;
      amount: string;
      scheduleType: string;
      scheduleValue: string;
      remark?: string;
    }
  | {
      type: 'cancel';
      walletAddress: string;
      id: string;
    };

interface ParsedIntent {
  intent: 'create' | 'cancel' | 'list' | 'preview' | 'unknown';
  recipient?: string | null;
  amount?: string | null;
  schedule?: string | null;
  remark?: string | null;
  paymentId?: string | null;
}

const INTENT_SYSTEM_PROMPT = `You are a scheduling intent parser for a USDC payment automation system.
Parse the user's scheduling request and return ONLY valid JSON with no markdown or explanation.
Return this shape:
{
  "intent": "create|cancel|list|preview",
  "recipient": "name or address or null",
  "amount": "number as string or null",
  "schedule": "natural language schedule or null",
  "remark": "string or null",
  "paymentId": "uuid or short id fragment if mentioned or null"
}
For intent:
- "create": user wants to set up a new recurring payment
- "cancel": user wants to stop/delete/remove a scheduled payment
- "list": user wants to see their scheduled payments
- "preview": same as create but user is just asking to see what it would look like
Examples:
- "pay jack.arc 5 USDC every monday" → intent=create, recipient=jack.arc, amount=5, schedule=every monday
- "pay vendor 10 USDC every monday" → intent=create, recipient=vendor, amount=10, schedule=every monday
- "Create a weekly schedule to send 10 USDC to vendor every monday" → intent=create, recipient=vendor, amount=10, schedule=every monday
- "cancel my weekly payment to alice.arc" → intent=cancel, recipient=alice.arc, schedule=weekly
- "show my scheduled payments" → intent=list
- "cancel payment 0509a92a" → intent=cancel, paymentId=0509a92a
Return ONLY the JSON object.`;

export async function parseScheduleTask(
  task: string,
  _walletAddress: string,
): Promise<ParsedIntent> {
  try {
    const raw = await callHermesFast(INTENT_SYSTEM_PROMPT, task);
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned) as ParsedIntent;
    if (!parsed.intent) {
      return { intent: 'unknown' };
    }
    return parsed;
  } catch {
    // Fallback: simple keyword-based parsing
    const lower = task.toLowerCase();
    if (/\b(cancel|remove|stop|delete)\b/.test(lower)) {
      const uuidMatch = task.match(
        /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{6,})\b/i,
      );
      return {
        intent: 'cancel',
        paymentId: uuidMatch?.[1] ?? null,
        recipient: extractRecipientFallback(task),
      };
    }
    if (/\b(list|show|view|check|my scheduled)\b/.test(lower)) {
      return { intent: 'list' };
    }
    return {
      intent: 'create',
      recipient: extractRecipientFallback(task),
      amount: extractAmountFallback(task),
      schedule: extractScheduleFallback(task),
    };
  }
}

/** Prefer last `to <recipient>` match so "… to send 10 USDC to vendor …" resolves to vendor, not send. */
function extractRecipientFallback(task: string): string | null {
  const re =
    /\bto\s+(0x[a-fA-F0-9]{40}|[^\s,]+\.arc|[a-z0-9][a-z0-9_-]{0,63})\b/gi;
  let last: string | null = null;
  for (const m of task.matchAll(re)) {
    last = m[1];
  }
  return last;
}

function extractAmountFallback(task: string): string | null {
  const match = task.match(/\b(\d+(?:\.\d+)?)\s*(?:USDC|usdc)?\b/);
  return match?.[1] ?? null;
}

function extractScheduleFallback(task: string): string | null {
  const match = task.match(
    /\b(daily|weekly|monthly|every\s+\w+|each\s+\w+|once\s+a\s+\w+|per\s+\w+)\b/i,
  );
  return match?.[1] ?? null;
}

function formatScheduleLabel(scheduleType: string, scheduleValue: string): string {
  if (scheduleType === 'daily') return 'Daily';
  if (scheduleType === 'weekly_day') {
    const day = scheduleValue.charAt(0).toUpperCase() + scheduleValue.slice(1);
    return `Every ${day}`;
  }
  if (scheduleType === 'monthly_day') {
    const day = parseInt(scheduleValue, 10);
    const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
    return `Monthly on the ${day}${suffix}`;
  }
  return `${scheduleType} / ${scheduleValue}`;
}

function formatPaymentLabel(row: Record<string, unknown>): string {
  const to = (row.to_name as string) || ((row.to_address as string) ?? 'unknown');
  const amount = row.amount ?? '?';
  const schedType = String(row.schedule_type ?? '');
  const schedVal = String(row.schedule_value ?? '');
  const sched = formatScheduleLabel(schedType, schedVal);
  return `${amount} USDC → ${to} (${sched})`;
}

async function storeConfirm(payload: PendingConfirmPayload): Promise<string> {
  const confirmId = uuidv4();
  await getRedis().set(
    `${SCHEDULE_CONFIRM_PREFIX}${confirmId}`,
    JSON.stringify(payload),
    'EX',
    CONFIRM_TTL_SECONDS,
  );
  return confirmId;
}

async function loadConfirm(confirmId: string): Promise<PendingConfirmPayload | null> {
  const raw = await getRedis().get(`${SCHEDULE_CONFIRM_PREFIX}${confirmId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingConfirmPayload;
  } catch {
    return null;
  }
}

async function clearConfirm(confirmId: string): Promise<void> {
  await getRedis().del(`${SCHEDULE_CONFIRM_PREFIX}${confirmId}`);
}

export async function handleCreateIntent(
  intent: ParsedIntent,
  walletAddress: string,
): Promise<ScheduleAgentResponse> {
  const recipient = intent.recipient?.trim();
  const amount = intent.amount?.trim();
  const schedule = intent.schedule?.trim();

  if (!recipient) {
    return { action: 'error', message: 'Recipient is required. Who should I send USDC to?' };
  }
  if (!amount || Number.isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return { action: 'error', message: 'Amount is required. How much USDC should be sent?' };
  }
  if (!schedule) {
    return {
      action: 'error',
      message:
        'Schedule is required. When should this run? (e.g., "every monday", "daily", "monthly")',
    };
  }

  const parsed = parseSchedulePhrase(schedule);
  if (!parsed) {
    return {
      action: 'error',
      message: `Could not parse schedule phrase: "${schedule}". Try: "every monday", "daily", "monthly", "every 1st".`,
    };
  }

  let resolvedAddress: string;
  try {
    resolvedAddress = await resolvePayee(recipient, walletAddress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { action: 'error', message: `Could not resolve recipient: ${msg}` };
  }

  const nextRun = calculateFirstNextRun(parsed.scheduleType, parsed.scheduleValue);
  const nextRunStr = nextRun.toISOString().split('T')[0];
  const schedLabel = formatScheduleLabel(parsed.scheduleType, parsed.scheduleValue);

  const confirmId = await storeConfirm({
    type: 'create',
    walletAddress,
    to: recipient,
    resolvedAddress,
    amount,
    scheduleType: parsed.scheduleType,
    scheduleValue: parsed.scheduleValue,
    remark: intent.remark || undefined,
  });

  const lines = [
    'Scheduled payment preview:',
    `- Recipient: ${recipient}`,
    `- Amount: ${amount} USDC`,
    `- Schedule: ${schedLabel}`,
    `- First run: ${nextRunStr}`,
    intent.remark ? `- Remark: ${intent.remark}` : null,
    '',
    'Confirm to create this recurring payment.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    action: 'preview',
    message: lines,
    confirmId,
    confirmLabel: 'Confirm schedule',
  };
}

export async function handleCancelIntent(
  intent: ParsedIntent,
  walletAddress: string,
): Promise<ScheduleAgentResponse> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = (await getScheduledPayments(walletAddress)) as Array<Record<string, unknown>>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { action: 'error', message: `Could not load scheduled payments: ${msg}` };
  }

  if (rows.length === 0) {
    return { action: 'error', message: 'You have no active scheduled payments to cancel.' };
  }

  // If a specific payment ID is provided, look it up directly
  if (intent.paymentId) {
    const pid = intent.paymentId.trim().toLowerCase();
    const found = rows.find(
      (r) =>
        String(r.id ?? '')
          .toLowerCase()
          .startsWith(pid) ||
        String(r.id ?? '').toLowerCase() === pid,
    );
    if (!found) {
      return {
        action: 'error',
        message: `No active scheduled payment found with ID starting with "${intent.paymentId}". Say "show my scheduled payments" to see the full list.`,
      };
    }
    const confirmId = await storeConfirm({
      type: 'cancel',
      walletAddress,
      id: String(found.id),
    });
    const label = formatPaymentLabel(found);
    return {
      action: 'cancel_confirm',
      message: [
        'Found the scheduled payment to cancel:',
        `- ID: ${found.id}`,
        `- ${label}`,
        '',
        'Confirm to cancel this payment.',
      ].join('\n'),
      confirmId,
      confirmLabel: 'Cancel payment',
    };
  }

  // Filter by recipient / amount / schedule / remark
  const matches = rows.filter((row) => {
    let score = 0;
    if (intent.recipient) {
      const r = intent.recipient.toLowerCase().replace(/\.arc$/i, '');
      const toName = String(row.to_name ?? '').toLowerCase().replace(/\.arc$/i, '');
      const toAddr = String(row.to_address ?? '').toLowerCase();
      if (toName.includes(r) || toAddr.includes(r) || r.includes(toName)) {
        score += 3;
      }
    }
    if (intent.amount) {
      const a = parseFloat(intent.amount);
      const ra = parseFloat(String(row.amount ?? ''));
      if (Number.isFinite(a) && Math.abs(a - ra) < 0.001) {
        score += 2;
      }
    }
    if (intent.schedule) {
      const sched = (intent.schedule || '').toLowerCase();
      const schedType = String(row.schedule_type ?? '').toLowerCase();
      const schedVal = String(row.schedule_value ?? '').toLowerCase();
      if (sched.includes(schedType) || sched.includes(schedVal) || schedType.includes(sched)) {
        score += 1;
      }
    }
    if (intent.remark) {
      const remark = (intent.remark || '').toLowerCase();
      const rowRemark = String(row.remark ?? '').toLowerCase();
      if (rowRemark.includes(remark) || remark.includes(rowRemark)) {
        score += 1;
      }
    }
    // If any filter was provided, require at least 1 point
    const anyFilter = intent.recipient || intent.amount || intent.schedule || intent.remark;
    return anyFilter ? score > 0 : true;
  });

  if (matches.length === 0) {
    return {
      action: 'error',
      message: [
        'No matching scheduled payments found.',
        intent.recipient ? `Recipient filter: ${intent.recipient}` : null,
        intent.schedule ? `Schedule filter: ${intent.schedule}` : null,
        '',
        'Say "show my scheduled payments" to see all active payments.',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  if (matches.length === 1) {
    const found = matches[0];
    const confirmId = await storeConfirm({
      type: 'cancel',
      walletAddress,
      id: String(found.id),
    });
    const label = formatPaymentLabel(found);
    return {
      action: 'cancel_confirm',
      message: [
        'Found the scheduled payment to cancel:',
        `- ID: ${String(found.id).slice(0, 8)}...`,
        `- ${label}`,
        '',
        'Confirm to cancel this payment.',
      ].join('\n'),
      confirmId,
      confirmLabel: 'Cancel payment',
    };
  }

  // Multiple matches — build a choice per match
  const choices: ScheduleAgentResponse['choices'] = [];
  const lines: string[] = ['Multiple matching payments found. Choose one to cancel:'];
  for (let i = 0; i < matches.length; i++) {
    const row = matches[i];
    const label = formatPaymentLabel(row);
    const choiceConfirmId = await storeConfirm({
      type: 'cancel',
      walletAddress,
      id: String(row.id),
    });
    lines.push(`${i + 1}. ${label} (ID: ${String(row.id).slice(0, 8)}...)`);
    choices.push({ id: String(row.id), label, confirmId: choiceConfirmId });
  }

  return {
    action: 'disambiguate',
    message: lines.join('\n'),
    choices,
  };
}

export async function handleListIntent(
  walletAddress: string,
): Promise<ScheduleAgentResponse> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = (await getScheduledPayments(walletAddress)) as Array<Record<string, unknown>>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { action: 'error', message: `Could not load scheduled payments: ${msg}` };
  }

  if (rows.length === 0) {
    return {
      action: 'list',
      message:
        'You have no active scheduled payments. Say "pay alice.arc 10 USDC every monday" to create one.',
      payments: [],
    };
  }

  const lines = rows.map((row, i) => {
    const label = formatPaymentLabel(row);
    const nextRun = row.next_run ? ` | next: ${row.next_run}` : '';
    return `${i + 1}. ${label}${nextRun}`;
  });

  return {
    action: 'list',
    message: `Active scheduled payments:\n\n${lines.join('\n')}`,
    payments: rows,
  };
}

export async function handleScheduleTask(
  task: string,
  walletAddress: string,
): Promise<ScheduleAgentResponse> {
  const intent = await parseScheduleTask(task, walletAddress);

  switch (intent.intent) {
    case 'list':
      return handleListIntent(walletAddress);
    case 'cancel':
      return handleCancelIntent(intent, walletAddress);
    case 'create':
    case 'preview':
      return handleCreateIntent(intent, walletAddress);
    default:
      return {
        action: 'error',
        message:
          'I could not understand that scheduling request. Try: "pay alice.arc 10 USDC every monday", "cancel my jack.arc payment", or "show my scheduled payments".',
      };
  }
}

export async function handleScheduleConfirm(
  confirmId: string,
  walletAddress: string,
): Promise<{ success: boolean; message: string }> {
  const payload = await loadConfirm(confirmId);

  if (!payload) {
    return {
      success: false,
      message: 'Confirmation expired or not found. Please start the schedule request again.',
    };
  }

  if (payload.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    return { success: false, message: 'Wallet address mismatch.' };
  }

  try {
    if (payload.type === 'create') {
      const result = await createScheduledPayment({
        walletAddress: payload.walletAddress,
        to: payload.to,
        resolvedAddress: payload.resolvedAddress,
        amount: payload.amount,
        remark: payload.remark,
        scheduleType: payload.scheduleType as 'daily' | 'weekly_day' | 'monthly_day',
        scheduleValue: payload.scheduleValue,
      });
      await clearConfirm(confirmId);
      const schedLabel = formatScheduleLabel(payload.scheduleType, payload.scheduleValue);
      const nextRun = result?.next_run ?? 'soon';
      return {
        success: true,
        message: [
          'Scheduled payment created.',
          '',
          `Recipient: ${payload.to}`,
          `Amount: ${payload.amount} USDC`,
          `Schedule: ${schedLabel}`,
          `First run: ${nextRun}`,
          `ID: ${result?.id ?? 'saved'}`,
        ].join('\n'),
      };
    }

    if (payload.type === 'cancel') {
      await cancelScheduledPayment(payload.id, payload.walletAddress);
      await clearConfirm(confirmId);
      return {
        success: true,
        message: `Scheduled payment ${payload.id.slice(0, 8)}... has been cancelled.`,
      };
    }

    return { success: false, message: 'Unknown confirmation type.' };
  } catch (err) {
    await clearConfirm(confirmId);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Operation failed: ${msg}` };
  }
}
