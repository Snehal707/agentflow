import { adminDb } from '../../../db/client';
import { resolveHandle } from '../../../lib/handles';

function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export async function resolveInvoicePayeeWallet(input: {
  vendorEmail?: string | null;
  vendorHandle?: string | null;
}): Promise<string | null> {
  const vendorHandle = String(input.vendorHandle ?? '').trim();
  if (vendorHandle) {
    try {
      return await resolveHandle(vendorHandle);
    } catch {
      // fall through to email-based resolution
    }
  }

  const vendorEmail = normalizeEmail(input.vendorEmail);
  if (!vendorEmail) {
    return null;
  }

  const { data: business, error } = await adminDb
    .from('businesses')
    .select('wallet_address')
    .eq('invoice_email', vendorEmail)
    .maybeSingle();

  if (!error && business?.wallet_address) {
    return business.wallet_address as string;
  }

  const inboundDomain = (process.env.RESEND_INBOUND_DOMAIN?.trim() || 'invoices.agentflow.one')
    .replace(/^@+/, '')
    .toLowerCase();

  const [localPart, domainPart] = vendorEmail.split('@');
  if (!localPart || domainPart?.toLowerCase() !== inboundDomain) {
    return null;
  }

  try {
    return await resolveHandle(localPart);
  } catch {
    return null;
  }
}
