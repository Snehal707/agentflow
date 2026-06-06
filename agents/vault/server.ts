import express, { type NextFunction, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { createPublicClient, formatUnits, getAddress, http, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { authMiddleware, type JWTPayload } from '../../lib/auth';
import { paidInternalOrAuthMiddleware } from '../../lib/agent-internal-auth';
import { checkRateLimit } from '../../lib/ratelimit';
import { ARC } from '../../lib/arc-config';
import { getOrCreateUserAgentWallet } from '../../lib/dcw';
import { resolveAgentPrivateKey } from '../../lib/agentPrivateKey';
import { getFacilitatorBaseUrl } from '../../lib/facilitator-url';
import { executionGuardMiddleware } from '../../lib/execution-guard';
import {
  executeDeposit,
  executeWithdraw,
  getProviderPosition,
  getUserPositionsAcrossProviders,
  getVaultApy,
  listAllVaults,
} from '../../lib/vault/router';
import type { VaultPosition } from '../../lib/vault/types';

dotenv.config();

const app = express();
app.use(express.json());

const port = Number(process.env.VAULT_AGENT_PORT || 3012);
const facilitatorUrl = getFacilitatorBaseUrl();
const price = process.env.VAULT_AGENT_PRICE ? `$${process.env.VAULT_AGENT_PRICE}` : '$0.012';
const fallbackVaultApy = Number(
  process.env.VAULT_MOCK_APY || process.env.VAULT_TARGET_APY || '5.3',
);
const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';
const readClient = createPublicClient({
  transport: http(ARC.alchemyRpc || ARC.rpc),
});
const vaultPreviewAbi = parseAbi([
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewWithdraw(uint256 assets) view returns (uint256)',
]);

async function resolveVaultQueryWallet(
  userWalletAddress: `0x${string}`,
  executionTarget: string,
): Promise<`0x${string}`> {
  if (executionTarget === 'EOA') {
    return userWalletAddress;
  }
  const executionWallet = await getOrCreateUserAgentWallet(userWalletAddress);
  return getAddress(executionWallet.address) as `0x${string}`;
}

function serializePosition(position: VaultPosition): {
  sharesRaw: string;
  sharesFormatted: string;
  underlyingValueRaw: string;
  underlyingValueFormatted: string;
  underlyingSymbol: string;
} {
  return {
    sharesRaw: position.sharesRaw.toString(),
    sharesFormatted: position.sharesFormatted,
    underlyingValueRaw: position.underlyingValueRaw.toString(),
    underlyingValueFormatted: position.underlyingValueFormatted,
    underlyingSymbol: position.underlyingSymbol,
  };
}

const account = privateKeyToAccount(resolveAgentPrivateKey());
const sellerAddress =
  (process.env.SELLER_ADDRESS?.trim() as `0x${string}`) || account.address;
const gateway = createGatewayMiddleware({ sellerAddress, facilitatorUrl });

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', agent: 'vault' });
});

const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  console.log('[vault.mw.rateLimitMiddleware]', { action: req.body?.action });
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

const executionGuardIfConfirmed = (req: Request, res: Response, next: NextFunction) => {
  console.log('[vault.mw.executionGuardIfConfirmed]', { action: req.body?.action });
  if (req.body?.confirmed === true) {
    executionGuardMiddleware(req, res, next);
    return;
  }
  next();
};

const paymentIfConfirmed = (req: Request, res: Response, next: NextFunction) => {
  console.log('[vault.mw.paymentIfConfirmed]', {
    action: req.body?.action,
    confirmed: req.body?.confirmed === true,
  });
  if (
    req.body?.action === 'list' ||
    req.body?.action === 'position' ||
    req.body?.confirmed !== true
  ) {
    return next();
  }

  const internalKey = process.env.AGENTFLOW_BRAIN_INTERNAL_KEY?.trim();
  const reqKey = (req.headers['x-agentflow-paid-internal'] as string | undefined)?.trim();
  if (internalKey && reqKey === internalKey) {
    return next();
  }

  return gateway.require(price)(req, res, next);
};

app.post('/run', (req: Request, res: Response, next: NextFunction) => {
  console.log(
    '[vault.req.in]',
    JSON.stringify({
      ts: Date.now(),
      action: req.body?.action,
      hasAuth: !!req.headers.authorization,
      hasInternal: !!req.headers['x-agentflow-paid-internal'],
      ip: req.ip,
    }),
  );
  res.on('finish', () =>
    console.log('[vault.req.out]', {
      status: res.statusCode,
    }),
  );
  res.on('close', () =>
    console.log('[vault.req.close]', {
      status: res.statusCode,
      finished: res.writableEnded,
    }),
  );
  next();
}, (req: Request, res: Response, next: NextFunction) => {
  console.log('[vault.mw.paidInternalOrAuthMiddleware.before]', { action: req.body?.action });
  paidInternalOrAuthMiddleware(req, res, next);
}, rateLimitMiddleware, executionGuardIfConfirmed, paymentIfConfirmed, async (req, res) => {
  try {
    const auth = (req as any).auth as JWTPayload;
    const action = String(req.body?.action || '').toLowerCase();
    const amount = Number(req.body?.amount ?? 0);
    const walletAddress = String(req.body?.walletAddress || auth.walletAddress);
    const executionTarget = String(req.body?.executionTarget || 'DCW').toUpperCase();

    if (!walletAddress || walletAddress.toLowerCase() !== auth.walletAddress.toLowerCase()) {
      return res.status(400).json({ error: 'walletAddress must match authenticated wallet' });
    }

    if (action === 'list') {
      const vaults = await listAllVaults();
      const withApy = await Promise.all(
        vaults.map(async (vault) => ({
          ...vault,
          apy: await getVaultApy(vault.provider, vault.address),
        })),
      );
      const normalized = withApy.map((vault) => {
        const apy = vault.apy;
        if (typeof apy?.apy === 'number' && Number.isFinite(apy.apy) && apy.apy > 0) {
          return vault;
        }
        return {
          ...vault,
          apy: {
            ...apy,
            apy: fallbackVaultApy,
            method: 'mock_fallback',
          },
        };
      });
      return res.json({
        success: true,
        action,
        vaults: normalized,
      });
    }

    if (action === 'position') {
      const normalizedUserWallet = getAddress(walletAddress) as `0x${string}`;
      const queryWallet = await resolveVaultQueryWallet(normalizedUserWallet, executionTarget);
      const positions = await getUserPositionsAcrossProviders(queryWallet);
      const serializable = positions.map((entry) => ({
        provider: entry.provider,
        vault: entry.vault,
        ...serializePosition(entry),
      }));
      return res.json({
        success: true,
        action,
        positions: serializable,
        queriedWallet: queryWallet,
        userWallet: normalizedUserWallet,
      });
    }

    if (!['deposit', 'withdraw'].includes(action)) {
      return res.status(400).json({
        error: 'action must be list|position|deposit|withdraw',
      });
    }

    const providerName =
      typeof req.body?.provider === 'string' && req.body.provider.trim()
        ? req.body.provider.trim()
        : 'lunex';
    const vaultAddress =
      typeof req.body?.vaultAddress === 'string' && /^0x[a-fA-F0-9]{40}$/.test(req.body.vaultAddress)
        ? getAddress(req.body.vaultAddress)
        : null;

    if (!vaultAddress) {
      return res.status(400).json({ success: false, error: 'vaultAddress is required' });
    }

    const availableVaults = await listAllVaults();
    const selectedVault = availableVaults.find(
      (vault) => vault.provider === providerName && vault.address === vaultAddress,
    );
    if (!selectedVault) {
      return res.status(400).json({
        success: false,
        error: 'vaultAddress/provider pair is not a known supported vault',
      });
    }

    const assetAddress = getAddress(selectedVault.asset);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be a positive number' });
    }

    const amountRaw = parseUnits(String(amount), 6);

    if (req.body?.confirmed !== true) {
      if (action === 'deposit') {
        const expectedSharesRaw = (await readClient.readContract({
          address: vaultAddress,
          abi: vaultPreviewAbi,
          functionName: 'previewDeposit',
          args: [amountRaw],
        })) as bigint;
        return res.json({
          success: true,
          action: 'preview',
          provider: selectedVault.provider,
          preview: {
            action: 'deposit',
            vault: selectedVault.label,
            vaultAddress,
            assetAddress,
            amount,
            amountRaw: amountRaw.toString(),
            expectedSharesRaw: expectedSharesRaw.toString(),
            expectedSharesFormatted: formatUnits(expectedSharesRaw, 6),
            provider: selectedVault.provider,
            experimental: selectedVault.experimental,
            notes: selectedVault.notes,
          },
        });
      }

      const normalizedUserWallet = getAddress(walletAddress) as `0x${string}`;
      const queryWallet = await resolveVaultQueryWallet(normalizedUserWallet, executionTarget);
      const position = await getProviderPosition(
        selectedVault.provider,
        queryWallet,
        vaultAddress,
      );
      const currentPosition = serializePosition(position);
      const expectedSharesBurnedRaw = (await readClient.readContract({
        address: vaultAddress,
        abi: vaultPreviewAbi,
        functionName: 'previewWithdraw',
        args: [amountRaw],
      })) as bigint;
      return res.json({
        success: true,
        action: 'preview',
        provider: selectedVault.provider,
        preview: {
          action: 'withdraw',
          vault: selectedVault.label,
          vaultAddress,
          assetAddress,
          amount,
          amountRaw: amountRaw.toString(),
          expectedSharesBurnedRaw: expectedSharesBurnedRaw.toString(),
          expectedSharesBurnedFormatted: formatUnits(expectedSharesBurnedRaw, 6),
          currentPosition,
          queriedWallet: queryWallet,
          provider: selectedVault.provider,
          experimental: selectedVault.experimental,
          notes: selectedVault.notes,
        },
      });
    }

    const executionWallet = await getOrCreateUserAgentWallet(getAddress(walletAddress));

    if (action === 'deposit') {
      try {
        const result = await executeDeposit(selectedVault.provider, {
          walletId: executionWallet.wallet_id,
          walletAddress: getAddress(executionWallet.address) as `0x${string}`,
          vaultAddress,
          assetAddress,
          amountInRaw: amountRaw,
          slippageBps: 100,
        });
        return res.json({
          success: true,
          action,
          provider: result.provider,
          txId: result.txId,
          txHash: result.txHash,
          approvalTxId: result.approvalTxId ?? null,
          approvalTxHash: result.approvalTxHash ?? null,
          approvalSkipped: result.approvalSkipped,
          sharesReceivedRaw: result.sharesReceivedRaw.toString(),
          sharesReceivedFormatted: formatUnits(result.sharesReceivedRaw, 6),
          assetsDepositedRaw: amountRaw.toString(),
          assetsDepositedFormatted: formatUnits(amountRaw, 6),
          vaultSymbol: selectedVault.vaultSymbol,
          vaultLabel: selectedVault.label,
          assetSymbol: selectedVault.assetSymbol,
          network: selectedVault.network,
          experimental: selectedVault.experimental,
          notes: selectedVault.notes,
          receipt: {
            explorerLink: `${explorerBase}${result.txHash}`,
            approvalExplorerLink: result.approvalTxHash
              ? `${explorerBase}${result.approvalTxHash}`
              : null,
          },
        });
      } catch (error) {
        return res.status(502).json({ success: false, error: toMessage(error) });
      }
    }

    try {
      const result = await executeWithdraw(selectedVault.provider, {
        walletId: executionWallet.wallet_id,
        walletAddress: getAddress(executionWallet.address) as `0x${string}`,
        vaultAddress,
        assetAddress,
        amountOutRaw: amountRaw,
      });
      return res.json({
        success: true,
        action,
        provider: result.provider,
        txId: result.txId,
        txHash: result.txHash,
        sharesBurnedRaw: result.sharesBurnedRaw.toString(),
        sharesBurnedFormatted: formatUnits(result.sharesBurnedRaw, 6),
        assetsReceivedRaw: result.assetsReceivedRaw.toString(),
        assetsReceivedFormatted: formatUnits(result.assetsReceivedRaw, 6),
        vaultSymbol: selectedVault.vaultSymbol,
        vaultLabel: selectedVault.label,
        assetSymbol: selectedVault.assetSymbol,
        network: selectedVault.network,
        experimental: selectedVault.experimental,
        notes: selectedVault.notes,
        receipt: {
          explorerLink: `${explorerBase}${result.txHash}`,
        },
      });
    } catch (error) {
      return res.status(502).json({ success: false, error: toMessage(error) });
    }
  } catch (error) {
    console.error('[vault.handler.error]', {
      action: req.body?.action,
      message: error instanceof Error ? error.message : String(error),
      stack:
        error instanceof Error
          ? error.stack?.split('\n').slice(0, 5)
          : undefined,
    });
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

app.listen(port, () => {
  console.log(`Vault agent running on :${port}`);
});

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
