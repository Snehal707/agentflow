import { getAddress, isAddress, parseUnits } from 'viem';
import { adminDb, getRedis } from '../db/client';
import { executeTransaction, waitForTransaction } from './dcw';
import { fetchGatewayBalanceForAddress } from './gateway-balance';
import { transferToGateway } from './circleWallet';

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const MIN_GATEWAY_BALANCE = 2; // USDC
const TARGET_GATEWAY_BALANCE = 10; // USDC
const MIN_DCW_BALANCE = 5; // USDC
const TREASURY_LOCK_KEY = 'agentflow:treasury:topup:lock';

const TREASURY_WALLET = process.env.TREASURY_WALLET_ADDRESS?.trim();

export interface AgentBalance {
  slug: string;
  walletId: string;
  address: string;
  dcwBalance: number;
  gatewayBalance: number;
  needsTopUp: boolean;
}

type WalletRow = {
  agent_slug: string | null;
  wallet_id: string | null;
  address: string | null;
};

type TreasuryWalletRow = {
  wallet_id: string | null;
  address: string | null;
};

function parseUsdc(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatAmount(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6).replace(/\.?0+$/, '') : '0';
}

async function fetchDcwUsdcBalance(walletId: string): Promise<number> {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  if (!apiKey) {
    return 0;
  }

  const response = await fetch(
    `https://api.circle.com/v1/w3s/wallets/${walletId}/balances`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Circle balance fetch failed: HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: {
      tokenBalances?: Array<{
        token?: { symbol?: string };
        amount?: string;
      }>;
    };
  };

  const usdcBalance = json.data?.tokenBalances?.find(
    (balance) => balance.token?.symbol === 'USDC',
  );
  return parseUsdc(usdcBalance?.amount);
}

export async function loadTreasuryWallet(): Promise<{
  walletId: string;
  address: `0x${string}`;
} | null> {
  if (!TREASURY_WALLET || !isAddress(TREASURY_WALLET)) {
    console.warn('[treasury] TREASURY_WALLET_ADDRESS is missing or invalid');
    return null;
  }

  const normalizedTreasury = getAddress(TREASURY_WALLET);

  const byUserWallet = await adminDb
    .from('wallets')
    .select('wallet_id, address')
    .eq('purpose', 'user_agent')
    .eq('user_wallet', normalizedTreasury)
    .maybeSingle();

  if (byUserWallet.error) {
    throw new Error(`[treasury] treasury wallet lookup failed: ${byUserWallet.error.message}`);
  }

  let treasury = byUserWallet.data as TreasuryWalletRow | null;
  if (!treasury) {
    const byPurpose = await adminDb
      .from('wallets')
      .select('wallet_id, address')
      .eq('purpose', 'treasury')
      .maybeSingle();

    if (byPurpose.error) {
      throw new Error(`[treasury] treasury purpose lookup failed: ${byPurpose.error.message}`);
    }
    treasury = byPurpose.data as TreasuryWalletRow | null;
  }

  if (!treasury?.wallet_id || !treasury.address || !isAddress(treasury.address)) {
    console.warn('[treasury] no treasury wallet found');
    return null;
  }

  return {
    walletId: treasury.wallet_id,
    address: getAddress(treasury.address),
  };
}

async function transferFromTreasury(input: {
  treasuryWalletId: string;
  treasuryAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amountUsdc: number;
  agentSlug: string;
}): Promise<{ txHash: `0x${string}` }> {
  const amountUsdc = Number(input.amountUsdc.toFixed(6));
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    throw new Error('Treasury top-up amount must be greater than zero');
  }

  const tx = await executeTransaction({
    walletId: input.treasuryWalletId,
    contractAddress: ARC_USDC,
    abiFunctionSignature: 'transfer(address,uint256)',
    abiParameters: [input.toAddress, parseUnits(amountUsdc.toFixed(6), 6).toString()],
    feeLevel: 'HIGH',
    usdcAmount: amountUsdc,
  });

  const txId =
    (tx as { data?: { transaction?: { id?: string }; id?: string } })?.data?.transaction?.id ??
    (tx as { data?: { id?: string } })?.data?.id;
  if (!txId) {
    throw new Error('[treasury] Missing Circle transaction id');
  }

  const polled = await waitForTransaction(txId, `treasury-topup:${input.agentSlug}`);
  if (polled.state !== 'COMPLETE' || !polled.txHash) {
    throw new Error(
      `[treasury] transfer failed: ${polled.errorReason ?? polled.state ?? 'unknown'}`,
    );
  }

  const txHash = polled.txHash as `0x${string}`;
  const { error } = await adminDb.from('transactions').insert({
    from_wallet: input.treasuryAddress,
    to_wallet: input.toAddress,
    amount: amountUsdc,
    remark: `Treasury -> ${input.agentSlug} Agent (auto top-up)`,
    arc_tx_id: txHash,
    status: 'complete',
    action_type: 'treasury_topup',
    agent_slug: input.agentSlug,
    payment_rail: 'arc_usdc',
  });

  if (error) {
    throw new Error(`[treasury] ledger insert failed: ${error.message}`);
  }

  return { txHash };
}

export async function checkAgentBalances(): Promise<AgentBalance[]> {
  const { data: agentWallets, error } = await adminDb
    .from('wallets')
    .select('agent_slug, wallet_id, address')
    .eq('purpose', 'owner');

  if (error) {
    throw new Error(`[treasury] wallet query failed: ${error.message}`);
  }

  const results: AgentBalance[] = [];

  for (const wallet of (agentWallets ?? []) as WalletRow[]) {
    if (!wallet.agent_slug || !wallet.wallet_id || !wallet.address || !isAddress(wallet.address)) {
      continue;
    }

    try {
      const address = getAddress(wallet.address);
      const [dcwBalance, gateway] = await Promise.all([
        fetchDcwUsdcBalance(wallet.wallet_id),
        fetchGatewayBalanceForAddress(address).catch(() => ({ available: '0', total: '0' })),
      ]);
      const gatewayBalance = parseUsdc(gateway.available);
      const needsTopUp =
        gatewayBalance < MIN_GATEWAY_BALANCE || dcwBalance < MIN_DCW_BALANCE;

      results.push({
        slug: wallet.agent_slug,
        walletId: wallet.wallet_id,
        address,
        dcwBalance,
        gatewayBalance,
        needsTopUp,
      });
    } catch (e) {
      console.warn(`[treasury] balance check failed for ${wallet.agent_slug}:`, e);
    }
  }

  return results;
}

export async function topUpAgentWallet(
  agentSlug: string,
  walletId: string,
  walletAddress: string,
  currentDcwBalance: number,
  currentGatewayBalance: number,
): Promise<void> {
  if (!isAddress(walletAddress)) {
    console.warn(`[treasury] invalid wallet address for ${agentSlug}`);
    return;
  }

  const treasury = await loadTreasuryWallet();
  if (!treasury) {
    return;
  }

  const agentAddress = getAddress(walletAddress);
  let dcwBalance = currentDcwBalance;

  if (currentGatewayBalance < MIN_GATEWAY_BALANCE) {
    const gatewayShortfall = TARGET_GATEWAY_BALANCE - currentGatewayBalance;
    if (dcwBalance < gatewayShortfall) {
      const preDepositAmount = gatewayShortfall - dcwBalance;
      console.log(
        `[treasury] funding ${agentSlug} before Gateway deposit: +${formatAmount(preDepositAmount)} USDC`,
      );
      await transferFromTreasury({
        treasuryWalletId: treasury.walletId,
        treasuryAddress: treasury.address,
        toAddress: agentAddress,
        amountUsdc: preDepositAmount,
        agentSlug,
      });
      dcwBalance += preDepositAmount;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.log(`[treasury] depositing ${agentSlug} to Gateway`);
    try {
      const deposit = await transferToGateway({
        walletId,
        walletAddress: agentAddress,
      });
      if (deposit.status !== 'COMPLETE') {
        throw new Error(deposit.errorDetails || deposit.errorReason || deposit.status);
      }
      console.log(`[treasury] ${agentSlug} Gateway topped up: ${deposit.depositTxHash ?? 'n/a'}`);
      dcwBalance = 0;
    } catch (e) {
      console.error(`[treasury] Gateway top-up failed for ${agentSlug}:`, e);
    }
  }

  if (dcwBalance < MIN_DCW_BALANCE) {
    const topUpAmount = TARGET_GATEWAY_BALANCE - dcwBalance;
    console.log(`[treasury] topping up ${agentSlug} DCW: +${formatAmount(topUpAmount)} USDC`);

    try {
      const result = await transferFromTreasury({
        treasuryWalletId: treasury.walletId,
        treasuryAddress: treasury.address,
        toAddress: agentAddress,
        amountUsdc: topUpAmount,
        agentSlug,
      });
      console.log(`[treasury] ${agentSlug} DCW topped up: ${result.txHash}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (e) {
      console.error(`[treasury] DCW top-up failed for ${agentSlug}:`, e);
    }
  }
}

export async function runTreasuryTopUp(): Promise<void> {
  const redis = getRedis();
  const lock = await redis.set(TREASURY_LOCK_KEY, String(Date.now()), 'EX', 50 * 60, 'NX');
  if (lock !== 'OK') {
    console.log('[treasury] top-up already running; skipping');
    return;
  }

  try {
    console.log('[treasury] checking agent balances...');
    const balances = await checkAgentBalances();
    const needsTopUp = balances.filter((balance) => balance.needsTopUp);

    if (needsTopUp.length === 0) {
      console.log('[treasury] all agents funded');
      return;
    }

    console.log(
      `[treasury] ${needsTopUp.length} agents need top-up: ${needsTopUp
        .map(
          (balance) =>
            `${balance.slug} (DCW: ${balance.dcwBalance.toFixed(2)}, Gateway: ${balance.gatewayBalance.toFixed(2)})`,
        )
        .join(', ')}`,
    );

    for (const agent of needsTopUp) {
      await topUpAgentWallet(
        agent.slug,
        agent.walletId,
        agent.address,
        agent.dcwBalance,
        agent.gatewayBalance,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log('[treasury] top-up complete');
  } finally {
    await redis.del(TREASURY_LOCK_KEY).catch(() => undefined);
  }
}

export async function getTreasuryStats(): Promise<{
  agents: AgentBalance[];
  totalDcw: number;
  totalGateway: number;
  agentsNeedingTopUp: number;
}> {
  const agents = await checkAgentBalances();
  const totalDcw = agents.reduce((sum, agent) => sum + agent.dcwBalance, 0);
  const totalGateway = agents.reduce((sum, agent) => sum + agent.gatewayBalance, 0);
  const agentsNeedingTopUp = agents.filter((agent) => agent.needsTopUp).length;

  return {
    agents,
    totalDcw,
    totalGateway,
    agentsNeedingTopUp,
  };
}
