import { callHermesDeep } from '../../lib/hermes';
import type { LiveFacts, ResearchBrief, VerifiedClaim } from './types';

export async function synthesizeResearchReport(input: {
  brief: ResearchBrief;
  claims: VerifiedClaim[];
  liveFacts: LiveFacts;
}): Promise<string> {
  const systemPrompt = `Write a markdown research report using only the provided verified claims and live facts.

Rules:
- NEVER introduce raw URLs in the body except the Sources section.
- NEVER cite or rely on unverified claims.
- Preserve disputes instead of flattening them.
- Use topic-appropriate section titles instead of one fixed universal outline.
- Match the output shape to the user's actual ask.
- If the user asked for a simple answer or latest developments, use a concise markdown brief instead of a formal report shell.
- Do not force the literal title "Research Report" or "Executive Summary" on every topic.
- Always include:
  - a short summary section near the top
  - an evidence section
  - an uncertainty or risks section
  - a sources section
- Choose the rest of the structure based on the subject.
- For geopolitics or current events, prefer sections like:
  ## Summary
  ## Current Situation
  ## Key Evidence
  ## Risks and Unknowns
  ## Sources
- For ecosystems, protocols, or products, prefer sections like:
  ## Summary
  ## Ecosystem or Product Overview
  ## Key Evidence
  ## Catalysts and Constraints
  ## Sources
- Keep the report compact, specific, and evidence-led.`;

  const userMessage = JSON.stringify(input, null, 2);
  return callHermesDeep(systemPrompt, userMessage);
}
