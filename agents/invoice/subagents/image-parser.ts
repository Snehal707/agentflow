import { extractInvoiceFromImageUrl } from '../../../lib/openai-vision';
import {
  isValidNormalizedInvoice,
  parseInvoiceJsonFromText,
  type NormalizedInvoice,
} from '../../../lib/invoice-types';

export async function parseInvoiceFromImageUrl(imageUrl: string): Promise<NormalizedInvoice> {
  const raw = await extractInvoiceFromImageUrl(imageUrl);
  const invoice = parseInvoiceJsonFromText(raw);
  if (!isValidNormalizedInvoice(invoice)) {
    throw new Error('[image-parser] Extracted invoice JSON failed validation');
  }
  return invoice;
}
