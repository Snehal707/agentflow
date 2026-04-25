import { adminDb } from '../../../db/client';
import { sendTelegramText } from '../../../lib/telegram-notify';
import type { ValidationResult } from './validator';

async function resolveBusinessTelegramChatId(
  businessWallet: string,
): Promise<{ chatId: string | null; businessName?: string | null }> {
  const { data: biz } = await adminDb
    .from('businesses')
    .select('telegram_id, business_name')
    .eq('wallet_address', businessWallet)
    .maybeSingle();

  const businessChatId = String(biz?.telegram_id ?? '').trim() || null;
  if (businessChatId) {
    return {
      chatId: businessChatId,
      businessName: (biz?.business_name as string | null | undefined) ?? null,
    };
  }

  const { data: user } = await adminDb
    .from('users')
    .select('telegram_id')
    .eq('wallet_address', businessWallet)
    .maybeSingle();

  return {
    chatId: String(user?.telegram_id ?? '').trim() || null,
    businessName: (biz?.business_name as string | null | undefined) ?? null,
  };
}

/**
 * Notify business owner on Telegram after settlement, or alert when review is needed.
 */
export async function notifyInvoiceSettled(input: {
  businessWallet: string;
  amountUsdc: number;
  txHash: string;
}): Promise<void> {
  const { chatId } = await resolveBusinessTelegramChatId(input.businessWallet);
  if (!chatId) {
    return;
  }

  const base = process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';
  const link = `${base.replace(/\/+$/, '')}/${input.txHash}`;

  try {
    await sendTelegramText(
      chatId,
      [
        `Invoice payment settled: ${input.amountUsdc} USDC`,
        `Tx: ${input.txHash}`,
        `Explorer: ${link}`,
      ].join('\n'),
    );
  } catch (e) {
    console.warn('[invoice/telegram] notify settled skipped:', e);
  }
}

export async function notifyInvoiceReviewNeeded(input: {
  businessWallet: string;
  validation: ValidationResult;
  invoiceId: string;
}): Promise<void> {
  const { chatId } = await resolveBusinessTelegramChatId(input.businessWallet);
  if (!chatId) {
    return;
  }

  try {
    await sendTelegramText(
      chatId,
      [
        'Invoice requires review',
        `Invoice id: ${input.invoiceId}`,
        `Approved: ${input.validation.approved}`,
        input.validation.reason ? `Reason: ${input.validation.reason}` : '',
        input.validation.flags?.length ? `Flags: ${input.validation.flags.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } catch (e) {
    console.warn('[invoice/telegram] notify review skipped:', e);
  }
}
