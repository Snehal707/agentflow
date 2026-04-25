import PDFDocument from 'pdfkit';

export interface DigestInvoiceRow {
  invoice_number?: string | null;
  vendor_email?: string | null;
  amount: number;
  currency?: string | null;
  settled_at?: string | null;
}

/**
 * Build a simple monthly invoice summary PDF for a business.
 */
export function buildInvoiceDigestPdf(input: {
  businessName: string;
  monthLabel: string;
  invoices: DigestInvoiceRow[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50 });
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(`Invoice summary — ${input.monthLabel}`, { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`Business: ${input.businessName}`);
    doc.moveDown();

    const rows = input.invoices;
    let total = 0;
    for (const inv of rows) {
      total += Number(inv.amount) || 0;
    }
    doc.text(`Settled invoices: ${rows.length}`);
    doc.text(`Total (${rows[0]?.currency ?? 'USDC'}): ${total.toFixed(2)}`);
    doc.moveDown();

    rows.forEach((inv, i) => {
      const line = [
        `${i + 1}.`,
        inv.invoice_number ? `#${inv.invoice_number}` : '(no number)',
        inv.vendor_email ?? '',
        `${Number(inv.amount).toFixed(2)} ${inv.currency ?? 'USDC'}`,
        inv.settled_at ? new Date(inv.settled_at).toISOString().slice(0, 10) : '',
      ]
        .filter(Boolean)
        .join(' ');
      doc.fontSize(10).text(line);
    });

    doc.end();
  });
}
