# Analyst / Writer Prompt Revisions

Date: 2026-05-24
Status: Design only. No prompt changes applied in this session.

## Goal

Make analyst and writer use deep-mode structured research deliberately, by referencing actual field names and adding a small number of explicit decision rules.

Design constraints followed:

- surgical edits only
- preserve current safety / sourcing / freshness rules
- modest prompt growth
- use field names explicitly
- use tendency/default patterns rather than rigid templates

## Analyst Prompt Revisions

### Change A1 - Explicit structured-field usage

**Current text**

From [lib/agentPrompts.ts](/c:/Users/ASUS/agent-economy/lib/agentPrompts.ts:133):

> - The input may include JSON objects or nested JSON strings. Parse and use the actual research content.

**Proposed replacement**

> - The input may include JSON objects or nested JSON strings. Parse and use the actual research content.
> - When `research` is a structured object, use its fields directly:
>   - use `research.scope.questions` as the coverage checklist
>   - use `research.facts` for source-backed claims
>   - use `research.recent_developments` for dated current-state changes
>   - use `research.metrics` for explicit numbers
>   - use `research.risks_or_caveats` and `research.open_questions` for uncertainty framing
> - Do not treat `analysis`-style interpretation as a substitute for those research fields.

**Reasoning**

Right now the prompt tells the analyst to parse JSON, but not what to do with the structured fields once it has them. This replacement names the exact fields we now produce, so the model knows which parts are evidence and which parts are uncertainty scaffolding.

**Expected behavior change**

- Analyst should stop treating structured research like generic prose.
- `key_insights` should be anchored in `facts`, `recent_developments`, and `metrics` more explicitly.
- `contradictions_or_uncertainties` should more often reflect `risks_or_caveats` or uncovered `open_questions` instead of generic caveat language.

### Change A2 - Coverage check against `research.scope.questions`

**Current text**

From [lib/reportInputs.ts](/c:/Users/ASUS/agent-economy/lib/reportInputs.ts:13), the input builder already says:

> If `liveData.research_brief` exists, treat it as the topic contract. Evaluate whether the research answered its query, scope, must_answer, and avoid_drift constraints.

But the analyst prompt itself has no explicit final-pass requirement tied to the structured research coverage fields.

**Proposed addition**

Add this to the analyst prompt Requirements block:

> - Before finalizing, check `research.scope.questions` against your draft.
> - If one or more scope questions are under-covered, say that explicitly in `contradictions_or_uncertainties` or `decision_relevant_conclusion`.
> - Do not silently assume missing coverage was answered by implication.

**Reasoning**

The builder already supplies the topic contract, but the analyst prompt does not force a last-mile coverage check. This addition turns the scope questions into a concrete completion test.

**Expected behavior change**

- Analyst should call out when the research did not answer the requested angle.
- OpenAI-style reports should more clearly say “architectural improvements / benchmarks are under-covered” instead of simply drifting to whatever evidence was easiest to summarize.

### Change A3 - Tighten `comparative_takeaways`

**Current text**

From [lib/agentPrompts.ts](/c:/Users/ASUS/agent-economy/lib/agentPrompts.ts:173):

>   "comparative_takeaways": [
>     {
>       "entity": string,
>       "positioning": string,
>       "advantage": string,
>       "constraint": string
>     }
>   ],

And from the Requirements block:

> - Keep the payload compact:
>   - key_insights: 2 to 4 items
>   - bullish_factors: at most 3 items
>   - bearish_factors: at most 3 items
>   - comparative_takeaways: at most 3 items
>   - contradictions_or_uncertainties: at most 3 items

**Proposed replacement**

Keep the schema, but add this requirement:

> - Leave `comparative_takeaways` empty unless:
>   - the user explicitly asked for a comparison
>   - or `research.comparisons` contains meaningful comparison evidence
> - Do not create comparison entities from ecosystem context, partners, distributors, or infrastructure vendors unless the query itself asks for that comparison.

**Reasoning**

The current prompt leaves a comparison-shaped slot open on every task, which encourages the model to invent comparison framing even for non-comparison queries. We want to preserve the field, not remove it, but make it conditional.

**Expected behavior change**

- Analyst should stop producing `comparative_takeaways` like `AWS` for an OpenAI research query unless the user actually asked for comparison.
- Comparison queries like `OpenAI vs Anthropic` should still populate this section cleanly.

### Change A4 - Make `evidence_refs` more concrete

**Current text**

From [lib/agentPrompts.ts](/c:/Users/ASUS/agent-economy/lib/agentPrompts.ts:194):

> - "evidence_refs" should point back to research facts, metrics, or developments in short text form.

**Proposed replacement**

> - `evidence_refs` should point back to specific structured research items in short label form.
> - Prefer labels derived from the evidence itself, for example:
>   - `fact: AWS deployment for GPT/Codex/Managed Agents (2026-04-28)`
>   - `metric: 50-token memorization threshold`
>   - `development: new voice models in the API (2026-05-07)`
> - Bad: `OpenAI announced a model`
> - Good: `fact: new realtime voice models in the API (2026-05-07)`

**Reasoning**

The current wording is directionally right but too loose. Concrete examples should help the model produce refs that are actually traceable back to `facts`, `metrics`, or `recent_developments`.

**Expected behavior change**

- `evidence_refs` should become shorter, more specific, and more obviously tied to structured research fields.
- Downstream debugging and report comparison should get easier.

## Writer Prompt Revisions

### Change W1 - Explicit distinction between `research` and `analysis`

**Current text**

From [lib/agentPrompts.ts](/c:/Users/ASUS/agent-economy/lib/agentPrompts.ts:206):

> - Use only claims supported by the provided research and analysis.

**Proposed replacement**

> - Use `research` as the evidence source and `analysis` as the interpretation layer.
> - `research` provides the source-backed facts, recent developments, metrics, risks, and source list.
> - `analysis` should help prioritize and explain those items, not replace or redefine them.
> - If `analysis` emphasizes a theme that is weakly supported in `research`, follow `research`.

**Reasoning**

This is the most important writer-side clarification. Right now the prompt lets research and analysis blur together. The writer should know that the report is built from research evidence first, with analysis helping shape emphasis.

**Expected behavior change**

- Writer should stop over-compressing the analyst summary and instead anchor sections in structured research evidence.
- Reports should be less likely to drift toward whatever interpretation sounded most confident in analysis.

### Change W2 - Default section mapping from structured fields

**Current text**

From [lib/agentPrompts.ts](/c:/Users/ASUS/agent-economy/lib/agentPrompts.ts:206):

> Required content blocks (only when live evidence exists for the topic):
> - one short summary section near the top
> - one evidence or data section
> - one interpretation or implications section
> - one sources section
> - one closing takeaway section

**Proposed replacement**

> Required content blocks (only when live evidence exists for the topic):
> - one short summary section near the top
> - one evidence or data section
> - one interpretation or implications section
> - one sources section
> - one closing takeaway section
>
> Default structured-research pattern when `research` is an object:
> - Summary: synthesize the main answer from `research.facts` and `research.recent_developments`
> - Evidence / Key Findings: draw primarily from `research.facts`
> - Recent Developments / Current Situation: draw primarily from `research.recent_developments` when present
> - Data / Metrics: draw primarily from `research.metrics` when present
> - Risks / Uncertainty / Coverage Limits: draw from `research.risks_or_caveats`, `research.open_questions`, and any source-diversity limits
> - Sources: use `research.sources`
> Adapt the section names and order to the query type when appropriate; do not force empty sections.

**Reasoning**

This keeps the prompt flexible, but makes the structured-field-to-section mapping explicit. It also avoids making section order rigid.

**Expected behavior change**

- Writer should more often produce sections that visibly correspond to `facts`, `recent_developments`, `metrics`, and `risks_or_caveats`.
- Fewer reports should feel like generic “summary plus implications” rewrites detached from the structured evidence layout.

### Change W3 - Coverage check against `research.scope.questions`

**Current text**

From [lib/reportInputs.ts](/c:/Users/ASUS/agent-economy/lib/reportInputs.ts:47), the builder already says:

> If `liveData.research_brief` exists, structure the answer around that topic contract: query, scope, must_answer, and avoid_drift.

But the writer prompt itself does not tie this to the structured research coverage list.

**Proposed addition**

Add this to the writer Requirements block:

> - Before finalizing, check whether the draft answers `research.scope.questions` when that field exists.
> - If one or more scope questions are under-covered, state that directly in a compact `Coverage Limits`, `What We Still Do Not Know`, or equivalent section.
> - Do not imply complete coverage when the structured research is partial.

**Reasoning**

The writer should not silently convert partial evidence into a complete-sounding report. This is especially useful for the current OpenAI case where the research is narrower than the user’s ideal question.

**Expected behavior change**

- Reports should surface scope gaps more honestly.
- OpenAI-style reports should explicitly note missing architecture / benchmark coverage rather than just implying it indirectly.

### Change W4 - Portfolio section gating

**Current text**

From [lib/agentPrompts.ts](/c:/Users/ASUS/agent-economy/lib/agentPrompts.ts:222):

> - If liveData.wallet_context exists, include a "Your Portfolio Impact" section that explains how the researched event affects the detected exposure profile. Do not expose full wallet addresses, raw balances, or PnL unless explicitly requested.

And later in the section-title patterns:

> - Markets / macro / geopolitics:
>   - Summary
>   - Current Situation
>   - Why It Matters
>   - Market Impact or Portfolio Implications
>   - Risks and Watchpoints
>   - Sources
>   - Takeaway

**Proposed replacement**

Keep the wallet-context rule, but revise the section pattern and add an explicit restriction:

> - Include portfolio-oriented framing only when:
>   - `liveData.wallet_context` is present
>   - and the query is portfolio-relevant or the user explicitly asked for portfolio impact
> - Otherwise do not include `Portfolio Impact`, `Your Portfolio Impact`, or `Portfolio Implications` sections.

And revise the section-title pattern to:

> - Markets / macro / geopolitics:
>   - Summary
>   - Current Situation
>   - Why It Matters
>   - Market Impact
>   - Risks and Watchpoints
>   - Sources
>   - Takeaway
> - Only use portfolio-specific section titles when wallet context is present and portfolio relevance is explicit.

**Reasoning**

This is the cleanest way to stop default portfolio framing from bleeding into non-portfolio reports, while preserving the personalized behavior when wallet context actually exists.

**Expected behavior change**

- Writer should stop producing portfolio-style sections on generic research queries.
- Personalized sections should only appear when the conditions are explicit.

## Optional Behavior Preview on the OpenAI Structured Payload

If these revisions are applied, the expected analyst behavior on the OpenAI payload is:

- `core_thesis` still leads with the main supported OpenAI themes
- `key_insights` are more clearly tied to:
  - `research.facts`
  - `research.metrics`
  - dated developments
- `comparative_takeaways` is likely empty
- the conclusion explicitly says which `scope.questions` were under-covered

Expected writer behavior:

- report sections more clearly map to:
  - key findings from `research.facts`
  - current developments from `research.recent_developments`
  - data / metrics from `research.metrics`
  - limitations from `research.risks_or_caveats`
- no portfolio framing
- clearer statement that architecture / benchmark questions remain under-covered
- less tendency to simply compress the analyst summary into a shorter brief

## Summary Recommendation

These revisions should be applied as a focused prompt-tuning pass.

They do not require new schema, new agents, or plumbing changes. They simply make the prompts acknowledge and use the structured fields we already worked to produce.
