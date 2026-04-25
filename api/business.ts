import { Router } from 'express';
import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbiItem,
} from 'viem';
import { authMiddleware, type JWTPayload } from '../lib/auth';
import { adminDb } from '../db/client';
import { normalizeHandle } from '../lib/handles';
import { resolveTelegramChatProfile } from '../lib/telegram-profile';
import { executeInvoicePayment } from '../agents/invoice/subagents/executor';
import { resolveInvoicePayeeWallet } from '../agents/invoice/subagents/resolve-payee';
import {
  notifyInvoiceSettled,
  notifyInvoiceReviewNeeded,
} from '../agents/invoice/subagents/telegram-notify';
import { sendInvoiceReceiptEmail } from '../agents/invoice/subagents/receipt';
import { ARC } from '../lib/arc-config';

const router = Router();
const INVOICE_DOMAIN = (process.env.RESEND_INBOUND_DOMAIN?.trim() || 'invoices.agentflow.one')
  .replace(/^@+/, '')
  .toLowerCase();
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const RECENT_PAYMENT_SCAN_BLOCKS = 80_000n;
const LOG_SCAN_CHUNK = 10_000n;
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

function normalizeWallet(req: unknown): string {
  const auth = (req as any).auth as JWTPayload;
  return auth.walletAddress;
}

function buildInvoiceEmail(handle: string): string {
  return `${handle}@${INVOICE_DOMAIN}`;
}

async function loadBusiness(walletAddress: string) {
  const { data: biz, error } = await adminDb
    .from('businesses')
    .select('*')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return biz;
}

async function loadInvoices(walletAddress: string) {
  const { data, error } = await adminDb
    .from('invoices')
    .select('*')
    .eq('business_wallet', walletAddress)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

async function loadPublicPayments(walletAddress: string) {
  const { data, error } = await adminDb
    .from('agent_interactions')
    .select('id, user_input, wallet_context, created_at')
    .eq('wallet_address', walletAddress)
    .eq('agent_slug', 'public_payment')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(error.message);
  }

  const recordedPayments = (data ?? []).map((row: any) => {
    const context = row?.wallet_context ?? {};
    return {
      id: String(row?.id ?? ''),
      payer_wallet: String(context?.payerWallet ?? '').trim() || null,
      amount: Number(context?.amountUsdc ?? 0),
      purpose: String(row?.user_input ?? '').trim() || null,
      tx_hash: String(context?.txHash ?? '').trim() || null,
      created_at: String(row?.created_at ?? new Date().toISOString()),
      source: 'recorded' as const,
    };
  });

  const recordedTxHashes = new Set(
    recordedPayments
      .map((payment) => String(payment.tx_hash ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  const reconciledPayments = await loadRecentOnchainPublicPayments(walletAddress);
  const merged = [
    ...recordedPayments,
    ...reconciledPayments.filter((payment) => {
      const txHash = String(payment.tx_hash ?? '').trim().toLowerCase();
      return !txHash || !recordedTxHashes.has(txHash);
    }),
  ];

  return merged.sort((a, b) => {
    const left = new Date(a.created_at).getTime();
    const right = new Date(b.created_at).getTime();
    return right - left;
  });
}

async function loadRecentOnchainPublicPayments(walletAddress: string) {
  const payeeWallet = getAddress(walletAddress);
  const client = createPublicClient({ chain, transport: http(ARC.rpc) });
  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock > RECENT_PAYMENT_SCAN_BLOCKS ? latestBlock - RECENT_PAYMENT_SCAN_BLOCKS : 0n;
  const logs = [];

  for (let chunkStart = fromBlock; chunkStart <= latestBlock; chunkStart += LOG_SCAN_CHUNK + 1n) {
    const chunkEnd =
      chunkStart + LOG_SCAN_CHUNK > latestBlock ? latestBlock : chunkStart + LOG_SCAN_CHUNK;
    const chunkLogs = await client.getLogs({
      address: getAddress(ARC_USDC),
      event: transferEvent,
      args: { to: payeeWallet },
      fromBlock: chunkStart,
      toBlock: chunkEnd,
    });
    logs.push(...chunkLogs);
  }

  if (!logs.length) {
    return [];
  }

  const txHashes = Array.from(
    new Set(
      logs
        .map((log) => String(log.transactionHash ?? '').trim())
        .filter(Boolean),
    ),
  );

  const { data: txRows, error: txError } = await adminDb
    .from('transactions')
    .select('arc_tx_id, action_type')
    .in('arc_tx_id', txHashes);

  if (txError) {
    throw new Error(txError.message);
  }

  const ignoreTxHashes = new Set(
    (txRows ?? [])
      .filter((row: any) => String(row?.action_type ?? '').trim().toLowerCase() !== 'payment')
      .map((row: any) => String(row?.arc_tx_id ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  const blockNumbers = Array.from(
    new Set(logs.map((log) => log.blockNumber.toString())),
  );
  const blocks = await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
      return [blockNumber, new Date(Number(block.timestamp) * 1000).toISOString()] as const;
    }),
  );
  const blockTimeByNumber = new Map(blocks);

  return logs
    .filter((log) => {
      const txHash = String(log.transactionHash ?? '').trim().toLowerCase();
      return !ignoreTxHashes.has(txHash);
    })
    .map((log) => ({
      id: `onchain:${String(log.transactionHash ?? '')}`,
      payer_wallet: log.args.from ? getAddress(String(log.args.from)) : null,
      amount: Number(formatUnits(BigInt(log.args.value as bigint), 6)),
      purpose: null,
      tx_hash: String(log.transactionHash ?? '').trim() || null,
      created_at:
        blockTimeByNumber.get(log.blockNumber.toString()) ?? new Date().toISOString(),
      source: 'onchain' as const,
    }));
}

async function loadBusinessHandle(walletAddress: string): Promise<string | null> {
  const { data, error } = await adminDb
    .from('users')
    .select('arc_handle')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.arc_handle ? String(data.arc_handle) : null;
}

async function loadUserTelegramLink(walletAddress: string): Promise<{
  telegramId: string | null;
  telegramUsername?: string;
  telegramDisplayName?: string;
}> {
  const { data, error } = await adminDb
    .from('users')
    .select('telegram_id')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const telegramId = String(data?.telegram_id ?? '').trim() || null;
  const profile = telegramId ? await resolveTelegramChatProfile(telegramId) : null;

  return {
    telegramId,
    telegramUsername: profile?.username,
    telegramDisplayName: profile?.displayName,
  };
}

async function syncBusinessTelegramFromLinkedUser<T extends { telegram_id?: string | null }>(
  walletAddress: string,
  business: T | null,
  linkedTelegramId: string | null,
): Promise<T | null> {
  if (!business || !linkedTelegramId) {
    return business;
  }

  const currentTelegramId = String(business.telegram_id ?? '').trim() || null;
  if (currentTelegramId === linkedTelegramId) {
    return business;
  }

  const { data, error } = await adminDb
    .from('businesses')
    .update({ telegram_id: linkedTelegramId })
    .eq('wallet_address', walletAddress)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return ((data as T | null) ?? business);
}

async function ensureHandleOwnership(handle: string, walletAddress: string): Promise<void> {
  const { data: row, error } = await adminDb
    .from('arc_handles')
    .select('wallet_address')
    .eq('handle', handle)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const existingWallet = String(row?.wallet_address ?? '').trim().toLowerCase();
  if (existingWallet && existingWallet !== walletAddress.toLowerCase()) {
    throw new Error('Arc handle is already taken');
  }
}

async function upsertBusinessIdentity(input: {
  walletAddress: string;
  arcHandle: string;
  telegramId: string | null;
}): Promise<void> {
  const usersPatch: Record<string, unknown> = {
    wallet_address: input.walletAddress,
    arc_handle: input.arcHandle,
    telegram_id: input.telegramId,
  };

  const { error: userError } = await adminDb
    .from('users')
    .upsert(usersPatch, { onConflict: 'wallet_address' });

  if (userError) {
    throw new Error(userError.message);
  }

  const { error: handleError } = await adminDb.from('arc_handles').upsert(
    {
      handle: input.arcHandle,
      wallet_address: input.walletAddress,
      handle_type: 'business',
      verified: true,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'handle' },
  );

  if (handleError) {
    throw new Error(handleError.message);
  }
}

/** Business dashboard: profile + invoices */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const walletAddress = normalizeWallet(req);
    let business = await loadBusiness(walletAddress);
    const linkedTelegram = await loadUserTelegramLink(walletAddress);
    const arcHandle = await loadBusinessHandle(walletAddress);

    business = await syncBusinessTelegramFromLinkedUser(
      walletAddress,
      business,
      linkedTelegram.telegramId,
    );

    if (!business) {
      return res.json({
        business: null,
        invoices: [],
        public_payments: [],
        arc_handle: arcHandle,
        linked_telegram_id: linkedTelegram.telegramId,
        linked_telegram_username: linkedTelegram.telegramUsername,
        linked_telegram_display_name: linkedTelegram.telegramDisplayName,
      });
    }

    const invoices = await loadInvoices(walletAddress);
    const publicPayments = await loadPublicPayments(walletAddress);
    return res.json({
      business,
      invoices,
      public_payments: publicPayments,
      inbox_email: business.invoice_email ?? null,
      arc_handle: arcHandle,
      linked_telegram_id: linkedTelegram.telegramId,
      linked_telegram_username: linkedTelegram.telegramUsername,
      linked_telegram_display_name: linkedTelegram.telegramDisplayName,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'business me failed' });
  }
});

/** Ledger rows from `transactions` where this wallet is payer or payee */
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const walletAddress = getAddress(normalizeWallet(req));
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(100, Math.floor(rawLimit))
        : 50;

    const { data, error } = await adminDb
      .from('transactions')
      .select('*')
      .or(`from_wallet.eq.${walletAddress},to_wallet.eq.${walletAddress}`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ transactions: data ?? [] });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'transactions list failed' });
  }
});

/** Create business row for the authenticated wallet. */
router.post('/onboard', authMiddleware, async (req, res) => {
  try {
    const walletAddress = normalizeWallet(req);
    const businessName = String(req.body?.business_name ?? '').trim();
    const telegramIdRaw = String(req.body?.telegram_id ?? '').trim();
    const handleRaw = String(req.body?.arc_handle ?? '').trim();

    if (!businessName) {
      return res.status(400).json({ error: 'business_name is required' });
    }
    if (!handleRaw) {
      return res.status(400).json({ error: 'arc_handle is required' });
    }

    const arcHandle = normalizeHandle(handleRaw);
    const invoiceEmail = buildInvoiceEmail(arcHandle);
    const linkedTelegram = await loadUserTelegramLink(walletAddress);
    const telegramId = linkedTelegram.telegramId || telegramIdRaw || null;

    await ensureHandleOwnership(arcHandle, walletAddress);

    const { data: existingByEmail, error: emailError } = await adminDb
      .from('businesses')
      .select('wallet_address')
      .eq('invoice_email', invoiceEmail)
      .maybeSingle();

    if (emailError) {
      throw new Error(emailError.message);
    }
    if (
      existingByEmail?.wallet_address &&
      String(existingByEmail.wallet_address).toLowerCase() !== walletAddress.toLowerCase()
    ) {
      return res.status(409).json({ error: 'Invoice inbox handle is already in use' });
    }

    await upsertBusinessIdentity({ walletAddress, arcHandle, telegramId });

    const { data: upsertedBusiness, error } = await adminDb
      .from('businesses')
      .upsert(
        {
          wallet_address: walletAddress,
          business_name: businessName,
          invoice_email: invoiceEmail,
          telegram_id: telegramId,
        },
        { onConflict: 'wallet_address' },
      )
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const business = await syncBusinessTelegramFromLinkedUser(
      walletAddress,
      upsertedBusiness,
      linkedTelegram.telegramId,
    );

    return res.json({
      business,
      inbox_email: invoiceEmail,
      arc_handle: arcHandle,
      invoices: [],
      linked_telegram_id: linkedTelegram.telegramId,
      linked_telegram_username: linkedTelegram.telegramUsername,
      linked_telegram_display_name: linkedTelegram.telegramDisplayName,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'business onboarding failed' });
  }
});

/** Update business rules (owner wallet must match row) */
router.patch('/rules', authMiddleware, async (req, res) => {
  try {
    const walletAddress = normalizeWallet(req);
    const linkedTelegram = await loadUserTelegramLink(walletAddress);

    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};

    if (Array.isArray(body.trusted_vendors)) {
      patch.trusted_vendors = body.trusted_vendors;
    }
    if (Array.isArray(body.blocked_vendors)) {
      patch.blocked_vendors = body.blocked_vendors;
    }
    if (body.auto_settle_below != null) {
      patch.auto_settle_below = Number(body.auto_settle_below);
    }
    if (body.require_approval_above != null) {
      patch.require_approval_above = Number(body.require_approval_above);
    }
    if (body.daily_settlement_cap != null) {
      patch.daily_settlement_cap = Number(body.daily_settlement_cap);
    }
    if (linkedTelegram.telegramId) {
      patch.telegram_id = linkedTelegram.telegramId;
    } else if (typeof body.telegram_id === 'string') {
      patch.telegram_id = body.telegram_id.trim() || null;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data: updatedBusiness, error } = await adminDb
      .from('businesses')
      .update(patch)
      .eq('wallet_address', walletAddress)
      .select('*')
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!updatedBusiness) {
      return res.status(404).json({ error: 'Business row not found for this wallet' });
    }

    const data = await syncBusinessTelegramFromLinkedUser(
      walletAddress,
      updatedBusiness,
      linkedTelegram.telegramId,
    );

    return res.json({ business: data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'rules update failed' });
  }
});

router.post('/invoices/:invoiceId/approve', authMiddleware, async (req, res) => {
  try {
    const walletAddress = normalizeWallet(req);
    const invoiceId = String(req.params.invoiceId ?? '').trim();

    const { data: invoice, error } = await adminDb
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('business_wallet', walletAddress)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found for this business wallet' });
    }

    const status = String(invoice.status ?? '').toLowerCase();
    if (status === 'settled') {
      return res.status(400).json({ error: 'Invoice is already settled' });
    }
    if (status === 'rejected') {
      return res.status(400).json({ error: 'Rejected invoices cannot be approved' });
    }

    const payeeWalletAddress = await resolveInvoicePayeeWallet({
      vendorEmail: String(invoice.vendor_email ?? ''),
      vendorHandle: String(invoice.vendor_handle ?? ''),
    });

    if (!payeeWalletAddress) {
      return res.status(400).json({
        error:
          'Could not resolve a payout wallet for this vendor. Ask the vendor to onboard with an invoice inbox or registered handle first.',
      });
    }

    const payment = await executeInvoicePayment({
      payerWalletAddress: walletAddress,
      payeeWalletAddress,
      amountUsdc: Number(invoice.amount ?? 0),
      invoiceId,
    });

    try {
      await sendInvoiceReceiptEmail({
        businessWallet: walletAddress,
        amountUsdc: Number(invoice.amount ?? 0),
        txHash: payment.txHash,
      });
    } catch (receiptError) {
      console.warn('[business] approve receipt failed', receiptError);
    }

    await notifyInvoiceSettled({
      businessWallet: walletAddress,
      amountUsdc: Number(invoice.amount ?? 0),
      txHash: payment.txHash,
    });

    const refreshed = await loadInvoices(walletAddress);
    const updated = refreshed.find((row: any) => String(row.id) === invoiceId) ?? null;

    return res.json({
      success: true,
      invoice: updated,
      txHash: payment.txHash,
      payeeWalletAddress,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'invoice approve failed' });
  }
});

router.post('/invoices/:invoiceId/reject', authMiddleware, async (req, res) => {
  try {
    const walletAddress = normalizeWallet(req);
    const invoiceId = String(req.params.invoiceId ?? '').trim();

    const { data: invoice, error } = await adminDb
      .from('invoices')
      .select('id, status')
      .eq('id', invoiceId)
      .eq('business_wallet', walletAddress)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found for this business wallet' });
    }

    const currentStatus = String(invoice.status ?? '').toLowerCase();
    if (currentStatus === 'settled') {
      return res.status(400).json({ error: 'Settled invoices cannot be rejected' });
    }

    const { data: updated, error: updateError } = await adminDb
      .from('invoices')
      .update({ status: 'rejected' })
      .eq('id', invoiceId)
      .eq('business_wallet', walletAddress)
      .select('*')
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    await notifyInvoiceReviewNeeded({
      businessWallet: walletAddress,
      invoiceId,
      validation: {
        approved: false,
        reason: 'Rejected by business owner',
        flags: ['rejected'],
      },
    });

    return res.json({ success: true, invoice: updated });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'invoice reject failed' });
  }
});

export default router;
