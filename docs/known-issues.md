# Known Issues

## Post-Launch Architectural Items

Two architectural items are documented for post-launch:

1. Routing authority is split between fast paths and the brain / intent classifier. Each handles session state independently, so edge cases in conversational continuity may surface. These are patched as they appear. Future v2 work: unify routing into a single session-state-first pipeline.

2. Financial advice grounding: writer and chat responses can occasionally make casual suggestions about moving user funds, such as treating Gateway reserve as vault-deployable capital. Guardrails should keep portfolio-aware responses factual unless the user explicitly asks for recommendations.

## Upstream Intent Router Oddities

These are pre-existing upstream router issues and do not come from the internal capability path.

- `send email to team` validates as `agentpay.send`
- `Will ARC launch its Mainnet before June 30` validates as `predmarket.list`

These are router-level issues and should be handled in a separate router cleanup session post-launch.

## Internal Capability External-Research Edge Cases

These are known edge cases in the current internal capability / research boundary and are not caused by the clarify outcome or the research-prefix hard guard.

- `yield curve outlook`
- `DeFi yield strategies`
- `L2 bridge designs`
- `Aave yields`
- `Lido staking status`
- `Will ARC launch its Mainnet before June 30`

These should be revisited in a post-launch routing cleanup session rather than patched opportunistically.

## Portfolio Impact Tense Coverage

Status: fixed for current routing.

Portfolio-impact research detection now catches both base and inflected impact verbs:

- `affect`, `affects`, `affected`, `affecting`
- `impact`, `impacts`, `impacted`, `impacting`

Previously, plural and past/progressive tense forms could be missed. Examples now covered:

- `How does the fed decision affects my portfolio`
- `Macro events that impact my holdings`
- `What's impacting my portfolio right now`

These should route to portfolio-impact research and load wallet context when a wallet is available.

## Explicit Research Request Boundary

Status: fixed for current routing.

Explicit research requests now use shared detection across chat routing and the intent router.

Patterns that trigger:

- `research` at the start of the message
- `research report`
- imperative verb plus `research`
- imperative verb plus `report on/about`

This overrides product FAQ and direct AgentFlow feature routing for deliverable-style requests, while preserving product questions such as `what is research in AgentFlow` and conversational mentions such as `I read some research on bitcoin yesterday`.

## Predmarket Clarify Deferred

Predmarket clarify is intentionally deferred post-launch.

Reason:

- prediction-market asks like AchMarket mix internal integration state with external reputation and public-web evidence
- that needs a cross-boundary policy, not the same clarify rules used for bridge, vault, and swap

## Operational Encoding Note

PowerShell `Get-Content` default encoding can display multilingual content as mojibake when raw-viewing artifacts.

This is display-layer encoding noise, not data corruption.

- Use Node-based JSON inspection for accurate content verification.
- Standardize log capture to UTF-8 for future operational consistency.
