import { getAddress } from 'viem';
import { adminDb } from '../db/client';
import { executeUsdcTransfer, explorerLinkTx } from './agentpay-transfer';
import { sendTelegramText } from './telegram-notify';

export type ScheduleType = 'monthly_day' | 'weekly_day' | 'daily';

function utcYmd(d: Date): string {
  return d.toISOString().split('T')[0];
}

function lastDayOfMonthUtc(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Next occurrence strictly after `from` (used after a successful run). */
export function calculateNextRun(
  scheduleType: string,
  scheduleValue: string,
  fromDate: Date = new Date(),
): Date {
  const next = new Date(fromDate.getTime());
  next.setUTCHours(12, 0, 0, 0);

  if (scheduleType === 'daily') {
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (scheduleType === 'weekly_day') {
    const days: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const targetDay = days[scheduleValue.toLowerCase()] ?? 1;
    const currentDay = next.getUTCDay();
    let add = (targetDay - currentDay + 7) % 7;
    if (add === 0) {
      add = 7;
    }
    next.setUTCDate(next.getUTCDate() + add);
    return next;
  }

  if (scheduleType === 'monthly_day') {
    const day = Math.min(31, Math.max(1, parseInt(scheduleValue, 10) || 1));
    let y = next.getUTCFullYear();
    let m = next.getUTCMonth();
    const ld = lastDayOfMonthUtc(y, m);
    const dom = Math.min(day, ld);
    if (next.getUTCDate() < dom) {
      next.setUTCDate(dom);
      return next;
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    const ld2 = lastDayOfMonthUtc(y, m);
    next.setUTCFullYear(y, m, Math.min(day, ld2));
    return next;
  }

  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** First scheduled run from creation time (next calendar occurrence). */
export function calculateFirstNextRun(
  scheduleType: string,
  scheduleValue: string,
  fromDate: Date = new Date(),
): Date {
  const now = new Date(fromDate.getTime());
  now.setUTCHours(12, 0, 0, 0);

  if (scheduleType === 'daily') {
    const n = new Date(now.getTime());
    n.setUTCDate(n.getUTCDate() + 1);
    return n;
  }

  if (scheduleType === 'weekly_day') {
    const days: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const targetDay = days[scheduleValue.toLowerCase()] ?? 1;
    const currentDay = now.getUTCDay();
    let add = (targetDay - currentDay + 7) % 7;
    if (add === 0) {
      add = 7;
    }
    const n = new Date(now.getTime());
    n.setUTCDate(n.getUTCDate() + add);
    return n;
  }

  if (scheduleType === 'monthly_day') {
    const day = Math.min(31, Math.max(1, parseInt(scheduleValue, 10) || 1));
    let y = now.getUTCFullYear();
    let m = now.getUTCMonth();
    const ld = lastDayOfMonthUtc(y, m);
    const dom = Math.min(day, ld);
    const candidateThis = new Date(Date.UTC(y, m, dom));
    const todayStr = utcYmd(now);
    if (utcYmd(candidateThis) >= todayStr) {
      return candidateThis;
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    const ld2 = lastDayOfMonthUtc(y, m);
    return new Date(Date.UTC(y, m, Math.min(day, ld2)));
  }

  const n = new Date(now.getTime());
  n.setUTCDate(n.getUTCDate() + 1);
  return n;
}

export function parseSchedulePhrase(schedule: string): { scheduleType: ScheduleType; scheduleValue: string } | null {
  const s = schedule
    .trim()
    .toLowerCase()
    .replace(/[.,;!?]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!s) {
    return null;
  }

  if (/\b(every\s*day|daily|each\s+day|once\s+a\s+day|once\s+daily)\b/.test(s) || s === 'daily') {
    return { scheduleType: 'daily', scheduleValue: 'daily' };
  }

  const weekDays = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ] as const;
  const shortDays: Record<string, typeof weekDays[number]> = {
    sun: 'sunday',
    mon: 'monday',
    tue: 'tuesday',
    tues: 'tuesday',
    wed: 'wednesday',
    thu: 'thursday',
    thur: 'thursday',
    thurs: 'thursday',
    fri: 'friday',
    sat: 'saturday',
  };
  for (const wd of weekDays) {
    if (
      new RegExp(`\\b${wd}s?\\b`).test(s) ||
      new RegExp(`(?:every|each|on)\\s+${wd}s?`).test(s)
    ) {
      return { scheduleType: 'weekly_day', scheduleValue: wd };
    }
  }
  for (const [short, full] of Object.entries(shortDays)) {
    if (
      new RegExp(`\\b${short}s?\\b`).test(s) ||
      new RegExp(`(?:every|each|on)\\s+${short}s?\\b`).test(s)
    ) {
      return { scheduleType: 'weekly_day', scheduleValue: full };
    }
  }

  if (/\b(weekly(?:\s+(?:payment|transfer|send))?|every\s+week|each\s+week|once\s+a\s+week|per\s+week)\b/.test(s)) {
    return { scheduleType: 'weekly_day', scheduleValue: 'monday' };
  }

  if (/\b(monthly(?:\s+(?:payment|transfer|send))?|every\s+month|each\s+month|once\s+a\s+month|per\s+month)\b/.test(s)) {
    return { scheduleType: 'monthly_day', scheduleValue: '1' };
  }

  let m = s.match(/\b(?:every\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:the\s+)?month\b/);
  if (m) {
    return { scheduleType: 'monthly_day', scheduleValue: String(parseInt(m[1], 10)) };
  }
  m = s.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\s+(?:of\s+)?(?:every\s+)?month\b/);
  if (m) {
    return { scheduleType: 'monthly_day', scheduleValue: String(parseInt(m[1], 10)) };
  }
  m = s.match(/\b(?:every\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (m) {
    return { scheduleType: 'monthly_day', scheduleValue: String(parseInt(m[1], 10)) };
  }
  m = s.match(/\b(?:1st|2nd|first)\s+of\s+(?:the\s+|every\s+)?month\b/);
  if (m) {
    return { scheduleType: 'monthly_day', scheduleValue: '1' };
  }

  // Broad fallbacks so natural phrasing like "every 2 weeks", "per month", etc
  // still resolves to a deterministic cadence instead of hard-failing preview.
  if (/\bday(s)?\b/.test(s)) {
    return { scheduleType: 'daily', scheduleValue: 'daily' };
  }
  if (/\bweek(s)?\b/.test(s)) {
    return { scheduleType: 'weekly_day', scheduleValue: 'monday' };
  }
  if (/\bmonth(s)?\b/.test(s)) {
    return { scheduleType: 'monthly_day', scheduleValue: '1' };
  }

  return null;
}

export async function createScheduledPayment(params: {
  walletAddress: string;
  to: string;
  resolvedAddress: string;
  amount: string;
  remark?: string | null;
  scheduleType: ScheduleType;
  scheduleValue: string;
}) {
  const nextRun = calculateFirstNextRun(params.scheduleType, params.scheduleValue);
  const nextRunStr = utcYmd(nextRun);

  const { data, error } = await adminDb
    .from('scheduled_payments')
    .insert({
      wallet_address: getAddress(params.walletAddress),
      to_address: getAddress(params.resolvedAddress),
      to_name: params.to,
      amount: parseFloat(params.amount),
      remark: params.remark ? String(params.remark).slice(0, 500) : null,
      schedule_type: params.scheduleType,
      schedule_value: params.scheduleValue,
      next_run: nextRunStr,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export async function getScheduledPayments(walletAddress: string) {
  const w = getAddress(walletAddress);
  const { data, error } = await adminDb
    .from('scheduled_payments')
    .select('*')
    .eq('wallet_address', w)
    .eq('status', 'active')
    .order('next_run', { ascending: true });

  if (error) {
    throw error;
  }
  return data ?? [];
}

export async function cancelScheduledPayment(id: string, walletAddress: string) {
  const w = getAddress(walletAddress);
  const { data, error } = await adminDb
    .from('scheduled_payments')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('wallet_address', w)
    .eq('status', 'active')
    .select('id,status')
    .limit(1);
  console.log('[cancel] supabase result:', error);

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Scheduled payment not found or already cancelled');
  }

  return true;
}

export async function processDuePayments(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  const { data: duePayments, error } = await adminDb
    .from('scheduled_payments')
    .select('*')
    .eq('status', 'active')
    .lte('next_run', today);

  if (error) {
    console.error('[scheduled-payments] query failed:', error.message);
    return;
  }

  if (!duePayments?.length) {
    console.log('[scheduled-payments] no payments due today');
    return;
  }

  console.log(`[scheduled-payments] processing ${duePayments.length} payment(s)`);

  for (const payment of duePayments as Array<{
    id: string;
    wallet_address: string;
    to_address: string;
    to_name: string | null;
    amount: number | string;
    remark: string | null;
    schedule_type: string;
    schedule_value: string;
    execution_count: number | null;
  }>) {
    try {
      const payerEoa = getAddress(String(payment.wallet_address));
      const toAddr = getAddress(String(payment.to_address));
      const amountNum = Number(payment.amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error('Invalid amount');
      }

      const { txHash } = await executeUsdcTransfer({
        payerEoa,
        toAddress: toAddr,
        amountUsdc: amountNum,
        remark: payment.remark ? String(payment.remark).slice(0, 500) : null,
        actionType: 'scheduled_payment',
      });

      const after = new Date();
      const nextRun = calculateNextRun(
        payment.schedule_type,
        payment.schedule_value,
        after,
      );
      const nextRunStr = utcYmd(nextRun);
      const execCount = (payment.execution_count ?? 0) + 1;

      await adminDb
        .from('scheduled_payments')
        .update({
          last_run: today,
          next_run: nextRunStr,
          execution_count: execCount,
        })
        .eq('id', payment.id);

      const { data: userRow } = await adminDb
        .from('users')
        .select('telegram_id')
        .eq('wallet_address', payerEoa)
        .maybeSingle();

      const chatId = String(userRow?.telegram_id ?? '').trim();
      if (chatId) {
        const toLabel =
          payment.to_name?.trim() ||
          `${String(payment.to_address).slice(0, 6)}...${String(payment.to_address).slice(-4)}`;
        const link = explorerLinkTx(txHash);
        try {
          await sendTelegramText(
            chatId,
            [
              'Scheduled payment executed',
              '',
              `Sent: ${amountNum} USDC`,
              `To: ${toLabel}`,
              `Remark: ${payment.remark || 'none'}`,
              `Tx: ${txHash.slice(0, 10)}...`,
              `Next run: ${nextRunStr}`,
              '',
              `View: ${link}`,
            ].join('\n'),
          );
        } catch (tgErr) {
          console.warn('[scheduled-payments] telegram send failed:', tgErr);
        }
      }

      console.log(`[scheduled-payments] paid ${amountNum} USDC to ${payment.to_address}`);
    } catch (e) {
      console.error('[scheduled-payments] failed for', payment.id, e);
      await adminDb
        .from('scheduled_payments')
        .update({
          last_run: today,
          status: 'failed',
        })
        .eq('id', payment.id);
    }
  }
}
