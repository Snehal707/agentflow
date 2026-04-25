import type { NormalizedInvoice } from '../../../lib/invoice-types';
import { parseInvoiceFromPdfUrl } from './pdf-parser';
import { parseInvoiceFromImageUrl } from './image-parser';

export interface EmailAttachmentInput {
  url: string;
  filename?: string;
  content_type?: string;
}

function isPdf(att: EmailAttachmentInput): boolean {
  const t = (att.content_type ?? '').toLowerCase();
  const n = (att.filename ?? '').toLowerCase();
  return t.includes('pdf') || n.endsWith('.pdf');
}

function isImage(att: EmailAttachmentInput): boolean {
  const t = (att.content_type ?? '').toLowerCase();
  const n = (att.filename ?? '').toLowerCase();
  return (
    t.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|heic)$/.test(n)
  );
}

/**
 * Resend inbound: after webhook resolves attachment URLs, route to PDF or image parser.
 */
export async function parseInvoiceFromEmailAttachments(
  attachments: EmailAttachmentInput[],
): Promise<{ invoice: NormalizedInvoice } | { error: string }> {
  if (!attachments.length) {
    return { error: 'No attachments with URLs' };
  }

  const pdf = attachments.find(isPdf);
  if (pdf) {
    try {
      const invoice = await parseInvoiceFromPdfUrl(pdf.url);
      return { invoice };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const img = attachments.find(isImage);
  if (img) {
    try {
      const invoice = await parseInvoiceFromImageUrl(img.url);
      return { invoice };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { error: 'No PDF or image attachment found' };
}
