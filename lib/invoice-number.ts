import { randomUUID } from 'node:crypto';

function compactDatePart(now: Date): string {
  const year = now.getUTCFullYear().toString();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function generateInvoiceNumber(now: Date = new Date()): string {
  const entropy = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `INV-${compactDatePart(now)}-${entropy}`;
}

export function isInvoiceNumberUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error || error.code !== '23505') {
    return false;
  }
  return /invoice_number/i.test(error.message ?? '');
}
