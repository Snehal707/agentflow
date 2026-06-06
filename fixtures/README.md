# Research Benchmark Fixtures

We keep two fixture layers so we can benchmark different parts of the research pipeline without live retrieval drift or extractor variance muddying the signal.

## Fixture types

### 1. Source fixtures

Stored in `fixtures/research-fixtures/*.json`.

Each source fixture freezes the handoff point right after `retrieveSources(...)` and stores:

- the original query string (`task`)
- the generated research brief (`brief`)
- the generated retrieval queries (`queries`)
- the retrieved `Source[]` payload (`sources`)
- capture timestamp and runtime version

These fixtures are used for:

- full replay benchmarking
- extraction-only benchmarking
- capturing canonical claims fixtures

### 2. Claims fixtures

Stored in `fixtures/research-claims-fixtures/*.json`.

Each claims fixture is captured from an existing source fixture and stores:

- the source fixture name it came from (`source_fixture`)
- the extracted `Claim[]`
- claim count and extraction latency
- capture timestamp and runtime version
- `capture_notes`
- `capture_config`

`capture_config` records the extractor conditions used at capture time:

```json
{
  "claim_batch_concurrency": 1,
  "claim_batch_timeout_ms": 45000
}
```

These fixtures are used for downstream-only benchmarking so verification and synthesis can be measured without extraction variance.

## Why we use fixtures

Live research runs are noisy in two different ways:

1. retrieval drift:
   - scrape availability changes
   - APIs rate-limit
   - current events change source mix

2. extraction variance:
   - Hermes Fast can produce materially different claim sets from the same `Source[]`

The two-layer fixture setup lets us isolate the part we actually want to measure.

## Capture convention

Canonical claims fixtures should be captured with:

```bash
CLAIM_BATCH_CONCURRENCY=1
```

Why:

- sequential extraction is the most stable capture mode we currently have
- it avoids mixing concurrency experiments into the canonical downstream benchmark input
- the saved `capture_config` makes the capture conditions explicit

This is a convention, not a hardcoded requirement, but we should follow it unless there is a strong reason not to.

## How to regenerate

### Capture a source fixture

```bash
npx tsx --env-file=.env scripts/capture-research-fixture.ts <fixture-name> "<query>"
```

Example:

```bash
npx tsx --env-file=.env scripts/capture-research-fixture.ts bitcoin-price-and-drivers "Bitcoin price today and crypto market drivers"
```

### Capture a claims fixture from an existing source fixture

```bash
$env:CLAIM_BATCH_CONCURRENCY=1
npx tsx --env-file=.env scripts/capture-claims-fixture.ts <fixture-name>
```

Optional notes flag:

```bash
npx tsx --env-file=.env scripts/capture-claims-fixture.ts <fixture-name> --notes=recaptured_more_representative
```

## Anomaly handling for claims fixtures

If a capture looks unusually small or large relative to typical extraction behavior:

- re-run once
- if the re-run is more representative, keep it and set:
  - `capture_notes: "recaptured_more_representative"`
- if the re-run is also odd, keep one capture and set:
  - `capture_notes: "captured_with_natural_variance"`

We are not trying to find the “best” claim set. We want a documented, consistent claim set that downstream benchmarks can reuse.

## When to regenerate

Refresh fixtures when:

- the registry changes materially
- adapter behavior changes materially
- benchmark topics drift enough that the fixtures stop representing realistic inputs

As a rule of thumb, refresh monthly or after a meaningful retrieval / registry session.

## Why we do not auto-regenerate

Auto-regeneration would defeat deterministic benchmarking by silently changing the benchmark input between runs. Fixtures are explicit test artifacts that should be regenerated intentionally, reviewed, and committed.
