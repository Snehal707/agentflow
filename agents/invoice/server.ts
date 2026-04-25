import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { fetchResendAttachmentDownloadUrl } from '../../lib/resend-inbound';
import { runInvoicePipeline, type InvoiceParseInput } from './pipeline';
import type { NormalizedInvoice } from '../../lib/invoice-types';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { resolveAgentRunUrl, runInvoiceVendorResearchFollowup } from '../../lib/a2a-followups';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import type { RunInvoicePipelineResult } from './pipeline';

dotenv.config();

const app = express();
app.use(express.json({ limit: '4mb' }));

const port = Number(process.env.INVOICE_AGENT_PORT || 3015);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.INVOICE_AGENT_PRICE ? `$${process.env.INVOICE_AGENT_PRICE}` : '$0.025';

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

const researchPort = Number(process.env.RESEARCH_AGENT_PORT || 3001);
const researchRunUrl = resolveAgentRunUrl(
  process.env.RESEARCH_AGENT_URL?.trim(),
  `http://127.0.0.1:${researchPort}/run`,
);

function researchPriceLabel(): string {
  const n = Number(process.env.RESEARCH_AGENT_PRICE ?? '0.005');
  return `$${Number.isFinite(n) ? n.toFixed(3) : '0.005'}`;
}

function scheduleInvoiceVendorResearchIfEligible(result: RunInvoicePipelineResult): void {
  const vendor = result.invoice.vendor?.trim();
  const amount = result.invoice.amount;
  if (!vendor || !(amount > 10)) {
    return;
  }
  setImmediate(() => {
    void (async () => {
      try {
        await runInvoiceVendorResearchFollowup({
          vendor,
          amount,
          issuerWalletAddress: result.businessWallet,
          researchRunUrl,
          researchPriceLabel: researchPriceLabel(),
        });
      } catch (e) {
        console.warn('[a2a] invoice→research hook failed:', e instanceof Error ? e.message : e);
      }
    })();
  });
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'invoice' });
});

/**
 * POST /run — business JWT; body picks channel json | pdf | image | email.
 */
app.post(
  '/run',
  paidInternalOrAuthMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
    const reqKey = (req.headers['x-agentflow-paid-internal'] as string | undefined)?.trim();
    if (internalKey && reqKey === internalKey) {
      next();
      return;
    }
    return gateway.require(price)(req, res, next);
  },
  async (req: Request, res: Response) => {
    try {
      if (req.body?.benchmark === true) {
        console.log('[benchmark] invoice short-circuit');
        return res.json({
          ok: true,
          benchmark: true,
          agent: 'invoice',
          result: 'Benchmark mode - payment logged',
        });
      }
      const auth = (req as any).auth as JWTPayload;
      const businessWallet = auth.walletAddress;
      const channel = String(req.body?.channel ?? 'json').toLowerCase();
      const payerWalletAddress = req.body?.payerWalletAddress
        ? String(req.body.payerWalletAddress)
        : undefined;
      const executePayment = req.body?.executePayment;

      let parse: InvoiceParseInput | undefined;
      let invoice: NormalizedInvoice | undefined;

      if (channel === 'json') {
        invoice = req.body?.invoice as NormalizedInvoice;
        if (!invoice) {
          return res.status(400).json({ error: 'channel json requires invoice object' });
        }
      } else if (channel === 'pdf') {
        const pdfUrl = String(req.body?.pdfUrl ?? '');
        if (!pdfUrl) {
          return res.status(400).json({ error: 'pdfUrl is required' });
        }
        parse = { channel: 'pdf', pdfUrl };
      } else if (channel === 'image') {
        const imageUrl = String(req.body?.imageUrl ?? '');
        if (!imageUrl) {
          return res.status(400).json({ error: 'imageUrl is required' });
        }
        parse = { channel: 'image', imageUrl };
      } else if (channel === 'email') {
        const attachments = req.body?.attachments;
        if (Array.isArray(attachments) && attachments.length) {
          parse = { channel: 'email', attachments };
        } else {
          return res.status(400).json({
            error:
              'channel email requires attachments[] with { url, filename?, content_type? } or resend payload (email_id + attachment ids)',
          });
        }
      } else {
        return res.status(400).json({ error: 'Invalid channel' });
      }

      const result = await runInvoicePipeline({
        businessWallet,
        invoice,
        parse,
        payerWalletAddress,
        executePayment:
          typeof executePayment === 'boolean' ? executePayment : undefined,
      });

      scheduleInvoiceVendorResearchIfEligible(result);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: toMessage(err) });
    }
  },
);

/**
 * POST /run/email — same auth; body may include Resend `email.received` shape or pre-resolved attachment URLs.
 */
app.post(
  '/run/email',
  gateway.require(price),
  paidInternalOrAuthMiddleware,
  async (req: Request, res: Response) => {
    try {
      if (req.body?.benchmark === true) {
        console.log('[benchmark] invoice short-circuit');
        return res.json({
          ok: true,
          benchmark: true,
          agent: 'invoice',
          result: 'Benchmark mode - payment logged',
        });
      }
      const auth = (req as any).auth as JWTPayload;
      const businessWallet = auth.walletAddress;
      const payerWalletAddress = req.body?.payerWalletAddress
        ? String(req.body.payerWalletAddress)
        : undefined;
      const executePayment = req.body?.executePayment;

      let attachments: Array<{ url: string; filename?: string; content_type?: string }>;

      if (Array.isArray(req.body?.attachments) && req.body.attachments.length) {
        attachments = req.body.attachments;
      } else {
        const data = req.body?.data ?? req.body;
        const emailId = String(data?.email_id ?? data?.emailId ?? '');
        const rawAtt = data?.attachments ?? [];
        if (!emailId || !Array.isArray(rawAtt) || !rawAtt.length) {
          return res.status(400).json({
            error:
              'Provide attachments[] with URLs or data.email_id + data.attachments[] with ids from Resend',
          });
        }
        attachments = [];
        for (const a of rawAtt) {
          const id = String(a?.id ?? '');
          if (!id) {
            continue;
          }
          const url = await fetchResendAttachmentDownloadUrl(emailId, id);
          attachments.push({
            url,
            filename: typeof a.filename === 'string' ? a.filename : undefined,
            content_type: typeof a.content_type === 'string' ? a.content_type : undefined,
          });
        }
        if (!attachments.length) {
          return res.status(400).json({ error: 'No resolvable attachments' });
        }
      }

      const result = await runInvoicePipeline({
        businessWallet,
        parse: { channel: 'email', attachments },
        payerWalletAddress,
        executePayment:
          typeof executePayment === 'boolean' ? executePayment : undefined,
      });

      scheduleInvoiceVendorResearchIfEligible(result);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: toMessage(err) });
    }
  },
);

app.listen(port, () => {
  console.log(`[invoice] listening on :${port}`);
});
