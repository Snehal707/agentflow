import assert from 'node:assert/strict';
import { buildSemanticContinuationContext } from '../lib/semantic-continuation';

const founderLocationContext = buildSemanticContinuationContext('where he is from?', [
  {
    role: 'user',
    content: 'who built agentflow?',
  },
  {
    role: 'assistant',
    content:
      'AgentFlow was built by Snehal (@SnehalRekt), a solo founder building Web3 AI agents on Arc Network.',
  },
]);

assert(founderLocationContext, 'expected founder follow-up context');
assert.match(founderLocationContext, /agentflow_founder/);
assert.match(founderLocationContext, /Snehal \(@SnehalRekt\)/);
assert.match(founderLocationContext, /Requested field: origin\/location/);
assert.match(founderLocationContext, /not verified/i);
assert.match(founderLocationContext, /do not offer external research/i);
assert.doesNotMatch(
  founderLocationContext,
  /^I only have the product\/team fact/m,
  'semantic layer should not emit a direct canned assistant reply',
);

const bridgeContext = buildSemanticContinuationContext('which one should i use?', [
  {
    role: 'user',
    content: 'i want to bridge',
  },
  {
    role: 'assistant',
    content:
      'I found supported source chains where this wallet already holds USDC. Choose one below, then tell me how much USDC you want to bridge.',
  },
]);

assert(bridgeContext, 'expected bridge follow-up context');
assert.match(bridgeContext, /bridge_to_arc/);
assert.match(bridgeContext, /Requested field: selection/);

const portfolioContext = buildSemanticContinuationContext('where can i see it?', [
  {
    role: 'user',
    content: 'show my portfolio',
  },
  {
    role: 'assistant',
    content:
      'Portfolio\nWallet tokens: 478.93 USDC\nVault shares: 7.00 luneEURC\nGateway reserve: 365.55 USDC',
  },
]);

assert(portfolioContext, 'expected portfolio follow-up context');
assert.match(portfolioContext, /portfolio/);
assert.match(portfolioContext, /before asking the user to run another portfolio check/i);

const unrelated = buildSemanticContinuationContext('tell me about agentflow', []);
assert.equal(unrelated, null);

console.log('semantic continuation tests passed');
