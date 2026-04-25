import '../lib/loadEnv';
import { parseUnits } from 'viem';
import { loadAgentOwnerWallet } from '../lib/agent-owner-wallet';
import { extractTxId } from '../lib/agentpay-transfer';
import { executeTransaction, waitForTransaction } from '../lib/dcw';
import { fetchGatewayBalanceForAddress } from '../lib/gateway-balance';

const GATEWAY_CONTRACT_ADDRESS = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
const USDC_TOKEN_ADDRESS = '0x3600000000000000000000000000000000000000';
const DEPOSIT_AMOUNT = parseUnits('5', 6);

type AgentSlug = 'research' | 'analyst' | 'writer';

async function runForAgent(agentSlug: AgentSlug): Promise<void> {
  const owner = await loadAgentOwnerWallet(agentSlug);
  const before = await fetchGatewayBalanceForAddress(owner.address);

  const approval = await executeTransaction({
    walletId: owner.walletId,
    contractAddress: USDC_TOKEN_ADDRESS,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [GATEWAY_CONTRACT_ADDRESS, DEPOSIT_AMOUNT.toString()],
    feeLevel: 'HIGH',
    usdcAmount: 0,
  });
  const approvalId = extractTxId(approval);
  if (!approvalId) {
    throw new Error(`[${agentSlug}] Missing Circle transaction id for approval`);
  }
  const approvalResult = await waitForTransaction(approvalId, `${agentSlug}-gateway-approve`);
  if (approvalResult.state !== 'COMPLETE' || !approvalResult.txHash) {
    throw new Error(
      `[${agentSlug}] approval failed: ${approvalResult.errorReason ?? approvalResult.state ?? 'unknown'}`,
    );
  }
  console.log(`[${agentSlug}] approved: ${approvalResult.txHash}`);

  const deposit = await executeTransaction({
    walletId: owner.walletId,
    contractAddress: GATEWAY_CONTRACT_ADDRESS,
    abiFunctionSignature: 'deposit(address,uint256)',
    abiParameters: [USDC_TOKEN_ADDRESS, DEPOSIT_AMOUNT.toString()],
    feeLevel: 'HIGH',
    usdcAmount: 5,
  });
  const depositId = extractTxId(deposit);
  if (!depositId) {
    throw new Error(`[${agentSlug}] Missing Circle transaction id for deposit`);
  }
  const depositResult = await waitForTransaction(depositId, `${agentSlug}-gateway-deposit`);
  if (depositResult.state !== 'COMPLETE' || !depositResult.txHash) {
    throw new Error(
      `[${agentSlug}] deposit failed: ${depositResult.errorReason ?? depositResult.state ?? 'unknown'}`,
    );
  }

  const after = await fetchGatewayBalanceForAddress(owner.address);
  const delta = Number(after.available) - Number(before.available);
  const deltaFormatted = Number.isFinite(delta) ? delta.toFixed(6).replace(/\.?0+$/, '') : 'unknown';
  console.log(`[${agentSlug}] ✓ deposited ${deltaFormatted} USDC to Gateway`);
  console.log(`[${agentSlug}] deposit tx: ${depositResult.txHash}`);
}

async function main(): Promise<void> {
  for (const agentSlug of ['research', 'analyst', 'writer'] as const) {
    await runForAgent(agentSlug);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
