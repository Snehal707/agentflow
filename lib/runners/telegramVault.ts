import { createPublicClient, formatUnits, getAddress, http, parseAbi, parseUnits } from 'viem';
import { adminDb } from '../../db/client';
import { ARC } from '../arc-config';
import { getOrCreateAgentWallets, getOrCreateUserAgentWallet } from '../dcw';
import { calculateScore, recordReputationSafe } from '../reputation';
import { readVaultApyPercent } from '../vault-apy';
import { formatVaultReceiptWithHermes } from '../telegramReceipts';
import { getUSYCPrice, redeemUSYC, subscribeUSYC } from '../usyc';
import {
  executeVaultAction,
  readVaultBalances,
  readVaultPaused,
  readVaultSharePreview,
  type VaultAction,
} from '../../agents/vault/execution';
import { executeUserPaidAgentViaX402, VAULT_AGENT_PRICE_LABEL, VAULT_RUN_URL } from '../paidAgentX402';
import { runPortfolioFollowupAfterTool } from '../a2a-followups';
import { PORTFOLIO_AGENT_PRICE_LABEL, PORTFOLIO_AGENT_RUN_URL } from '../agentRunConfig';
import { buildGatewayLowMessage, isLikelyGatewayOrBalanceError } from '../telegramPaymentHints';
import {
  arcscanTxViewUrl,
  formatNanopaymentRequestLine,
  formatX402NanopaymentFeeLine,
  shortHash,
} from '../telegramX402SuccessCopy';

const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';

const MIN_VAULT_USDC = 0.01;
const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;

export interface VaultClassicPayload {
  kind: 'vault';
  userWalletAddress: string;
  executionWalletAddress: string;
  action: 'deposit' | 'withdraw';
  amount: number;
  amountRaw: string;
  vaultAddress: `0x${string}`;
}

export interface UsycVaultPayload {
  kind: 'usyc';
  userWalletAddress: string;
  executionWalletAddress: string;
  action: 'usyc_deposit' | 'usyc_withdraw';
  amount: number;
  amountRaw: string;
}

/** @deprecated Use VaultClassicPayload — kept for Redis payloads without `kind` */
export type LegacyVaultExecutionPayload = Omit<VaultClassicPayload, 'kind'> & { kind?: 'vault' };

export type VaultExecutionPayload = VaultClassicPayload | UsycVaultPayload;

export type VaultPaymentMode = 'x402' | 'dcw';

export interface TelegramVaultResult {
  txHash?: string;
  action: VaultAction | 'usyc_deposit' | 'usyc_withdraw';
  approvalSkipped: boolean;
  apyPercent?: number;
  explorerLink: string | null;
  walletSharesFormatted?: string;
  receiptMessage?: string;
  usycSideAmount?: string;
  paymentMode?: VaultPaymentMode;
}

export interface VaultSimulationResult {
  ok: boolean;
  blockReason?: string;
  summaryLines: string[];
  payload?: VaultExecutionPayload;
}

const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

function isUsycPayload(p: VaultExecutionPayload | LegacyVaultExecutionPayload): p is UsycVaultPayload {
  return (p as UsycVaultPayload).kind === 'usyc';
}

function isClassicPayload(p: VaultExecutionPayload | LegacyVaultExecutionPayload): p is VaultClassicPayload | LegacyVaultExecutionPayload {
  const any = p as { kind?: string; vaultAddress?: string };
  if (any.kind === 'usyc') return false;
  if (any.kind === 'vault') return true;
  return Boolean(any.vaultAddress);
}

export async function simulateTelegramVault(input: {
  walletAddress: string;
  action: 'deposit' | 'withdraw';
  amount: number;
}): Promise<VaultSimulationResult> {
  const vaultAddress = (ARC.vaultContract || process.env.VAULT_CONTRACT_ADDRESS || '').trim() as `0x${string}`;
  if (!vaultAddress) {
    return { ok: false, blockReason: 'VAULT_CONTRACT_ADDRESS is not configured.', summaryLines: [] };
  }

  if (!Number.isFinite(input.amount) || input.amount < MIN_VAULT_USDC) {
    return {
      ok: false,
      blockReason: `Minimum amount is ${MIN_VAULT_USDC} USDC.`,
      summaryLines: [],
    };
  }

  const normalizedUserWallet = getAddress(input.walletAddress);
  const executionWallet = await getOrCreateUserAgentWallet(normalizedUserWallet);
  const amountRaw = parseUnits(input.amount.toFixed(6), 6);

  const paused = await readVaultPaused(vaultAddress);
  if (paused === true) {
    return {
      ok: false,
      blockReason: 'Vault is paused. Try again later.',
      summaryLines: [],
    };
  }

  const balances = await readVaultBalances(vaultAddress, executionWallet.address);
  const preview = await readVaultSharePreview({
    vaultAddress,
    depositAssetsRaw: input.action === 'deposit' ? amountRaw : 0n,
    withdrawAssetsRaw: input.action === 'withdraw' ? amountRaw : 0n,
  });

  if (input.action === 'deposit') {
    if (balances.walletUsdcRaw < amountRaw) {
      return {
        ok: false,
        blockReason: `Insufficient USDC on execution wallet. Balance: ${formatUnits(balances.walletUsdcRaw, 6)} USDC, needed: ${input.amount.toFixed(2)} USDC.`,
        summaryLines: [],
      };
    }

    const sharesFmt = formatUnits(preview.depositSharesRaw, 6);
    const estYield = (input.amount * preview.apyPercent) / 100;

    const summaryLines = [
      '📊 Vault simulation:',
      '',
      `Deposit:         ${input.amount.toFixed(2)} USDC`,
      `Shares received: ${Number(sharesFmt).toFixed(2)} afvUSDC (preview)`,
      `Current APY:     ${preview.apyPercent.toFixed(2)}%`,
      '',
      `Estimated yearly yield: ${estYield.toFixed(2)} USDC`,
      '',
      '✅ Simulation passed',
      '',
      'Execute? Reply YES or NO.',
    ];

    return {
      ok: true,
      summaryLines,
      payload: {
        kind: 'vault',
        userWalletAddress: normalizedUserWallet,
        executionWalletAddress: executionWallet.address,
        action: 'deposit',
        amount: input.amount,
        amountRaw: amountRaw.toString(),
        vaultAddress,
      },
    };
  }

  const sharesNeeded = preview.withdrawSharesRaw;
  if (balances.walletSharesRaw < sharesNeeded) {
    return {
      ok: false,
      blockReason: `Insufficient vault shares. Have ${formatUnits(balances.walletSharesRaw, 6)}, need ${formatUnits(sharesNeeded, 6)} (preview) to withdraw ${input.amount.toFixed(2)} USDC.`,
      summaryLines: [],
    };
  }

  const usdcOutFmt = input.amount.toFixed(2);
  const summaryLines = [
    '📊 Vault simulation:',
    '',
    `Withdraw:       ${input.amount.toFixed(2)} USDC (assets)`,
    `Shares burned:  ${Number(formatUnits(sharesNeeded, 6)).toFixed(2)} (preview)`,
    `Current APY:    ${preview.apyPercent.toFixed(2)}%`,
    '',
    `You receive: ~${usdcOutFmt} USDC`,
    '',
    '✅ Simulation passed',
    '',
    'Execute? Reply YES or NO.',
  ];

  return {
    ok: true,
    summaryLines,
    payload: {
      kind: 'vault',
      userWalletAddress: normalizedUserWallet,
      executionWalletAddress: executionWallet.address,
      action: 'withdraw',
      amount: input.amount,
      amountRaw: amountRaw.toString(),
      vaultAddress,
    },
  };
}

export async function simulateTelegramUsyc(input: {
  walletAddress: string;
  action: 'usyc_deposit' | 'usyc_withdraw';
  amount: number;
}): Promise<VaultSimulationResult> {
  const teller = (ARC.usycTeller || '').trim();
  const usycToken = (ARC.usycAddress || '').trim();
  if (!teller || !usycToken) {
    return { ok: false, blockReason: 'USYC addresses are not configured.', summaryLines: [] };
  }

  if (!Number.isFinite(input.amount) || input.amount < MIN_VAULT_USDC) {
    return {
      ok: false,
      blockReason: `Minimum amount is ${MIN_VAULT_USDC} USDC.`,
      summaryLines: [],
    };
  }

  const normalizedUserWallet = getAddress(input.walletAddress);
  const executionWallet = await getOrCreateUserAgentWallet(normalizedUserWallet);
  const amountRaw = parseUnits(input.amount.toFixed(6), 6);

  const client = createPublicClient({ transport: http(ARC.rpc) });
  const usycAddr = getAddress(usycToken) as `0x${string}`;
  const execAddr = getAddress(executionWallet.address) as `0x${string}`;

  let usycDecimals = 6;
  try {
    usycDecimals = Number(
      await client.readContract({
        address: usycAddr,
        abi: erc20Abi,
        functionName: 'decimals',
      }),
    );
  } catch {
    usycDecimals = 6;
  }

  const priceUsd = await getUSYCPrice();
  const estApy = Number(process.env.USYC_ESTIMATED_APY?.trim() || '5.3');

  if (input.action === 'usyc_deposit') {
    const usdcBal = (await client.readContract({
      address: ARC_USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [execAddr],
    })) as bigint;
    if (usdcBal < amountRaw) {
      return {
        ok: false,
        blockReason: `Insufficient USDC on execution wallet. Balance: ${formatUnits(usdcBal, 6)} USDC.`,
        summaryLines: [],
      };
    }

    const summaryLines = [
      'USYC simulation:',
      '',
      `Subscribe:     ${input.amount.toFixed(2)} USDC`,
      `Oracle (NAV):  ~${priceUsd.toFixed(4)} USD`,
      `Est. yield:   ~${estApy.toFixed(1)}% APY (overnight rate — estimate)`,
      '',
      'Simulation passed.',
      '',
      'Execute? Reply YES or NO.',
    ];

    return {
      ok: true,
      summaryLines,
      payload: {
        kind: 'usyc',
        userWalletAddress: normalizedUserWallet,
        executionWalletAddress: executionWallet.address,
        action: 'usyc_deposit',
        amount: input.amount,
        amountRaw: amountRaw.toString(),
      },
    };
  }

  const sharesRaw = parseUnits(input.amount.toFixed(usycDecimals), usycDecimals);
  const usycBal = (await client.readContract({
    address: usycAddr,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [execAddr],
  })) as bigint;

  if (usycBal < sharesRaw) {
    return {
      ok: false,
      blockReason: `Insufficient USYC. Have ${formatUnits(usycBal, usycDecimals)}, need ${input.amount.toFixed(2)} USYC.`,
      summaryLines: [],
    };
  }

  const summaryLines = [
    'USYC simulation:',
    '',
    `Redeem:        ${input.amount.toFixed(2)} USYC`,
    `Oracle (NAV): ~${priceUsd.toFixed(4)} USD`,
    '',
    'Simulation passed.',
    '',
    'Execute? Reply YES or NO.',
  ];

  return {
    ok: true,
    summaryLines,
    payload: {
      kind: 'usyc',
      userWalletAddress: normalizedUserWallet,
      executionWalletAddress: executionWallet.address,
      action: 'usyc_withdraw',
      amount: input.amount,
      amountRaw: sharesRaw.toString(),
    },
  };
}

type VaultRunResponse = {
  success?: boolean;
  error?: string;
  txHash?: string;
  explorerLink?: string | null;
  action?: string;
  usycReceived?: string;
  approvalSkipped?: boolean;
};

function vaultPastTenseAmountLine(amount: number, effective: string): string {
  if (effective === 'deposit') return `Deposited ${amount.toFixed(2)} USDC`;
  if (effective === 'withdraw') return `Withdrew ${amount.toFixed(2)} USDC`;
  if (effective === 'usyc_deposit') return `Subscribed ${amount.toFixed(2)} USDC`;
  if (effective === 'usyc_withdraw') return `Redeemed ${amount.toFixed(2)} USYC`;
  return `${effective} ${amount.toFixed(2)} USDC`;
}

function scheduleTelegramVaultPortfolioA2A(
  walletAddress: string,
  details: string,
  paymentMode: VaultPaymentMode,
) {
  void runPortfolioFollowupAfterTool({
    buyerAgentSlug: 'vault',
    userWalletAddress: getAddress(walletAddress as `0x${string}`),
    portfolioRunUrl: PORTFOLIO_AGENT_RUN_URL,
    portfolioPriceLabel: PORTFOLIO_AGENT_PRICE_LABEL,
    trigger: 'post_vault',
    details: { paymentMode, summary: details },
  }).catch((e) => console.warn('[telegram/vault] A2A follow-up failed:', e));
}

function vaultSuccessTitle(action: string, mode: 'x402' | 'dcw'): string {
  const suffix = mode === 'x402' ? '· x402' : '· DCW';
  switch (action) {
    case 'deposit':
      return `✅ Vault Deposit complete ${suffix}`;
    case 'withdraw':
      return `✅ Vault Withdraw complete ${suffix}`;
    case 'usyc_deposit':
      return `✅ Vault USYC subscribe complete ${suffix}`;
    case 'usyc_withdraw':
      return `✅ Vault USYC redeem complete ${suffix}`;
    default:
      return `✅ Vault ${action} complete ${suffix}`;
  }
}

function buildVaultDcwTelegramReceipt(input: {
  action: string;
  amountLine: string;
  txHash: string;
}): string {
  return [
    vaultSuccessTitle(input.action, 'dcw'),
    '',
    input.amountLine,
    `Tx: ${shortHash(input.txHash)}`,
    arcscanTxViewUrl(input.txHash),
    '',
    'Executed via Agent Wallet',
    'Fund Gateway at agentflow.one/funds',
    'to enable nanopayments',
  ].join('\n');
}

async function executeTelegramUsycVaultDirect(input: {
  payload: UsycVaultPayload;
  onStatus?: (msg: string) => void | Promise<void>;
}): Promise<TelegramVaultResult> {
  const p = input.payload;
  const normalizedUserWallet = getAddress(p.userWalletAddress);
  const executionWallet = await getOrCreateUserAgentWallet(normalizedUserWallet);
  const teller = (ARC.usycTeller || '').trim();

  if (p.action === 'usyc_deposit') {
    await input.onStatus?.('Subscribing USYC (approve + deposit)...');
    const result = await subscribeUSYC({
      walletId: executionWallet.wallet_id,
      walletAddress: executionWallet.address,
      usdcAmount: String(p.amount),
      receiverAddress: normalizedUserWallet,
    });

    if (result.txHash) {
      await adminDb.from('transactions').insert({
        from_wallet: executionWallet.address,
        to_wallet: teller || executionWallet.address,
        amount: p.amount,
        arc_tx_id: result.txHash,
        agent_slug: 'vault',
        action_type: 'vault_usyc_deposit',
        status: 'complete',
      });
    }

    const explorerLink = `${explorerBase}${result.txHash}`;
    const receiptMessage = [
      `USYC subscribe complete. Received ~${result.usycReceived} USYC.`,
      `Tx: ${result.txHash.slice(0, 10)}…`,
      `View: ${explorerLink}`,
    ].join('\n');

    return {
      txHash: result.txHash,
      action: 'usyc_deposit',
      approvalSkipped: result.approvalSkipped,
      explorerLink,
      receiptMessage,
      usycSideAmount: result.usycReceived,
    };
  }

  await input.onStatus?.('Redeeming USYC...');
  const result = await redeemUSYC({
    walletId: executionWallet.wallet_id,
    walletAddress: executionWallet.address,
    usycAmount: String(p.amount),
    receiverAddress: normalizedUserWallet,
  });

  if (result.txHash) {
    await adminDb.from('transactions').insert({
      from_wallet: executionWallet.address,
      to_wallet: normalizedUserWallet,
      amount: p.amount,
      arc_tx_id: result.txHash,
      agent_slug: 'vault',
      action_type: 'vault_usyc_withdraw',
      status: 'complete',
    });
  }

  const explorerLink = `${explorerBase}${result.txHash}`;
  const receiptMessage = [
    `USYC redeem complete. Received ~${result.usdcReceived} USDC.`,
    `Tx: ${result.txHash.slice(0, 10)}…`,
    `View: ${explorerLink}`,
  ].join('\n');

  return {
    txHash: result.txHash,
    action: 'usyc_withdraw',
    approvalSkipped: result.approvalSkipped,
    explorerLink,
    receiptMessage,
    usycSideAmount: result.usdcReceived,
  };
}

async function executeTelegramVaultClassicDirect(input: {
  payload: VaultClassicPayload | LegacyVaultExecutionPayload;
  onStatus?: (msg: string) => void | Promise<void>;
}): Promise<TelegramVaultResult> {
  const classic = input.payload;
  const vaultAddress = classic.vaultAddress as `0x${string}`;
  const amountRaw = BigInt(classic.amountRaw);
  const normalizedUserWallet = getAddress(classic.userWalletAddress);
  const executionWalletAddress = getAddress(classic.executionWalletAddress);

  const executionWallet = await getOrCreateUserAgentWallet(normalizedUserWallet);

  await input.onStatus?.(
    classic.action === 'deposit' ? 'Approving USDC...' : 'Withdrawing from vault...',
  );
  if (classic.action === 'deposit') {
    await input.onStatus?.('Depositing to vault...');
  }

  const result = await executeVaultAction({
    action: classic.action,
    walletAddress: executionWalletAddress,
    walletId: executionWallet.wallet_id,
    vaultAddress,
    amountRaw,
    amountUsdc: classic.amount,
  });

  if (result.txHash) {
    const fromWallet = classic.action === 'withdraw' ? vaultAddress : executionWalletAddress;
    const toWallet = classic.action === 'withdraw' ? executionWalletAddress : vaultAddress;

    await adminDb.from('transactions').insert({
      from_wallet: fromWallet,
      to_wallet: toWallet,
      amount: classic.amount,
      arc_tx_id: result.txHash,
      agent_slug: 'vault',
      action_type: `vault_${classic.action}`,
      status: 'complete',
    });
  }

  const apyPercent = await readVaultApyPercent(vaultAddress);

  let walletSharesFormatted: string | undefined;
  try {
    const vb = await readVaultBalances(vaultAddress, executionWalletAddress);
    walletSharesFormatted = formatUnits(vb.walletSharesRaw, 6);
  } catch {
    // optional
  }

  const { ownerWallet, validatorWallet } = await getOrCreateAgentWallets('vault');
  if (ownerWallet.erc8004_token_id) {
    const score = calculateScore('vault', {
      actualAPY: apyPercent,
      quotedAPY: Number(process.env.VAULT_TARGET_APY || '8'),
    });
    await recordReputationSafe(
      ownerWallet.erc8004_token_id,
      score,
      `vault_${classic.action}`,
      validatorWallet.address,
    );
  }

  const explorerLink = result.txHash ? `${explorerBase}${result.txHash}` : null;
  const extraLines = [
    walletSharesFormatted != null ? `Vault shares: ${walletSharesFormatted}` : '',
    `Current APY: ${apyPercent}%`,
  ].filter(Boolean);

  const receiptMessage = await formatVaultReceiptWithHermes({
    walletAddress: normalizedUserWallet,
    action: classic.action,
    amount: classic.amount,
    extraLines,
    txHash: result.txHash,
    explorerBase,
  });

  return {
    txHash: result.txHash,
    action: classic.action,
    approvalSkipped: result.approvalSkipped,
    apyPercent,
    explorerLink,
    walletSharesFormatted,
    receiptMessage,
  };
}

export async function executeTelegramVault(input: {
  payload: VaultExecutionPayload | LegacyVaultExecutionPayload;
  onStatus?: (msg: string) => void | Promise<void>;
}): Promise<TelegramVaultResult> {
  const p = input.payload;
  if (!isUsycPayload(p) && !isClassicPayload(p)) {
    throw new Error('[telegramVault] invalid vault payload');
  }
  const wallet = getAddress(
    isUsycPayload(p) ? p.userWalletAddress : (p as VaultClassicPayload).userWalletAddress,
  ) as `0x${string}`;
  const actionStr = isUsycPayload(p) ? p.action : (p as VaultClassicPayload).action;
  const amount = p.amount;
  const requiredFee = Number(String(VAULT_AGENT_PRICE_LABEL).replace(/^\$/, '')) || 0;
  const onSt = input.onStatus;

  try {
    const paid = await executeUserPaidAgentViaX402<VaultRunResponse>({
      userWalletAddress: wallet,
      url: VAULT_RUN_URL,
      agent: 'vault',
      price: VAULT_AGENT_PRICE_LABEL,
      requestId: `telegram_vault_${wallet}_${Date.now()}`,
      body: { action: actionStr, amount },
    });
    const d = paid.data;
    if (d && d.success && d.txHash) {
      const effective = String(d.action || actionStr);
      const bodyLine = vaultPastTenseAmountLine(amount, effective);
      const viewUrl = arcscanTxViewUrl(d.txHash);
      const receiptMessage = [
        vaultSuccessTitle(effective, 'x402'),
        '',
        bodyLine,
        `Tx: ${shortHash(d.txHash)}`,
        viewUrl,
        '',
        formatX402NanopaymentFeeLine(VAULT_AGENT_PRICE_LABEL),
        formatNanopaymentRequestLine(paid.requestId),
      ].join('\n');
      const r: TelegramVaultResult = {
        txHash: d.txHash,
        action: (d.action as VaultAction) || (actionStr as VaultAction | 'usyc_deposit' | 'usyc_withdraw'),
        approvalSkipped: d.approvalSkipped ?? true,
        explorerLink: viewUrl,
        receiptMessage,
        usycSideAmount: d.usycReceived,
        paymentMode: 'x402',
      };
      scheduleTelegramVaultPortfolioA2A(p.userWalletAddress, receiptMessage, 'x402');
      return r;
    }
    onSt?.('⚠️ Agent returned no success — using Agent Wallet…');
  } catch (e) {
    const em = e instanceof Error ? e.message : String(e);
    if (isLikelyGatewayOrBalanceError(em)) onSt?.(buildGatewayLowMessage(0, requiredFee));
    else onSt?.('⚠️ x402 / agent route failed — using Agent Wallet…');
  }

  if (isUsycPayload(p)) {
    const out = await executeTelegramUsycVaultDirect({ payload: p, onStatus: onSt });
    out.paymentMode = 'dcw';
    if (out.txHash) {
      out.receiptMessage = buildVaultDcwTelegramReceipt({
        action: out.action,
        amountLine: vaultPastTenseAmountLine(p.amount, out.action),
        txHash: out.txHash,
      });
    }
    scheduleTelegramVaultPortfolioA2A(p.userWalletAddress, out.receiptMessage || 'vault', 'dcw');
    return out;
  }
  const out = await executeTelegramVaultClassicDirect({
    payload: p as VaultClassicPayload | LegacyVaultExecutionPayload,
    onStatus: onSt,
  });
  out.paymentMode = 'dcw';
  const classic = p as VaultClassicPayload;
  if (out.txHash) {
    out.receiptMessage = buildVaultDcwTelegramReceipt({
      action: classic.action,
      amountLine: vaultPastTenseAmountLine(classic.amount, classic.action),
      txHash: out.txHash,
    });
  }
  scheduleTelegramVaultPortfolioA2A(
    (p as VaultClassicPayload).userWalletAddress,
    out.receiptMessage || 'vault',
    'dcw',
  );
  return out;
}
