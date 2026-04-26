import dotenv from 'dotenv';
import { adminDb } from '../db/client';
import { buildInvoiceDigestPdf } from '../lib/digest-pdf';
import { sendDigestEmail } from '../lib/resend-digest';
import { sendTelegramPdf } from '../lib/telegram-notify';

dotenv.config();

function previousMonthRangeUtc(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const firstThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = firstThisMonth;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start, end, label };
}

/**
 * Monthly digest for businesses: PDF via Telegram + Resend email.
 */
export async function runMonthlyDigest(): Promise<void> {
  const { start, end, label } = previousMonthRangeUtc();

  const { data: businesses, error } = await adminDb
    .from('businesses')
    .select('wallet_address, business_name, invoice_email, telegram_id')
    .not('telegram_id', 'is', null);

  if (error) {
    throw new Error(`[monthly-digest] businesses query: ${error.message}`);
  }

  for (const b of businesses ?? []) {
    const wallet = b.wallet_address as string;
    const telegramId = (b.telegram_id as string | null)?.trim();
    if (!telegramId) {
      continue;
    }

    const { data: invoices, error: invErr } = await adminDb
      .from('invoices')
      .select('invoice_number, vendor_email, amount, currency, settled_at, status')
      .eq('business_wallet', wallet)
      .gte('settled_at', start.toISOString())
      .lt('settled_at', end.toISOString());

    if (invErr) {
      console.warn(`[monthly-digest] invoices for ${wallet}:`, invErr.message);
      continue;
    }

    const rows = (invoices ?? []).filter((inv) => {
      const st = (inv.status as string | null)?.toLowerCase();
      return st === 'settled' || st === 'paid';
    });

    if (rows.length === 0) {
      continue;
    }

    const pdf = await buildInvoiceDigestPdf({
      businessName: (b.business_name as string) ?? wallet,
      monthLabel: label,
      invoices: rows.map((r) => ({
        invoice_number: r.invoice_number as string | null,
        vendor_email: r.vendor_email as string | null,
        amount: Number(r.amount),
        currency: r.currency as string | null,
        settled_at: r.settled_at as string | null,
      })),
    });

    try {
      await sendTelegramPdf(
        telegramId,
        pdf,
        `invoice-digest-${label}.pdf`,
        `Monthly invoice digest (${label})`,
      );
    } catch (e) {
      console.warn('[monthly-digest] telegram:', e);
    }

    const email = (b.invoice_email as string | null)?.trim();
    if (email) {
      try {
        await sendDigestEmail({
          to: email,
          subject: `Invoice digest ${label} — ${b.business_name}`,
          html: `<p>Attached: settled invoices summary for ${label}.</p>`,
          pdf,
          pdfFilename: `invoice-digest-${label}.pdf`,
        });
      } catch (e) {
        console.warn('[monthly-digest] resend:', e);
      }
    }
  }
}

async function main(): Promise<void> {
  await runMonthlyDigest();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[monthly-digest] failed:', err);
    process.exit(1);
  });
}
