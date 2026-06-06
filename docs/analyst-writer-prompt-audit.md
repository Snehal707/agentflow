# Analyst / Writer Prompt Audit

Date: 2026-05-24
Scope: Audit only. No prompt changes applied in this session.

## Goal

Determine how well the current analyst and writer prompts use the new deep-mode `structuredResearch` contract, identify where they still behave as if the input were generic prose, and propose surgical prompt revisions for the next session.

## Files Reviewed

- [lib/agentPrompts.ts](/c:/Users/ASUS/agent-economy/lib/agentPrompts.ts:133)
- [lib/reportInputs.ts](/c:/Users/ASUS/agent-economy/lib/reportInputs.ts:13)
- [tmp/fast-vs-deep/deep-openai-latest-model-research-post-scope-override.json](/c:/Users/ASUS/agent-economy/tmp/fast-vs-deep/deep-openai-latest-model-research-post-scope-override.json:1)
- [tmp/fast-vs-deep/openai-deep-public-payload-post-parser-fix.json](/c:/Users/ASUS/agent-economy/tmp/fast-vs-deep/openai-deep-public-payload-post-parser-fix.json:1)

## Structured Research Contract Available Today

Deep mode now provides a structured object with these fields:

- `topic`
- `scope.timeframe`
- `scope.entities`
- `scope.questions`
- `facts`
- `recent_developments`
- `metrics`
- `comparisons`
- `risks_or_caveats`
- `open_questions`
- `sources`

This is materially richer than the old markdown-only deep research handoff.

## Analyst Prompt Audit

### What the prompt currently does well

The analyst prompt already has some good discipline:

- says to base conclusions only on provided research
- forbids invented facts and forward-dated claims
- asks for ranking, tradeoffs, contradictions, and implications
- asks `evidence_refs` to point back to research facts, metrics, or developments
- allows JSON input and says to parse actual research content

### What it does not do explicitly enough

The analyst prompt still treats the research payload mostly as a generic information blob.

It does **not** explicitly tell the model to use:

- `research.scope.questions` as a coverage checklist
- `research.facts` as the primary evidence base
- `research.recent_developments` for dated current-state claims
- `research.metrics` for quantitative evidence
- `research.risks_or_caveats` for uncertainty framing
- `research.comparisons` only when comparison evidence actually exists
- `research.sources` to preserve source-backed specificity

### Output structure today

The analyst output schema is:

- `core_thesis`
- `key_insights`
- `bullish_factors`
- `bearish_factors`
- `comparative_takeaways`
- `contradictions_or_uncertainties`
- `decision_relevant_conclusion`

### Current weak points

1. **No explicit coverage audit against `scope.questions`**
   - The prompt mentions the brief topic contract indirectly through `liveData.research_brief`
   - It does not force the model to check whether the structured research actually answered the required questions

2. **Comparative takeaways can drift**
   - The prompt always leaves room for `comparative_takeaways`
   - It does not say to leave that array empty unless:
     - the user asked for comparison
     - or `research.comparisons` has meaningful support

3. **Bullish / bearish framing can over-marketize neutral research**
   - This is useful for markets topics
   - It is less natural for company research, scientific topics, or institutional reports

4. **Evidence refs are underspecified**
   - The prompt says `evidence_refs` should point back to facts/metrics/developments
   - It does not say whether refs should use exact claim strings, metric names, or dated development labels

## Writer Prompt Audit

### What the prompt currently does well

The writer prompt already has good guardrails around:

- not inventing unsupported claims
- distinguishing reported vs confirmed
- keeping current-event uncertainty explicit
- using real sources
- sparse-evidence handling
- adaptive section structure instead of a rigid universal outline

### What it does not do explicitly enough

The writer prompt does **not** explicitly instruct the model to build sections from the structured research fields.

It never directly says:

- use `research.facts` for core evidence
- use `research.recent_developments` for dated current changes
- use `research.metrics` for data sections
- use `research.risks_or_caveats` for uncertainty / risks
- use `research.scope.questions` to make sure the report actually answers the topic contract
- use `analysis.key_insights` as interpretation layered on top of structured research rather than as the main content source

### Section template issue

The prompt still includes a generic section-title pattern:

- `Market Impact or Portfolio Implications`

This is broader than the wallet-context-specific rule:

- only include `"Your Portfolio Impact"` when `liveData.wallet_context` exists

So even though the wallet rule is conditional, the section-title pattern still leaves room for portfolio-style framing by default.

### Current weak points

1. **Structured fields are implicit, not explicit**
   - The prompt expects the model to infer that it should use structured fields if present
   - That works sometimes, but it leaves too much freedom to summarize analysis prose instead

2. **Analysis can overshadow research**
   - The writer receives both `research` and `analysis`
   - The prompt does not clearly say:
     - use research as the evidence source
     - use analysis as interpretation only

3. **Scope-question coverage is not enforced**
   - The prompt references the brief topic contract through `liveData.research_brief`
   - It does not explicitly require a final check against the named questions

4. **Portfolio wording remains too available**
   - Even without wallet context, the template language makes portfolio-style sections more likely than they should be

## Input Builder Audit

### Analyst input builder

In [lib/reportInputs.ts](/c:/Users/ASUS/agent-economy/lib/reportInputs.ts:13):

- if `params.research` is already an object, it uses that directly
- otherwise it tries to parse `researchText`
- fallback is raw text

This is good. Deep mode can already hand the analyst a structured object directly.

### Writer input builder

In [lib/reportInputs.ts](/c:/Users/ASUS/agent-economy/lib/reportInputs.ts:47):

- if `research` and `analysis` are already objects, it uses them directly
- otherwise it tries to parse the text
- fallback is raw text

This is also good. The plumbing is not the problem anymore.

### Key implication

The input builders are already ready for structured use.

The weak point is now **prompt utilization**, not transport or parsing.

## Representative OpenAI Trace

Representative source:

- [tmp/fast-vs-deep/deep-openai-latest-model-research-post-scope-override.json](/c:/Users/ASUS/agent-economy/tmp/fast-vs-deep/deep-openai-latest-model-research-post-scope-override.json:1)

For audit purposes, a fresh analyst and writer pass was run over this structured payload using the current prompts.

### What the structured research made available

The OpenAI structured research contained:

- explicit topic and scope
- specific facts about:
  - AWS deployment
  - memorization studies
  - the `50 token` memorization threshold
  - `confessions`
  - older OpenAI Gym background
- explicit source-backed caveats
- explicit coverage limits

### What analyst actually did

Strengths:

- used specific facts instead of purely generic summarization
- preserved source constraints in the conclusion
- referenced evidence in `evidence_refs`

Weaknesses:

- elevated AWS as the primary strategic pillar because it was concrete and easy to summarize
- created `comparative_takeaways` for `AWS` even though the user did not ask for comparison and `research.comparisons` was effectively empty
- did not explicitly audit the research against `scope.questions` until the end
- did not use `risks_or_caveats` or `open_questions` as named inputs

### What writer actually did

Strengths:

- stayed much more on-topic than earlier deep runs
- preserved key themes from analyst output
- clearly surfaced coverage limits

Weaknesses:

- largely rewrote the analyst summary instead of clearly grounding sections in structured research fields
- used a generic outline:
  - `Key Advancements`
  - `Research Focus vs. Gaps`
  - `Implications`
  - `Coverage Notes`
- did not visibly organize around:
  - `recent_developments`
  - `metrics`
  - `risks_or_caveats`
- underused the available structured evidence when deciding what to foreground

### Where quality dropped

The biggest drop happened here:

- structured research had a richer, fielded evidence base
- analyst compressed it into a few thematic pillars
- writer then mostly compressed the analyst again

So the current pipeline still behaves too much like:

`structured data -> summary -> shorter summary`

instead of:

`structured data -> analysis over named fields -> report built from named fields + analysis`

## Field-to-Prompt Mismatch Summary

### Fields the prompts currently use only weakly

- `scope.questions`
- `recent_developments`
- `metrics`
- `risks_or_caveats`
- `open_questions`
- `sources.used_for`

### Fields the prompts implicitly use but do not name

- `facts`
- `comparisons`

### Output slots that may cause drift

- analyst `comparative_takeaways`
- analyst `bullish_factors` / `bearish_factors`
- writer generic `Market Impact or Portfolio Implications` pattern

## Proposed Revision Approach

Do **not** rewrite the prompts from scratch.

Use surgical changes only.

### Analyst prompt revisions to propose next session

1. Explicitly tell the analyst to use structured fields when present
   - `research.scope.questions`
   - `research.facts`
   - `research.recent_developments`
   - `research.metrics`
   - `research.risks_or_caveats`

2. Add a coverage-check instruction
   - before finalizing, check whether the research answered the scope questions
   - if not, state what is under-covered in `contradictions_or_uncertainties` or the conclusion

3. Tighten `comparative_takeaways`
   - leave empty unless:
     - user asked for comparison
     - or structured research contains explicit comparison evidence

4. Tighten `evidence_refs`
   - prefer exact short claim/metric/development labels derived from structured fields

### Writer prompt revisions to propose next session

1. Explicitly separate roles of inputs
   - `research` = evidence source
   - `analysis` = interpretation layer

2. Explicitly map sections to structured research fields
   - evidence section from `facts`
   - current/recent section from `recent_developments`
   - data section from `metrics`
   - uncertainty/risk section from `risks_or_caveats`

3. Add a final scope-question coverage check
   - make sure the report answers `research.scope.questions` or clearly states what is under-covered

4. Restrict portfolio sections
   - `Portfolio Impact` or equivalent should appear only when:
     - wallet context exists
     - or the user explicitly asked for portfolio / market impact framing

5. Reduce analysis-overwrite risk
   - if research and analysis differ in emphasis, prefer research-backed evidence and use analysis to interpret rather than redefine the topic

## Recommendation for Next Session

Proceed with prompt tuning.

The infrastructure work is already done:

- deep mode produces structured research
- analyst and writer already receive it as objects

The highest-leverage next step is now prompt surgery that makes those agents use the structured fields deliberately rather than implicitly.
