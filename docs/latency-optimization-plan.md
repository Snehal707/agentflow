# Latency Optimization Plan

Date: 2026-05-23

Scope of this session: design only. No code, adapter, registry, or routing changes were made.

Update: Pass 1 benchmarking clarified that the original latency problem is a **deep-mode** problem. Fast mode already uses a separate single-call Hermes Fast path and does not run the multi-stage claim extraction / verification / synthesis pipeline.

## 1. Current Latency Breakdown

Fresh baseline was measured against the current deep research pipeline using five representative queries:

1. `Bitcoin price today and crypto market drivers`
2. `CISA exploited vulnerability latest advisory`
3. `OpenAI latest model research`
4. `India RBI rate decision`
5. `IPCC climate report findings`

Measurement method:

- `retrievalMs`: taken from existing `[research] registry retrieval completed latency_ms=...` log
- `claimMs`: taken from existing `[research] claim extraction completed latency_ms=...` log
- `verificationMs`: derived as wall-clock delta from `claims:complete` stage to `report:streaming` stage
- `synthesisMs`: taken from existing `[research] synthesis completed latency_ms=...` log
- `totalMs`: wall-clock runtime of `runDeepResearchCore(...)`

### Per-query results

| Query | Retrieval | Claim Extraction | Verification | Synthesis | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bitcoin price today and crypto market drivers | 6.3s | 28.8s | 30.5s | 16.4s | 97.5s |
| CISA exploited vulnerability latest advisory | 14.5s | 43.2s | 51.1s | 44.8s | 164.2s |
| OpenAI latest model research | 10.0s | 22.9s | 26.3s | 15.3s | 86.8s |
| India RBI rate decision | 10.0s | 17.4s | 0.0s | 13.8s | 58.4s |
| IPCC climate report findings | 8.7s | 18.7s | 19.7s | 17.1s | 72.2s |

### Averages

Across all five queries:

- Retrieval: `9.9s`
- Claim extraction: `26.2s`
- Verification: `25.5s`
- Synthesis: `21.5s`
- Total: `95.8s`

Across the four queries that produced non-zero verified claims:

- Retrieval: `9.9s`
- Claim extraction: `28.4s`
- Verification: `31.9s`
- Synthesis: `23.4s`
- Total: `105.2s`

### What varies most

Retrieval is the most stable stage and remains within the intended budget.

The most variable Hermes stage in this sample is **verification**, with a range from `19.7s` to `51.1s` on claimful queries. **Synthesis** is a close second, ranging from `15.3s` to `44.8s`. In practice:

- verification cost rises with claim count and breadth of conflicting evidence
- synthesis cost rises with both claim count and report breadth
- claim extraction also remains a major contributor because batches of 5 sources are currently processed sequentially

The `CISA exploited vulnerability latest advisory` query is the current worst-case style:

- many source documents
- several `rss_plus_scrape` sources
- 18 extracted claims
- long verification and synthesis stages

### Baseline conclusion

Current bottleneck is not retrieval. The optimization target is the Hermes-heavy path after retrieval:

- claim extraction
- verification
- synthesis

## Fast Mode Clarification

Fast mode does **not** use the multi-stage deep research pipeline. It currently does:

1. `fetchLiveData(...)`
2. one `callHermesFast(...)`

That means the large Hermes totals above are deep-mode numbers, not fast-mode numbers.

Fresh fast-mode end-to-end measurements on the same five representative queries:

| Query | Fast-Mode Total |
| --- | ---: |
| Bitcoin price today and crypto market drivers | 55.4s |
| CISA exploited vulnerability latest advisory | 30.1s |
| OpenAI latest model research | 38.3s |
| India RBI rate decision | 15.7s |
| IPCC climate report findings | 21.8s |

Implications:

- fast mode is **not** universally under 20s
- fast mode is still slow on live-data-heavy topics because `fetchLiveData(...)` dominates before the single Hermes call finishes
- there is **not** a fast-mode 405B synthesis problem to fix, because fast mode already uses the 70B path

Recommendation:

- treat fast-mode latency as a separate future investigation if needed
- keep current optimization focus on deep mode, where the multi-stage pipeline is the actual bottleneck

Operational note from later fast-path tracing:

- `ensureUserPaidAgentLedger(...)` took about `2.5s` on a research call.
- This was made async for user-facing latency because analyst does not need the ledger write to start.
- Worth investigating why the underlying write is slow before scale. Possible causes include database round-trip latency, multi-step writes, or connection/setup overhead.
- Not launch-blocking, but it is a real background-cost hotspot.

## 2. Evaluation of Candidate Optimizations

### A. Parallel claim extraction batches

**What it changes**

Today `extractClaimsFromSources()` processes source batches of 5 sequentially:

```ts
for (let index = 0; index < sources.length; index += 5) {
  const batch = sources.slice(index, index + 5);
  const claims = await extractClaimBatch(batch);
  output.push(...claims);
}
```

Parallelizing those batches with `Promise.allSettled` would make claim extraction latency closer to the slowest batch instead of the sum of all batches.

**Expected latency reduction**

- claim extraction: `30%` to `60%`
- end-to-end: about `8s` to `20s` on typical deep queries
- highest gain when 9-15 sources are passed downstream

**Expected quality impact**

- same

**Implementation complexity**

- small to medium

**Risk to existing architecture**

- low to medium
- main risk is increased concurrent Hermes Fast load, which may affect local model throughput or contention

**Can it be tested in isolation?**

- yes
- benchmark claim extraction stage before/after with the same saved `Source[]`

### B. Reduced snippet budget

**What it changes**

Lower the per-registry-source snippet cap in retriever mapping from about `2000` chars to about `1200` chars.

This reduces tokens sent into:

- claim extraction
- verification
- synthesis

**Expected latency reduction**

- claim extraction: `15%` to `25%`
- verification: `15%` to `30%`
- synthesis: `10%` to `20%`
- end-to-end: about `10s` to `25s`

**Expected quality impact**

- probably same on narrow queries
- slightly worse on broad queries with many dimensions, where long evidence blocks occasionally help

**Implementation complexity**

- small

**Risk to existing architecture**

- low
- main risk is evidence loss on broad or policy-heavy topics

**Can it be tested in isolation?**

- yes
- can be A/B tested on the current smoke suite with no other changes

### C. Skip verification stage for fast reports

**What it changes**

For fast-mode reports only, skip `verifyClaims(...)` and synthesize directly from extracted claims plus live facts.

Deep reports would keep the current verification path.

**Expected latency reduction**

- fast reports: save roughly the full verification stage, currently about `20s` to `50s`
- end-to-end fast-mode target improvement: `20s` to `45s`

**Expected quality impact**

- worse
- biggest tradeoff in this list
- more risk of uncollapsed contradictions, weaker freshness enforcement, and less precise confidence/status labels

**Implementation complexity**

- small to medium

**Risk to existing architecture**

- medium
- architecture remains intact, but product behavior changes meaningfully by mode

**Can it be tested in isolation?**

- yes
- fast vs deep output can be compared on the same prompts

### D. Two-stage retrieval with quality filter

**What it changes**

Instead of always fully fetching all selected sources before Hermes sees them:

1. First pass: fetch lightweight headers/snippets
2. Rank/filter by relevance and quality
3. Second pass: do full adapter fetch for only top `3-5` sources

This cuts payload before claim extraction, verification, and synthesis.

**Expected latency reduction**

- potentially the largest total reduction: `20s` to `50s`
- especially on broad queries currently sending 9-12 rich sources downstream

**Expected quality impact**

- could be better if low-value noise is filtered out
- could be worse if the ranker removes diversity or misses an important but less obviously relevant source

**Implementation complexity**

- large

**Risk to existing architecture**

- medium to high
- this changes retrieval semantics and source diversity behavior, even if adapters and registry stay untouched

**Can it be tested in isolation?**

- partially
- but full value requires orchestration changes, ranking evaluation, and regression testing against source diversity requirements

### E. Hermes 70B for synthesis on fast reports

**What it changes**

Keep deep reports on the stronger model. For fast-mode reports, switch synthesis from the current deep model path to Hermes 70B.

This affects the writer stage only.

**Expected latency reduction**

- synthesis: `50%` to `75%`
- end-to-end fast-mode: about `10s` to `30s`

**Expected quality impact**

- same to slightly worse
- likely acceptable for fast reports if claim extraction remains grounded
- greatest risk is weaker structure, less nuance, and flatter prose on broad topics

**Implementation complexity**

- small

**Risk to existing architecture**

- low

**Can it be tested in isolation?**

- yes
- very easy to compare side-by-side on the existing smoke report suite

### F. Streaming synthesis

**What it changes**

Begin sending report content to the client token-by-token or chunk-by-chunk during synthesis instead of waiting for the full markdown result.

This does **not** reduce total compute time. It improves perceived responsiveness.

**Expected latency reduction**

- actual wall-clock reduction: none
- perceived latency improvement: first useful content may appear `15s` to `45s` earlier

**Expected quality impact**

- same

**Implementation complexity**

- medium

**Risk to existing architecture**

- low to medium
- mostly transport/client/UI concerns rather than research correctness

**Can it be tested in isolation?**

- yes
- can be validated via UX metrics like time-to-first-token

## 3. Recommended Path

### Guiding principle

Take the highest-impact, lowest-risk changes first. Preserve research correctness on deep mode. Use fast/deep mode separation for aggressive tradeoffs.

### Recommended implementation order

#### Phase 1: Low-risk, isolated wins

1. **A. Parallel claim extraction batches**
2. **E. Hermes 70B for synthesis on fast reports**
3. **B. Reduced snippet budget**

Why first:

- all three are relatively contained
- all can be benchmarked in isolation
- two of them (`A`, `E`) have little or no expected quality loss
- together they should meaningfully reduce the post-retrieval budget without changing source behavior

Expected outcome after Phase 1:

- fast reports: roughly `45s` to `70s`
- deep reports: roughly `65s` to `95s`

#### Phase 2: Mode-specific product tradeoff

4. **C. Skip verification for fast reports**

Why second:

- this is the single biggest fast-mode latency win
- but it is the clearest quality tradeoff
- better to implement after we first harvest the lower-risk gains

Expected outcome after Phase 2:

- fast reports: roughly `25s` to `45s`
- deep reports: unchanged from Phase 1

#### Phase 3: UX improvement

5. **F. Streaming synthesis**

Why third:

- improves user experience even if total compute stays the same
- easiest to justify once the actual compute budget is already reduced

Expected outcome after Phase 3:

- same total latency
- faster perceived response and better product feel

#### Phase 4: Structural optimization

6. **D. Two-stage retrieval with quality filter**

Why last:

- largest architecture-adjacent change in the list
- requires new ranking behavior and stronger regression coverage
- best attempted after measuring how much Phase 1 + Phase 2 already solve

This option may become unnecessary if the earlier phases already bring fast reports under target.

### Options to defer or skip initially

Defer:

- **D. Two-stage retrieval with quality filter**
- **F. Streaming synthesis** until actual compute latency is reduced first

Do not skip permanently:

- **C. Skip verification for fast reports** should remain on the table because it is the most powerful fast-mode lever

### Target latencies

Recommended targets for the next implementation session:

#### Fast reports

- target: `25s` to `45s`
- acceptable ceiling: `60s`

This target likely requires:

- parallel claim extraction
- smaller snippets
- 70B synthesis
- skipping verification in fast mode

#### Deep reports

- target: `55s` to `85s`
- acceptable ceiling: `95s`

This target likely requires:

- parallel claim extraction
- smaller snippets
- keep verification
- keep stronger synthesis model

## 4. What We Are Not Changing

The following stay untouched in the latency work unless a separate session explicitly re-scopes the effort:

- adapter architecture
- source registry data
- source routing logic
- claim verification logic itself
- output format

Clarification:

- for verification, only **whether/when to run it by mode** is in scope
- the internals of claim verification are not in scope for the first optimization pass

## 5. Recommendation Summary

If the goal is maximum ROI with minimal disruption:

1. parallelize claim extraction batches
2. use Hermes 70B for fast synthesis
3. reduce snippet budget from `2000` to `1200`
4. benchmark again
5. if fast reports are still too slow, skip verification in fast mode
6. only then consider two-stage retrieval

This sequence keeps the current research architecture intact while attacking the biggest real bottleneck: Hermes time after retrieval.

## Pass 1 Benchmark Update

Pass 1 implemented only claim-extraction batch parallelization with per-batch timeout protection.

### Deep-mode re-benchmark

| Query | Retrieval Before | Retrieval After | Claim Before | Claim After | Verification Before | Verification After | Synthesis Before | Synthesis After | Total Before | Total After |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bitcoin price today and crypto market drivers | 6.3s | 10.0s | 28.8s | 19.5s | 30.5s | 35.5s | 16.4s | 21.0s | 97.5s | 105.7s |
| CISA exploited vulnerability latest advisory | 14.5s | 10.0s | 43.2s | 30.0s | 51.1s | 8.2s | 44.8s | 37.8s | 164.2s | 99.8s |
| OpenAI latest model research | 10.0s | 10.0s | 22.9s | 18.2s | 26.3s | 36.7s | 15.3s | 39.7s | 86.8s | 133.7s |
| India RBI rate decision | 10.0s | 10.0s | 17.4s | 15.8s | 0.0s | 3.5s | 13.8s | 34.1s | 58.4s | 72.0s |
| IPCC climate report findings | 8.7s | 8.1s | 18.7s | 20.9s | 19.7s | 5.7s | 17.1s | 16.0s | 72.2s | 60.1s |

### Pass 1 observations

- Claim extraction improved on most queries:
  - Bitcoin: about `32%` faster
  - CISA: about `30%` faster
  - OpenAI: about `20%` faster
  - India RBI: about `9%` faster
- IPCC claim extraction got slightly worse in this sample due to model/runtime variability
- One CISA claim batch hit the new per-batch timeout (`claim_batch_timeout_30000ms`), so the stage returned partial results instead of blocking the whole query
- Because the system is still LLM-heavy and query selection is dynamic, total end-to-end latency remains noisy across runs

### Pass 1 conclusion

Parallel claim extraction is directionally correct and improves the target stage, but Pass 1 alone does **not** reliably reduce total deep-mode latency query-by-query. It also introduces a new tradeoff:

- better stage resilience and faster average extraction
- but partial-claim loss when a batch times out

That means Pass 2 is still needed, but it should be designed with this result in mind:

1. tune or rethink batch timeout behavior
2. reduce downstream token load
3. target verification and synthesis next, since they now dominate even more clearly on some queries

## Pass 1 Post-Mortem

Pass 1 was rolled back. The diagnostic findings are kept here because they materially change the next design.

### Rollback status

- parallel claim extraction code was reverted
- baseline behavior restored
- verification after rollback:
  - `npm run typecheck`: pass
  - `npm run validate-registry`: pass
  - `npm run soak:research-topics`: `301/301`
  - `npm run smoke:research-reports`: `3/3`

### Question 1: Why did total latency get worse on Bitcoin and OpenAI deep?

We compared:

- original deep baseline from the first latency capture
- Pass 1 parallel run timings
- fresh rollback sequential reruns for Bitcoin and OpenAI

#### Bitcoin

| Run | Retrieval | Claims | Verification | Synthesis | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original baseline | 6.3s | 28.8s | 30.5s | 16.4s | 97.5s |
| Pass 1 parallel run | 10.0s | 19.5s | 35.5s | 21.0s | 105.7s |
| Rollback sequential rerun | 30.0s | 15.7s | 14.0s | 18.5s | 89.9s |

#### OpenAI

| Run | Retrieval | Claims | Verification | Synthesis | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original baseline | 10.0s | 22.9s | 26.3s | 15.3s | 86.8s |
| Pass 1 parallel run | 10.0s | 18.2s | 36.7s | 39.7s | 133.7s |
| Rollback sequential rerun | 10.0s | 42.3s | 53.7s | 41.4s | 161.3s |

#### Interpretation

The slowdown is **not clean evidence of Hermes 70B provider throttling**.

What the data actually shows:

1. **Dynamic retrieval/source mix changed a lot between runs.**
   - Bitcoin rollback rerun retrieved a different set of sources and only produced 7 claims from 4 usable sources.
   - OpenAI rollback rerun produced 15 claims again, but the sequential rerun was even slower than the earlier parallel run.

2. **Verification and synthesis time move with claim set size and source mix, not just extractor mode.**
   - OpenAI got slower even after rollback, which argues against “parallel extractor alone caused the slowdown.”
   - Bitcoin’s verification and synthesis were lower on the rollback rerun, but retrieval was much worse due to different selected/failing sources.

3. **The timing noise is large enough that total-latency comparisons are confounded.**
   - source selection and scrape/API success vary
   - claim counts vary
   - downstream prompt payload varies

#### Provisional conclusion

Provider-side throttling from concurrent Hermes Fast claim batches is **possible**, but this dataset does **not** prove it. The stronger conclusion is:

- the parallel extractor reduced claim-stage time
- but total latency is dominated by dynamic retrieval and downstream prompt variability
- therefore Pass 1 cannot be judged only by total wall-clock change on a handful of live runs

To isolate provider throttling later, we would need a fixed saved `Source[]` replay benchmark rather than live retrieval.

### Question 2: What is the actual batch latency distribution?

From the five Pass 1 deep re-benchmark logs, completed batch latencies were:

- `8.9s`
- `10.7s`
- `11.2s`
- `13.9s`
- `15.8s`
- `18.2s`
- `19.5s`
- `20.3s`
- `20.9s`

And there was one timed-out batch:

- `30.0s` timeout (`claim_batch_timeout_30000ms`)

#### Distribution summary

- median completed batch latency: `15.8s`
- 95th percentile completed batch latency: `20.9s`
- max completed batch latency: `20.9s`

#### Timeout interpretation

With the observed Pass 1 data:

- completed within `30s`: `9/9`
- timed out at `30s`: `1`
- completed within `45s`: still at least `9/9` completed batches, with **1 additional timed-out batch that likely would have had room to finish, but logs alone cannot prove it**

Important nuance:

- the timed-out CISA batch failed at `30.001s`, which is exactly the configured wall
- in an earlier Pass 1 smoke run, the comparable CISA batch set completed under `21s`

That makes `30s` look more like an aggressive cutoff under variable model latency than evidence of a genuinely hung batch.

## Pass 1.1 Design Options

### Option A: Sequential fallback on batch timeout

**What it does**

- run batches in parallel with `Promise.allSettled`
- any timed-out batch is retried sequentially after the parallel phase
- final claim set is complete unless the retry also fails

**Implementation complexity**

- medium

**Expected latency impact**

- best case: close to Pass 1 parallel gain
- worst case: parallel stage plus one or more sequential retries
- likely still a net win when only occasional batches are slow

**Risk of silent quality regression**

- low
- much safer than dropping timed-out batches

**Testability**

- high
- easy to assert that claim count never decreases solely due to timeout

### Option B: Provider-aware concurrency limit

**What it does**

- parallelize only up to `N` batches at once, likely `2`
- reduces the chance of provider-side contention or queueing

**Implementation complexity**

- medium

**Expected latency impact**

- smaller gain than full parallelization
- likely around `1.5x` to `2x` speedup on the claim stage instead of the optimistic `2x` to `3x`

**Risk of silent quality regression**

- low
- no dropped claims by design if combined with existing sequential semantics or retries

**Testability**

- high
- easy to benchmark across `N=1`, `N=2`, `N=3`

### Option C: Adaptive timeout based on baseline

**What it does**

- derive timeout from real batch latency distribution
- for example, `2x median` from observed data would be about `31.6s`
- or choose a safer fixed guard such as `45s`

**Implementation complexity**

- small

**Expected latency impact**

- does not create speedup by itself
- improves safety and reduces false timeout failures

**Risk of silent quality regression**

- medium if used alone with batch dropping
- low if combined with retry-on-timeout

**Testability**

- high

### Option D: Abandon parallelization, optimize differently

**What it does**

- drop claim-extraction parallelization entirely
- focus next on verification/synthesis/token-load optimizations instead

**Implementation complexity**

- small

**Expected latency impact**

- none on claim extraction
- shifts effort to lower-risk but potentially slower-to-land wins

**Risk of silent quality regression**

- lowest

**Testability**

- high

## Recommended Pass 1.1

Recommended first implementation path:

1. **Option B + Option A together**
   - concurrency limit of `2`
   - sequential retry on timeout
2. **Option C as a guardrail**
   - raise timeout from `30s` to a data-backed `45s`

Why this is the best next step:

- it addresses the real failure mode we observed: dropped claims on timeout
- it reduces the chance of provider contention without fully abandoning the claim-stage speedup
- it remains testable in isolation
- it avoids silent quality regression

Recommended Pass 1.1 shape:

- limit claim-batch concurrency to `2`
- use per-batch timeout of `45s`
- retry timed-out batches sequentially after the parallel phase
- fail only the retried batch if it still times out
- explicitly compare final claim counts vs sequential baseline on a fixed replay set before trusting live-query totals

### What not to do next

Do **not** re-ship full unconstrained parallelization with drop-on-timeout behavior.

That version improved the target stage, but it was not safe enough or measurable enough to trust in production.

## Verification Variance Diagnostic

Date: 2026-05-24

Goal of this diagnostic: determine whether verification-stage variance is primarily provider-side, content-size-driven, or prompt/output-structure-driven.

### Current verifier structure

`verifyClaims(...)` is **not** sequential per claim. It performs:

1. one batched `callHermesFast(...)` over the full `claims[]` array
2. local JSON parse
3. local freshness enforcement
4. fallback-to-input if parse returns no valid verified claims

This matters because there is no true per-claim Hermes timing in the current design. The meaningful timing unit is the **single batched verifier call**.

### Instrumentation

Tracing was added behind:

- `VERIFY_TRACE_ENABLED=1`
- `VERIFY_TRACE_FIXTURE=<fixture-name>`

When enabled, verifier writes one JSON trace per run to:

- `tmp/verification-detail-runs/{fixture}-{timestamp}.json`

Each trace includes:

- `input_claim_count`
- `input_prompt_char_length`
- `hermes_batch_call_latency_ms`
- `response_char_length`
- `parse_latency_ms`
- `freshness_enforcement_latency_ms`
- `used_fallback`
- `parsed_claim_count`
- `final_verified_claim_count`
- `total_stage_latency_ms`
- `per_claim_outcomes[]`

### Sanity checks

- Trace disabled:
  - no trace file created
  - downstream benchmark output shape unchanged
- Trace enabled:
  - trace file created as expected
  - recorded timing excludes file I/O from `total_stage_latency_ms`

### Fixtures tested

Two highest-variance downstream fixtures:

1. `openai-latest-research`
2. `cisa-exploited-vulnerability`

Five downstream-only replay runs were executed for each fixture with tracing enabled.

### Results

#### OpenAI latest research

- input claims: `16`
- input prompt chars: constant at `13415`
- fallback rate: `5/5`
- parsed claim count: `0` on all runs
- final verified claim count: `16`

Latency / size stats across 5 runs:

- Hermes batch latency:
  - median: `39831ms`
  - range: `11094ms` to `42631ms`
  - CV: `37.7%`
- response char length:
  - median: `11516`
  - range: `3442` to `11603`
  - CV: `36.3%`
- total verification stage latency:
  - median: `39831ms`
  - CV: `37.7%`
- Pearson correlation (`response_char_length` vs `hermes_batch_call_latency_ms`):
  - `0.996`

Per-claim outcome stability:

- stable `16/16`
- no claim-status drift across the 5 runs

Interpretation:

- verification outputs are status-stable
- latency variance tracks response size almost perfectly
- the variability is not from changing claim inputs
- the model is returning **different output shapes / lengths** for the same batched request, then falling back every time because the JSON is unparsable

#### CISA exploited vulnerability

- input claims: `13`
- input prompt chars: constant at `12117`
- fallback rate: `5/5`
- parsed claim count: `0` on all runs
- final verified claim count: `13`

Latency / size stats across 5 runs:

- Hermes batch latency:
  - median: `37090ms`
  - range: `4356ms` to `43239ms`
  - CV: `43.9%`
- response char length:
  - median: `10588`
  - range: `858` to `10593`
  - CV: `45.0%`
- total verification stage latency:
  - median: `37092ms`
  - CV: `43.9%`
- Pearson correlation (`response_char_length` vs `hermes_batch_call_latency_ms`):
  - `0.983`

Per-claim outcome stability:

- stable `13/13`
- no claim-status drift across the 5 runs

Interpretation:

- same pattern as OpenAI
- verifier output length is highly variable
- latency variance closely tracks that output-length variance
- parser fails every time, forcing fallback every run

### Main finding

Both fixtures match **Case A**, but with an additional stronger finding:

- `response_char_length` CV is very high (`36%` to `45%`)
- correlation with Hermes latency is extremely high (`0.98` to `1.00`)
- inputs are constant
- output statuses after fallback are stable
- parser success is effectively zero on these traced runs

So the dominant driver is:

1. **variable-length verifier model output**
2. leading to
3. **variable batch-call latency**
4. while the system often falls back to local pseudo-verification

This is not pure provider jitter on stable outputs. The output itself is unstable in length/format.

### What this means for Pass 2

Pass 2 should **not** start with generic verification parallelization.

Recommended design direction:

1. **Reduce verifier output size per call**
   - smaller claim batches
   - narrower expected JSON arrays
   - lower chance of malformed oversized responses

2. **Measure parser success rate as a first-class metric**
   - because fallback rate is currently material
   - latency alone hides whether verifier is actually doing useful work

3. **Consider verifier batching strategy before model selection**
   - the immediate problem is unstable large batched output
   - smaller verification batches are the most directly supported next experiment

### Recommended next session

Design Pass 2 as a **verification batching experiment**, not a generic latency optimization:

- split `claims[]` into smaller verifier batches
- replay-benchmark them downstream-only
- track:
  - batch latency
  - parser success rate
  - fallback rate
  - total stage latency

Success condition for Pass 2 should be:

- lower or comparable total latency
- materially better parser success rate
- lower output-size variance

That would address both correctness and performance together, which is the right target given these findings.

## Verification Correctness Issue Discovered During Diagnostic

Date: 2026-05-24

This is not just a latency problem. The verification stage is frequently not functioning as intended.

### Scope of the issue

Additional fallback-rate checks were run on the three smaller downstream fixtures:

- `bitcoin-price-and-drivers`: fallback `3/3`
- `india-rbi-rate-decision`: fallback `3/3`
- `ipcc-climate-findings`: fallback `3/3`

Combined with the earlier traced runs:

- `openai-latest-research`: fallback `5/5`
- `cisa-exploited-vulnerability`: fallback `5/5`

Observed conclusion:

- traced verification fallback rate is effectively `100%` across all tested benchmark fixtures

That means the current verification stage is typically not returning parsed `VerifiedClaim[]` at all. Instead, it falls back to a local heuristic that assigns:

- `supported_by_count = 1`
- `is_current = true` before freshness enforcement
- `status = "Disputed"` when `stance === "disputes"`, otherwise `"Reported"`

This fallback is useful as a safety net, but it is **not actual LLM-based verification**.

### Raw output inspection

Raw verifier responses were captured via `raw_response_preview` in trace files.

Representative OpenAI sample:

- begins with ```` ```json ````
- contains what appears to be a valid JSON array body
- ends with closing `]` and closing code fence ```` ``` ````

Representative Bitcoin and RBI samples show the same pattern:

- fenced JSON output
- not raw JSON text

This is enough to explain the immediate parse failure:

- `parseVerifiedClaims(raw)` currently does `JSON.parse(raw)` directly
- fenced JSON is not valid input to `JSON.parse`
- therefore parser returns `[]`
- verifier enters fallback path

### Parsing logic and failure modes

Current parser behavior:

1. `JSON.parse(raw)`
2. if parse fails: return `[]`
3. if parsed value is not an array: return `[]`
4. if array entries normalize to `null` because required fields are missing: they are filtered out

So there are three broad failure modes:

- malformed / non-JSON text
- valid JSON but wrong top-level structure
- array entries missing required fields (`claim`, `source_url`)

Based on the traced raw previews, the dominant current failure mode is:

- **valid-looking JSON wrapped in markdown code fences**, causing `JSON.parse` to throw immediately

### Max tokens check

`callHermesFast(...)` in `lib/hermes.ts` does **not** set `max_tokens` (or equivalent) explicitly.

Implications:

- there is no repo-local output cap forcing truncation
- provider defaults may still exist, but they are not controlled here

Comparison to observed responses:

- median long response lengths were around `10.5k` to `11.6k` chars
- sampled raw previews from OpenAI, Bitcoin, and RBI all appeared to end cleanly with closing array / code fence markers

This makes truncation a **secondary possibility**, not the primary root cause.

### Additional quality finding

The short RBI sample returned a fenced array with only one verified object despite eight input claims.

So there are likely **two separate correctness issues**:

1. fenced JSON causes parser failure
2. verifier output may also be incomplete in claim coverage on some runs

The first issue is enough to force fallback every time. The second issue should be re-evaluated after the parser is fixed, because the current fallback masks whether verifier coverage is complete.

### Root cause hypothesis

Most likely primary root cause:

- Hermes returns JSON wrapped in markdown fences
- parser expects raw JSON only
- verifier falls back on every traced run

Possible secondary contributor:

- on some runs the model may also return partial / incomplete coverage even when the JSON body looks well formed

### Pass 2 design implication

Pass 2 is now a **correctness-first** session, not an optimization-first session.

Recommended order:

1. fix parsing robustness first
   - strip markdown code fences / common JSON wrappers before `JSON.parse`
   - preserve current fallback as a backup only
2. re-run the verification trace benchmark
   - measure real parser success rate
   - measure whether coverage is complete
   - then re-characterize latency variance
3. only after parser success is materially improved, evaluate batching / optimization

Likely Pass 2 fix candidates:

- tolerant parser for fenced JSON and common LLM wrappers
- stronger verifier prompt formatting constraints
- possibly smaller verification batches if coverage and output size remain unstable after parsing is fixed

### Product implication

This affects report quality, not just speed.

At least on the benchmark fixtures tested here, the system has been labeling fallback-derived statuses as though verification succeeded. That means some synthesized reports have been relying on heuristic statuses rather than true parsed verifier output.

This should be treated as a correctness issue to resolve before further verification-stage optimization.

## Verification Working Baseline

Date: 2026-05-24

Pass 2 attempted a conservative parser robustness fix:

- strip markdown code fences
- strip preamble text before first JSON container
- strip trailing text after last JSON container
- then attempt `JSON.parse(...)`
- keep existing fallback behavior if parsing still fails

No prompt changes, batch-size changes, or fallback logic changes were made in this pass.

### Before vs after fallback rate

Before the parser fix:

- traced fallback rate was `100%` across all benchmark fixtures tested

After the parser fix (3 downstream-only traced runs per fixture):

| Fixture | Fallback Before | Fallback After |
| --- | ---: | ---: |
| bitcoin-price-and-drivers | 3/3 | 0/3 |
| cisa-exploited-vulnerability | 5/5 (previous diagnostic) | 0/3 |
| openai-latest-research | 5/5 (previous diagnostic) | 1/3 |
| india-rbi-rate-decision | 3/3 | 0/3 |
| ipcc-climate-findings | 3/3 | 1/3 |

### Gate evaluation

#### Gate 1 - Parser fix success

Target:

- all fixtures `0/3`

Observed:

- Bitcoin: `0/3`
- CISA: `0/3`
- RBI: `0/3`
- OpenAI: `1/3`
- IPCC: `1/3`

Interpretation:

- markdown-fence stripping fixed the dominant failure mode
- parser correctness improved dramatically
- but parser success is not yet perfect

The remaining failures were inspected and show a second failure mode:

- the model sometimes returns a **single JSON object** instead of the expected top-level array

Representative failed traces:

- `openai-latest-research-2026-05-23T21-13-43-574Z.json`
- `ipcc-climate-findings-2026-05-23T21-16-31-117Z.json`

In both cases:

- raw response was clean JSON
- not fenced
- but top-level shape was an object, not an array
- current parser intentionally rejects non-array top-level values

So Gate 1 is **partially passed**:

- wrapper/fence issue fixed
- remaining shape-instability issue still present

#### Gate 2 - Coverage quality

Coverage metric:

- `parsed_claim_count / input_claim_count`

Results:

| Fixture | Input Claims | Parsed Claims | Coverage |
| --- | ---: | ---: | ---: |
| bitcoin-price-and-drivers | 8 | 8 | 100% |
| cisa-exploited-vulnerability | 13 | 13 | 100% |
| openai-latest-research | 16 | 16, 16, 0 | median 100% |
| india-rbi-rate-decision | 8 | 8 | 100% |
| ipcc-climate-findings | 3 | 0, 3, 3 | median 100% |

Interpretation:

- when parser succeeds, coverage is currently full on these fixtures
- the severe earlier `1-of-8` RBI pattern did **not** persist after the parser fix
- the remaining coverage failures are tied to the residual parse failures, not systematic dropping within successful parses

So Gate 2 passes for successful parses, with residual risk only on the fixtures still hitting fallback.

#### Gate 3 - Working verification latency baseline

These are the new verifier medians against mostly-working verification:

| Fixture | Verification Median | Total Downstream Median |
| --- | ---: | ---: |
| bitcoin-price-and-drivers | 20.7s | 44.5s |
| cisa-exploited-vulnerability | 38.2s | 71.1s |
| openai-latest-research | 38.8s | 66.7s |
| india-rbi-rate-decision | 20.4s | 44.5s |
| ipcc-climate-findings | 9.1s | 31.2s |

This is the first useful near-working verification baseline, but it is **not yet the final Pass 3 baseline** because OpenAI and IPCC still fall back on one run out of three.

#### Gate 4 - Per-claim outcome stability

Results:

- Bitcoin: stable `8/8`
- CISA: mostly stable, with drift on `3/13`
- OpenAI: drift on many claims due to one fallback run
- RBI: drift on `6/8`, again aligned with one fallback run
- IPCC: drift on `3/3`, aligned with one fallback run

Interpretation:

- successful parsed runs look materially more stable
- most outcome drift is explained by the residual fallback runs
- per-claim instability should be re-measured only after eliminating the remaining parse-shape failures

### Updated root cause

The verification correctness issue now has **two** identified layers:

1. **Primary fixed issue**
   - model often returned fenced JSON
   - parser expected raw JSON
   - fixed by wrapper stripping

2. **Remaining issue**
   - model sometimes returns a single verified object instead of an array
   - parser currently rejects non-array top-level structures
   - this still triggers fallback on some runs

### Implication for prior benchmarks

Important: earlier latency and variance measurements were taken against fallback-dominated verification and are therefore not representative of a functioning verifier.

That includes:

- Pass 1 measurements
- Pass 1.1 measurements
- the earlier downstream variance measurement

The infrastructure built in those sessions is still valid and useful. What must be refreshed is the baseline measurement after correctness is fully stabilized.

### Recommendation after Pass 2

This session **did land a real correctness improvement**, but follow-up correctness work is still needed before Pass 3 latency optimization.

Recommended next step:

1. fix the remaining top-level shape issue
   - conservative option: if parsed JSON is a single object, wrap it as a one-element array before normalization
   - only if it satisfies the expected verified-claim shape
2. re-run the same 5-fixture x 3-run correctness sweep
3. if fallback reaches ~`0/3` across fixtures, then capture the real Pass 3 latency baseline

So the project is **not yet ready for Pass 3 latency optimization**. It is ready for one focused follow-up correctness patch, after which Pass 3 baseline capture should be rerun.

## Pass 2 Follow-up: Single-Object Shape Handling

Date: 2026-05-24

A follow-up correctness pass inspected the two residual parse failures from the first Pass 2 sweep:

- `openai-latest-research-2026-05-23T21-13-43-574Z.json`
- `ipcc-climate-findings-2026-05-23T21-16-31-117Z.json`

Both were **Type A** responses:

- top-level JSON object
- object matched the `VerifiedClaim` shape
- object corresponded to one real input claim
- object was not an aggregate summary shell

Based on that inspection, parser handling was extended conservatively:

- if parsed JSON is an array, normalize the array as before
- if parsed JSON is a single object, normalize it
- only wrap it into a one-element array if `normalizeVerifiedClaim(...)` succeeds
- otherwise fail closed and fall back as before

### Post-fix correctness sweep

After the single-object wrap fix, a new 5-fixture x 3-run downstream-only traced sweep produced:

| Fixture | Fallback Rate | Parsed Claims | Input Claims |
| --- | ---: | --- | ---: |
| bitcoin-price-and-drivers | 0/3 | 8, 1, 8 | 8 |
| cisa-exploited-vulnerability | 0/3 | 13, 13, 13 | 13 |
| openai-latest-research | 0/3 | 16, 16, 16 | 16 |
| india-rbi-rate-decision | 0/3 | 8, 8, 8 | 8 |
| ipcc-climate-findings | 0/3 | 3, 2, 3 | 3 |

### What improved

- fallback rate dropped to `0/3` on all five benchmark fixtures
- the top-level object mismatch no longer triggers fallback
- OpenAI now parses successfully on all three traced runs
- IPCC no longer falls back when the model returns one verified claim object

### New issue exposed

Eliminating fallback exposed a deeper coverage issue on some runs.

#### Bitcoin

One run returned a fenced JSON array with **one** item:

- `claim`: `Bitcoin price today and crypto market drivers`
- not one of the input claims
- clearly an aggregate summary object rather than per-claim verification output

Coverage on that run was:

- `1 / 8` parsed claims (`12.5%`)

This is a **severe coverage failure** even though parsing technically succeeded.

#### IPCC

One run returned a fenced JSON array with **two** items for three input claims:

- parsed coverage: `2 / 3` (`66.7%`)

This is a **moderate coverage failure** and suggests the model sometimes omits claims even when the JSON is valid.

### Updated gate evaluation

#### Gate 1 - Fallback rate

- **Passed**
- all fixtures are now `0/3`

#### Gate 2 - Coverage quality

- **Failed**
- Bitcoin had a severe `1 / 8` run
- IPCC had a moderate `2 / 3` run
- the issue is no longer parser failure; it is verifier output collapsing or omitting claims

#### Gate 3 - Verification latency range

- **Passed**
- median verification stage still sits in the expected roughly `9s` to `40s` band:
  - Bitcoin: `20.8s`
  - CISA: `37.7s`
  - OpenAI: `42.3s`
  - RBI: `19.8s`
  - IPCC: `13.5s`

### Implication

Verification parsing is now materially more robust, but correctness is **not fully resolved**.

The remaining issue is not:

- markdown fences
- object-vs-array wrapping

The remaining issue is:

- the verifier model sometimes returns fewer verification rows than input claims
- and in the Bitcoin case, it can collapse many claims into one summary-style verification object

This means Pass 3 latency baseline capture should still wait.

### Recommended next session

Do a focused correctness session on **verification coverage**, not latency:

1. inspect verifier prompt behavior on claim-preservation
2. decide whether the model must be instructed to return exactly one row per input claim
3. add a coverage guardrail in verification diagnostics:
   - compare `parsed_claim_count` to `input_claim_count`
   - flag low coverage as verifier failure even if parsing succeeds
4. only after coverage is stable should real Pass 3 latency baselines be captured

Bottom line:

- parser robustness issue: substantially improved
- fallback issue: resolved on current fixtures
- coverage/collapse issue: still open
- not yet ready for Pass 3 optimization baselines

## Architecture Clarification Before Pass 3

Date: 2026-05-24

The user-facing paid research flow is broader than the deep research stage benchmarked so far.

### Full paid pipeline

The public pipeline is:

1. `research`
2. `analyst`
3. `writer`

This orchestration lives in the public backend entry point and paid pipeline flow:

- `server.ts`

### Deep research stage

The deep research pipeline benchmarked in this document lives inside the `research` step:

- `agents/research/deepPipeline.ts`

That stage performs:

1. brief generation
2. query generation
3. retrieval
4. claim extraction
5. verification
6. synthesis

### Implication

Previous latency measurements in this document mostly covered the **research stage** and its internals, not the full paid `research -> analyst -> writer` chain.

That does not invalidate the infrastructure or findings, but it does mean the eventual Pass 3 baseline must be refreshed against the **full user-facing pipeline**, not only the inner research stage.

### Pre-Pass-3 session plan

Before Pass 3 latency optimization:

1. **Session A**: verifier coverage guardrail
2. **Session B**: parser audit on research and analyst structured outputs
3. **Session C**: full paid-pipeline latency baseline capture

Only after those three sessions should Pass 3 optimization design be finalized.

## Session A: Verifier Coverage Guardrail

Date: 2026-05-24

This session added:

- prompt tightening to require exactly one output row per input claim
- a conservative coverage guardrail:
  - if `parsed_claim_count / input_claim_count < 0.5`
  - treat the verifier run as failure
  - return `[]` and use the existing fallback path
- tracing fields:
  - `coverage_ratio`
  - `coverage_guardrail_triggered`

### Post-session sweep

A 5-fixture x 3-run traced downstream-only sweep produced:

| Fixture | Fallback Rate | Parsed Counts | Coverage Ratios |
| --- | ---: | --- | --- |
| bitcoin-price-and-drivers | 1/3 | 8, 3, 8 | 1.0, 0.375, 1.0 |
| cisa-exploited-vulnerability | 0/3 | 13, 13, 13 | 1.0, 1.0, 1.0 |
| openai-latest-research | 0/3 | 16, 16, 16 | 1.0, 1.0, 1.0 |
| india-rbi-rate-decision | 0/3 | 8, 8, 11 | 1.0, 1.0, 1.375 |
| ipcc-climate-findings | 0/3 | 3, 3, 3 | 1.0, 1.0, 1.0 |

### What improved

The Bitcoin collapse case was caught correctly.

In the failing Bitcoin run:

- the model returned only 3 verification rows for 8 input claims
- `coverage_ratio = 0.375`
- `coverage_guardrail_triggered = true`
- verifier fell back to the existing heuristic path instead of silently shipping under-covered output

This is the intended behavior of the guardrail.

### New issue exposed

The RBI fixture showed the opposite failure mode:

- input claims: `8`
- parsed claims: `11`
- `coverage_ratio = 1.375`
- no fallback, because the current guardrail only protects against severe under-coverage

The traced verifier output for that run was not a collapse. It was an **expansion / drift** response:

- extra rows unrelated to the original claim set
- output shape valid JSON
- coverage above `0.5`
- current guardrail does not catch it

### Scenario classification

This session landed in **Scenario 4**:

- collapse still happens occasionally, but the new guardrail catches the severe collapse case
- however, a different failure mode remains: partial or over-expanded output can still evade the current threshold logic

More precisely:

- **Bitcoin** behaved like Scenario 2 in one run: collapse happened and guardrail caught it
- **RBI** introduced Scenario 4: invalid expansion that preserves or exceeds row count, so the under-coverage guardrail does not fire

Because Scenario 4 fired, Session A should be treated as a **useful partial correctness improvement, not a final fix**.

### Latency notes

Verification medians from this sweep:

- Bitcoin: `22.9s`
- CISA: `43.4s`
- OpenAI: `52.9s`
- RBI: `26.1s`
- IPCC: `11.8s`

These are not yet stable enough to use as the final Pass 3 baseline because verifier correctness is still not fully controlled.

### Recommendation after Session A

Do **not** proceed to Session B yet.

First, resolve the remaining verifier coverage issue:

1. add an upper-bound or shape-preservation guardrail
   - for example, reject outputs that materially exceed the input claim count
   - and/or reject rows whose claim text does not map back to the input claim set
2. rerun the 5-fixture x 3-run sweep
3. only then proceed to:
   - Session B: research/analyst parser audit
   - Session C: full pipeline baseline capture

So Session A improved safety, but it did **not** fully close verifier correctness.
