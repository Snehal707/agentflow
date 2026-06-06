# Retrieval Relevance Audit

## 2026-05-26 Shipped Architecture Update

The retrieval architecture described in this audit was superseded by the shipped fast-research search stack:

- search-first retrieval
- Firecrawl + direct SearXNG hybrid search
- Firecrawl internal backend switched to SearXNG
- query normalization with forecasting-aware variants
- hybrid live-data timeout:
  - forecasting `120s`
  - niche protocol `90s`
  - current-events `60s`
  - default `45s`
- cache hardening:
  - no negative caching of empty Firecrawl result sets
  - no caching of fully empty `liveData`
  - one retry on full-empty search outcomes

This audit remains useful as historical context for why the architecture moved away from generic registry-led retrieval, but it no longer reflects the current fast research path.

Date: 2026-05-24
Query: `OpenAI latest model research`
Mode: deep research pipeline

## Goal

Determine where retrieval drift enters the deep pipeline for a specific-entity query and identify the earliest practical place to filter it.

## Stage 1: Brief Output

Observed brief:

- `query`: `OpenAI latest model research`
- `intent`: `research`
- `scope`: `narrow`
- `time_sensitivity`: `live`
- `required_freshness_days`: `60`
- `must_answer`: OpenAI-specific technical questions such as:
  - `What are the key architectural innovations in OpenAI's latest models?`
  - `What are the training methodologies and datasets used?`
  - `How do these advancements compare to previous models and industry benchmarks?`
- `sub_questions`: also OpenAI-specific and technical

Important fields that widen scope:

- `domains_priority`:
  - `ai`
  - `research`
  - `technology`
  - `science`
  - `academic`

### Finding

The brief preserves the named entity `OpenAI` in the main query and in the research questions, so **entity specificity is not lost completely at the brief stage**.

However, the brief also emits a very broad set of domain priorities. Those priorities are generic enough to invite ecosystem-wide routing once they are fed downstream.

## Stage 2: Registry Routing

Topic classification for the query:

- `labels`: `ai`, `research`
- `intent`: `research`

Routing query passed into registry selection:

`OpenAI latest model research What specific architectural approaches distinguish OpenAI's latest models from previous versions? How have training methodologies evolved, particularly regarding efficiency and scale? What new capabilities or performance benchmarks have been demonstrated? ai research technology science academic`

Top selected sources:

1. `OpenAI`
2. `arXiv`
3. `Google DeepMind`
4. `ENA`
5. `Hugging Face`
6. `OpenAlex`
7. `BBC`
8. `OpenReview`
9. `Semantic Scholar`
10. `Crossref`
11. `Anthropic`
12. `DOAJ`

Why they were eligible:

- Most of these sources are tagged with broad topics like:
  - `ai`
  - `research`
  - `model`
  - `papers`
  - `academic`
- `selectSources(...)` scores overlap on topic labels and query token overlap, not entity specificity.
- Once `OpenAI` causes the query to classify as `ai/research`, the registry treats the whole AI research ecosystem as relevant.

### Concrete examples

- `Google DeepMind` topics: `ai`, `research`, `model`
- `Anthropic` topics: `ai`, `llm`, `research`, `safety`
- `Meta AI` topics: `ai`, `research`, `open source`
- `OpenReview` topics: `ai`, `research`, `papers`
- `OpenAlex` topics: `research`, `academic`, `papers`
- `BBC` was pulled in because `technology/science` overlap plus generic high-trust fallback scoring kept it competitive

### Finding

This is the **first strong point where drift enters**.

The registry routing is too broad for a narrow, named-entity query. It treats:

- `OpenAI latest model research`

as roughly equivalent to:

- `AI research latest model developments`

for source selection purposes.

## Stage 3: Retrieved Content

Retrieved sources that survived relevance checks included:

- `OpenAI` — relevant, but stale/mixed content
- `BBC` — completely off-topic entertainment/news snippets
- `arXiv` — AGI theory paper from 2021, not specific to OpenAI's latest models
- `Google DeepMind` — `Gemma 4` / `Gemini 3 Deep Think`, competitor content
- `Hugging Face` — unrelated model listing content
- `OpenAlex` — `OpenAI Gym` paper from 2016
- `OpenReview` — unrelated comments with `openai` string in content
- `Crossref` — Azure OpenAI / package metadata, weak fit
- `DOAJ` — one relevant OpenAI/o1 article mixed with generic AI material

### Examples of retrieved drift

#### BBC

Retrieved snippet preview contained:

- Stephen Colbert final show
- Paris bridge cave artwork
- Raúl Castro DOJ story

No OpenAI relevance.

#### Google DeepMind

Retrieved snippet preview contained:

- `Gemma 4: Byte for byte, the most capable open models`
- `Gemini 3 Deep Think`

This is high-quality AI research content, but it is about a competitor, not OpenAI.

#### arXiv

Retrieved snippet preview contained:

- `The Artificial Scientist: Logicist, Emergentist, and Universalist Approaches to Artificial General Intelligence`

This is broad AGI material, not `OpenAI latest model research`.

#### OpenAlex

Retrieved snippet preview contained:

- `OpenAI Gym` from 2016

Entity match exists, but temporal and topical relevance are poor.

### Why these sources passed

The retriever's `isRelevantToBrief(...)` function is permissive:

- It tokenizes the brief query plus first three sub-questions
- It accepts a source if **any** token matches the source title/snippet/domain/URL

This means terms like:

- `openai`
- `models`
- `research`
- `latest`
- `technical`

can admit weakly related or unrelated content.

For example:

- `BBC` passed because generic tokens from the research-heavy query matched broad news content
- `Google DeepMind` passed because `model` / `research` overlap was enough
- `arXiv` passed because `research` / `AGI` / `models` overlap was enough

### Finding

The retriever does not enforce entity alignment for narrow entity-specific queries. Once routing admits broad AI sources, the relevance gate is too weak to correct it.

## Stage 4: Claim Extraction

Extracted claims included:

### On-topic / partly on-topic

- OpenAI disinformation misuse research
- OpenAI `confessions` for honesty/transparency
- OpenAI Gym
- OpenAI `o1-preview` exam performance

### Off-topic or drifted

- Stephen Colbert final show
- Paris bridge cave artwork
- DOJ charge against Raúl Castro
- DeepMind `Gemma 4`
- DeepMind `FACTS Benchmark Suite`
- Hugging Face `Supertonic-3`
- general AI / LCA tooling claim

### Finding

Claim extraction does **not** apply topic filtering beyond “supported by the snippet.” If the source snippet is off-topic but internally coherent, the claim survives.

So drift that enters retrieval becomes structured evidence downstream.

## Where Drift Enters

### Primary entry point

**Registry routing is too broad** for named-entity AI research queries.

That is the earliest strong drift source.

### Secondary amplifier

**Retriever relevance filtering is too permissive**.

It allows broad token overlap instead of enforcing:

- entity match

## 2026-05-26 Cache Fix

Cache fix shipped for fast research retrieval:

- Firecrawl empty results no longer poison subsequent runs.
- Fully empty `liveData` payloads are not cached.
- Firecrawl gets one immediate retry when every selected variant returns zero snapshots.

### Known Retrieval Gaps

These are documented for follow-up and are not part of the shipped cache fix.

1. **Transient Firecrawl variability on some broad evergreen queries**
   - Behavior: the same broad query can intermittently return zero Firecrawl evidence on one run and recover on the next.
   - Current handling: the system falls back cleanly to structured sources like CoinGecko, DefiLlama, and Wikipedia.
   - Follow-up: monitor and improve Firecrawl stability/query shaping for broad evergreen asks without complicating routing.

2. **AgentFlow-internal entity coverage**
   - Examples: Lunex vault, community-built Arc-native integrations, AgentFlow-specific internal flows.
   - Behavior: public web search often returns nothing because these entities have little or no public coverage. That is correct behavior, not a Firecrawl bug.
   - Follow-up direction: queries about AgentFlow/Arc-internal entities should use internal knowledge instead of web search:
     - product RAG
     - structured vault/swap/bridge registries
     - on-chain reads from integrated contracts
   - Future work: route internal AgentFlow/Arc entity retrieval to internal knowledge sources first, rather than treating it as a public-web search problem.
- query-to-source alignment
- freshness alignment

### Tertiary amplifier

**Claim extraction keeps any grounded claim from the admitted snippets**, even if the snippet is off-topic.

## Classification

This is best classified as **D: mix of the above**, with a clear primary source:

1. **A. Registry routing too broad** — primary
2. **B. Retrieved content too broad / weakly filtered** — secondary
3. **C. Brief loses entity specificity** — not primary, but broad `domains_priority` contributes

The brief does not fully lose `OpenAI`, but it does add enough broad AI/science context to make over-broad routing easier.

## Earliest Practical Filtering Point

### Best early filter

**Immediately after brief creation, during source routing and source admission for narrow named-entity queries.**

Why here:

- cheapest place to prevent drift
- avoids spending retrieval budget on competitor or generic content
- prevents bad snippets from ever reaching claim extraction

## Candidate Filtering Signals

### 1. Entity match

For narrow named-entity queries like `OpenAI latest model research`, require at least one of:

- exact entity mention in source title/snippet/URL
- known entity domain match (`openai.com`)
- sanctioned comparative source when brief explicitly asks for comparison

This would have filtered:

## Implemented Fix

An entity-aware retrieval gate was added in [agents/research/entityRelevanceGate.ts](/c:/Users/ASUS/agent-economy/agents/research/entityRelevanceGate.ts:1) and wired into [agents/research/retriever.ts](/c:/Users/ASUS/agent-economy/agents/research/retriever.ts:1).

### Behavior

- Gate applies only when:
  - `brief.scope === "narrow"`
  - derived entity count is between `1` and `3`
- Entities are derived from brief text using:
  - `brief.query`
  - `brief.must_answer`
  - `brief.sub_questions`
- Comparison intent is detected from the query string using:
  - `vs`
  - `versus`
  - `compare`
  - `comparison`
  - `compared to`
- Source admission criteria:
  - entity-domain match
  - entity appears in source title
  - entity appears at least `ENTITY_MENTION_THRESHOLD` times in source content/snippet/title/URL

### Configuration

- `ENTITY_MENTION_THRESHOLD`
  - default: `3`
  - used to tune the content-mention admission rule without code changes

## Known Technical Debt

The brief schema still has no first-class `entities` field.

Current gate behavior derives entities heuristically from brief text. That works for the first pass, but it is not the ideal long-term shape. A future brief refactor should add explicit entity extraction so retrieval filtering does not need to infer it from prose.

## Test Results

### 1. `OpenAI latest model research`

- Derived entities: `["OpenAI"]`
- Comparison mode: `false`
- Brief scope: `broad`
- Gate applied: `false`
- Retrieved sources after normal scoring: `11`

Important consequence:

- The entity derivation heuristic worked cleanly.
- The gate still did **not** activate because the brief classified the query as `broad`.

Observed source set still included broad AI ecosystem sources such as:

- `Google Research`
- `Meta AI`
- `Mistral AI`
- `Microsoft Research`
- `Google DeepMind`
- `Anthropic`

### Finding

The original OpenAI drift is **not fixed yet**, because the agreed activation rule blocked the gate from running on this query.

### 2. `OpenAI vs Anthropic latest model differences`

- Derived entities: `["Anthropic", "OpenAI"]`
- Comparison mode: `true`
- Brief scope: `narrow`
- Gate applied: `true`
- Sources before gate: `9`
- Sources kept: `3`
- Sources filtered: `6`

Kept sources included:

- `OpenAI`
- `Anthropic`
- `OpenReview`

Filtered sources included:

- `Google DeepMind`
- `LessWrong`
- `arXiv`
- `Google Research`
- `Meta AI`
- `Microsoft Research`

### Finding

Comparison mode behaved as intended. The gate preserved the named comparison entities and removed unrelated competitor and general-domain sources.

### 3. `Bitcoin price drivers today`

- Derived entities: `["Bitcoin"]`
- Comparison mode: `false`
- Brief scope: `narrow`
- Gate applied: `true`
- Sources before gate: `9`
- Sources kept: `3`
- Sources filtered: `6`

Kept sources:

- `CoinDesk`
- `CoinGecko`
- `CoinPaprika`

Filtered sources:

- `dYdX Public API`
- `Binance`
- `Kraken`
- `Coinbase`
- `Deribit`
- `DeFiLlama Stablecoins`

### Finding

The gate made the Bitcoin run much more focused on Bitcoin-labeled coverage, but it also reduced source diversity substantially. The resulting deep report stayed on-topic, though it now surfaces coverage limits more explicitly.

### 4. `IPCC climate findings`

- Derived entities: `["IPCC"]`
- Comparison mode: `false`
- Brief scope: `broad`
- Gate applied: `false`

### Finding

The same upstream scope-classification problem appeared here. Entity derivation succeeded, but the gate never ran.

## Overall Outcome

The entity-aware gate works correctly when it activates.

What it proved:

- entity extraction is good enough for a first pass
- comparison detection works
- post-fetch source filtering removes broad ecosystem drift effectively on narrow queries

What blocked the original OpenAI fix:

- the brief labeled `OpenAI latest model research` as `broad`, so the gate did not fire

## Open Follow-Ups

1. Scope classification reliability
   - narrow named-entity research queries like `OpenAI latest model research` and `IPCC climate findings` should likely not be classified as `broad`

2. Brief schema enhancement
   - add a first-class `entities` field to `ResearchBrief`

3. Fast-mode sparse-evidence behavior
   - separate issue from this gate; still unresolved

4. Structured-data prompt tuning
   - deep structured output is now wired correctly, but synthesis and downstream prompts may still benefit from tighter source-use expectations

## Scope Override Implementation

A deterministic scope override was added in [agents/research/orchestrator.ts](/c:/Users/ASUS/agent-economy/agents/research/orchestrator.ts:1), using shared entity detection logic from [agents/research/entityDetection.ts](/c:/Users/ASUS/agent-economy/agents/research/entityDetection.ts:1).

### Rule

Force `scope = "narrow"` only when both are true:

1. a named entity is detected in the query and confirmed across brief text
2. the query contains at least one strong narrowing signal

Strong narrowing signals currently used:

- `vs`
- `versus`
- `compare`
- `comparison`
- `compared to`
- `impact of`
- `latest`
- `current`
- `today`
- `now`

The override logs only when it changes a non-`narrow` result:

- `[brief] scope override applied: original=... forced=narrow ...`

## Scope Stability Results

### Narrow test queries

#### `OpenAI latest model research`

- scopes across 5 runs: `narrow, narrow, narrow, narrow, narrow`
- override fired: `3/5`

#### `Bitcoin price drivers today`

- scopes across 5 runs: `narrow, narrow, narrow, narrow, narrow`
- override fired: `4/5`

#### `OpenAI vs Anthropic latest model differences`

- scopes across 5 runs: `narrow, narrow, narrow, narrow, narrow`
- override fired: `2/5`

#### `IPCC climate findings`

- scopes across 5 runs: `broad, broad, broad, broad, broad`
- override fired: `0/5`

### Broad control queries

#### `forex market`

- scopes across 5 runs: `broad, broad, broad, broad, broad`
- override fired: `0/5`

#### `AI agents`

- scopes across 5 runs: `broad, broad, broad, broad, broad`
- override fired: `0/5`

#### `climate change`

- scopes across 5 runs: `broad, broad, broad, broad, broad`
- override fired: `0/5`

## Combined Impact

The deep-mode quality improvement track now includes three linked fixes:

1. structured deep research contract
2. entity-aware retrieval gate
3. deterministic scope override for entity-plus-narrowing-signal queries

### What improved

- `OpenAI latest model research` now classifies as `narrow` consistently
- the entity gate now activates for that query and removes competitor drift
- comparison queries like `OpenAI vs Anthropic latest model differences` remain narrow and keep the intended entities
- broad control queries remain broad, so the override did not over-fire in the test set

### What did not improve yet

- `IPCC climate findings` still classifies as `broad` because it does not contain one of the approved strong narrowing signals
- the entity gate therefore still does not activate for that query under the current design
- OpenAI retrieval became much tighter at the source level, but report quality still depends on the surviving sources and the downstream synthesis step

## Full Retrieval Test Results

### `OpenAI latest model research`

- final scope: `narrow`
- entity gate activated: `true`
- gate summary: `11 total -> 2 kept -> 9 filtered`

Kept:

- `OpenAI`
- `OpenReview`

Filtered:

- `arXiv`
- `Google DeepMind`
- `Hugging Face`
- `Anthropic`
- `Google Research`
- `Meta AI`
- `Microsoft Research`
- `Mistral AI`
- `OpenRouter`

### Outcome

This removed the obvious competitor-ecosystem drift. The report is now much more OpenAI-focused at the source-selection level, though the surviving OpenReview content still pulls the report toward memorization/safety research and away from a pure “latest model lineup” framing.

### `OpenAI vs Anthropic latest model differences`

- final scope: `narrow`
- entity gate activated: `true`
- gate summary: `10 total -> 3 kept -> 7 filtered`

### Outcome

This is the cleanest success case. The gate preserved the named comparison pair and filtered other labs.

### `Bitcoin price drivers today`

- final scope: `narrow`
- entity gate activated: `true`
- gate summary: `4 total -> 1 kept -> 3 filtered`

### Outcome

The query stayed tightly Bitcoin-focused, but the gate over-compressed the source set in this run. This is acceptable for now, but it suggests that mention-threshold tuning or a broader set of acceptable Bitcoin-adjacent market sources may be useful later.

### `IPCC climate findings`

- final scope: `broad`
- entity gate activated: `false`

### Outcome

This remains outside the current override rule. The result is behaving according to the implemented specification, not failing unpredictably.

## Deep mode quality arc — completed

Three fixes shipped in this arc:

1. Structured research contract
   - deep pipeline now returns `structuredResearch` alongside `markdownReport`
   - analyst and downstream stages consume structured data directly instead of trying to parse markdown as JSON

2. Entity-aware retrieval gate
   - narrow queries with detected entities filter out off-topic sources using:
     - domain match
     - title match
     - content mention threshold

3. Scope classification override
   - deterministic post-LLM rule forces `narrow` scope when a query contains:
     - a named entity
     - and a strong narrowing signal such as `latest`, `today`, `current`, `vs`, `compare`, or `impact of`

### Combined impact on representative queries

- `OpenAI latest model research`
  - cross-lab drift eliminated
  - sources filtered from `10` to `4` OpenAI-focused survivors in the final post-override run

- `OpenAI vs Anthropic latest model differences`
  - comparison mode works
  - both named entities are allowed
  - unrelated competitors are filtered out

- `Bitcoin price drivers today`
  - focused source set
  - on-topic output preserved

- `IPCC climate findings`
  - still classifies as `broad`
  - see known limitation below

## Known Limitations

Institutional/topic queries without temporal or specificity signals - for example, `IPCC climate findings` - do not trigger the scope override.

The strong-signal list deliberately excludes generic topic nouns like `findings` or `report` to avoid over-firing on legitimately broad queries such as `AI safety findings`.

This is a known gap.

Addressing this case reliably likely requires:

- a first-class `entities` field in the brief schema, since entities are currently derived heuristically from query text
- more contextual brief modeling to distinguish institutional queries from broad topic queries
- possibly LLM-based scope classification with deterministic confidence floors

This was not addressed in this arc in order to keep the override rule clean and legible.

## Open Items for Future Work

### Gate sensitivity on narrow queries

Sources like `OpenAlex` and `Crossref` can still pass the entity gate through the content-mention threshold even when they are not tightly focused on the entity's primary topic.

Possible improvements:

- higher mention threshold
- title relevance requirement in addition to content match
- source-type weighting or deprioritization for index-like sources

### Fast mode sparse-evidence template

Fast-mode Bitcoin produced off-topic boilerplate such as `insurance spikes` when retrieval returned thin results.

The template source and fallback behavior still need investigation.

### Analyst and writer prompt tuning for structured research

Deep mode now produces structured research data reliably, but analyst and writer prompts are still written to work from prose-first inputs.

There is likely meaningful quality upside in revising prompts to reference structured fields directly, especially:

- `facts`
- `metrics`
- `recent_developments`

### Brief schema enhancement

Adding a first-class `entities` field would:

- remove the need for heuristic entity extraction in the retrieval gate
- improve scope classification for institutional queries
- make entity-aware retrieval behavior easier to reason about and test

## Verification Summary

Final state at arc completion:

- `npm run typecheck`: passing
- `npm run validate-registry`: passing
- `npm run soak:research-topics`: `301/301`
- `npm run smoke:research-reports`: `3/3`
- OpenAI deep quality: substantially improved, with no cross-lab drift and a much tighter source set
- no regressions observed on broad control queries

- BBC
- generic Hugging Face model page
- generic arXiv AGI paper
- unrelated OpenReview content

### 2. Source-to-query alignment

Require overlap on both:

- named entity (`OpenAI`)
- topic signal (`model`, `research`, `benchmark`, `training`, etc.)

This is stronger than today's “any token match.”

### 3. Freshness alignment

For `required_freshness_days = 60`, down-rank or exclude very stale content unless it is canonical background and explicitly needed.

This would have filtered or heavily down-ranked:

- `OpenAI Gym` 2016
- AGI theory paper from 2021

### 4. Comparative intent detection

Only admit competitor labs like DeepMind, Anthropic, Meta, Mistral if:

- the brief asks for comparison
- or the must-answer list explicitly includes benchmarking against peers

This query did include one comparative must-answer, so competitor sources are not automatically wrong. But they should be:

- a minority
- clearly marked as comparison evidence
- never allowed to dominate the source set

## Proposed Fix Design

Small, contained first fix:

### Add an entity-aware relevance gate for narrow queries

When:

- `brief.scope === "narrow"`
- and the query contains a probable named entity like `OpenAI`, `Anthropic`, `DeepMind`, etc.

Then require retrieved sources to satisfy stronger relevance:

1. direct entity/domain match, or
2. explicit comparative allowance from the brief

This can likely live in retriever admission logic first, without changing the registry schema yet.

### Why this is the best first fix

- contained
- low-risk
- directly targets the OpenAI failure mode
- does not require a full registry redesign
- keeps broad-topic queries unchanged

## Estimated Impact on the OpenAI Drift

Yes, this likely would have prevented the specific OpenAI drift we observed.

It would have blocked or heavily reduced:

- BBC off-topic articles
- broad AGI background papers
- weak OpenReview/OpenAlex/Crossref matches
- generic Hugging Face model pages

It would also force competitor content like DeepMind to justify itself through explicit comparative relevance instead of entering by generic `ai/research/model` overlap.

## Recommendation for Next Session

Implement the smallest contained fix first:

1. detect narrow named-entity queries
2. strengthen retriever relevance gate for those queries
3. rerun the OpenAI deep query
4. inspect whether:
   - sources are more OpenAI-centered
   - extracted claims stay on-topic
   - structuredResearch scope/entities look cleaner

That should tell us quickly whether we need:

- only a retrieval relevance gate, or
- a deeper registry/routing redesign after that
