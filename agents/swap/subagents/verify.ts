import { createPublicClient, defineChain, getAddress, http, parseAbiItem } from 'viem';
import { ARC } from '../../../lib/arc-config';

const DEFAULT_USDC = '0x3600000000000000000000000000000000000000';
const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

export interface VerifyTransferInput {
  recipient: string;
  tokenAddress?: `0x${string}`;
  txHash?: `0x${string}`;
  minValueRaw?: bigint;
  timeoutMs?: number;
  lookbackBlocks?: bigint;
}

export async function verifyTokenTransfer(
  input: VerifyTransferInput,
): Promise<{ txHash: `0x${string}` }> {
  const recipient = getAddress(input.recipient);
  const timeoutMs = input.timeoutMs ?? 30_000;
  const lookbackBlocks = input.lookbackBlocks ?? 20n;
  const tokenAddress = getAddress(
    (input.tokenAddress?.trim() || process.env.ARC_USDC_ADDRESS?.trim() || DEFAULT_USDC) as `0x${string}`,
  ) as `0x${string}`;

  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  const deadline = Date.now() + timeoutMs;
  let fromBlock: bigint | null = null;

  while (Date.now() < deadline) {
    if (fromBlock === null) {
      if (input.txHash) {
        try {
          const receipt = await client.getTransactionReceipt({ hash: input.txHash });
          fromBlock = receipt.blockNumber;
        } catch {
          // Receipt may not be indexed yet. Fall back to a short lookback window.
        }
      }

      if (fromBlock === null) {
        const latest = await client.getBlockNumber();
        fromBlock = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;
      }
    }

    const startBlock = fromBlock;
    const toBlock: bigint = input.txHash ? startBlock : await client.getBlockNumber();
    const logs = await client.getLogs({
      address: tokenAddress,
      event: transferEvent,
      args: { to: recipient },
      fromBlock: startBlock,
      toBlock,
    });

    const matched = logs.find((log) => {
      if (input.txHash && log.transactionHash !== input.txHash) {
        return false;
      }
      if (!input.minValueRaw) {
        return true;
      }
      const value = log.args.value as bigint | undefined;
      return typeof value === 'bigint' && value >= input.minValueRaw;
    });

    if (matched?.transactionHash) {
      return { txHash: matched.transactionHash as `0x${string}` };
    }

    if (!input.txHash) {
      fromBlock = toBlock + 1n;
    }

    await sleep(1_000);
  }

  throw new Error(
    `[swap/verify] Transfer confirmation timed out after ${Math.ceil(timeoutMs / 1000)} seconds`,
  );
}

export async function verifyUsdcTransfer(
  input: Omit<VerifyTransferInput, 'tokenAddress'>,
): Promise<{ txHash: `0x${string}` }> {
  return verifyTokenTransfer({
    ...input,
    tokenAddress: DEFAULT_USDC,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
