import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from 'viem';
import { ARC } from './arc-config';

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

const ARC_USDC = getAddress(
  process.env.ARC_USDC_ADDRESS?.trim() || '0x3600000000000000000000000000000000000000',
);

const ECONOMY_ARC_GAS_SCAN_BLOCKS = Math.max(
  100,
  Number.parseInt(process.env.ECONOMY_ARC_GAS_SCAN_BLOCKS || '50000', 10) || 50000,
);

const CACHE_TTL_MS = 60_000;

export type ArcBatcherGasSnapshot = {
  totalUsd: number;
  batchTxCount: number;
  ourTransferCount: number;
  totalTransfersInBatches: number;
  scannedFromBlock: number;
  scannedToBlock: number;
};

let arcReadClient: ReturnType<typeof createPublicClient> | null = null;

function getArcReadClient() {
  if (!arcReadClient) {
    arcReadClient = createPublicClient({
      transport: http(ARC.alchemyRpc || ARC.rpc),
    });
  }
  return arcReadClient;
}

let cachedSnapshot: { key: string; fetchedAt: number; payload: ArcBatcherGasSnapshot } | null =
  null;

function startOfTodayUtcMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

const RECEIPT_GAS_CACHE = new Map<
  string,
  { gasUsd: number; transfersInBatch: number; blockTimestampMs: number; fetchedAt: number }
>();
const RECEIPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Computes Arc gas pro-rata-attributed to settlements that landed on our seller agents.
 *
 * Why this exists: x402 + Circle Gateway batch many buyers' settlements into a single
 * on-chain Arc tx submitted by Circle's batcher. Buyer-side rows therefore hold a
 * Gateway transfer UUID, not a hex tx hash, so the per-row gas estimator returns 0.
 *
 * This helper finds the actual batch txs that touched our agents (by scanning USDC
 * Transfer logs where `to` is one of our seller addresses), reads their receipts,
 * and attributes each batch's gas proportionally to our share of that batch's
 * transfers.
 */
export async function fetchAttributedArcBatcherGas(
  sellerAddresses: Address[],
  options?: { batcherAddress?: Address; dayBoundaryMs?: number },
): Promise<ArcBatcherGasSnapshot> {
  const empty: ArcBatcherGasSnapshot = {
    totalUsd: 0,
    batchTxCount: 0,
    ourTransferCount: 0,
    totalTransfersInBatches: 0,
    scannedFromBlock: 0,
    scannedToBlock: 0,
  };

  if (!sellerAddresses.length) {
    return empty;
  }

  const dayBoundaryMs = options?.dayBoundaryMs ?? startOfTodayUtcMs();
  const cacheKey = `${dayBoundaryMs}|${sellerAddresses
    .map((address) => address.toLowerCase())
    .sort()
    .join(',')}|${options?.batcherAddress?.toLowerCase() ?? ''}`;

  const now = Date.now();
  if (cachedSnapshot && cachedSnapshot.key === cacheKey && now - cachedSnapshot.fetchedAt < CACHE_TTL_MS) {
    return cachedSnapshot.payload;
  }

  const client = getArcReadClient();

  let toBlock: bigint;
  try {
    toBlock = await client.getBlockNumber();
  } catch (error) {
    console.warn('[economy:arcBatcherGas] getBlockNumber failed:', errorMessage(error));
    return empty;
  }

  const fromBlock =
    toBlock > BigInt(ECONOMY_ARC_GAS_SCAN_BLOCKS) ? toBlock - BigInt(ECONOMY_ARC_GAS_SCAN_BLOCKS) : 0n;

  let logs;
  try {
    logs = await client.getLogs({
      address: ARC_USDC,
      event: TRANSFER_EVENT,
      args: {
        ...(options?.batcherAddress ? { from: options.batcherAddress } : {}),
        to: sellerAddresses,
      },
      fromBlock,
      toBlock,
    });
  } catch (error) {
    console.warn('[economy:arcBatcherGas] getLogs failed:', errorMessage(error));
    return { ...empty, scannedFromBlock: Number(fromBlock), scannedToBlock: Number(toBlock) };
  }

  const ourTransfersByTx = new Map<Hex, number>();
  for (const log of logs) {
    if (!log.transactionHash) continue;
    ourTransfersByTx.set(
      log.transactionHash,
      (ourTransfersByTx.get(log.transactionHash) ?? 0) + 1,
    );
  }

  if (ourTransfersByTx.size === 0) {
    const payload: ArcBatcherGasSnapshot = {
      ...empty,
      scannedFromBlock: Number(fromBlock),
      scannedToBlock: Number(toBlock),
    };
    cachedSnapshot = { key: cacheKey, fetchedAt: now, payload };
    return payload;
  }

  let totalUsd = 0;
  let batchTxCount = 0;
  let ourTransferCount = 0;
  let totalTransfersInBatches = 0;

  await Promise.all(
    Array.from(ourTransfersByTx.entries()).map(async ([txHash, ourShare]) => {
      const cachedReceipt = RECEIPT_GAS_CACHE.get(txHash);
      let gasUsd: number;
      let transfersInBatch: number;
      let blockTimestampMs: number;

      if (cachedReceipt && now - cachedReceipt.fetchedAt < RECEIPT_CACHE_TTL_MS) {
        gasUsd = cachedReceipt.gasUsd;
        transfersInBatch = cachedReceipt.transfersInBatch;
        blockTimestampMs = cachedReceipt.blockTimestampMs;
      } else {
        try {
          const receipt = await client.getTransactionReceipt({ hash: txHash });
          const effectiveGasPrice =
            'effectiveGasPrice' in receipt && typeof receipt.effectiveGasPrice === 'bigint'
              ? receipt.effectiveGasPrice
              : null;
          if (!effectiveGasPrice) return;

          const block = await client.getBlock({ blockNumber: receipt.blockNumber });
          blockTimestampMs = Number(block.timestamp) * 1000;

          const usdcLogs = receipt.logs.filter(
            (entry) => entry.address.toLowerCase() === ARC_USDC.toLowerCase(),
          );
          transfersInBatch = usdcLogs.length || 1;

          gasUsd = Number(formatUnits(receipt.gasUsed * effectiveGasPrice, 18));
          if (!Number.isFinite(gasUsd)) return;

          RECEIPT_GAS_CACHE.set(txHash, {
            gasUsd,
            transfersInBatch,
            blockTimestampMs,
            fetchedAt: now,
          });
        } catch (error) {
          console.warn(
            '[economy:arcBatcherGas] receipt lookup skipped:',
            txHash,
            errorMessage(error),
          );
          return;
        }
      }

      if (blockTimestampMs < dayBoundaryMs) return;

      const attributed = gasUsd * (ourShare / transfersInBatch);
      totalUsd += attributed;
      batchTxCount += 1;
      ourTransferCount += ourShare;
      totalTransfersInBatches += transfersInBatch;
    }),
  );

  const payload: ArcBatcherGasSnapshot = {
    totalUsd,
    batchTxCount,
    ourTransferCount,
    totalTransfersInBatches,
    scannedFromBlock: Number(fromBlock),
    scannedToBlock: Number(toBlock),
  };

  cachedSnapshot = { key: cacheKey, fetchedAt: now, payload };
  return payload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
