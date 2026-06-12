import assert from 'node:assert/strict';

import {
  buildCapabilityThreadContext,
  hasProductRoutingBypassSignals,
  isNoiseOnlyChatProbe,
  resolveCapabilityRoutingProbe,
  shouldHandleAsAgentFlowCapabilityQuestion,
} from '../lib/chatRouting';
import { WRITER_SYSTEM_PROMPT } from '../lib/agentPrompts';
import { answerProductQuestion, retrieveProductKnowledge } from '../lib/product-rag';
import { classifyAnswerMode } from '../lib/answer-mode';
import { classifyPortfolioRequestMode } from '../lib/portfolio-request-intent';
import { buildWriterModelInput } from '../lib/reportInputs';
import { sanitizeAssistantStreamDelta } from '../lib/sanitizeAssistantStreamDelta';

function shallowThread() {
  return buildCapabilityThreadContext([{ role: 'user', content: 'hello' }]);
}

function threadedThreeTurns(): ReturnType<typeof buildCapabilityThreadContext> {
  return buildCapabilityThreadContext([
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ]);
}

function threadedWithAssistantEarly(): ReturnType<typeof buildCapabilityThreadContext> {
  return buildCapabilityThreadContext([
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
  ]);
}

// --- Capability / Hermes probes (routing helpers) ---
assert.equal(isNoiseOnlyChatProbe(']'), true, 'bare bracket is noise');
assert.equal(isNoiseOnlyChatProbe('lol]'), false, 'lol] is long enough not to be ultra-short-only');

assert.equal(hasProductRoutingBypassSignals('what happened?'), true, 'what happened bypass');
assert.equal(hasProductRoutingBypassSignals('something happened?'), true, 'trailing happened? bypass');
assert.equal(hasProductRoutingBypassSignals('could you patch yourself?'), true, 'meta patch bypass');
assert.equal(hasProductRoutingBypassSignals('are you getting me?'), true, '"are you" bypass');
assert.equal(
  hasProductRoutingBypassSignals('im talking about hardware capabilities lol'),
  true,
  'frustration / lol bypass',
);

assert.equal(
  shouldHandleAsAgentFlowCapabilityQuestion('what can AgentFlow do?', shallowThread()),
  true,
  'shallow standalone capability FAQ',
);
assert.equal(
  shouldHandleAsAgentFlowCapabilityQuestion('what is AgentFlow?', shallowThread()),
  true,
);

assert.equal(
  shouldHandleAsAgentFlowCapabilityQuestion('how does AgentFlow work?', shallowThread()),
  true,
);

assert.equal(
  shouldHandleAsAgentFlowCapabilityQuestion('what can AgentFlow do?', threadedThreeTurns()),
  false,
  'deep thread: no standalone capability FAQ',
);

assert.equal(
  shouldHandleAsAgentFlowCapabilityQuestion('what can AgentFlow do?', threadedWithAssistantEarly()),
  false,
  'once assistant replied: defer to Hermes',
);

assert.equal(
  shouldHandleAsAgentFlowCapabilityQuestion('could you patch yourself?', shallowThread()),
  false,
  'meta phrasing skipped',
);

assert.equal(
  shouldHandleAsAgentFlowCapabilityQuestion('what happened?', shallowThread()),
  false,
);

// Probe must never include Portfolio tail keywords from injection.
const injected = resolveCapabilityRoutingProbe(
  undefined,
  'what happened?\n\nPortfolio context:\nYour portfolio holds USDC vault shares',
);
assert.equal(injected, 'what happened?', 'routing probe ignores portfolio block');

assert.equal(
  shouldHandleAsAgentFlowCapabilityQuestion(
    injected,
    threadedThreeTurns(),
  ),
  false,
);

// --- Stream sanitization ---
assert.equal(sanitizeAssistantStreamDelta('hello [[AFMETA:foo]] there'), 'hello  there');

const toolBlob = '{"name":"agentflow_research","arguments":{"q":"x"}}';
assert.ok(
  !sanitizeAssistantStreamDelta(`prefix ${toolBlob} suffix`).includes('agentflow_'),
  'suppresses balanced agentflow_* tool JSON blobs',
);

const mixed = `Checking… ${toolBlob} Done.`;
assert.equal(sanitizeAssistantStreamDelta(mixed).trim(), 'Checking…  Done.');

assert.equal(
  sanitizeAssistantStreamDelta('before <tool_call>{"z":1}</tool_call> after').trim(),
  'before after',
  'drops complete XML tool envelopes',
);
assert.equal(
  sanitizeAssistantStreamDelta('Check "vault_action" for options.'),
  'Check "vault options" for options.',
  'replaces internal tool identifiers in visible text',
);
assert.equal(
  sanitizeAssistantStreamDelta('Call the portfolio tool to show your current balances and positions.'),
  'I can check your current portfolio here. Ask me to show your portfolio for a live snapshot.',
  'sanitizes leaked portfolio tool instructions',
);

// --- Portfolio speech acts ---
assert.equal(classifyPortfolioRequestMode('where can I view my holdings?'), 'clarify');
assert.equal(classifyPortfolioRequestMode('is that my portfolio?'), 'clarify');
assert.equal(classifyPortfolioRequestMode('show my portfolio'), 'snapshot');
assert.equal(classifyPortfolioRequestMode('can you show my portfolio?'), 'snapshot');
assert.equal(classifyPortfolioRequestMode('what do I own?'), 'snapshot');
assert.equal(classifyPortfolioRequestMode('make portfolio analysis'), 'snapshot');
assert.equal(classifyPortfolioRequestMode('generate my portfolio report'), 'snapshot');
assert.equal(classifyPortfolioRequestMode('do you think my portfolio is good?'), 'discussion');
assert.equal(classifyPortfolioRequestMode('is my portfolio too risky?'), 'discussion');
assert.equal(classifyPortfolioRequestMode('swap 5 USDC and show portfolio'), null);
assert.equal(classifyPortfolioRequestMode("what's my balance"), null);
assert.equal(classifyPortfolioRequestMode('show my vault positions'), null);
assert.equal(classifyPortfolioRequestMode('what do I have in my vault?'), null);
assert.equal(classifyAnswerMode('do you think my portfolio is good?'), 'financial_advice');

// --- Portfolio-aware writer guardrails ---
assert.match(WRITER_SYSTEM_PROMPT, /Portfolio-aware writing is descriptive by default/);
assert.match(WRITER_SYSTEM_PROMPT, /Only recommend a specific portfolio move/i);
assert.match(WRITER_SYSTEM_PROMPT, /the user decides/i);

const portfolioWriterInput = buildWriterModelInput({
  task: 'How does this affect my portfolio?',
  researchText: '{}',
  analysisText: '{}',
  research: {},
  analysis: {},
  liveData: { wallet_context: { exposure: 'stablecoin-heavy' } },
  portfolioImpact: true,
});
assert.match(portfolioWriterInput, /describe options factually/i);
assert.match(portfolioWriterInput, /Only recommend specific moves/i);
assert.match(portfolioWriterInput, /Gateway reserve as x402/i);

// --- Product RAG ---
const voiceDocs = retrieveProductKnowledge('what is voice to text?');
assert.equal(voiceDocs[0]?.id, 'voice-to-text', 'voice-to-text retrieves mic dictation doc first');
const voiceAnswer = answerProductQuestion('what is voice to text?')?.answer ?? '';
assert.match(voiceAnswer, /mic icon/i, 'voice answer guides the mic UI');
assert.doesNotMatch(voiceAnswer, /Want to try it/i, 'voice answer does not create fake YES affordance');

const capabilityAnswer = answerProductQuestion('what can you do?')?.answer ?? '';
assert.match(capabilityAnswer, /payments on Arc/i, 'capability answer includes payments on Arc');
assert.match(capabilityAnswer, /voice notes/i, 'capability answer includes voice notes');

const scheduleAnswer = answerProductQuestion('how to make schedule payment?')?.answer ?? '';
assert.match(scheduleAnswer, /recurring USDC payments on a schedule/i);
assert.doesNotMatch(scheduleAnswer, /AgentPay is the payments surface/i);

const batchAnswer = answerProductQuestion('how to make batch payment?')?.answer ?? '';
assert.match(batchAnswer, /bulk USDC payouts from CSV/i);
assert.doesNotMatch(batchAnswer, /AgentPay is the payments surface/i);

const paymentRequestAnswer = answerProductQuestion('how to request money?')?.answer ?? '';
assert.match(paymentRequestAnswer, /without moving funds immediately/i);
assert.match(paymentRequestAnswer, /do not need YES confirmation/i);

const telegramAnswer = answerProductQuestion('explain how to use AgentFlow on Telegram')?.answer ?? '';
assert.match(telegramAnswer, /link AgentFlow to Telegram/i);
assert.doesNotMatch(telegramAnswer, /How to start using AgentFlow/i);

console.log('[test:chat-routing] OK');
