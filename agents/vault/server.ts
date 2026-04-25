import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { getAddress, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { ARC } from '../../lib/arc-config';
import { getOrCreateUserAgentWallet } from '../../lib/dcw';
import { calculateScore, recordReputationSafe } from '../../lib/reputation';
import { getOrCreateAgentWallets } from '../../lib/dcw';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { readVaultApyPercent } from '../../lib/vault-apy';
import { checkEntitlement, redeemUSYC, subscribeUSYC } from '../../lib/usyc';
import {
  executeVaultAction,
  getVaultOwnerWallet,
  type VaultAction,
} from './execution';
import { adminDb } from '../../db/client';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.VAULT_AGENT_PORT || 3012);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.VAULT_AGENT_PRICE ? `$${process.env.VAULT_AGENT_PRICE}` : '$0.012';
const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';
const ARC_NATIVE_USDC = '0x3600000000000000000000000000000000000000' as const;

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'vault' });
});

const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = (req as any).auth as JWTPayload | undefined;
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const amount = Number(req.body?.amount ?? 0);
    const action = String(req.body?.action ?? 'vault_action');
    const result = await checkRateLimit({
      walletAddress: auth.walletAddress,
      agentSlug: 'vault',
      actionType: action,
      amountUsd: Number.isFinite(amount) ? amount : 0,
    });
    if (!result.allowed) {
      res.status(429).json({ error: `Rate limited: ${result.reason}` });
      return;
    }
    next();
  } catch (error) {
    res.status(500).json({ error: toMessage(error) });
  }
};

app.post('/run', paidInternalOrAuthMiddleware, rateLimitMiddleware, (req: Request, res: Response, next: NextFunction) => {
  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const reqKey = (req.headers['x-agentflow-paid-internal'] as string | undefined)?.trim();
  if (internalKey && reqKey === internalKey) {
    next();
    return;
  }
  return gateway.require(price)(req, res, next);
}, async (req, res) => {
  const auth = (req as any).auth as JWTPayload;
  const action = String(req.body?.action || '').toLowerCase();
  const amount = Number(req.body?.amount ?? 0);
  const walletAddress = String(req.body?.walletAddress || auth.walletAddress);
  const executionTarget = String(req.body?.executionTarget || 'DCW').toUpperCase();
  const vaultAddress = (ARC.vaultContract || process.env.VAULT_CONTRACT_ADDRESS || '').trim() as `0x${string}`;

  if (!walletAddress || walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
    return res.status(400).json({ error: 'walletAddress must match authenticated wallet' });
  }

  if (req.body?.benchmark === true) {
    console.log('[benchmark] vault short-circuit');
    return res.json({
      ok: true,
      benchmark: true,
      agent: 'vault',
      result: 'Benchmark mode - payment logged',
    });
  }

  try {
    if (action === 'check_apy') {
      if (!vaultAddress) {
        return res.status(500).json({ error: 'VAULT_CONTRACT_ADDRESS is required' });
      }
      const apy = await readVaultApyPercent(vaultAddress);
      return res.json({ success: true, action, apy });
    }

    if (action === 'usyc_deposit' || action === 'usyc_withdraw') {
      const teller = (ARC.usycTeller || '').trim();
      const usyc = (ARC.usycAddress || '').trim();
      if (!teller || !/^0x[a-fA-F0-9]{40}$/i.test(teller)) {
        return res.status(500).json({ error: 'USYC_TELLER_ADDRESS is required' });
      }
      if (!usyc || !/^0x[a-fA-F0-9]{40}$/i.test(usyc)) {
        return res.status(500).json({ error: 'USYC_ADDRESS is required' });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }

      const normalizedUserWallet = getAddress(auth.walletAddress);
      const receiver = normalizedUserWallet;

      if (executionTarget === 'EOA') {
        const entitled = await checkEntitlement(normalizedUserWallet);
        if (!entitled) {
          return res.status(400).json({
            error:
              '[usyc] This connected wallet is not entitled for USYC on Arc Testnet yet. Complete the hackathon or Hashnote onboarding for this wallet, then retry.',
          });
        }

        return res.json({
          success: true,
          action,
          executionMode: 'EOA',
          eoaPlan: {
            action,
            walletAddress: normalizedUserWallet,
            receiverAddress: receiver,
            tellerAddress: getAddress(teller),
            usdcAddress: ARC_NATIVE_USDC,
            usycAddress: getAddress(usyc),
            amount: String(amount),
          },
        });
      }

      const executionWallet = await getOrCreateUserAgentWallet(normalizedUserWallet);

      if (action === 'usyc_deposit') {
        const result = await subscribeUSYC({
          walletId: executionWallet.wallet_id,
          walletAddress: executionWallet.address,
          usdcAmount: String(amount),
          receiverAddress: receiver,
        });
        if (result.txHash) {
          await adminDb.from('transactions').insert({
            from_wallet: executionWallet.address,
            to_wallet: teller,
            amount,
            arc_tx_id: result.txHash,
            agent_slug: 'vault',
            action_type: 'vault_usyc_deposit',
            status: 'complete',
          });
        }
        return res.json({
          success: true,
          action,
          txHash: result.txHash,
          usycReceived: result.usycReceived,
          approvalSkipped: result.approvalSkipped,
          explorerLink: `${explorerBase}${result.txHash}`,
        });
      }

      const result = await redeemUSYC({
        walletId: executionWallet.wallet_id,
        walletAddress: executionWallet.address,
        usycAmount: String(amount),
        receiverAddress: receiver,
      });
      if (result.txHash) {
        await adminDb.from('transactions').insert({
          from_wallet: executionWallet.address,
          to_wallet: receiver,
          amount,
          arc_tx_id: result.txHash,
          agent_slug: 'vault',
          action_type: 'vault_usyc_withdraw',
          status: 'complete',
        });
      }
      return res.json({
        success: true,
        action,
        txHash: result.txHash,
        usdcReceived: result.usdcReceived,
        approvalSkipped: result.approvalSkipped,
        explorerLink: `${explorerBase}${result.txHash}`,
      });
    }

    if (!vaultAddress) {
      return res.status(500).json({ error: 'VAULT_CONTRACT_ADDRESS is required' });
    }

    if (!['deposit', 'withdraw', 'compound'].includes(action)) {
      return res.status(400).json({
        error: 'action must be deposit|withdraw|compound|check_apy|usyc_deposit|usyc_withdraw',
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const amountRaw = parseUnits(Math.max(amount, 0).toFixed(6), 6);
    const normalizedUserWallet = getAddress(auth.walletAddress);
    const executionWallet =
      action === 'compound'
        ? await getVaultOwnerWallet()
        : await getOrCreateUserAgentWallet(normalizedUserWallet);

    const result = await executeVaultAction({
      action: action as VaultAction,
      walletAddress:
        action === 'compound' ? executionWallet.address : executionWallet.address,
      walletId: executionWallet.wallet_id,
      vaultAddress,
      amountRaw,
      amountUsdc: amount,
    });

    if (result.txHash) {
      const fromWallet =
        action === 'withdraw'
          ? vaultAddress
          : action === 'compound'
            ? executionWallet.address
            : executionWallet.address;
      const toWallet =
        action === 'withdraw' ? executionWallet.address : vaultAddress;

      await adminDb.from('transactions').insert({
        from_wallet: fromWallet,
        to_wallet: toWallet,
        amount,
        arc_tx_id: result.txHash,
        agent_slug: 'vault',
        action_type: `vault_${action}`,
        status: 'complete',
      });
    }

    let reputation: { success: boolean; txHash?: string } | null = null;
    const { ownerWallet, validatorWallet } = await getOrCreateAgentWallets('vault');
    if (ownerWallet.erc8004_token_id) {
      const score = calculateScore('vault', {
        actualAPY: await readVaultApyPercent(vaultAddress),
        quotedAPY: Number(process.env.VAULT_TARGET_APY || '8'),
      });
      await recordReputationSafe(
        ownerWallet.erc8004_token_id,
        score,
        `vault_${action}`,
        validatorWallet.address,
      );
    }

    return res.json({
      success: true,
      action,
      txId: result.txId,
      txHash: result.txHash,
      approvalTxId: result.approvalTxId ?? null,
      approvalSkipped: result.approvalSkipped,
      explorerLink: result.txHash ? `${explorerBase}${result.txHash}` : null,
      reputation,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: toMessage(error) });
  }
});

app.listen(port, () => {
  console.log(`Vault agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
