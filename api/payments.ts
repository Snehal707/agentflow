import { Router } from 'express';
import {
  decodeEventLog,
  createPublicClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  parseUnits,
  verifyMessage,
} from 'viem';
import { adminDb } from '../db/client';
import { executeTransaction, getOrCreateUserAgentWallet, waitForTransaction } from '../lib/dcw';
import { generateQR, resolveHandle } from '../lib/handles';
import { ARC } from '../lib/arc-config';

const router = Router();
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

async function recordPublicPaymentDetails(input: {
  payeeWallet: string;
  payerWallet: string;
  amountUsdc: number;
  txHash: string;
  handle: string;
  purpose: string | null;
}): Promise<void> {
  const purpose = input.purpose?.trim() || null;
  const summary = purpose
    ? `Public payment received for "${purpose}"`
    : `Public payment received via /pay/${input.handle}`;

  const { error } = await adminDb.from('agent_interactions').insert({
    wallet_address: input.payeeWallet,
    agent_slug: 'public_payment',
    user_input: purpose,
    agent_output: summary,
    wallet_context: {
      type: 'public_payment',
      payerWallet: input.payerWallet,
      payeeWallet: input.payeeWallet,
      amountUsdc: input.amountUsdc,
      txHash: input.txHash,
      handle: input.handle,
      purpose,
    },
    execution_ms: 0,
    was_retried: false,
  });

  if (error) {
    throw new Error(error.message);
  }
}

router.get('/pay/:handle', async (req, res) => {
  try {
    const handle = req.params.handle;
    const payeeWallet = await resolveHandle(handle);

    const { data: business } = await adminDb
      .from('businesses')
      .select('business_name, invoice_email, telegram_id')
      .eq('wallet_address', payeeWallet)
      .maybeSingle();

    return res.json({
      handle: handle.toLowerCase(),
      walletAddress: payeeWallet,
      business: business ?? null,
    });
  } catch (error: any) {
    return res.status(404).json({ error: error?.message ?? 'handle not found' });
  }
});

router.post('/pay/:handle/execute', async (req, res) => {
  try {
    const handle = req.params.handle;
    const payerWalletAddress = String(req.body?.walletAddress ?? '');
    const amountUsdc = Number(req.body?.amountUsdc ?? 0);
    const txHashRaw = String(req.body?.txHash ?? '').trim();
    const purposeRaw = String(req.body?.purpose ?? '').trim();
    const message = String(req.body?.message ?? '');
    const signature = String(req.body?.signature ?? '');

    if (!isAddress(payerWalletAddress)) {
      return res.status(400).json({ error: 'Valid walletAddress is required' });
    }
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      return res.status(400).json({ error: 'amountUsdc must be > 0' });
    }

    const payerWallet = getAddress(payerWalletAddress);
    const payeeWallet = await resolveHandle(handle);
    const client = createPublicClient({ chain, transport: http(ARC.rpc) });

    if (txHashRaw) {
      if (!/^0x[a-fA-F0-9]{64}$/.test(txHashRaw)) {
        return res.status(400).json({ error: 'Valid txHash is required' });
      }

      const txHash = txHashRaw as `0x${string}`;
      const amountRaw = parseUnits(amountUsdc.toFixed(6), 6);
      const [tx, receipt] = await Promise.all([
        client.getTransaction({ hash: txHash }),
        client.getTransactionReceipt({ hash: txHash }),
      ]);

      if (receipt.status !== 'success') {
        return res.status(400).json({ success: false, error: 'Payment tx failed onchain' });
      }

      if (getAddress(tx.from) !== payerWallet) {
        return res.status(400).json({ error: 'Payment transaction sender does not match walletAddress' });
      }

      const matchedTransfer = receipt.logs.some((log) => {
        if (getAddress(log.address) !== getAddress(ARC_USDC)) {
          return false;
        }
        try {
          const decoded = decodeEventLog({
            abi: [transferEvent],
            data: log.data,
            topics: log.topics,
          });

          if (decoded.eventName !== 'Transfer') {
            return false;
          }

          return (
            getAddress(String(decoded.args.from)) === payerWallet &&
            getAddress(String(decoded.args.to)) === getAddress(payeeWallet) &&
            BigInt(decoded.args.value as bigint) === amountRaw
          );
        } catch {
          return false;
        }
      });

      if (!matchedTransfer) {
        return res.status(400).json({
          error: 'Could not verify a matching USDC transfer in the supplied transaction receipt',
        });
      }

      const { data: existingTx, error: existingError } = await adminDb
        .from('transactions')
        .select('arc_tx_id')
        .eq('arc_tx_id', txHash)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      if (!existingTx?.arc_tx_id) {
        const { error: insertError } = await adminDb.from('transactions').insert({
          from_wallet: payerWallet,
          to_wallet: payeeWallet,
          amount: amountUsdc,
          arc_tx_id: txHash,
          action_type: 'payment',
          status: 'complete',
          created_at: new Date().toISOString(),
        });

        if (insertError) {
          throw new Error(insertError.message);
        }

        await recordPublicPaymentDetails({
          payeeWallet,
          payerWallet,
          amountUsdc,
          txHash,
          handle: handle.toLowerCase(),
          purpose: purposeRaw || null,
        });
      }

      return res.json({
        success: true,
        handle: handle.toLowerCase(),
        fromWallet: payerWallet,
        toWallet: payeeWallet,
        amountUsdc,
        txHash,
        recorded: !existingTx?.arc_tx_id,
        message: `Payment confirmed on Arc: ${txHash}`,
      });
    }

    if (!message || !signature) {
      return res.status(400).json({ error: 'message and signature are required when txHash is not supplied' });
    }

    const valid = await verifyMessage({
      address: payerWallet,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const userAgentWallet = await getOrCreateUserAgentWallet(payerWallet);
    const amountRaw = parseUnits(amountUsdc.toFixed(6), 6);

    const tx = await executeTransaction({
      walletId: userAgentWallet.wallet_id,
      contractAddress: ARC_USDC,
      abiFunctionSignature: 'transfer(address,uint256)',
      abiParameters: [payeeWallet, amountRaw.toString()],
      feeLevel: 'HIGH',
      usdcAmount: amountUsdc,
    });

    const txId = extractTxId(tx);
    if (!txId) {
      throw new Error('Missing DCW transaction id');
    }
    const done = await waitForTransaction(txId, 'payment-execute');
    if (done.state !== 'COMPLETE' || !done.txHash) {
      return res.status(400).json({
        success: false,
        state: done.state,
        errorReason: done.errorReason,
        errorDetails: done.errorDetails,
      });
    }

    const receipt = await client.getTransactionReceipt({ hash: done.txHash as `0x${string}` });
    if (receipt.status !== 'success') {
      return res.status(400).json({ success: false, error: 'Payment tx failed onchain' });
    }

    await adminDb.from('transactions').insert({
      from_wallet: payerWallet,
      to_wallet: payeeWallet,
      amount: amountUsdc,
      arc_tx_id: done.txHash,
      action_type: 'payment',
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    await recordPublicPaymentDetails({
      payeeWallet,
      payerWallet,
      amountUsdc,
      txHash: done.txHash,
      handle: handle.toLowerCase(),
      purpose: purposeRaw || null,
    });

    return res.json({
      success: true,
      handle: handle.toLowerCase(),
      fromWallet: payerWallet,
      toWallet: payeeWallet,
      amountUsdc,
      txId,
      txHash: done.txHash,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message ?? 'payment execute failed' });
  }
});

router.get('/pay/:handle/qr', async (req, res) => {
  try {
    const buffer = await generateQR(req.params.handle);
    res.setHeader('Content-Type', 'image/png');
    return res.send(buffer);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message ?? 'qr generation failed' });
  }
});

export default router;

function extractTxId(tx: unknown): string | null {
  const obj = tx as { data?: { id?: string; transaction?: { id?: string } } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}
