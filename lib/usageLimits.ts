// Default per-wallet daily caps for the perception agents. Centralized so the
// value lives in one place (server.ts and the agent entrypoints all import it)
// and so the RAG accuracy guard can assert the docs against the real default.
export const VISION_DAILY_LIMIT_DEFAULT = 5;
export const TRANSCRIBE_DAILY_LIMIT_DEFAULT = 5;

// Default pay-per-task rate limits (per wallet) when the env overrides are unset.
export const PAY_PER_TASK_DAILY_LIMIT_DEFAULT = 200;
export const PAY_PER_TASK_MINUTE_LIMIT_DEFAULT = 10;
