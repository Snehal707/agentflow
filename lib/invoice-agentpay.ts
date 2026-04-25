import { adminDb } from '../db/client';
import { resolvePayee } from './agentpay-payee';
import { sendTelegramText } from './telegram-notify';

/**
 * Resolve the telegram_id for a wallet: check businesses + users by the given
 * address, then reverse-resolve DCW → EOA via `wallets` and try again.
 *
 * Why: `.arc` names resolve to DCW addresses, but users link Telegram with
 * their EOA (`users.wallet_address = EOA`). Without the reverse-lookup we'd
 * miss notifications for every user who linked TG before registering `.arc`.
 *
 * Mirrors the pattern in agents/invoice/subagents/telegram-notify.ts.
 */
async function resolveVendorTelegramChatId(walletAddress: string): Promise<string | null> {
  const candidates: string[] = [walletAddress];

  // If the given address is a DCW (has a row in `wallets` with purpose=user_agent),
  // add its owning EOA to the lookup candidates.
  try {
    const { data: dcwRow } = await adminDb
      .from('wallets')
      .select('user_wallet')
      .eq('address', walletAddress)
      .eq('purpose', 'user_agent')
      .maybeSingle();
    const eoa = String(dcwRow?.user_wallet ?? '').trim();
    if (eoa && eoa.toLowerCase() !== walletAddress.toLowerCase()) {
      candidates.push(eoa);
    }
  } catch {
    // non-fatal: stay with the original address
  }

  for (const addr of candidates) {
    const { data: biz } = await adminDb
      .from('businesses')
      .select('telegram_id')
      .ilike('wallet_address', addr)
      .maybeSingle();
    const bizId = String(biz?.telegram_id ?? '').trim();
    if (bizId) return bizId;

    const { data: user } = await adminDb
      .from('users')
      .select('telegram_id')
      .ilike('wallet_address', addr)
      .maybeSingle();
    const userId = String(user?.telegram_id ?? '').trim();
    if (userId) return userId;
  }

  return null;
}

/**
 * Create an AgentPay payment_request linked to an existing invoice.
 * Called when an invoice is approved but no DCW payer is present —
 * the payer will approve the request in the Requests tab.
 */
export async function createPaymentRequestFromInvoice(
  invoiceId: string,
): Promise<{ requestId: string } | null> {
  const { data: invoice, error: invErr } = await adminDb
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle();

  if (invErr || !invoice) {
    console.warn('[invoice-agentpay] invoice not found:', invoiceId, invErr?.message);
    return null;
  }
  if (invoice.status === 'paid' || invoice.status === 'settled') {
    return null;
  }
  // Skip if a payment request already exists for this invoice
  if (invoice.payment_request_id) {
    return { requestId: String(invoice.payment_request_id) };
  }

  let payerWallet: string | null = null;
  const vendorHandle = String(invoice.vendor_handle ?? '').trim();
  const issuer = String(invoice.business_wallet ?? '').trim();

  if (vendorHandle && issuer) {
    try {
      payerWallet = await resolvePayee(vendorHandle, issuer);
    } catch {
      payerWallet = null;
    }
  }

  if (!payerWallet) {
    console.log(
      `[invoice-agentpay] ${vendorHandle || invoiceId} not registered on AgentPay contract`,
    );
    return null;
  }

  const remark = [
    invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : null,
    invoice.vendor_name ?? null,
  ]
    .filter(Boolean)
    .join(': ')
    .slice(0, 500) || null;

  const { data: request, error: reqErr } = await adminDb
    .from('payment_requests')
    .insert({
      from_wallet: payerWallet,
      to_wallet: invoice.business_wallet,
      amount: invoice.amount,
      remark,
      status: 'pending',
      invoice_id: invoiceId,
      initiated_by: 'invoice_agent',
    })
    .select('id')
    .single();

  if (reqErr || !request) {
    console.warn('[invoice-agentpay] failed to create payment_request:', reqErr?.message);
    return null;
  }

  const requestId = String(request.id);

  // Link back to invoice
  await adminDb
    .from('invoices')
    .update({ payment_request_id: requestId })
    .eq('id', invoiceId);

  // Notify vendor via Telegram if linked
  try {
    const chatId = await resolveVendorTelegramChatId(payerWallet);
    if (chatId) {
      const msg = [
        '📄 New Invoice Payment Request',
        '',
        `Invoice: ${invoice.invoice_number ?? ''}`,
        `Amount: ${invoice.amount} USDC`,
        `From: ${String(invoice.business_wallet ?? '').slice(0, 6)}...`,
        `For: ${invoice.line_items?.[0]?.description ?? 'Services'}`,
        '',
        'Pay at agentflow.one/pay → Requests tab',
      ].join('\n');
      await sendTelegramText(chatId, msg);
      console.log(`[invoice-agentpay] Telegram notification sent for invoice ${invoice.invoice_number} to chat ${chatId}`);
    } else {
      console.log(`[invoice-agentpay] No Telegram linked for payer ${payerWallet} (invoice ${invoice.invoice_number})`);
    }
  } catch (tgErr) {
    console.warn('[invoice-agentpay] telegram notify failed (non-fatal):', tgErr);
  }

  return { requestId };
}

/**
 * Mark an invoice as paid when its linked payment_request is approved.
 * Called in api/pay.ts POST /approve/:requestId after executeUsdcTransfer.
 */
export async function markInvoicePaidFromRequest(
  requestId: string,
  txHash: string,
): Promise<void> {
  const { data: req, error } = await adminDb
    .from('payment_requests')
    .select('invoice_id')
    .eq('id', requestId)
    .maybeSingle();

  if (error || !req?.invoice_id) {
    return;
  }

  const { error: upErr } = await adminDb
    .from('invoices')
    .update({
      status: 'paid',
      arc_tx_id: txHash,
      settled_at: new Date().toISOString(),
    })
    .eq('id', String(req.invoice_id));

  if (upErr) {
    console.warn('[invoice-agentpay] failed to mark invoice paid:', upErr.message);
  } else {
    console.log(`[invoice-agentpay] invoice ${req.invoice_id} marked paid via request ${requestId}`);
  }
}
