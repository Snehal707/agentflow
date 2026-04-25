import express, { type Request, type Response } from 'express';
import { Webhook } from 'svix';
import { runInvoicePipeline } from '../../agents/invoice/pipeline';
import { fetchResendAttachmentDownloadUrl } from '../../lib/resend-inbound';

const router = express.Router();

function emailFromRecipient(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  if (m) {
    return m[1].trim().toLowerCase();
  }
  return raw.trim().toLowerCase();
}

async function resolveBusinessWalletFromInbound(
  toAddresses: string[],
): Promise<string | null> {
  const fallback = process.env.INVOICE_DEFAULT_BUSINESS_WALLET?.trim();
  if (fallback) {
    return fallback;
  }

  const { adminDb } = await import('../../db/client');

  for (const raw of toAddresses) {
    const email = emailFromRecipient(raw);
    if (!email) {
      continue;
    }
    const { data } = await adminDb
      .from('businesses')
      .select('wallet_address')
      .eq('invoice_email', email)
      .maybeSingle();
    const w = data?.wallet_address as string | undefined;
    if (w) {
      return w;
    }
  }
  return null;
}

interface ResendInboundAttachment {
  id?: string;
  filename?: string;
  content_type?: string;
}

interface ResendInboundData {
  email_id?: string;
  attachments?: ResendInboundAttachment[];
  to?: string[];
}

/**
 * POST /inbound — Resend inbound (Svix-signed). No JWT; business resolved from recipient address.
 */
router.post(
  '/inbound',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const buf = req.body as Buffer;
    const raw = buf.toString('utf8');

    let payload: { type?: string; data?: ResendInboundData };

    const skipVerify = process.env.SKIP_WEBHOOK_VERIFY === 'true';
    const secret =
      process.env.RESEND_WEBHOOK_SECRET?.trim() ||
      process.env.RESEND_INBOUND_SIGNING_SECRET?.trim();

    try {
      if (skipVerify) {
        payload = JSON.parse(raw) as { type?: string; data?: ResendInboundData };
      } else {
        if (!secret) {
          console.error('[webhooks/email] RESEND_WEBHOOK_SECRET is not set');
          return res.status(500).json({ error: 'Webhook not configured' });
        }
        const wh = new Webhook(secret);
        payload = wh.verify(raw, {
          'svix-id': req.headers['svix-id'] as string,
          'svix-timestamp': req.headers['svix-timestamp'] as string,
          'svix-signature': req.headers['svix-signature'] as string,
        }) as { type?: string; data?: ResendInboundData };
      }
    } catch (e) {
      console.warn('[webhooks/email] verify failed', e);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const data = payload.data;
    const emailId = data?.email_id;
    const to = data?.to ?? [];
    const attachments = data?.attachments ?? [];

    if (!emailId || !attachments.length) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'no attachments or email_id' });
    }

    const businessWallet = await resolveBusinessWalletFromInbound(to);
    if (!businessWallet) {
      console.warn('[webhooks/email] No business for recipients', to);
      return res.status(200).json({ ok: true, skipped: true, reason: 'unknown recipient' });
    }

    const resolved: Array<{ url: string; filename?: string; content_type?: string }> = [];
    try {
      for (const a of attachments) {
        const id = a.id;
        if (!id) {
          continue;
        }
        const url = await fetchResendAttachmentDownloadUrl(emailId, id);
        resolved.push({
          url,
          filename: a.filename,
          content_type: a.content_type,
        });
      }
    } catch (e) {
      console.error('[webhooks/email] attachment fetch failed', e);
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }

    if (!resolved.length) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'no attachment ids' });
    }

    try {
      const result = await runInvoicePipeline({
        businessWallet,
        parse: { channel: 'email', attachments: resolved },
        payerWalletAddress: businessWallet,
        executePayment: true,
        executionPolicy: 'auto_settle_band',
      });
      return res.status(200).json({ ok: true, result });
    } catch (e) {
      console.error('[webhooks/email] pipeline failed', e);
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

export default router;
