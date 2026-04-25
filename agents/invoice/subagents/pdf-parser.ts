import { callHermesDeep } from '../../../lib/hermes';
import { fetchUrlViaFirecrawl } from '../../../lib/firecrawl';
import {
  isValidNormalizedInvoice,
  parseInvoiceJsonFromText,
  type NormalizedInvoice,
} from '../../../lib/invoice-types';

const SYSTEM_PROMPT = `You are an invoice data extractor. Given markdown text scraped from an invoice PDF, output a single JSON object ONLY (no markdown fences) with exactly these keys:
vendor (string), vendorEmail (string), amount (number), currency (string), dueDate (ISO 8601 date string), invoiceNumber (string), lineItems (array of objects with optional description, amount, quantity).
Use USDC or USD as currency when unclear. If an email is missing, use empty string.`;

export async function parseInvoiceFromPdfUrl(pdfUrl: string): Promise<NormalizedInvoice> {
  const markdown = await fetchUrlViaFirecrawl(pdfUrl);
  const raw = await callHermesDeep(SYSTEM_PROMPT, `INVOICE_MARKDOWN:\n${markdown.slice(0, 32_000)}`);
  const invoice = parseInvoiceJsonFromText(raw);
  if (!isValidNormalizedInvoice(invoice)) {
    throw new Error('[pdf-parser] Extracted invoice JSON failed validation');
  }
  return invoice;
}
