import { callHermesDeep } from '../../lib/hermes';
import type { LiveFacts, ResearchBrief, Source, SourceDiagnostics, VerifiedClaim } from './types';

export async function synthesizeResearchReport(input: {
  brief: ResearchBrief;
  claims: VerifiedClaim[];
  liveFacts: LiveFacts;
  sources: Source[];
  sourceDiagnostics: SourceDiagnostics;
}): Promise<string> {
  const systemPrompt = `Write a markdown research report using only the provided verified claims and live facts.

Rules:
- Treat brief as a topic contract. The report must answer brief.query, brief.must_answer, and brief.scope.
- Search/retrieval results may support the brief, but they must not narrow or redefine the user topic.
- If sourceDiagnostics.drift_risk is medium or high, explicitly say retrieval was narrow and avoid making that narrow subtopic the whole report.
- If brief.scope is broad, do not anchor the report around one article, one company, one vendor, one demographic, or one side issue unless brief.query asks for that.
- If source diversity is insufficient, produce a compact partial report with a "Coverage Limits" section instead of a confident full report.
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
- This is the deep-report synthesizer, so the output should be materially more complete than a fast report when evidence is available.
- Prefer a fuller report over a terse brief unless source coverage is genuinely thin.
- Aim for roughly 900 to 1600 words when evidence coverage is sufficient.
- Cover multiple dimensions from brief.must_answer instead of collapsing everything into 3 short bullets.
- Use more section depth than fast mode: normally 6 to 9 substantive sections, not just 4 or 5.
- Include concrete source-backed detail in each major section, not just in one evidence block.
- If evidence is strong enough, include sections such as:
  ## Summary
  ## Current State or Market Context
  ## Key Evidence
  ## Drivers or Catalysts
  ## Constraints, Risks, and Open Questions
  ## Strategic or Practical Implications
  ## Sources
- If evidence is thin, say so clearly, but still make the report as complete as the evidence allows.
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
- For broad topics, prefer sections that cover the user's required dimensions rather than the most common subtopic in retrieved articles.
- Before finalizing, ask: "Would this answer still be on-topic if the user saw only the title and section headings?" If not, rewrite around the brief.
- Keep the report specific and evidence-led, but do not over-compress deep mode into a short memo.`;

  const userMessage = JSON.stringify(input, null, 2);
  return callHermesDeep(systemPrompt, userMessage);
}
