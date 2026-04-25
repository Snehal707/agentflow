/**
 * Static checks for chat YES → portfolio hook string matching (no DB, no network).
 */
import assert from 'node:assert/strict';
import { isVaultPortfolioHookResult } from '../lib/a2a-chat-scheduler';

function assertVault(input: string, expected: boolean): void {
  assert.equal(
    isVaultPortfolioHookResult(input),
    expected,
    `vault hook expected ${expected} for: ${JSON.stringify(input.slice(0, 80))}…`,
  );
}

assertVault('Executed deposit: 1 USDC\n\nTx …', true);
assertVault('Executed withdraw: 2 USDC\n\nTx …', true);
assertVault(
  '✅ Vault deposit complete on Arc Testnet.\nAmount: 1 USDC\nTx: 0xabc…',
  true,
);
assertVault(
  '✅ Vault withdrawal complete on Arc Testnet.\nAmount: 1 USDC\nTx: 0xabc…',
  true,
);
assertVault('No pending vault action found.', false);
assertVault('Reply YES to execute or NO to cancel.', false);

// swap still uses prefix in tool-executor (not exported here — document only)
const swapOk = 'Executed swap: 1 USDC -> …';
assert.equal(swapOk.startsWith('Executed swap:'), true);

console.log('[self-test-a2a-chat-scheduler] OK');
