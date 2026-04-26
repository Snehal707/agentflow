# AgentFlow Intent Interpretation Skill

**Location (this repo):** `agentflow-frontend/SKILL.md`  
Consult this file for any payment, schedule, send, or balance command.

## Purpose
Teach Hermes to correctly parse user intent for DeFi/payment commands and prevent hallucination of onchain state.

---

## RULE 0 — Non-negotiable: live state only

**NEVER** report scheduled payment status, wallet balances, transaction history, or **any** on-chain state unless you have fetched it **live in this session** via the correct tool call. Do **not** use memory, rolling context, or prior conversation to assert state.

| Question type | Call this Hermes tool first (before answering) |
|---------------|-----------------------------------------------|
| Schedules, recurring payments, automations | `list_scheduled_payments` |
| Balances, funds, how much USDC/EURC/vault | `agentflow_balance` |
| Past sends, payment history, ledger / txs | `agentpay_history` |

Conceptual names sometimes used in docs (`getScheduledPayments()`, `getBalance()`) map to **`list_scheduled_payments`** and **`agentflow_balance`** here.

If a fetch fails or returns an error, **say so**. **Never guess** IDs, amounts, statuses, or balances.

**AgentFlow chat note:** The runtime may attach a block **"Current wallet context for this request"** (balance + portfolio) for **this message only** after a server-side live fetch. You may answer balance/portfolio questions from **that injected block for the current turn** without duplicating `agentflow_balance`. You must **not** treat older chat turns or free-form memory as authoritative for any of the rows in the table above.

---

## RULE 1 — Never Assert State You Haven't Fetched

Before reporting ANY of the following, you MUST query the live source of truth first (see RULE 0):
- Scheduled payment status (active / cancelled / paused)
- Wallet balance (USDC, USYC, or any token)
- Transaction history
- Vault APY or positions
- Agent registration status

**Wrong behavior:**
> User: "Do I have any scheduled payments?"
> Hermes: "Yes, you have a weekly 1 USDC payment to jack.arc — Scheduled ID: 020f4b2..."

This is hallucination. Hermes fabricated a state it did not verify.

**Correct behavior:**
> Hermes calls `list_scheduled_payments` → receives empty list → responds:
> "You have no active scheduled payments."

If the API call fails or returns an error, say so explicitly. Never fall back to guessing.

---

## RULE 2 — Intent Phrase Mapping

Users will express the same intent in many different ways. Always map to the canonical action before executing.

### Cancel / Stop

| User says | Canonical intent |
|-----------|-----------------|
| "cancel all scheduled payments" | CANCEL_ALL_SCHEDULED |
| "stop all recurring sends" | CANCEL_ALL_SCHEDULED |
| "kill all my schedules" | CANCEL_ALL_SCHEDULED |
| "remove all automations" | CANCEL_ALL_SCHEDULED |
| "i don't want any more automatic payments" | CANCEL_ALL_SCHEDULED |
| "cancel the weekly payment to X" | CANCEL_SCHEDULED(recipient=X) |
| "stop sending to X" | CANCEL_SCHEDULED(recipient=X) |
| "pause payments to X" | PAUSE_SCHEDULED(recipient=X) |

### Create / Schedule

| User says | Canonical intent |
|-----------|-----------------|
| "send X USDC every week to Y" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly, recipient=Y) |
| "set up a recurring payment" | CREATE_SCHEDULED (prompt for missing params) |
| "automate X USDC monthly to Y" | CREATE_SCHEDULED(amount=X, token=USDC, freq=monthly, recipient=Y) |
| "start paying Y X USDC weekly" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly, recipient=Y) |
| "pay weekly X USDC to Y" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly, recipient=Y) |
| "pay weekly payment of X USDC to Y" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly, recipient=Y) |
| "pay weekly transfer of X USDC to Y" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly, recipient=Y) |
| "send X USDC to Y every week" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly, recipient=Y) |
| "pay X USDC to Y every monday" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly_day(monday), recipient=Y) |
| "send X USDC to Y on mondays" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly_day(monday), recipient=Y) |
| "schedule X USDC monthly to Y" | CREATE_SCHEDULED(amount=X, token=USDC, freq=monthly, recipient=Y) |
| "start paying Y X USDC every monday" | CREATE_SCHEDULED(amount=X, token=USDC, freq=weekly_day(monday), recipient=Y) |

### Query / Check

| User says | Canonical intent |
|-----------|-----------------|
| "what's running?" | LIST_SCHEDULED |
| "show my automations" | LIST_SCHEDULED |
| "any active scheduled payments?" | LIST_SCHEDULED |
| "do I have recurring sends?" | LIST_SCHEDULED |
| "check my schedules" | LIST_SCHEDULED |
| "what's my balance?" | GET_BALANCE |
| "how much USDC do I have?" | GET_BALANCE(token=USDC) |

### Send (one-time)

| User says | Canonical intent |
|-----------|-----------------|
| "send X USDC to Y" | SEND_ONCE(amount=X, token=USDC, recipient=Y) |
| "transfer X to Y" | SEND_ONCE (confirm token if ambiguous) |
| "pay Y X USDC" | SEND_ONCE(amount=X, token=USDC, recipient=Y) |

---

## RULE 3 — Disambiguation Protocol

If the user's phrase is ambiguous, ask ONE clarifying question. Do not execute and do not hallucinate.

**Example:**
> User: "stop the payment"
> Hermes: "Which payment would you like to stop? You currently have: [list from live query]"

Never assume which payment the user means.

---

## RULE 4 — Post-Action Verification

After executing any state-changing action (cancel, create, send), always confirm by re-querying:

1. Execute action → receive tx hash or schedule ID
2. Re-query state (`list_scheduled_payments`, `agentflow_balance`, `agentpay_history` as appropriate)
3. Report the verified result, not the assumed result

**Example after cancellation:**
> "Done. I've cancelled all scheduled payments. Live check confirms: 0 active schedules."

---

## RULE 5 — Confidence Calibration

If you are uncertain whether an action was completed (network timeout, ambiguous API response), say so:

> "The cancellation request was sent but I couldn't confirm the final state. Run `/schedules` to verify."

Never fabricate a success confirmation.

---

## Common Failure Modes to Avoid

| Failure | Why it happens | Fix |
|---------|---------------|-----|
| Reporting stale scheduled payments | Using context window state instead of live query | Always call `list_scheduled_payments` first |
| Reporting wrong balance | Last known balance in memory | Always call `agentflow_balance` first (or use only this-turn injected wallet context) |
| Misidentifying cancel vs pause | Phrase ambiguity | Map to canonical intent table above |
| Confirming cancellation without verifying | Assuming API success | Re-query after every write action |
| Making up schedule IDs | Pattern completion | Only report IDs returned by live API |

---

## Integration Note

Drop this skill file into `~/.hermes/skills/agentflow/SKILL.md` (or symlink to `agentflow-frontend/SKILL.md` in this monorepo).

Reference it in the AgentFlow / Hermes system prompt, for example:
```
Before responding to any payment, balance, schedule, or send intent, consult the AgentFlow Intent Interpretation Skill (agentflow-frontend/SKILL.md in-repo, or ~/.hermes/skills/agentflow/SKILL.md).
```
