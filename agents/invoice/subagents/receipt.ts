import { Resend } from 'resend';
import { adminDb } from '../../../db/client';

const DEFAULT_FROM = 'noreply@invoices.agentflow.one';

function explorerLink(txHash: string): string {
  const base = process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';
  return `${base.replace(/\/+$/, '')}/${txHash.replace(/^\/+/, '')}`;
}

export async function sendInvoiceReceiptEmail(input: {
  businessWallet: string;
  amountUsdc: number;
  txHash: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_INVOICE_FROM?.trim() || DEFAULT_FROM;
  if (!apiKey) {
    throw new Error('[invoice/receipt] RESEND_API_KEY is required');
  }

  const { data: biz } = await adminDb
    .from('businesses')
    .select('invoice_email, business_name')
    .eq('wallet_address', input.businessWallet)
    .maybeSingle();

  const to = biz?.invoice_email as string | undefined;
  if (!to?.trim()) {
    console.warn('[invoice/receipt] No invoice_email for business; skip email');
    return;
  }

  const resend = new Resend(apiKey);
  const link = explorerLink(input.txHash);
  const name = (biz?.business_name as string) || 'Business';

  const { error } = await resend.emails.send({
    from,
    to: to.trim(),
    subject: `Payment received — ${input.amountUsdc} USDC`,
    html: `
      <p>Hi ${name},</p>
      <p>We settled an invoice payment on Arc.</p>
      <ul>
        <li><strong>Amount:</strong> ${input.amountUsdc} USDC</li>
        <li><strong>Transaction:</strong> <a href="${link}">${input.txHash}</a></li>
      </ul>
      <p>— AgentFlow Invoice</p>
    `,
  });

  if (error) {
    throw new Error(`[invoice/receipt] Resend failed: ${JSON.stringify(error)}`);
  }
}
