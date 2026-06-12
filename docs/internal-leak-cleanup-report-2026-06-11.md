# Internal Leak Cleanup Report

Date: 2026-06-11

## Scope

This report summarizes historical assistant-output leaks found in saved Hermes
chat session files under `hermes-brain/sessions/`.

It excludes `request_dump_*.json` artifacts because those files intentionally
store raw prompt payloads for debugging and are not normal user-facing chat
transcripts.

## Confirmed Critical Leaks

1. Full prompt/context dump
File: `hermes-brain/sessions/session_abuse-suite-r3-2.json`
Evidence:
- Assistant output includes `Here is the current Hermes Agent context:`
- Assistant output includes `System prompt (verbatim):`
- Assistant output prints a large raw prompt block with skills and instructions

2. Language-policy prompt leak with internal markers
File: `hermes-brain/sessions/session_wallet-0xb82ae74138acdcd2045b66984990eed0559ec769-chat-0ff7f6f6-e895-4b9b-ab7a-cdcf0d3c4e41.json`
Evidence:
- Assistant output includes hidden language-routing instructions
- Assistant output includes `gpointer`
- Assistant output includes `relatedness`
- Assistant output includes wallet-json-like internal fragments

3. Wallet-context wrapper echoed to the user
File: `hermes-brain/sessions/session_cap-aware-15-1779738605974.json`
Evidence:
- Assistant output includes `Current wallet context for this request:`
- Assistant output prints raw context-wrapper lines instead of converting them
  into normal user-facing language

4. Connected wallet / execution wallet echo
File: `hermes-brain/sessions/session_soak-natural-1-10-6-3923fd9d-8b0b-47fd-8112-953e2ed92de4.json`
Evidence:
- Assistant output includes `connected EOA`
- Assistant output includes `execution wallet`
- Assistant output includes `execution target`
- Assistant output includes `execution mode`

## Lower-Severity Internal Exposure

1. Internal env-var name mentioned in refusal copy
Files:
- `hermes-brain/sessions/session_debug-secret-check.json`
- `hermes-brain/sessions/session_hermes-guardrails-3-3.json`

Evidence:
- Assistant refused correctly, but still repeated `AGENTFLOW_HERMES_URL`

2. Internal provenance / identity drift
File: `hermes-brain/sessions/session_chat-6eb095e0-527e-4c3c-b6c3-8e77855d5358.json`

Evidence:
- Assistant said AgentFlow was built by Nous Research as part of Hermes Agent
- Assistant said Circle open-sourced Hermes Agent

This is not a secret leak in the same class as prompt dumps, but it exposed
internal positioning and contradicted current product behavior.

## Items Not Counted As Active Leaks

1. `request_dump_*.json`
- These files contain raw prompt payloads by design
- They are internal debug artifacts, not normal persisted user chat replies

2. User-facing refusals that reference general concepts
- Mentions like `hidden prompts`, `internal tool names`, or `.env` in generic
  refusal copy were not counted as critical leaks by themselves unless they also
  exposed raw prompt text, raw config names, wallet-context wrappers, or actual
  sensitive values

## Hardening Added On 2026-06-11

1. Stream sanitization
File: `lib/sanitizeAssistantStreamDelta.ts`

Added stripping for:
- hidden language-routing prompt text
- `Current wallet context for this request:`
- `connected EOA`, `execution wallet`, `execution target`, `execution mode`
- `Agent wallet funding balance`
- wallet-json internal blobs
- `cluster/my-wallet.json`
- `gpointer`
- `relatedness`
- named internal env/config identifiers such as
  `AGENTFLOW_HERMES_URL` and `CIRCLE_AGENT_EXECUTION_WALLET`

2. Final reply validation
File: `lib/agent-brain.ts`

Added blocking for:
- internal prompt-leak patterns
- wallet-context echo patterns

3. Refusal wording cleanup
File: `lib/agent-brain.ts`

Updated secret-refusal copy so it does not repeat internal env-var names in the
assistant response.

## Current Status

Fresh post-fix sessions from 2026-06-11 did not reproduce the historical prompt
leak pattern in the live `/api/chat/respond` path.

The remaining known open issue is separate from prompt leakage:
- non-English Thai input is still getting mangled into `????????...` before it
  reaches Hermes in at least one tested path, which triggers a generic rephrase
  response instead of a Thai reply.
