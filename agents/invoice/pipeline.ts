import { adminDb } from '../../db/client';
import type { NormalizedInvoice } from '../../lib/invoice-types';
import { isValidNormalizedInvoice } from '../../lib/invoice-types';
import { parseInvoiceFromEmailAttachments } from './subagents/email-parser';
import { parseInvoiceFromImageUrl } from './subagents/image-parser';
import { parseInvoiceFromPdfUrl } from './subagents/pdf-parser';
import { sendInvoiceReceiptEmail } from './subagents/receipt';
import { notifyInvoiceReviewNeeded, notifyInvoiceSettled } from './subagents/telegram-notify';
import { executeInvoicePayment } from './subagents/executor';
import { resolveInvoicePayeeWallet } from './subagents/resolve-payee';
import { validateInvoiceForBusiness, type ValidationResult } from './subagents/validator';
import { createPaymentRequestFromInvoice } from '../../lib/invoice-agentpay';

export type InvoiceParseInput =
  | { channel: 'json'; invoice: NormalizedInvoice }
  | { channel: 'pdf'; pdfUrl: string }
  | { channel: 'image'; imageUrl: string }
  | {
      channel: 'email';
      attachments: Array<{ url: string; filename?: string; content_type?: string }>;
    };

export interface RunInvoicePipelineInput {
  businessWallet: string;
  /** Provide either pre-normalized invoice or a parse descriptor. */
  invoice?: NormalizedInvoice;
  parse?: InvoiceParseInput;
  payerWalletAddress?: string;
  /** When false, never execute DCW payment (e.g. inbound email without payer). Default true when payer is set. */
  executePayment?: boolean;
  /**
   * Control whether auto-execution should happen for any approved invoice,
   * or only when the invoice falls within the business auto-settle band.
   */
  executionPolicy?: 'always' | 'auto_settle_band';
}

export interface RunInvoicePipelineResult {
  invoiceId: string;
  invoice: NormalizedInvoice;
  validation: ValidationResult;
  executed: boolean;
  businessWallet: string;
  txHash?: `0x${string}`;
}

async function resolveInvoice(input: RunInvoicePipelineInput): Promise<NormalizedInvoice> {
  if (input.invoice) {
    return input.invoice;
  }
  if (!input.parse) {
    throw new Error('[invoice/pipeline] invoice or parse is required');
  }

  switch (input.parse.channel) {
    case 'json':
      return input.parse.invoice;
    case 'pdf':
      return await parseInvoiceFromPdfUrl(input.parse.pdfUrl);
    case 'image':
      return await parseInvoiceFromImageUrl(input.parse.imageUrl);
    case 'email': {
      const r = await parseInvoiceFromEmailAttachments(input.parse.attachments);
      if ('error' in r) {
        throw new Error(r.error);
      }
      return r.invoice;
    }
    default:
      throw new Error('[invoice/pipeline] unknown parse channel');
  }
}

/**
 * Parse → persist invoice → validate → optional DCW settlement → receipt + Telegram.
 */
export async function runInvoicePipeline(
  input: RunInvoicePipelineInput,
): Promise<RunInvoicePipelineResult> {
  const invoice = await resolveInvoice(input);

  if (!isValidNormalizedInvoice(invoice)) {
    throw new Error('[invoice/pipeline] Normalized invoice failed validation');
  }

  const { data: inserted, error: insErr } = await adminDb
    .from('invoices')
    .insert({
      business_wallet: input.businessWallet,
      vendor_name: invoice.vendor,
      vendor_email: invoice.vendorEmail,
      amount: invoice.amount,
      currency: invoice.currency,
      invoice_number: invoice.invoiceNumber,
      line_items: invoice.lineItems,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insErr || !inserted?.id) {
    throw new Error(`[invoice/pipeline] insert failed: ${insErr?.message ?? 'unknown'}`);
  }

  const invoiceId = String(inserted.id);

  const validation = await validateInvoiceForBusiness({
    businessWallet: input.businessWallet,
    invoice,
  });

  const nextStatus = validation.approved ? 'approved' : 'review';
  await adminDb.from('invoices').update({ status: nextStatus }).eq('id', invoiceId);

  if (!validation.approved) {
    await notifyInvoiceReviewNeeded({
      businessWallet: input.businessWallet,
      validation,
      invoiceId,
    });
    return { invoiceId, invoice, validation, executed: false, businessWallet: input.businessWallet };
  }

  const wantExecute =
    input.executePayment !== false &&
    Boolean(input.payerWalletAddress?.trim());
  const inAutoSettleBand = Boolean(validation.flags?.includes('auto_settle_band'));

  if (!wantExecute) {
    // No DCW payer available — create an AgentPay payment request so the
    // payer can approve it manually from the Requests tab.
    try {
      const payReq = await createPaymentRequestFromInvoice(invoiceId);
      if (payReq) {
        console.log('[invoice/pipeline] payment request created:', payReq.requestId);
      }
    } catch (e) {
      console.warn('[invoice/pipeline] payment request creation failed (non-fatal):', e);
    }
    return { invoiceId, invoice, validation, executed: false, businessWallet: input.businessWallet };
  }

  if ((input.executionPolicy ?? 'always') === 'auto_settle_band' && !inAutoSettleBand) {
    return { invoiceId, invoice, validation, executed: false, businessWallet: input.businessWallet };
  }

  const payeeWalletAddress = await resolveInvoicePayeeWallet({
    vendorEmail: invoice.vendorEmail,
  });
  if (!payeeWalletAddress) {
    throw new Error(
      '[invoice/pipeline] Could not resolve a payout wallet for this vendor. Ask the vendor to onboard with an invoice email or handle first.',
    );
  }

  const ex = await executeInvoicePayment({
    payerWalletAddress: input.payerWalletAddress!,
    payeeWalletAddress,
    amountUsdc: invoice.amount,
    invoiceId,
  });

  try {
    await sendInvoiceReceiptEmail({
      businessWallet: input.businessWallet,
      amountUsdc: invoice.amount,
      txHash: ex.txHash,
    });
  } catch (e) {
    console.warn('[invoice/pipeline] receipt email failed:', e);
  }

  await notifyInvoiceSettled({
    businessWallet: input.businessWallet,
    amountUsdc: invoice.amount,
    txHash: ex.txHash,
  });

  return {
    invoiceId,
    invoice,
    validation,
    executed: true,
    businessWallet: input.businessWallet,
    txHash: ex.txHash,
  };
}
