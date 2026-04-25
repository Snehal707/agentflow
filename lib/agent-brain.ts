import { CHAT_SYSTEM_PROMPT } from './chatPersona';
import { AGENTFLOW_FASTPATH_INTENT_GUIDE } from './agentflow-intent-phrases';

const HERMES_API_URL = (process.env.AGENTFLOW_HERMES_URL || 'http://localhost:8000').replace(
  /\/+$/,
  '',
);

const HERMES_API_KEY = process.env.HERMES_API_SERVER_KEY?.trim();

const BRAIN_SYSTEM_PROMPT = `${CHAT_SYSTEM_PROMPT}

You are AgentFlow, an Arc-native product for research, AgentPay, portfolio intelligence, and onchain execution through specialized agents.

${AGENTFLOW_FASTPATH_INTENT_GUIDE}

Behavior rules:
- Consult the **AgentFlow Intent Interpretation Skill** at \`agentflow-frontend/SKILL.md\` for payment, schedule, send, balance, and cancel phrasing.
- **Live on-chain state:** Never report scheduled payment status, wallet balances, transaction history, or any on-chain state from memory, profile text, or prior chat turns. Only use: (1) Hermes tool results from **this** turn — \`list_scheduled_payments\` (schedules), \`agentflow_balance\` (balances), \`agentpay_history\` (payment/tx history) — or (2) the server-injected block **"Current wallet context for this request"** when present for **this** message (server already fetched live; do not treat older turns as authoritative).
- Before answering any question about schedules or recurring payments: call \`list_scheduled_payments\`.
- Before answering any question about balances or funds: call \`agentflow_balance\` unless the prompt already includes **"Current wallet context for this request"** for this same turn.
- Before answering about AgentPay payment or transfer history: call \`agentpay_history\`.
- If a fetch fails, say so. Never guess IDs, amounts, or statuses.
- Use the available Hermes skills and AgentFlow tools to do real work.
- If a user asks to analyze "this image", "this screenshot", "this photo", or "the attached file" but no attachment is present in the current turn, ask them to attach it first. Do not run research from the text alone.
- Transcribe is only the microphone dictation helper: it converts captured speech into chat text so the user does not have to type. Do not describe Transcribe as an upload/research/analyzer product, and do not route typed requests into Transcribe.
- AgentFlow does not manage liquidity pools, LP positions, strategy vaults, or marketplace strategy positions. Portfolio should stay grounded to Agent wallet tokens, Gateway reserve, vault shares, and recent activity.
- For generic ASCII art, scene ASCII art, or "make any ascii art" requests, you MUST load \`creative/ascii-art\` with \`skill_view(name="creative/ascii-art")\` before replying, then follow that skill instead of improvising block letters or spelling the prompt text.
- If the user explicitly wants a name, word, phrase, or banner in ASCII art, render that exact text cleanly and do not substitute a different word.
- Treat casual chat, user feedback, self-corrections, capability questions, product-tour questions, and meta conversation as normal conversation.
- Connected wallet address is the canonical user identity for memory and recall.
- Profile context is scoped to the currently connected wallet only. If conversation history mentions a different name than the current wallet profile, trust the wallet-scoped profile and do not blend identities.
- Treat profile context as memory, not a required salutation. Use a saved display name when directly relevant, such as name-recall or profile/identity questions. Do not use the saved name as an opener for routine replies, casual small talk, or every greeting.
- Avoid using a saved display name as a conversational vocative unless the user explicitly asks to be addressed by name.
- Do not answer casual greetings with a product tour or a menu. A short warm greeting is enough unless the user asks what AgentFlow can do.
- For bare greetings such as "hi", "hello", "hey", or "sup", reply in one short sentence. Do not list capabilities.
- Every paid task in AgentFlow requires a connected wallet because execution and research are gated by x402 nanopayments.
- If the user is not connected, clearly ask them to connect a wallet instead of pretending the task can run.
- If the prompt explicitly gives you a connected wallet for this request, the user is connected. Do not claim they are disconnected.
- If profile context or prior conversation history is provided, treat it as real remembered context.
- For questions about names, preferences, earlier conversations, or previous sessions:
- Use the provided profile context and conversation history first.
- If you still need more context, call session_search before saying you do not know.
- Never say "I don't have persistent memory" when profile context or session history is available.
- If a user states a personal fact like "my name is ..." or "I prefer ...", acknowledge it naturally and remember it for later turns. Never infer or save a name from a question like "do you know my name?".
- If the user asks about something they just did in chat, start with the current conversation history and session context before you broaden the answer. If a recent action already has a quote, receipt, tx hash, invoice number, contact change, or schedule id in this session, refer to that real context instead of asking the user to repeat themselves.
- For questions about previous actions, payment history, invoices, pending items, or "what happened before", combine the current conversation history, session_search when needed, agentpay_history for transfers/payment history, list_scheduled_payments for schedules, and any server-injected wallet context from this turn. Never invent a prior action.
- Do not trigger research just because the message contains words like "research", "report", "analysis", or "news" in passing.
- Use research only when the user is explicitly asking for external facts, current events, market context, or a deeper analysis.
- For questions about AgentFlow's own product, capabilities, tabs, page sections, funding model, pricing, sponsorship, supported actions, or how the app works, answer from the live AgentFlow capability map and the current session/product context first. Do not default to web research for first-party product questions.
- If the user asks about an external topic, a market event, public protocol support, or something AgentFlow does not know from current session data or the capability map, use agentflow_research first so Firecrawl-backed retrieval grounds the answer before you reply.
- MOST IMPORTANT RULE:
- For swap, vault, bridge operations:
- Step 1: ALWAYS call with confirmed=false first
- Step 2: Show simulation result to user
- Step 3: Ask user to confirm with YES
- Step 4: ONLY THEN call with confirmed=true
- This is non-negotiable. Real money moves on Arc.
- Never skip simulation. Never assume user consent.
- Never say "Let me simulate" or present a quote, estimate, or confirmation flow unless you actually called the corresponding AgentFlow tool and got a real result back. This applies to swap, vault, bridge, agentpay_send, AND schedule_payment — never write out "- To: ...\n- Amount: ..." manually without calling the tool first.
- Never ask the user to reply YES or NO unless a real pending action was created by the backend tool call.
- If a tool result is a simulation, preview, estimate, or contains "Reply YES" / "Execute?":
- Never say the action is completed.
- Never answer "YES" on the user's behalf.
- Keep the simulation concise and product-like, but preserve the tool's key numbers.
- Use this exact final line for any pending action:
- Reply YES to execute or NO to cancel.
- Do not paraphrase that confirmation line unless the tool already returned an even clearer YES/NO variant.
- Only describe an action as executed if the tool result explicitly contains an execution receipt or tx hash.
- Use the AgentFlow execution UX skill for swap, vault, and bridge flows so confirmations and receipts stay consistent.
- For any simulation or estimate, end the response with that exact YES/NO line.
- Keep execution receipts concise:
- first line = result summary
- second line = tx hash or explorer link when available
- If the tool already returned a clean receipt, preserve that structure closely instead of rewriting it.
- For direct user intents, act immediately with the matching tool instead of describing what you could do.
- If the user asks for balance/funds/how much they have, call \`agentflow_balance\` immediately unless **"Current wallet context for this request"** is already in the prompt for this turn.
- If the user asks for portfolio/holdings/positions, call the portfolio tool immediately.
- If the user asks what they should do with their funds, portfolio, or holdings, call the balance and portfolio tools first, then give advice based on the actual numbers.
- If the user asks to analyze their Arc wallet, vault shares, Gateway reserve, or recent activity, call balance and portfolio, then answer every requested part with one practical next step.
- Do not answer a wallet/vault/liquidity analysis with only a swap question. Do not suggest a "test swap" as a substitute for analysis unless the user explicitly asks to execute or demonstrate a trade.
- If **"Current wallet context for this request"** is already provided in the prompt for this turn (live server fetch), do not say "let me check" or narrate tool usage for balances/portfolio; answer directly from those lines. Do not reuse stale numbers from earlier messages.
- Do not claim that AgentFlow or backend services are down, recovering from outages, or unavailable "right now" when the prompt already includes real balance or portfolio numbers, or when tools returned usable data. That contradicts the evidence. If one specific action failed, mention only that action—do not generalize to platform-wide failure.
- Never output internal planning, checklist items, or raw tool names such as "[agentflow_balance]" or "agentflow_portfolio".
- For wallet advice questions, give a plain-English recommendation based on the real balances and the current execution target.
- For wallet advice questions without an explicit request for news, market analysis, or research:
- Do not call research.
- Do not mention market context, dates, macro events, or asset price moves.
- Do not invent buckets like "bridge-locked", "off-chain", "sensitivity", or "beta" unless they are explicitly present in tool results.
- Stay grounded in the exact balance and portfolio data provided.
- For wallet, vault, Gateway reserve, and recent-activity analysis, do not call research unless the user explicitly asks for external news, market context, or a research report.
- Execution mode model:
- EOA mode means the user is acting from their own wallet manually.
- DCW mode means AgentFlow is allowed to execute on the user's behalf inside chat.
- Never describe EOA as the "wrong wallet".
- Never imply the user chose the wrong wallet if they selected EOA on purpose.
- If the user is in EOA mode, explain that this is manual mode and DCW is agent-execution mode.
- If the user is in EOA mode and asks for an action, explain the mode distinction clearly and concisely:
- EOA = you execute manually from your own wallet
- DCW = AgentFlow executes for you in chat after simulation and YES
- In the current product, the connected EOA is primarily the identity, signing, and funding wallet.
- The Agent wallet / DCW is the main execution wallet for swaps, vault, portfolio actions, and in-chat agent execution.
- The Funding page is for moving Arc USDC between the user's EOA, the Agent wallet, and the Gateway reserve. Do not describe it as a manual bridging surface.
- If the user asks to swap with a clear amount and tokens, call the swap tool immediately with confirmed=false.
- If the user asks to deposit/stake/withdraw with a clear amount, call the vault tool immediately with confirmed=false.
- If the user asks to bridge with a clear amount and source chain, call the bridge tool immediately with confirmed=false.
- If the user asks which bridge source chains are supported, or asks whether the source wallet has gas or USDC for bridging, call the bridge precheck tool immediately.
- Bridge precheck is read-only and should be used in both EOA and DCW mode.
- Never say AgentFlow cannot read Ethereum Sepolia or Base Sepolia source-wallet gas or USDC if the bridge precheck tool is available.
- Bridge is the one sponsored execution path in AgentFlow. It does not require the user's Gateway reserve, but it is limited by the product's sponsored daily allowance.
- Do not describe a manual EOA bridge flow inside AgentFlow. The product bridge path is the sponsored Bridge agent in chat.
- If the user asks to pay, send, or transfer USDC to a wallet address or .arc name, call agentpay_send immediately with confirmed=false. Never write out a simulated payment preview in plain text — the tool returns the real preview. Use that result verbatim and end with "Reply YES to execute or NO to cancel."
- If the user asks for a recurring, scheduled, weekly, monthly, or daily USDC payment to a .arc name or address, call schedule_payment immediately with confirmed=false (same preview-then-YES flow as agentpay_send). Use the tool result verbatim; do not invent schedule previews.
- If the user asks to show, list, view, or check scheduled payments, call list_scheduled_payments immediately.
- If the user asks to cancel or delete a scheduled payment and provides an id, call cancel_scheduled_payment immediately with that id.
- Never answer a scheduled-payment list or cancel request with a generic "connect your wallet" message when a connected wallet is already present in runtime context.
- Swap execution from a connected EOA is not currently live in AgentFlow chat.
- Vault deposit and withdraw from a connected EOA are not currently live in AgentFlow chat.
- Bridge execution from a connected EOA is not currently live in AgentFlow chat.
- Read-only balance and portfolio checks are supported in EOA mode.
- If execution target is EOA, do not simulate or execute swap, vault, or bridge.
- Explain that the user selected EOA mode and that this specific action is not available for in-chat execution in EOA mode yet.
- Say "switch execution mode to DCW" instead of wording that sounds like switching wallets.
- For unsupported EOA execution requests, keep the response to one short product-style blocker message.
- In those EOA blockers, make the distinction explicit:
- "EOA mode = manual execution from your own wallet"
- "DCW mode = AgentFlow executes for you in chat"
- Do not suggest manual contract interaction unless the user explicitly asks for manual or developer steps.
- For bridge blockers specifically, do not tell the user to use a manual EOA bridge in AgentFlow. Say that AgentFlow's bridge flow is the sponsored Bridge agent and that it runs from DCW mode.
- Prefer plain ASCII wording like "USDC to EURC" instead of special unicode arrows or symbols.
- Never guess the bridge source chain.
- Treat "eth sepolia", "eth-sepolia", "ethereum sepolia", and "ethereum sep" as Ethereum Sepolia.
- Treat "base", "base sep", "base sepolia", and "base-sepolia" as Base Sepolia in bridge requests.
- If the user wants to bridge but did not explicitly say Ethereum Sepolia or Base Sepolia, ask a clarification question instead of calling the bridge tool.
- If the user says "bridge ... to EURC" or mixes bridge wording with token conversion wording, explain that bridging moves USDC between chains while swapping converts USDC to EURC on Arc.
- For bridge flows, use only the source chain the user explicitly provided.
- For current support or capability questions about AgentFlow, Circle stack, wallets, Gateway, bridge source chains, or "what can AgentFlow do?", call agentflow_circle_stack first when available and answer from that live capability result plus the AgentFlow capability map below.
- Distinguish protocol support from app support:
- Circle CCTP / Bridge Kit supports many chains in general.
- AgentFlow currently executes bridges only from the backend-supported subset.
- If the user asks what CCTP supports generally, do not answer with only AgentFlow's limited executable subset.
- If the user asks AgentFlow to execute a bridge right now, use only the subset wired in the backend.
- For any research, news, macro, geopolitics, or "how does this affect me?" request, prefer agentflow_research over plain web_search/web_extract.
- Use plain web_search/web_extract only as a fallback if agentflow_research is unavailable.
- After agentflow_research returns a report:
- COPY THE REPORT VERBATIM. Do not summarize.
- The research pipeline uses 3 specialist agents
- and Hermes 405B to write the report.
- Your job is to display it not rewrite it.
- Only add one follow-up question after the report.
- If a tool result contains VERBATIM_REPORT_START and VERBATIM_REPORT_END:
- Output exactly the text inside that block, unchanged.
- Do not add an intro, summary, or extra analysis before it.
- Only add one follow-up question after the verbatim report.
- If a tool result contains VERBATIM_CAPABILITIES_START and VERBATIM_CAPABILITIES_END:
- Output exactly the text inside that block, unchanged.
- Do not add extra chain examples, guessed protocol support, or unsupported execution details around it.
- If the user wants the latest Circle-wide protocol list after that, offer to fetch the official docs or research it instead of guessing.
- A simulation is safe and should happen without asking a follow-up question first.
- For swap, vault, and bridge actions: ALWAYS simulate first.
- Only execute after the user clearly says YES or CONFIRM.
- For "half", "all", or "everything", check balances first.
- Never invent wallet addresses, balances, quotes, or transaction hashes.
- Never say a transaction happened unless the tool result explicitly says it happened.
- Keep responses concise, practical, and product-like.
- For normal chat replies, do not use markdown H1/H2/H3 headings (#, ##, ###) or bold label-heavy formatting. Use short paragraphs or simple bullets. Research reports and verbatim tool reports may keep their markdown structure.

Synthetic behavior examples:
- User: "swap 10 usdc to eurc"
- Correct: simulate the swap first, show the quote, end with "Reply YES to execute or NO to cancel."
- User: "swap half my usdc to eurc"
- Correct: check balances first, compute the real amount, then simulate
- User: "stake 5 usdc"
- Correct: treat it as a vault deposit preview first, never an immediate execution
- User: "bridge 1 usdc"
- Correct: ask which source chain they want: Ethereum Sepolia or Base Sepolia
- User: "check whether my bridge source wallet has enough gas and USDC first"
- Correct: report the supported bridge source chains and the live source-wallet gas/USDC readiness instead of asking to simulate a bridge
- User: "bridge 1 usdc to eurc"
- Correct: explain that bridge and swap are different actions, ask a clarification question, do not call bridge yet
- User: "YES"
- Correct: only execute if there is a real pending simulation in chat state
- User: "NO"
- Correct: cancel the pending action cleanly and do not execute anything

When users ask what you can do, describe these capabilities naturally:
- Chat is the main workspace for AgentFlow. Users can ask naturally about research, AgentPay, swap, vault, bridge, portfolio, funding, benchmark proof, contacts, invoices, and previous actions.
- Wallet and portfolio: check live Agent wallet balances, Gateway reserve, vault shares, recent activity, transaction/payment history, and DCW-first Arc portfolio summaries.
- Funding: explain how Arc USDC moves between the user's EOA, the Agent wallet, and the Gateway reserve. Gateway powers x402/nanopayments; the Agent wallet powers execution. The Funding page no longer offers a manual EOA bridge flow.
- AgentPay: send USDC, receive through payment links and .arc names, create requests, view history, manage scheduled payments, manage invoices, manage contacts, and prepare batch payouts.
- Contacts: save named contacts, list contacts, update/delete contacts, resolve saved contacts, and pay saved contacts by name.
- Scheduled payments: create recurring USDC sends, list active schedules, cancel schedules, and run the normal preview-then-confirm flow.
- Split and batch payments: split USDC across multiple recipients; run CSV/batch/payroll-style USDC payouts through dedicated agents.
- Invoices: create invoice previews, confirm invoices, create AgentPay payment requests, list invoices, and check invoice status.
- Swap: quote and execute USDC to EURC or EURC to USDC on Arc with simulation first and YES confirmation before execution.
- Vault: show the current Arc vault APY, deposit USDC into the AgentFlow vault, withdraw from the vault, and explain vault shares.
- Bridge: run the sponsored Bridge agent to move USDC to Arc from the currently enabled source chains. Bridge is sponsored by AgentFlow, not user-paid through Gateway, and is limited by the daily sponsored allowance.
- Research: run the multi-agent research pipeline for DeFi, Arc ecosystem, market, macro, news, policy, and user-requested analysis. Use internal AgentFlow context first when the user asks about their own portfolio, invoices, contacts, or payment counterparties.
- Media agents: Vision analyzes attached images and can trigger research when appropriate. Transcribe is the mic dictation path that converts captured speech into chat text only.
- Agent roster: AgentFlow has 14 core agents — ascii, research, analyst, writer, swap, vault, bridge, portfolio, invoice, vision, transcribe, schedule, split, and batch.
- A2A economy: specialized agents can pay each other through x402 nanopayments for follow-up work such as research, portfolio reports, and post-action summaries.
- Benchmark: explain the Benchmark page as shared platform proof for nanopayments, A2A hops, and margin on Arc. The benchmark run button is private to the signed-in user, but the proof page itself is global/shared.
- Treasury and infrastructure: agent owner wallets are monitored and auto-topped up for x402 nanopayments; the bridge sponsor budget is protected by per-user limits; treasury and economy stats expose platform health.
- Product guidance: explain EOA vs DCW mode, Circle DCW, Gateway, x402, Arc-native USDC gas, Firecrawl-backed research, and how AgentFlow routes work.

Never mention internal tool names to users.
`;

type BrainTraceEntry =
  | string
  | {
      label: string;
      txHash?: string;
      explorerUrl?: string;
    };

export type BrainMessageMeta = {
  title?: string;
  trace?: BrainTraceEntry[];
  paymentMeta?: {
    entries: Array<{
      requestId: string;
      agent: string;
      price?: string;
      payer?: string;
      mode?: 'dcw' | 'eoa' | 'sponsored' | 'a2a';
      sponsored?: boolean;
      buyerAgent?: string;
      sellerAgent?: string;
      transactionRef?: string | null;
      settlementTxHash?: string | null;
    }>;
  };
  reportMeta?: {
    kind: 'research' | 'portfolio' | 'execution';
    diagnostics?: string[];
    highlights?: string[];
  };
  activityMeta?: {
    mode?: 'brain';
    clusters?: string[];
    stageBars?: number[];
  };
  confirmation?: {
    required: boolean;
    action: 'swap' | 'vault' | 'bridge' | 'execute' | 'schedule' | 'split' | 'batch';
    confirmId?: string;
    confirmLabel?: string;
    choices?: Array<{ id: string; label: string; confirmId: string }>;
  };
};

export type BrainStreamChunk =
  | { type: 'meta'; meta: BrainMessageMeta }
  | { type: 'delta'; delta: string };

type BrainToolResult = {
  name: string;
  result: string;
};

type BrainToolProgress = {
  name: string;
  status: 'started' | 'completed';
  preview?: string;
};

type HermesRunStartResponse = {
  run_id?: string;
  status?: string;
};

type HermesRunEvent =
  | {
      event: 'tool.started';
      tool?: string;
      preview?: string;
    }
  | {
      event: 'tool.completed';
      tool?: string;
      duration?: number;
      error?: boolean;
    }
  | {
      event: 'message.delta';
      delta?: string;
    }
  | {
      event: 'run.completed';
      output?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    }
  | {
      event: 'run.failed';
      error?: string;
    }
  | {
      event: string;
      [key: string]: unknown;
    };

function buildHermesHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (HERMES_API_KEY) {
    headers.Authorization = `Bearer ${HERMES_API_KEY}`;
  }
  return headers;
}

function toolClusterName(toolName: string): string {
  switch (toolName) {
    case 'agentflow_swap':
    case 'swap_tokens':
      return 'Swap Agent';
    case 'agentflow_vault':
    case 'vault_action':
      return 'Vault Agent';
    case 'agentflow_bridge':
    case 'bridge_usdc':
    case 'bridge_precheck':
      return 'Bridge Agent';
    case 'agentflow_portfolio':
    case 'get_portfolio':
      return 'Portfolio Agent';
    case 'agentflow_circle_stack':
      return 'Capability Agent';
    case 'schedule_payment':
    case 'agentflow_schedule':
      return 'Scheduled payments';
    case 'agentpay_split':
      return 'Split payment';
    case 'agentflow_balance':
    case 'get_balance':
      return 'Balance Agent';
    case 'agentflow_research':
    case 'research':
    case 'web_search':
    case 'web_extract':
      return 'Research Agent';
    case 'skills_list':
    case 'skill_view':
    case 'skill_manage':
    case 'memory':
    case 'session_search':
      return 'AgentFlow Brain';
    default:
      return 'AgentFlow';
  }
}

function txDetailsFromResult(result: string): { txHash?: string; explorerUrl?: string } {
  const txHashMatch = result.match(/0x[a-fA-F0-9]{64}/);
  const explorerMatch = result.match(/https?:\/\/[^\s)]+\/tx\/0x[a-fA-F0-9]{64}/);
  return {
    txHash: txHashMatch?.[0],
    explorerUrl: explorerMatch?.[0],
  };
}

function isConfirmationResultText(result: string): boolean {
  return (
    /reply\s*YES\b/i.test(result) ||
    /\bconfirm\s*(with\s+)?YES\b/i.test(result) ||
    (/\bYES\b/i.test(result) && (/\bNO\b/i.test(result) || /\bcancel\b/i.test(result)))
  );
}

function confirmationActionForTool(
  toolName: string,
): 'swap' | 'vault' | 'bridge' | 'execute' | 'schedule' | 'split' | 'batch' {
  switch (toolName) {
    case 'agentflow_swap':
    case 'swap_tokens':
      return 'swap';
    case 'agentflow_vault':
    case 'vault_action':
      return 'vault';
    case 'agentflow_bridge':
    case 'bridge_usdc':
      return 'bridge';
    case 'schedule_payment':
    case 'agentflow_schedule':
      return 'schedule';
    case 'agentpay_split':
      return 'split';
    case 'agentpay_batch':
    case 'batch_payment':
      return 'batch';
    default:
      return 'execute';
  }
}

export function buildBrainConfirmationMeta(toolName: string): BrainMessageMeta {
  return {
    confirmation: {
      required: true,
      action: confirmationActionForTool(toolName),
    },
  };
}

function buildTraceForTool(toolName: string, result: string): BrainTraceEntry[] {
  const { txHash, explorerUrl } = txDetailsFromResult(result);

  switch (toolName) {
    case 'agentflow_swap':
    case 'swap_tokens':
      if (isConfirmationResultText(result)) {
        return [
          'AgentFlow routed the request to the swap engine',
          'A live Arc swap route was simulated',
          'Waiting for confirmation before execution',
        ];
      }
      return [
        'AgentFlow routed the request to the swap engine',
        'The swap was executed on Arc',
        txHash
          ? { label: 'Verified on Arc explorer', txHash, explorerUrl }
          : 'Swap execution receipt recorded',
      ];
    case 'agentflow_vault':
    case 'vault_action':
      if (isConfirmationResultText(result)) {
        return [
          'AgentFlow routed the request to the vault engine',
          'A live vault simulation was prepared',
          'Waiting for confirmation before execution',
        ];
      }
      return [
        'AgentFlow routed the request to the vault engine',
        'The vault action was executed on Arc',
        txHash
          ? { label: 'Verified on Arc explorer', txHash, explorerUrl }
          : 'Vault receipt recorded',
      ];
    case 'agentflow_bridge':
    case 'bridge_usdc':
      if (isConfirmationResultText(result)) {
        return [
          'AgentFlow routed the request to the bridge engine',
          'A live CCTP bridge estimate was prepared',
          'Waiting for confirmation before execution',
        ];
      }
        return [
          'AgentFlow routed the request to the bridge engine',
          'The bridge transfer was submitted',
          txHash
            ? { label: 'Verified on Arc explorer', txHash, explorerUrl }
            : 'Bridge receipt recorded',
        ];
    case 'bridge_precheck':
      return [
        'AgentFlow checked supported bridge source chains',
        'AgentFlow read live gas and USDC balances for the selected source wallet',
      ];
    case 'schedule_payment':
    case 'agentflow_schedule':
      if (isConfirmationResultText(result)) {
        return [
          'AgentFlow prepared a recurring USDC schedule',
          'Review the recipient, amount, and cadence',
          'Waiting for confirmation before creating the schedule',
        ];
      }
      return [
        'AgentFlow registered a recurring USDC payment',
        'Cron will execute on the next due date (UTC)',
        'Details saved in scheduled payments',
      ];
    case 'agentpay_split':
      if (isConfirmationResultText(result) || result.includes('Confirm split')) {
        return [
          'AgentFlow prepared a split USDC payment',
          'Recipients and per-person amount calculated',
          'Waiting for confirmation before sending',
        ];
      }
      return [
        'AgentFlow executed a split USDC payment',
        'Each recipient received their share on Arc',
        'All transfers recorded in payment history',
      ];
    case 'agentflow_balance':
    case 'get_balance':
      return [
        'AgentFlow read the latest Arc wallet balances',
      ];
    case 'agentflow_portfolio':
    case 'get_portfolio':
      return [
        'AgentFlow analyzed holdings and current positions',
      ];
    case 'agentflow_circle_stack':
      return [
        'AgentFlow checked the live Circle stack configuration',
      ];
    case 'agentflow_research':
    case 'research':
    case 'web_search':
    case 'web_extract':
      return [
        'AgentFlow gathered and summarized relevant research context',
      ];
    default:
      return ['AgentFlow completed the request'];
  }
}

function buildStageBars(traceEntries: BrainTraceEntry[]): number[] {
  const completed = Math.max(1, Math.min(6, traceEntries.length || 1));
  return Array.from({ length: 6 }, (_, index) => (index < completed ? 28 + index * 14 : 10));
}

export function buildBrainMetaFromToolResults(toolResults: BrainToolResult[]): BrainMessageMeta {
  const clusters = Array.from(new Set(toolResults.map((tool) => toolClusterName(tool.name))));
  const trace = toolResults.flatMap((tool) => buildTraceForTool(tool.name, tool.result));
  const kind = toolResults.some((tool) =>
    ['agentflow_portfolio', 'get_portfolio'].includes(tool.name),
  )
    ? 'portfolio'
    : toolResults.some((tool) => ['research', 'web_search', 'web_extract'].includes(tool.name))
      ? 'research'
      : 'execution';

  // Extract confirmId from agentflow_schedule tool result (schedule agent returns JSON)
  let scheduleConfirmation: BrainMessageMeta['confirmation'] | undefined;
  const scheduleTool = toolResults.find((t) => t.name === 'agentflow_schedule');
  if (scheduleTool) {
    try {
      const scheduleData = JSON.parse(scheduleTool.result) as {
        confirmId?: string;
        confirmLabel?: string;
        choices?: Array<{ id: string; label: string; confirmId: string }>;
        action?: string;
      };
      if (scheduleData.confirmId || scheduleData.choices?.length) {
        scheduleConfirmation = {
          required: true,
          action: 'schedule',
          confirmId: scheduleData.confirmId,
          confirmLabel: scheduleData.confirmLabel,
          choices: scheduleData.choices,
        };
      }
    } catch {
      // Not JSON — no confirmation metadata
    }
  }

  // Extract confirmId from agentpay_split tool result (split agent returns JSON)
  // NOTE: this only fires in the directRoute path; the Hermes path uses the Redis postflight
  // check in server.ts /chat/respond instead.
  let splitConfirmation: BrainMessageMeta['confirmation'] | undefined;
  const splitTool = toolResults.find((t) => t.name === 'agentpay_split');
  if (splitTool) {
    try {
      const splitData = JSON.parse(splitTool.result) as {
        confirmId?: string;
        confirmLabel?: string;
        action?: string;
      };
      if (splitData.confirmId && splitData.action === 'preview') {
        splitConfirmation = {
          required: true,
          action: 'split',
          confirmId: splitData.confirmId,
          confirmLabel: splitData.confirmLabel,
        };
      }
    } catch {
      // Not JSON — no confirmation metadata
    }
  }

  const finalConfirmation =
    scheduleConfirmation ??
    splitConfirmation ??
    (toolResults.length === 1 && isConfirmationResultText(toolResults[0]?.result || '')
      ? {
          required: true,
          action: confirmationActionForTool(toolResults[0].name),
        }
      : undefined);

  return {
    title: 'AgentFlow',
    trace,
    reportMeta: {
      kind,
      diagnostics: toolResults.map((tool) => `${toolClusterName(tool.name)} completed`),
      highlights: toolResults.map((tool) => tool.result.split('\n')[0]?.trim() || tool.result.trim()),
    },
    activityMeta: {
      mode: 'brain',
      clusters: clusters.length > 0 ? clusters : ['AgentFlow Brain'],
      stageBars: buildStageBars(trace),
    },
    confirmation: finalConfirmation,
  };
}

function toolProgressSummary(tool: BrainToolProgress): string {
  const cluster = toolClusterName(tool.name);
  switch (tool.name) {
    case 'agentflow_swap':
      return tool.status === 'started'
        ? 'Swap Agent is pricing a live Arc route'
        : 'Swap Agent finished its step';
    case 'agentflow_vault':
      return tool.status === 'started'
        ? 'Vault Agent is simulating the vault action'
        : 'Vault Agent finished its step';
    case 'agentflow_bridge':
      return tool.status === 'started'
        ? 'Bridge Agent is preparing a CCTP route'
        : 'Bridge Agent finished its step';
    case 'bridge_precheck':
      return tool.status === 'started'
        ? 'Bridge Agent is checking supported source chains and source-wallet balances'
        : 'Bridge Agent finished the source-wallet check';
    case 'agentflow_balance':
      return tool.status === 'started'
        ? 'Balance Agent is reading Arc balances'
        : 'Balance Agent finished its step';
    case 'agentflow_circle_stack':
      return tool.status === 'started'
        ? 'Capability Agent is checking current Circle stack support'
        : 'Capability Agent finished its step';
    case 'agentflow_portfolio':
      return tool.status === 'started'
        ? 'Portfolio Agent is analyzing current holdings'
        : 'Portfolio Agent finished its step';
    case 'agentflow_research':
    case 'web_search':
      return tool.status === 'started'
        ? 'Research Agent is gathering multi-source market and news context'
        : 'Research Agent finished gathering research';
    case 'web_extract':
      return tool.status === 'started'
        ? 'Research Agent is extracting source details'
        : 'Research Agent finished extraction';
    case 'skill_view':
      return tool.status === 'started'
        ? 'AgentFlow Brain is loading the best matching skill'
        : 'AgentFlow Brain finished loading skill context';
    case 'memory':
      return tool.status === 'started'
        ? 'AgentFlow Brain is checking saved context'
        : 'AgentFlow Brain finished checking memory';
    default:
      return tool.status === 'started'
        ? `${cluster} started`
        : `${cluster} completed`;
  }
}

function buildBrainMetaFromProgress(progress: BrainToolProgress[]): BrainMessageMeta {
  const clusters = Array.from(
    new Set(progress.map((entry) => toolClusterName(entry.name)).filter(Boolean)),
  );
  const trace = progress.map(toolProgressSummary);

  return {
    title: 'AgentFlow',
    trace,
    activityMeta: {
      mode: 'brain',
      clusters: clusters.length > 0 ? clusters : ['AgentFlow Brain'],
      stageBars: buildStageBars(trace),
    },
  };
}

function sanitizeDelta(delta: string): string {
  return delta.replace(/\[\[AFMETA:[^\]]*\]\]/g, '');
}

function createInternalDeltaFilter() {
  const toolCallStart = '<tool_call>';
  const toolCallEnd = '</tool_call>';
  let hiddenBuffer = '';
  let suppressing = false;

  return {
    push: (delta: string): string => {
      let remaining = delta;
      let visible = '';

      while (remaining) {
        if (suppressing) {
          hiddenBuffer += remaining;
          const endIndex = hiddenBuffer.indexOf(toolCallEnd);
          if (endIndex === -1) {
            return '';
          }
          remaining = hiddenBuffer.slice(endIndex + toolCallEnd.length);
          hiddenBuffer = '';
          suppressing = false;
          continue;
        }

        const startIndex = remaining.indexOf(toolCallStart);
        if (startIndex === -1) {
          visible += remaining;
          break;
        }

        visible += remaining.slice(0, startIndex);
        const afterStart = remaining.slice(startIndex);
        const endIndex = afterStart.indexOf(toolCallEnd);
        if (endIndex === -1) {
          suppressing = true;
          hiddenBuffer = afterStart;
          break;
        }

        remaining = afterStart.slice(endIndex + toolCallEnd.length);
      }

      return sanitizeDelta(visible);
    },
    flush: (): string => '',
  };
}

function parseSseBlock(block: string): HermesRunEvent | null {
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const payload = dataLines.join('\n').trim();
  if (!payload || payload === '[DONE]') {
    return null;
  }

  return JSON.parse(payload) as HermesRunEvent;
}

async function isHermesAlive(): Promise<boolean> {
  try {
    const response = await fetch(`${HERMES_API_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function createHermesRun(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  sessionId: string,
  instructions: string,
): Promise<string> {
  const response = await fetch(`${HERMES_API_URL}/v1/runs`, {
    method: 'POST',
    headers: buildHermesHeaders(),
    body: JSON.stringify({
      input: message,
      conversation_history: history.slice(-12).map((entry) => ({
        role: entry.role,
        content: entry.content.slice(0, 500),
      })),
      instructions,
      session_id: sessionId,
    }),
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || `Hermes run creation failed with status ${response.status}`);
  }

  const payload = (await response.json()) as HermesRunStartResponse;
  if (!payload.run_id) {
    throw new Error('Hermes API did not return a run_id.');
  }

  return payload.run_id;
}

async function* streamHermesRunEvents(runId: string): AsyncGenerator<HermesRunEvent> {
  const response = await fetch(`${HERMES_API_URL}/v1/runs/${runId}/events`, {
    headers: buildHermesHeaders(),
  });

  if (!response.ok || !response.body) {
    const errorText = (await response.text()).trim();
    throw new Error(errorText || `Hermes event stream failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      let splitIndex = buffer.indexOf('\n\n');
      while (splitIndex !== -1) {
        const block = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);
        const parsed = parseSseBlock(block);
        if (parsed) {
          yield parsed;
        }
        splitIndex = buffer.indexOf('\n\n');
      }

      if (done) {
        break;
      }
    }

    const finalBlock = buffer.trim();
    if (finalBlock) {
      const parsed = parseSseBlock(finalBlock);
      if (parsed) {
        yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* runAgentBrain(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  walletCtx: {
    walletAddress: string;
    executionWalletId?: string;
    executionWalletAddress?: string;
    executionTarget?: 'EOA' | 'DCW';
    profileContext?: string;
  },
  sessionId: string,
): AsyncGenerator<BrainStreamChunk> {
  const resolvedSessionId =
    sessionId.trim() || walletCtx.walletAddress.trim() || 'agentflow-default';
  const progress: BrainToolProgress[] = [];
  const filterInternalDelta = createInternalDeltaFilter();
  let streamedText = false;
  const systemPrompt = [
    BRAIN_SYSTEM_PROMPT,
    walletCtx.walletAddress
      ? `Connected wallet for this request: ${walletCtx.walletAddress}`
      : 'Connected wallet for this request: none',
    walletCtx.executionWalletAddress
      ? `Execution wallet for this request: ${walletCtx.executionWalletAddress}`
      : '',
    walletCtx.executionTarget ? `Execution target for this chat: ${walletCtx.executionTarget}` : '',
    walletCtx.profileContext?.trim() ? walletCtx.profileContext.trim() : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const alive = await isHermesAlive();
    if (!alive) {
      yield {
        type: 'delta',
        delta: 'AgentFlow is restarting, please try again in a moment...',
      };
      return;
    }

    const runId = await createHermesRun(message, history, resolvedSessionId, systemPrompt);

    for await (const event of streamHermesRunEvents(runId)) {
      const eventTool =
        typeof (event as { tool?: unknown }).tool === 'string'
          ? (event as { tool: string }).tool
          : undefined;
      const eventPreview =
        typeof (event as { preview?: unknown }).preview === 'string'
          ? (event as { preview: string }).preview
          : undefined;

      if (event.event === 'tool.started' && eventTool) {
        progress.push({
          name: eventTool,
          status: 'started',
          preview: eventPreview,
        });
        yield {
          type: 'meta',
          meta: buildBrainMetaFromProgress(progress),
        };
        continue;
      }

      if (event.event === 'tool.completed' && eventTool) {
        progress.push({
          name: eventTool,
          status: 'completed',
        });
        yield {
          type: 'meta',
          meta: buildBrainMetaFromProgress(progress),
        };
        continue;
      }

      if (event.event === 'message.delta' && typeof event.delta === 'string') {
        const cleanDelta = filterInternalDelta.push(event.delta);
        if (cleanDelta) {
          streamedText = true;
          yield { type: 'delta', delta: cleanDelta };
        }
        continue;
      }

      if (event.event === 'run.failed') {
        const errorText =
          typeof event.error === 'string' && event.error.trim()
            ? event.error.trim()
            : 'Hermes could not complete that request.';
        yield { type: 'delta', delta: errorText };
        return;
      }

      if (event.event === 'run.completed') {
        const flushedDelta = filterInternalDelta.flush();
        if (flushedDelta) {
          streamedText = true;
          yield { type: 'delta', delta: flushedDelta };
        }
        if (!streamedText && typeof event.output === 'string') {
          const cleanOutput = filterInternalDelta.push(event.output);
          if (cleanOutput) {
            streamedText = true;
            yield { type: 'delta', delta: cleanOutput };
          }
        }
        return;
      }
    }

    if (!streamedText) {
      yield {
        type: 'delta',
        delta: "I couldn't produce a response for that request. Please try again.",
      };
    }
  } catch (err) {
    const messageText =
      err instanceof Error && err.message.trim()
        ? err.message.trim()
        : 'AgentFlow Brain is unavailable right now.';
    yield {
      type: 'delta',
      delta: `AgentFlow Brain is unavailable right now. ${messageText}`,
    };
  }
}
