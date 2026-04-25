import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
} from 'viem';
import { ARC } from '../../../lib/arc-config';
import {
  checkSpendingLimits,
  executeTransaction,
  waitForTransaction,
} from '../../../lib/dcw';

export interface SwapExecuteInput {
  userWalletAddress: string;
  userAgentWalletId: string;
  userAgentWalletAddress: string;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountInRaw: bigint;
  minAmountOutRaw: bigint;
}

export interface SwapExecuteResult {
  txId: string;
  approvalTxId?: string;
  approvalSkipped: boolean;
}

export async function preflightSwapExecution(input: {
  userAgentWalletAddress: string;
  tokenIn: `0x${string}`;
  amountInRaw: bigint;
}): Promise<void> {
  const executionWalletAddress = getAddress(input.userAgentWalletAddress) as `0x${string}`;

  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  await assertNativeGasBalance(client, executionWalletAddress);
  await assertTokenBalance(client, input.tokenIn, executionWalletAddress, input.amountInRaw);
}

export async function executeSwap(input: SwapExecuteInput): Promise<SwapExecuteResult> {
  const amountInUsdc = Number(formatUnits(input.amountInRaw, 6));
  await checkSpendingLimits(input.userWalletAddress, amountInUsdc);

  const contractAddress = ARC.swapContract?.trim() || process.env.SWAP_CONTRACT_ADDRESS?.trim();
  if (!contractAddress) {
    throw new Error('[swap/execute] SWAP_CONTRACT_ADDRESS is required');
  }
  const swapAddress = getAddress(contractAddress) as `0x${string}`;
  const executionWalletAddress = getAddress(input.userAgentWalletAddress) as `0x${string}`;

  const client = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });

  await preflightSwapExecution({
    userAgentWalletAddress: executionWalletAddress,
    tokenIn: input.tokenIn,
    amountInRaw: input.amountInRaw,
  });
  const approval = await ensureTokenAllowance({
    client,
    walletId: input.userAgentWalletId,
    walletAddress: executionWalletAddress,
    tokenAddress: input.tokenIn,
    spender: swapAddress,
    amount: input.amountInRaw,
  });

  const tx = await executeTransaction({
    walletId: input.userAgentWalletId,
    contractAddress: swapAddress,
    abiFunctionSignature: 'swap(address,address,uint256,uint256)',
    abiParameters: [
      input.tokenIn,
      input.tokenOut,
      input.amountInRaw.toString(),
      input.minAmountOutRaw.toString(),
    ],
    feeLevel: 'HIGH',
    usdcAmount: amountInUsdc,
  });

  const txId = extractTransactionId(tx);
  if (!txId) {
    throw new Error('[swap/execute] Missing transaction id from Circle response');
  }

  return {
    txId,
    approvalTxId: approval.approvalTxId,
    approvalSkipped: approval.approvalSkipped,
  };
}

function extractTransactionId(tx: unknown): string | null {
  const obj = tx as { data?: { transaction?: { id?: string }; id?: string } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

async function assertTokenBalance(
  client: ReturnType<typeof createPublicClient>,
  tokenAddress: `0x${string}`,
  owner: `0x${string}`,
  requiredAmount: bigint,
): Promise<void> {
  const balance = (await client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint;

  if (balance < requiredAmount) {
    throw new Error(
      `[swap/execute] Your AgentFlow execution wallet has insufficient token balance for this swap. Fund the execution wallet first.`,
    );
  }
}

async function assertNativeGasBalance(
  client: ReturnType<typeof createPublicClient>,
  owner: `0x${string}`,
): Promise<void> {
  const nativeBalance = await client.getBalance({ address: owner });
  if (nativeBalance <= 0n) {
    throw new Error(
      `[swap/execute] Your AgentFlow execution wallet does not have enough USDC on Arc to cover transaction fees. Fund the execution wallet first.`,
    );
  }
}

async function ensureTokenAllowance(input: {
  client: ReturnType<typeof createPublicClient>;
  walletId: string;
  walletAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
}): Promise<{ approvalTxId?: string; approvalSkipped: boolean }> {
  const currentAllowance = (await input.client.readContract({
    address: input.tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [input.walletAddress, input.spender],
  })) as bigint;

  if (currentAllowance >= input.amount) {
    return { approvalSkipped: true };
  }

  const approvalTx = await executeTransaction({
    walletId: input.walletId,
    contractAddress: input.tokenAddress,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [input.spender, input.amount.toString()],
    feeLevel: 'HIGH',
  });

  const approvalTxId = extractTransactionId(approvalTx);
  if (!approvalTxId) {
    throw new Error('[swap/execute] Missing transaction id from approve() response');
  }

  const approvalResult = await waitForTransaction(approvalTxId, 'swap-approve');
  if (approvalResult.state !== 'COMPLETE') {
    throw new Error(
      `[swap/execute] approve failed: ${approvalResult.errorReason || approvalResult.state || 'unknown'}`,
    );
  }

  const refreshedAllowance = (await input.client.readContract({
    address: input.tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [input.walletAddress, input.spender],
  })) as bigint;

  if (refreshedAllowance < input.amount) {
    throw new Error('[swap/execute] approve() completed but allowance is still too low');
  }

  return {
    approvalTxId,
    approvalSkipped: false,
  };
}

export {
  simulateSwapExecution,
  type SwapSimulationExecutionPayload,
} from './simulation';
