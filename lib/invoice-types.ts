export interface InvoiceLineItem {
  description?: string;
  amount?: number;
  quantity?: number;
}

/** Normalized invoice JSON — all input channels converge here. */
export interface NormalizedInvoice {
  vendor: string;
  vendorEmail: string;
  amount: number;
  currency: string;
  dueDate: string;
  invoiceNumber: string;
  lineItems: InvoiceLineItem[];
}

export function parseInvoiceJsonFromText(raw: string): NormalizedInvoice {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : trimmed;
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  const lineItemsRaw = parsed.lineItems ?? parsed.line_items;
  const lineItems: InvoiceLineItem[] = Array.isArray(lineItemsRaw)
    ? lineItemsRaw.map((x) => x as InvoiceLineItem)
    : [];

  return {
    vendor: String(parsed.vendor ?? ''),
    vendorEmail: String(parsed.vendorEmail ?? parsed.vendor_email ?? ''),
    amount: Number(parsed.amount ?? 0),
    currency: String(parsed.currency ?? 'USDC'),
    dueDate: String(parsed.dueDate ?? parsed.due_date ?? ''),
    invoiceNumber: String(parsed.invoiceNumber ?? parsed.invoice_number ?? ''),
    lineItems,
  };
}

export function isValidNormalizedInvoice(inv: NormalizedInvoice): boolean {
  return (
    Number.isFinite(inv.amount) &&
    inv.amount > 0 &&
    inv.vendor.length > 0 &&
    inv.invoiceNumber.length > 0
  );
}
