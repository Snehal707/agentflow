/**
 * USYC on Arc Testnet: Teller + Oracle + Entitlements (RolesAuthority).
 * Entitlement checks use `canCall` on the Teller’s `authority()` contract — the
 * proxy at USYC_ENTITLEMENTS matches Circle’s published address.
 */

import {
  createPublicClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  toFunctionSelector,
} from 'viem';

import { ARC } from './arc-config';
import { checkSpendingLimits, executeTransaction, waitForTransaction } from './dcw';

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;

/** Circle docs — Teller interface */
export const TELLER_ABI = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [
      { name: '_assets', type: 'uint256' },
      { name: '_receiver', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'redeem',
    type: 'function',
    inputs: [
      { name: '_shares', type: 'uint256' },
      { name: '_receiver', type: 'address' },
      { name: '_account', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'authority',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const;

export const ORACLE_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
] as const;

/** Documented interface; Arc uses RolesAuthority — see `checkEntitlement`. */
export const ENTITLEMENTS_ABI = [
  {
    name: 'isEntitled',
    type: 'function',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'role', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

const ROLES_AUTHORITY_ABI = parseAbi([
  'function canCall(address user, address target, bytes4 functionSig) view returns (bool)',
]);

const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

function getPublicClient() {
  return createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });
}

const DEPOSIT_SELECTOR = toFunctionSelector('function deposit(uint256,address)') as `0x${string}`;
const REDEEM_SELECTOR = toFunctionSelector('function redeem(uint256,address,address)') as `0x${string}`;

/**
 * Whether the wallet may call Teller deposit/redeem via RolesAuthority.
 * Uses `canCall(user, teller, functionSelector)` (Arc Entitlements implementation).
 */
export async function checkEntitlement(walletAddress: string): Promise<boolean> {
  const teller = (ARC.usycTeller || '').trim();
  if (!teller || !/^0x[a-fA-F0-9]{40}$/i.test(teller)) {
    return false;
  }
  const client = getPublicClient();
  const user = getAddress(walletAddress) as `0x${string}`;
  const tellerAddr = getAddress(teller) as `0x${string}`;

  const authority = (await client.readContract({
    address: tellerAddr,
    abi: TELLER_ABI,
    functionName: 'authority',
  })) as `0x${string}`;

  const [canDeposit, canRedeem] = await Promise.all([
    client.readContract({
      address: authority,
      abi: ROLES_AUTHORITY_ABI,
      functionName: 'canCall',
      args: [user, tellerAddr, DEPOSIT_SELECTOR],
    }) as Promise<boolean>,
    client.readContract({
      address: authority,
      abi: ROLES_AUTHORITY_ABI,
      functionName: 'canCall',
      args: [user, tellerAddr, REDEEM_SELECTOR],
    }) as Promise<boolean>,
  ]);

  return canDeposit && canRedeem;
}

/** Oracle answer → USD price per USYC share (18-decimal fixed point on Arc Testnet oracle). */
export async function getUSYCPrice(): Promise<number> {
  const oracle = (ARC.usycOracle || '').trim();
  if (!oracle || !/^0x[a-fA-F0-9]{40}$/i.test(oracle)) {
    throw new Error('[usyc] USYC_ORACLE_ADDRESS is not configured');
  }
  const client = getPublicClient();
  const [, answer] = (await client.readContract({
    address: getAddress(oracle) as `0x${string}`,
    abi: ORACLE_ABI,
    functionName: 'latestRoundData',
  })) as [bigint, bigint, bigint, bigint, bigint];

  // int256 NAV/USD per share: never use Number(bigint) — large int256 loses precision in JS.
  // Arc Testnet USYC oracle returns NAV with 18 decimals (on-chain value e.g. ~1.116e18 for ~$1.12/share).
  const abs = answer < 0n ? -answer : answer;
  const asNumber = Number(formatUnits(abs, 18));
  if (!Number.isFinite(asNumber)) {
    throw new Error('[usyc] invalid oracle answer');
  }
  return answer < 0n ? -asNumber : asNumber;
}

async function readErc20Decimals(client: ReturnType<typeof getPublicClient>, token: `0x${string}`): Promise<number> {
  try {
    const d = (await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'decimals',
    })) as number;
    return Number(d);
  } catch {
    return 6;
  }
}

function extractTransactionId(tx: unknown): string | null {
  const obj = tx as { data?: { transaction?: { id?: string }; id?: string } };
  return obj?.data?.transaction?.id ?? obj?.data?.id ?? null;
}

async function ensureErc20Allowance(input: {
  client: ReturnType<typeof getPublicClient>;
  walletId: string;
  walletAddress: `0x${string}`;
  assetAddress: `0x${string}`;
  spender: `0x${string}`;
  amountRaw: bigint;
}): Promise<{ approvalTxId?: string; approvalSkipped: boolean }> {
  const currentAllowance = (await input.client.readContract({
    address: input.assetAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [input.walletAddress, input.spender],
  })) as bigint;

  if (currentAllowance >= input.amountRaw) {
    return { approvalSkipped: true };
  }

  const approvalTx = await executeTransaction({
    walletId: input.walletId,
    contractAddress: input.assetAddress,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [input.spender, input.amountRaw.toString()],
    feeLevel: 'HIGH',
  });

  const approvalTxId = extractTransactionId(approvalTx);
  if (!approvalTxId) {
    throw new Error('[usyc] approve() did not return transaction id');
  }

  const approvalResult = await waitForTransaction(approvalTxId, 'usyc-approve');
  if (approvalResult.state !== 'COMPLETE') {
    throw new Error(
      `[usyc] approve failed: ${approvalResult.errorReason || approvalResult.state || 'unknown'}`,
    );
  }

  return { approvalTxId, approvalSkipped: false };
}

export async function subscribeUSYC(params: {
  walletId: string;
  walletAddress: string;
  usdcAmount: string;
  receiverAddress: string;
}): Promise<{ usycReceived: string; txHash: string; approvalSkipped: boolean }> {
  const teller = (ARC.usycTeller || '').trim();
  const usyc = (ARC.usycAddress || '').trim();
  if (!teller || !usyc) {
    throw new Error('[usyc] USYC_TELLER_ADDRESS and USYC_ADDRESS are required');
  }

  const exec = getAddress(params.walletAddress) as `0x${string}`;
  const receiver = getAddress(params.receiverAddress) as `0x${string}`;
  const tellerAddr = getAddress(teller) as `0x${string}`;
  const usycAddr = getAddress(usyc) as `0x${string}`;

  const entitled = await checkEntitlement(exec);
  if (!entitled) {
    throw new Error(
      '[usyc] This wallet is not entitled for USYC. Apply for whitelist via the Arc hackathon form, then retry.',
    );
  }

  const amountNum = Number(params.usdcAmount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error('[usyc] usdcAmount must be a positive number');
  }
  await checkSpendingLimits(exec, amountNum);

  const client = getPublicClient();
  const assetsRaw = parseUnits(amountNum.toFixed(6), 6);

  const approvalMeta = await ensureErc20Allowance({
    client,
    walletId: params.walletId,
    walletAddress: exec,
    assetAddress: ARC_USDC,
    spender: tellerAddr,
    amountRaw: assetsRaw,
  });
  const approvalSkipped = approvalMeta.approvalSkipped;

  const usycDecimals = await readErc20Decimals(client, usycAddr);
  const balBefore = (await client.readContract({
    address: usycAddr,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [receiver],
  })) as bigint;

  const usdcBal = (await client.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [exec],
  })) as bigint;
  if (usdcBal < assetsRaw) {
    throw new Error(`[usyc] insufficient USDC: have ${formatUnits(usdcBal, 6)}, need ${params.usdcAmount}`);
  }

  const tx = await executeTransaction({
    walletId: params.walletId,
    contractAddress: tellerAddr,
    abiFunctionSignature: 'deposit(uint256,address)',
    abiParameters: [assetsRaw.toString(), receiver],
    feeLevel: 'HIGH',
    usdcAmount: amountNum,
  });

  const txId = extractTransactionId(tx);
  if (!txId) {
    throw new Error('[usyc] deposit did not return transaction id');
  }
  const settled = await waitForTransaction(txId, 'usyc-deposit');
  if (settled.state !== 'COMPLETE') {
    throw new Error(`[usyc] deposit failed: ${settled.errorReason || settled.state}`);
  }
  const txHash = settled.txHash;
  if (!txHash) {
    throw new Error('[usyc] missing tx hash');
  }

  const balAfter = (await client.readContract({
    address: usycAddr,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [receiver],
  })) as bigint;

  const received = balAfter - balBefore;
  return {
    usycReceived: formatUnits(received > 0n ? received : 0n, usycDecimals),
    txHash,
    approvalSkipped,
  };
}

export async function redeemUSYC(params: {
  walletId: string;
  walletAddress: string;
  usycAmount: string;
  receiverAddress: string;
}): Promise<{ usdcReceived: string; txHash: string; approvalSkipped: boolean }> {
  const teller = (ARC.usycTeller || '').trim();
  if (!teller) {
    throw new Error('[usyc] USYC_TELLER_ADDRESS is required');
  }
  const usyc = (ARC.usycAddress || '').trim();
  if (!usyc) {
    throw new Error('[usyc] USYC_ADDRESS is required');
  }

  const exec = getAddress(params.walletAddress) as `0x${string}`;
  const receiver = getAddress(params.receiverAddress) as `0x${string}`;
  const tellerAddr = getAddress(teller) as `0x${string}`;
  const usycAddr = getAddress(usyc) as `0x${string}`;

  const entitled = await checkEntitlement(exec);
  if (!entitled) {
    throw new Error(
      '[usyc] This wallet is not entitled for USYC. Apply for whitelist via the Arc hackathon form, then retry.',
    );
  }

  const amountNum = Number(params.usycAmount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error('[usyc] usycAmount must be a positive number');
  }
  await checkSpendingLimits(exec, amountNum);

  const client = getPublicClient();
  const usycDecimals = await readErc20Decimals(client, usycAddr);
  const sharesRaw = parseUnits(amountNum.toFixed(usycDecimals), usycDecimals);

  const approvalMeta = await ensureErc20Allowance({
    client,
    walletId: params.walletId,
    walletAddress: exec,
    assetAddress: usycAddr,
    spender: tellerAddr,
    amountRaw: sharesRaw,
  });
  const approvalSkipped = approvalMeta.approvalSkipped;

  const shareBal = (await client.readContract({
    address: usycAddr,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [exec],
  })) as bigint;
  if (shareBal < sharesRaw) {
    throw new Error(
      `[usyc] insufficient USYC: have ${formatUnits(shareBal, usycDecimals)}, need ${params.usycAmount}`,
    );
  }

  const usdcBefore = (await client.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [receiver],
  })) as bigint;

  const tx = await executeTransaction({
    walletId: params.walletId,
    contractAddress: tellerAddr,
    abiFunctionSignature: 'redeem(uint256,address,address)',
    abiParameters: [sharesRaw.toString(), receiver, exec],
    feeLevel: 'HIGH',
  });

  const txId = extractTransactionId(tx);
  if (!txId) {
    throw new Error('[usyc] redeem did not return transaction id');
  }
  const settled = await waitForTransaction(txId, 'usyc-redeem');
  if (settled.state !== 'COMPLETE') {
    throw new Error(`[usyc] redeem failed: ${settled.errorReason || settled.state}`);
  }
  const txHash = settled.txHash;
  if (!txHash) {
    throw new Error('[usyc] missing tx hash');
  }

  const usdcAfter = (await client.readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [receiver],
  })) as bigint;

  const usdcDecimals = await readErc20Decimals(client, ARC_USDC);
  const received = usdcAfter - usdcBefore;
  return {
    usdcReceived: formatUnits(received > 0n ? received : 0n, usdcDecimals),
    txHash,
    approvalSkipped,
  };
}
