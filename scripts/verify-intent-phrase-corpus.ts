import {
  AGENTFLOW_A2A_INTENT_PHRASES,
  AGENTFLOW_AGENT_INTENT_PHRASES,
  assertAgentFlowIntentPhraseCorpus,
} from '../lib/agentflow-intent-phrases';

assertAgentFlowIntentPhraseCorpus(100);

const agentCount = Object.keys(AGENTFLOW_AGENT_INTENT_PHRASES).length;
const a2aCount = Object.keys(AGENTFLOW_A2A_INTENT_PHRASES).length;
const phraseCount =
  Object.values(AGENTFLOW_AGENT_INTENT_PHRASES).reduce((sum, phrases) => sum + phrases.length, 0) +
  Object.values(AGENTFLOW_A2A_INTENT_PHRASES).reduce((sum, phrases) => sum + phrases.length, 0);

console.log(
  `[intent-corpus] ok: ${phraseCount} phrases across ${agentCount} agent intents and ${a2aCount} A2A intents`,
);
