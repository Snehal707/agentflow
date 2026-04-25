import dotenv from 'dotenv';
import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
} from 'viem';

import { adminDb } from '../db/client';
import { ARC } from '../lib/arc-config';
import { waitForTransaction, type PersistedWalletRow } from '../lib/dcw';
import { fetchSwapQuote } from '../agents/swap/subagents/price';
import { calculateOptimalSlippage } from '../agents/swap/subagents/slippage';
import { executeSwap } from '../agents/swap/subagents/execute';
import { verifyTokenTransfer } from '../agents/swap/subagents/verify';

dotenv.config();

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const REQUESTED_SLIPPAGE = 1;

const swapAbi = parseAbi([
  'function pairToken() view returns (address)',
  'function reserveUsdc() view returns (uint256)',
  'function reservePair() view returns (uint256)',
]);

const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

async function main(): Promise<void> {
  const swapContract = getAddress(
    process.env.SWAP_CONTRACT_ADDRESS?.trim() || '0x0f0d649Fd1b2d658ace5184933DEa3ea4e2d4517',
  ) as `0x${string}`;

  const ownerWallet = await loadSwapOwnerWallet();
  const publicClient = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  const pairToken = (await publicClient.readContract({
    address: swapContract,
    abi: swapAbi,
    functionName: 'pairToken',
  })) as `0x${string}`;

  const [reserveUsdcBefore, reservePairBefore, ownerUsdcBefore, ownerPairBefore] =
    await Promise.all([
      publicClient.readContract({
        address: swapContract,
        abi: swapAbi,
        functionName: 'reserveUsdc',
      }) as Promise<bigint>,
      publicClient.readContract({
        address: swapContract,
        abi: swapAbi,
        functionName: 'reservePair',
      }) as Promise<bigint>,
      publicClient.readContract({
        address: ARC_USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ownerWallet.address as `0x${string}`],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: pairToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ownerWallet.address as `0x${string}`],
      }) as Promise<bigint>,
    ]);

  const amountInRaw = parseUnits('1', 6);

  console.log('[test-swap] swap owner wallet');
  console.log(
    JSON.stringify(
      {
        walletId: ownerWallet.wallet_id,
        address: ownerWallet.address,
        erc8004TokenId: ownerWallet.erc8004_token_id,
      },
      null,
      2,
    ),
  );

  console.log('[test-swap] on-chain state before');
  console.log(
    JSON.stringify(
      {
        swapContract,
        tokenIn: ARC_USDC,
        tokenOut: pairToken,
        reserveUsdc: formatUnits(reserveUsdcBefore, 6),
        reservePair: formatUnits(reservePairBefore, 6),
        ownerUsdc: formatUnits(ownerUsdcBefore, 6),
        ownerPair: formatUnits(ownerPairBefore, 6),
      },
      null,
      2,
    ),
  );

  const quote = await fetchSwapQuote({
    tokenIn: ARC_USDC,
    tokenOut: pairToken,
    amountIn: amountInRaw,
  });

  const slippage = await calculateOptimalSlippage({
    walletAddress: ownerWallet.address,
    tokenPair: `${ARC_USDC}/${pairToken}`,
    requestedSlippage: REQUESTED_SLIPPAGE,
  });

  const minAmountOutRaw = applySlippage(quote.amountOut, slippage.optimalSlippage);

  console.log('[test-swap] quote');
  console.log(
    JSON.stringify(
      {
        amountIn: '1',
        amountOutRaw: quote.amountOut.toString(),
        amountOutFormatted: formatUnits(quote.amountOut, 6),
        feeRaw: quote.feeRaw?.toString() ?? null,
        feeFormatted: quote.feeRaw ? formatUnits(quote.feeRaw, 6) : null,
        quoteSource: quote.source,
        requestedSlippage: REQUESTED_SLIPPAGE,
        optimalSlippage: slippage.optimalSlippage,
        minAmountOutRaw: minAmountOutRaw.toString(),
        minAmountOutFormatted: formatUnits(minAmountOutRaw, 6),
      },
      null,
      2,
    ),
  );

  console.log('[test-swap] execute');
  const submitted = await executeSwap({
    userWalletAddress: ownerWallet.address,
    userAgentWalletId: ownerWallet.wallet_id,
    userAgentWalletAddress: ownerWallet.address as `0x${string}`,
    tokenIn: ARC_USDC,
    tokenOut: pairToken,
    amountInRaw,
    minAmountOutRaw,
  });
  console.log(
    JSON.stringify(
      {
        approvalTxId: submitted.approvalTxId ?? null,
        approvalSkipped: submitted.approvalSkipped,
        swapTxId: submitted.txId,
      },
      null,
      2,
    ),
  );

  console.log('[test-swap] verify');
  const settled = await waitForTransaction(submitted.txId, 'test-swap');
  if (settled.state !== 'COMPLETE' || !settled.txHash) {
    throw new Error(
      `[test-swap] swap transaction failed: ${settled.errorReason || settled.state || 'unknown'}`,
    );
  }

  const verified = await verifyTokenTransfer({
    tokenAddress: pairToken,
    recipient: ownerWallet.address,
    minValueRaw: minAmountOutRaw,
    txHash: settled.txHash as `0x${string}`,
    timeoutMs: 30_000,
  });

  console.log(
    JSON.stringify(
      {
        txHash: verified.txHash,
      },
      null,
      2,
    ),
  );

  const receipt = await publicClient.getTransactionReceipt({
    hash: verified.txHash,
  });

  const [reserveUsdcAfter, reservePairAfter, ownerUsdcAfter, ownerPairAfter] =
    await Promise.all([
      publicClient.readContract({
        address: swapContract,
        abi: swapAbi,
        functionName: 'reserveUsdc',
      }) as Promise<bigint>,
      publicClient.readContract({
        address: swapContract,
        abi: swapAbi,
        functionName: 'reservePair',
      }) as Promise<bigint>,
      publicClient.readContract({
        address: ARC_USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ownerWallet.address as `0x${string}`],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: pairToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ownerWallet.address as `0x${string}`],
      }) as Promise<bigint>,
    ]);

  console.log('[test-swap] receipt');
  console.log(
    JSON.stringify(
      {
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        txHash: verified.txHash,
        explorerLink: `${explorerBase}${verified.txHash}`,
        reserveUsdcAfter: formatUnits(reserveUsdcAfter, 6),
        reservePairAfter: formatUnits(reservePairAfter, 6),
        ownerUsdcAfter: formatUnits(ownerUsdcAfter, 6),
        ownerPairAfter: formatUnits(ownerPairAfter, 6),
      },
      null,
      2,
    ),
  );
}

async function loadSwapOwnerWallet(): Promise<PersistedWalletRow> {
  const { data, error } = await adminDb
    .from('wallets')
    .select('*')
    .eq('agent_slug', 'swap')
    .eq('purpose', 'owner')
    .maybeSingle();

  if (error) {
    throw new Error(`[test-swap] Failed loading swap owner wallet: ${error.message}`);
  }
  if (!data) {
    throw new Error('[test-swap] Swap owner wallet not found in Supabase');
  }

  return data as PersistedWalletRow;
}

function applySlippage(amountOut: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round(slippagePercent * 100));
  const scale = 10_000n;
  return (amountOut * (scale - bps)) / scale;
}

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';

main().catch((error) => {
  console.error('[test-swap] Fatal:', error);
  process.exit(1);
});
