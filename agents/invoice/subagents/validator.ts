import { adminDb } from '../../../db/client';
import type { NormalizedInvoice } from '../../../lib/invoice-types';

export interface ValidationResult {
  approved: boolean;
  reason?: string;
  flags?: string[];
}

export async function validateInvoiceForBusiness(input: {
  businessWallet: string;
  invoice: NormalizedInvoice;
}): Promise<ValidationResult> {
  const { data: biz, error } = await adminDb
    .from('businesses')
    .select(
      'trusted_vendors, blocked_vendors, auto_settle_below, require_approval_above, daily_settlement_cap',
    )
    .eq('wallet_address', input.businessWallet)
    .maybeSingle();

  if (error) {
    return { approved: false, reason: `business lookup failed: ${error.message}` };
  }
  if (!biz) {
    return { approved: false, reason: 'Business not registered' };
  }

  const flags: string[] = [];
  const vendorLower = input.invoice.vendor.toLowerCase();
  const emailLower = input.invoice.vendorEmail.toLowerCase();

  const blocked = (biz.blocked_vendors as string[] | null) ?? [];
  for (const b of blocked) {
    if (b && (vendorLower.includes(b.toLowerCase()) || emailLower.includes(b.toLowerCase()))) {
      return { approved: false, reason: 'Vendor is blocked for this business' };
    }
  }

  const trusted = (biz.trusted_vendors as string[] | null) ?? [];
  const isTrusted = trusted.some(
    (t) =>
      t &&
      (vendorLower.includes(t.toLowerCase()) || emailLower.includes(t.toLowerCase())),
  );

  const amount = input.invoice.amount;
  const requireAbove = Number(biz.require_approval_above ?? 500);
  const autoBelow = Number(biz.auto_settle_below ?? 100);
  const dailyCap = Number(biz.daily_settlement_cap ?? 1000);

  if (amount > requireAbove && !isTrusted) {
    return {
      approved: false,
      reason: `Amount ${amount} exceeds approval threshold ${requireAbove} for non-trusted vendor`,
      flags: ['needs_review'],
    };
  }

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data: todayRows } = await adminDb
    .from('invoices')
    .select('amount')
    .eq('business_wallet', input.businessWallet)
    .eq('status', 'settled')
    .gte('settled_at', start.toISOString());

  const usedToday = (todayRows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  if (usedToday + amount > dailyCap) {
    return {
      approved: false,
      reason: `Daily settlement cap ${dailyCap} USDC would be exceeded`,
      flags: ['daily_cap'],
    };
  }

  if (amount <= autoBelow) {
    flags.push('auto_settle_band');
  }

  return { approved: true, flags: flags.length ? flags : undefined };
}
