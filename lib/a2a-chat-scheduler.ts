import { loadAgentOwnerWallet } from './agent-owner-wallet';
import { portfolioBuyerSlugFromTool } from './a2a-trigger';
import { runPortfolioFollowupAfterTool } from './a2a-followups';

/**
 * Vault tool returns either `Executed deposit:` (legacy) or Hermes receipt lines
 * (`Vault deposit complete…` / `Vault withdrawal complete…`) — see
 * `lib/tool-executor.ts` receiptMessage branch and `lib/telegramReceipts.ts`.
 */
export function isVaultPortfolioHookResult(result: string): boolean {
  if (/Executed (deposit|withdraw):/i.test(result)) return true;
  if (/Vault deposit complete/i.test(result)) return true;
  if (/Vault withdrawal complete/i.test(result)) return true;
  return false;
}

/**
 * Non-blocking post-success hooks for tools confirmed via chat YES.
 * Must not throw; logs with [a2a] prefix.
 */
export function scheduleChatToolPostA2a(input: {
  pendingTool: string;
  result: string;
  userWalletAddress: string;
  portfolioRunUrl: string;
  portfolioPriceLabel: string;
}): void {
  setImmediate(() => {
    void (async () => {
      try {
        const { pendingTool, result, userWalletAddress, portfolioRunUrl, portfolioPriceLabel } = input;
        if (typeof result !== 'string') return;

        const slug = portfolioBuyerSlugFromTool(pendingTool);
        if (!slug) return;

        if (pendingTool === 'swap_tokens' && result.startsWith('Executed swap:')) {
          console.log('[a2a] swap hook triggered');
          try {
            const swapWallet = await loadAgentOwnerWallet('swap');
            const portfolioWallet = await loadAgentOwnerWallet('portfolio');
            console.log('[a2a] swap wallet:', swapWallet.walletId);
            console.log('[a2a] portfolio wallet:', portfolioWallet.address);
          } catch (logErr) {
            console.warn('[a2a] swap hook wallet probe failed:', logErr);
          }
          try {
            await runPortfolioFollowupAfterTool({
              buyerAgentSlug: 'swap',
              userWalletAddress,
              portfolioRunUrl,
              portfolioPriceLabel,
              trigger: 'post_swap',
              details: result,
            });
          } catch (e) {
            console.error('[a2a] swap→portfolio FAILED:', e);
          }
          return;
        }

        if (pendingTool === 'vault_action' && isVaultPortfolioHookResult(result)) {
          await runPortfolioFollowupAfterTool({
            buyerAgentSlug: 'vault',
            userWalletAddress,
            portfolioRunUrl,
            portfolioPriceLabel,
            trigger: 'post_vault',
            details: result,
          });
          return;
        }

        if (pendingTool === 'bridge_usdc' && /Bridged/i.test(result) && /USDC to Arc/i.test(result)) {
          await runPortfolioFollowupAfterTool({
            buyerAgentSlug: 'bridge',
            userWalletAddress,
            portfolioRunUrl,
            portfolioPriceLabel,
            trigger: 'post_bridge',
            details: result,
          });
        }
      } catch (e) {
        console.warn('[a2a] chat tool post hooks failed:', e instanceof Error ? e.message : e);
      }
    })();
  });
}
