import { formatUnits, getAddress } from 'viem';
import { adminDb } from '../../db/client';
import { ARC } from '../arc-config';
import { getOrCreateAgentWallets, getOrCreateUserAgentWallet, waitForTransaction } from '../dcw';
import { calculateScore, recordReputationSafe } from '../reputation';
import { executeSwap } from '../../agents/swap/subagents/execute';
import { verifyTokenTransfer } from '../../agents/swap/subagents/verify';
import type { SwapSimulationExecutionPayload } from '../../agents/swap/subagents/simulation';
import { formatSwapReceipt } from '../telegramReceipts';
import { executeUserPaidAgentViaX402, SWAP_AGENT_PRICE_LABEL, SWAP_RUN_URL } from '../paidAgentX402';
import { runPortfolioFollowupAfterTool } from '../a2a-followups';
import { PORTFOLIO_AGENT_PRICE_LABEL, PORTFOLIO_AGENT_RUN_URL } from '../agentRunConfig';
import { buildGatewayLowMessage, isLikelyGatewayOrBalanceError } from '../telegramPaymentHints';
import {
  arcscanTxViewUrl,
  formatNanopaymentRequestLine,
  formatX402NanopaymentFeeLine,
  shortHash,
} from '../telegramX402SuccessCopy';

export type { SwapSimulationExecutionPayload } from '../../agents/swap/subagents/simulation';
export { simulateSwapExecution } from '../../agents/swap/subagents/simulation';

const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';

export type SwapPaymentMode = 'x402' | 'dcw';

export interface TelegramSwapResult {
  txHash: string;
  explorerLink: string;
  amountIn: number;
  quoteOutRaw: string;
  amountOutFormatted: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  /** Optional friendly copy from Hermes (fallback to deterministic in caller). */
  receiptMessage?: string;
  /** How the swap agent fee was paid; absent for legacy callers. */
  paymentMode?: SwapPaymentMode;
  /** True when we attempted x402 but fell back; optional Gateway hint. */
  gatewayHint?: string;
}

type SwapRunResponse = {
  success?: boolean;
  txHash?: string;
  error?: string;
  receipt?: {
    explorerLink?: string;
    quoteOutRaw?: string;
  };
};

function scheduleTelegramSwapPortfolioA2A(walletAddress: string, details: string, paymentMode: SwapPaymentMode) {
  void runPortfolioFollowupAfterTool({
    buyerAgentSlug: 'swap',
    userWalletAddress: getAddress(walletAddress as `0x${string}`),
    portfolioRunUrl: PORTFOLIO_AGENT_RUN_URL,
    portfolioPriceLabel: PORTFOLIO_AGENT_PRICE_LABEL,
    trigger: 'post_swap',
    details: { paymentMode, summary: details },
  }).catch((e) => console.warn('[telegram/swap] A2A follow-up failed:', e));
}

/**
 * DCW on-chain path after simulation (no HTTP swap agent) — also used as fallback when x402 is unavailable.
 */
export async function executeTelegramSwapDirect(input: {
  payload: SwapSimulationExecutionPayload;
  onStatus?: (msg: string) => void | Promise<void>;
}): Promise<TelegramSwapResult> {
  const p = input.payload;
  const amountRaw = BigInt(p.amountRaw);
  const minAmountOutRaw = BigInt(p.minAmountOutRaw);

  const userAgentWallet = await getOrCreateUserAgentWallet(p.walletAddress);
  const startedAt = Date.now();

  await input.onStatus?.('Executing swap...');

  const submitted = await executeSwap({
    userWalletAddress: p.walletAddress,
    userAgentWalletId: userAgentWallet.wallet_id,
    userAgentWalletAddress: userAgentWallet.address as `0x${string}`,
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    amountInRaw: amountRaw,
    minAmountOutRaw,
  });

  const polled = await waitForTransaction(submitted.txId, 'swap');
  if (polled.state !== 'COMPLETE' || !polled.txHash) {
    throw new Error(`[swap] Circle tx failed: ${polled.errorReason || polled.state}`);
  }

  const verified = await verifyTokenTransfer({
    tokenAddress: p.tokenOut,
    recipient: userAgentWallet.address,
    minValueRaw: minAmountOutRaw,
    txHash: polled.txHash as `0x${string}`,
    timeoutMs: 30_000,
  });
  const txHash = verified.txHash;

  const quoteAmountOut = BigInt(p.quoteAmountOutRaw);
  const trace = {
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    quoteOutRaw: p.quoteAmountOutRaw,
    minAmountOutRaw: p.minAmountOutRaw,
    requestedSlippage: p.requestedSlippage,
    optimalSlippage: p.optimalSlippage,
    observedSlippage: p.optimalSlippage,
    reason: 'execute_after_simulation',
    swapTxId: submitted.txId,
    approvalTxId: submitted.approvalTxId ?? null,
    approvalSkipped: submitted.approvalSkipped,
    quoteSource: p.quoteSource,
    quoteFeeRaw: p.quoteFeeRaw,
  };

  await adminDb.from('transactions').insert({
    from_wallet: p.walletAddress,
    to_wallet: ARC.swapContract || p.tokenOut,
    amount: p.amount,
    arc_tx_id: txHash,
    agent_slug: 'swap',
    action_type: 'swap',
    status: 'complete',
  });

  await adminDb.from('agent_interactions').insert({
    wallet_address: p.walletAddress,
    agent_slug: 'swap',
    user_input: JSON.stringify({
      tokenPair: { tokenIn: p.tokenIn, tokenOut: p.tokenOut },
      amount: p.amount,
      slippage: p.requestedSlippage,
    }),
    agent_output: JSON.stringify({
      txHash,
      explorerLink: `${explorerBase}${txHash}`,
    }),
    subagent_trace: trace,
    execution_ms: Date.now() - startedAt,
  });

  const { ownerWallet, validatorWallet } = await getOrCreateAgentWallets('swap');
  if (ownerWallet.erc8004_token_id) {
    const score = calculateScore('swap', {
      slippage: p.optimalSlippage,
      expectedSlippage: p.requestedSlippage,
    });
    await recordReputationSafe(
      ownerWallet.erc8004_token_id,
      score,
      'successful_swap',
      validatorWallet.address,
    );
  }

  const amountOutFormatted = formatUnits(quoteAmountOut, 6);
  const explorerLink = `${explorerBase}${txHash}`;
  const receiptMessage = formatSwapReceipt({
    walletAddress: p.walletAddress,
    amountIn: p.amount.toFixed(2),
    tokenIn: p.fromSym.toUpperCase(),
    amountOut: formatTelegramTokenAmount(amountOutFormatted),
    tokenOut: p.toSym.toUpperCase(),
    fee: p.quoteFeeRaw ? formatTelegramTokenAmount(formatUnits(BigInt(p.quoteFeeRaw), 6)) : '0',
    priceImpact: formatTelegramPercent(p.priceImpactPct),
    txHash,
  });

  return {
    txHash,
    explorerLink,
    amountIn: p.amount,
    quoteOutRaw: p.quoteAmountOutRaw,
    amountOutFormatted,
    tokenIn: p.tokenIn,
    tokenOut: p.tokenOut,
    receiptMessage,
  };
}

/**
 * Prefer x402 → swap agent HTTP (ledger + on-chain in agent); fall back to direct DCW on any failure.
 */
export async function executeTelegramSwap(input: {
  payload: SwapSimulationExecutionPayload;
  onStatus?: (msg: string) => void | Promise<void>;
}): Promise<TelegramSwapResult> {
  const p = input.payload;
  const wallet = getAddress(p.walletAddress) as `0x${string}`;

  const x402Label = (msg: string) => void input.onStatus?.(msg);
  const requiredFeeUsd = Number(String(SWAP_AGENT_PRICE_LABEL).replace(/^\$/, '')) || 0;
  // Best-effort: if x402 path fails, always try direct. Avoid double-execution when HTTP reports success+txHash.

  try {
    const paid = await executeUserPaidAgentViaX402<SwapRunResponse>({
      userWalletAddress: wallet,
      url: SWAP_RUN_URL,
      agent: 'swap',
      price: SWAP_AGENT_PRICE_LABEL,
      requestId: `telegram_swap_${wallet}_${Date.now()}`,
      body: {
        tokenPair: { tokenIn: p.tokenIn, tokenOut: p.tokenOut },
        amount: p.amount,
        slippage: p.requestedSlippage,
      },
    });
    const data = paid.data;
    if (data && data.success && typeof data.txHash === 'string' && data.txHash) {
      const outRaw = data.receipt?.quoteOutRaw ?? p.quoteAmountOutRaw;
      const amountOutFormatted = formatUnits(BigInt(outRaw), 6);
      const swapTxHash = data.txHash;
      const viewUrl = arcscanTxViewUrl(swapTxHash);
      const fromU = p.fromSym.toUpperCase();
      const toU = p.toSym.toUpperCase();
      const line = `${p.amount} ${fromU} → ${formatTelegramTokenAmount(amountOutFormatted)} ${toU}`;
      const receiptMessage = [
        '✅ Swap complete · x402',
        '',
        line,
        `Tx: ${shortHash(swapTxHash)}`,
        viewUrl,
        '',
        formatX402NanopaymentFeeLine(SWAP_AGENT_PRICE_LABEL),
        formatNanopaymentRequestLine(paid.requestId),
      ].join('\n');
      const result: TelegramSwapResult = {
        txHash: swapTxHash,
        explorerLink: viewUrl,
        amountIn: p.amount,
        quoteOutRaw: outRaw,
        amountOutFormatted,
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        receiptMessage,
        paymentMode: 'x402',
      };
      scheduleTelegramSwapPortfolioA2A(p.walletAddress, line, 'x402');
      return result;
    }
    x402Label('⚠️ Agent returned no success — retrying via your Agent Wallet…');
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (isLikelyGatewayOrBalanceError(errMsg)) {
      const hint = buildGatewayLowMessage(0, requiredFeeUsd);
      x402Label(hint);
    } else {
      x402Label(
        '⚠️ x402 / agent route unavailable—executing via your Agent Wallet instead.',
      );
    }
  }

  const direct = await executeTelegramSwapDirect({
    ...input,
    onStatus: input.onStatus,
  });
  const received = formatTelegramTokenAmount(direct.amountOutFormatted);
  const fromU = p.fromSym.toUpperCase();
  const toU = p.toSym.toUpperCase();
  const summary = `${p.amount} ${fromU} → ${received} ${toU}`;
  direct.paymentMode = 'dcw';
  direct.receiptMessage = [
    '✅ Swap complete · DCW',
    '',
    summary,
    `Tx: ${shortHash(direct.txHash)}`,
    arcscanTxViewUrl(direct.txHash),
    '',
    'Executed via Agent Wallet',
    'Fund Gateway at agentflow.one/funds',
    'to enable nanopayments',
  ].join('\n');
  scheduleTelegramSwapPortfolioA2A(p.walletAddress, summary, 'dcw');
  return direct;
}

function formatTelegramTokenAmount(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  if (numeric === 0) {
    return '0';
  }
  return numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function formatTelegramPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a';
  }
  if (value > 0 && value < 0.01) {
    return '<0.01%';
  }
  return `${value.toFixed(2)}%`;
}
