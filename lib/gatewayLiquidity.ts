import { getAddress, type Address } from 'viem';
import { transferToGateway } from './circleWallet';
import { fetchGatewayBalanceForAddress } from './gateway-balance';

const GATEWAY_BALANCE_EPSILON = 0.000001;
const DEFAULT_GATEWAY_TOPUP_TARGET_USDC = 10;

function parseUsdcAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatUsdcAmount(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6).replace(/\.?0+$/, '') : '0';
}

function gatewayTopUpTargetUsdc(requiredAmountUsdc: number): number {
  const configured = Number(process.env.GATEWAY_AUTO_TOPUP_TARGET_USDC ?? DEFAULT_GATEWAY_TOPUP_TARGET_USDC);
  const target = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GATEWAY_TOPUP_TARGET_USDC;
  return Math.max(requiredAmountUsdc, target);
}

export type EnsureGatewayBuyerBalanceResult = {
  requiredAmountUsdc: number;
  availableBeforeUsdc: number;
  availableAfterUsdc: number;
  funded: boolean;
  depositTxHash?: string;
  depositAmountUsdc?: number;
};

export async function ensureGatewayBuyerBalance(input: {
  walletId: string;
  walletAddress: Address;
  requiredAmountUsdc: number;
  label?: string;
  requestId?: string;
}): Promise<EnsureGatewayBuyerBalanceResult> {
  const payer = getAddress(input.walletAddress);
  const requiredAmountUsdc =
    Number.isFinite(input.requiredAmountUsdc) && input.requiredAmountUsdc > 0
      ? Number(input.requiredAmountUsdc.toFixed(6))
      : 0;

  const before = await fetchGatewayBalanceForAddress(payer);
  const availableBeforeUsdc = parseUsdcAmount(before.available);

  if (requiredAmountUsdc <= 0 || availableBeforeUsdc + GATEWAY_BALANCE_EPSILON >= requiredAmountUsdc) {
    return {
      requiredAmountUsdc,
      availableBeforeUsdc,
      availableAfterUsdc: availableBeforeUsdc,
      funded: false,
    };
  }

  console.log('[gateway] buyer balance low, attempting top-up:', {
    requestId: input.requestId,
    label: input.label,
    walletId: input.walletId,
    walletAddress: payer,
    availableBeforeUsdc: formatUsdcAmount(availableBeforeUsdc),
    requiredAmountUsdc: formatUsdcAmount(requiredAmountUsdc),
  });

  const targetGatewayBalanceUsdc = gatewayTopUpTargetUsdc(requiredAmountUsdc);
  const topUpAmountUsdc = Math.max(
    requiredAmountUsdc - availableBeforeUsdc,
    targetGatewayBalanceUsdc - availableBeforeUsdc,
  );

  const deposit = await transferToGateway({
    walletId: input.walletId,
    walletAddress: payer,
    maxAmountUsdc: formatUsdcAmount(topUpAmountUsdc),
  });

  console.log('[gateway] top-up result:', {
    requestId: input.requestId,
    label: input.label,
    walletId: input.walletId,
    walletAddress: payer,
    status: deposit.status,
    depositTxHash: deposit.depositTxHash,
    amount: deposit.amount,
    errorReason: deposit.errorReason,
    errorDetails: deposit.errorDetails,
  });

  if (deposit.status !== 'COMPLETE') {
    throw new Error(
      [
        `Gateway top-up failed for ${input.label || payer}.`,
        `Request ID: ${input.requestId || 'n/a'}`,
        `Status: ${deposit.status}`,
        deposit.errorDetails || deposit.errorReason || 'Unknown error',
      ].join(' '),
    );
  }

  const after = await fetchGatewayBalanceForAddress(payer);
  const availableAfterUsdc = parseUsdcAmount(after.available);

  if (availableAfterUsdc + GATEWAY_BALANCE_EPSILON < requiredAmountUsdc) {
    throw new Error(
      [
        `Gateway balance is still too low for ${input.label || payer} after top-up.`,
        `Request ID: ${input.requestId || 'n/a'}`,
        `Available: ${formatUsdcAmount(availableAfterUsdc)} USDC.`,
        `Required: ${formatUsdcAmount(requiredAmountUsdc)} USDC.`,
      ].join(' '),
    );
  }

  return {
    requiredAmountUsdc,
    availableBeforeUsdc,
    availableAfterUsdc,
    funded: true,
    depositTxHash: deposit.depositTxHash,
    depositAmountUsdc: deposit.amount,
  };
}
