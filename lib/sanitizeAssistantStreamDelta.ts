/** Strip Hermes-internal metadata markers (server-injected UX hints). */
function stripAfmetaMarkers(text: string): string {
  return text.replace(/\[\[AFMETA:[^\]]*\]\]/g, '');
}

/**
 * Completed XML-style tool envelopes only (Hermes chunk may contain a full
 * `<tool_call>…` or the plural `<tool_calls>…` wrapper). Matches both singular
 * and plural forms and strips the whole block (tags + JSON inside).
 */
function stripCompleteToolCallXml(chunk: string): string {
  return chunk.replace(/\s*<tool_calls?\b[^>]*>[\s\S]*?<\/tool_calls?>\s*/gi, ' ');
}

/**
 * Strip Hermes reasoning/marker tags (e.g. `<bi>…</bi>`) but KEEP the text
 * between them — `<bi>` has been observed wrapping the actual user-facing reply,
 * so we remove only the tags, never the content. Also handles any stray
 * unmatched `<bi>` / `</bi>`.
 */
function stripReasoningWrapperTags(text: string): string {
  return text.replace(/<\/?bi>/gi, ' ');
}

/**
 * Removes a brace-balanced `{...}` block when it opens with `"name":"agentflow_..."`.
 * Handles nested `{}` roughly for typical JSON tool payloads; does not claim full JSON parse.
 */
function stripMatchedAgentflowToolObject(text: string, openBraceIndex: number): { next: number; stripped: boolean } {
  const head = text.slice(openBraceIndex, openBraceIndex + 80);
  if (!/\{\s*"name"\s*:\s*"agentflow_/i.test(head)) {
    return { next: openBraceIndex + 1, stripped: false };
  }

  let depth = 0;
  let j = openBraceIndex;
  let inString = false;
  let escaped = false;

  for (; j < text.length; j++) {
    const c = text[j];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          return { next: j + 1, stripped: true };
        }
      }
    }
  }

  return { next: text.length, stripped: true };
}

function stripAgentflowToolJsonBlobs(chunk: string): string {
  let i = 0;
  let out = '';
  while (i < chunk.length) {
    const brace = chunk.indexOf('{', i);
    if (brace === -1) {
      out += chunk.slice(i);
      break;
    }
    out += chunk.slice(i, brace);
    const { next, stripped } = stripMatchedAgentflowToolObject(chunk, brace);
    if (!stripped) {
      out += chunk[brace];
      i = brace + 1;
    } else {
      i = next;
    }
  }
  return out;
}

function stripGenericToolCallJson(text: string): string {
  return text.replace(
    /\{\s*"name"\s*:\s*"[a-z][a-z0-9_-]*"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/gi,
    ' ',
  );
}

function replaceInternalToolIdentifiers(text: string): string {
  return text
    .replace(/\b(?:agentflow_portfolio|get_portfolio)\b/gi, 'portfolio check')
    .replace(/\bget_balance\b/gi, 'balance check')
    .replace(/\bvault_action\b/gi, 'vault options')
    .replace(/\bswap_tokens\b/gi, 'swap preview')
    .replace(/\bpredict_action\b/gi, 'prediction market action');
}

function stripInternalPromptLeakPatterns(text: string): string {
  let next = text;

  next = next.replace(
    /\bI can speak Thai when you message me primarily in Thai\.[\s\S]*?(?=(?:\n{2,}|$))/gi,
    ' ',
  );
  next = next.replace(
    /\bIf the user's latest message is clearly in another language[\s\S]*?(?=(?:\n{2,}|$))/gi,
    ' ',
  );
  next = next.replace(/\bTag:\s*Thai response based on user's language in previous message\b/gi, ' ');
  next = next.replace(/\bCurrent wallet context for this request:\b[\s\S]*?(?=(?:\n{2,}|$))/gi, ' ');
  next = next.replace(/^\s*Connected wallet for this request:\s*0x[a-f0-9]{40}\s*$/gim, ' ');
  next = next.replace(/^\s*Execution wallet for this request:\s*0x[a-f0-9]{40}\s*$/gim, ' ');
  next = next.replace(/^\s*Execution target for this chat:\s*(?:EOA|DCW)\s*$/gim, ' ');
  next = next.replace(/\bConnected EOA:\s*0x[a-f0-9]{40}\b/gi, ' ');
  next = next.replace(/\bExecution wallet:\s*0x[a-f0-9]{40}\b/gi, ' ');
  next = next.replace(/\bExecution target:\s*(?:EOA|DCW)\b/gi, ' ');
  next = next.replace(/\bExecution mode:\s*[a-z][a-z0-9 _-]*\b/gi, ' ');
  next = next.replace(/^\s*-\s*connected EOA:\s*0x[a-f0-9]{40}\s*$/gim, ' ');
  next = next.replace(/^\s*-\s*execution wallet:\s*0x[a-f0-9]{40}\s*$/gim, ' ');
  next = next.replace(/^\s*-\s*execution target:\s*(?:EOA|DCW)\s*$/gim, ' ');
  next = next.replace(/^\s*-\s*execution mode:\s*[a-z0-9_-]+\s*$/gim, ' ');
  next = next.replace(/^\s*-\s*Agent wallet funding balance:\s*[^\n]*$/gim, ' ');
  next = next.replace(/\bcluster\/my-wallet\.json\b/gi, ' ');
  next = next.replace(/\bgpointer\b/gi, ' ');
  next = next.replace(/\brelatedness\b/gi, ' ');
  next = next.replace(/\bDES:\s*the representation of the system message\b[\s\S]*$/gi, ' ');
  next = next.replace(/\bNo IP\.\s*No glimpse\.\b/gi, ' ');
  next = next.replace(/\bsystem_(?:role|prompt)_l_sigma\s*=\s*\d+(?:\.\d+)?\b/gi, ' ');
  next = next.replace(/\brep_sigma\s*=\s*\d+(?:\.\d+)?\b/gi, ' ');
  next = next.replace(/\bVar\(\s*\d+(?:\.\d+)?\s*\)\b/gi, ' ');
  next = next.replace(/\bauto_generate_instruction\s*=\s*(?:true|false)\b/gi, ' ');
  next = next.replace(/\benable_math\s*=\s*(?:true|false)\b/gi, ' ');
  next = next.replace(/\bresponse_length\s*=\s*\d+\b/gi, ' ');
  next = next.replace(/\bmax_candidates\s*=\s*\d+\b/gi, ' ');
  next = next.replace(/\b_stop_prob_threshold\s*=\s*\d+(?:\.\d+)?\b/gi, ' ');
  next = next.replace(/\bsampler[_-]?safe conditioning\b/gi, ' ');
  next = next.replace(/\btypical Arc runtime execution message\b/gi, ' ');
  next = next.replace(
    /\{\s*"connected_wallet"\s*:\s*"0x[a-f0-9]+"\s*,\s*"execution_wallet"\s*:\s*"0x[a-f0-9]+"\s*\}/gi,
    ' ',
  );
  next = next.replace(
    /\bCall the portfolio tool to show your current balances and positions\.?/gi,
    'I can check your current portfolio here. Ask me to show your portfolio for a live snapshot.',
  );
  next = next.replace(
    /\bIf the user asks for portfolio\/holdings\/positions,\s*call the portfolio tool immediately\.?\b/gi,
    ' ',
  );

  return next;
}

/**
 * Visible assistant stream only: hide tool-call JSON blobs and AFMETA fragments.
 * Does not execute tools.
 */
export function sanitizeAssistantStreamDelta(delta: string): string {
  if (typeof delta !== 'string' || !delta.length) return '';
  let s = stripAfmetaMarkers(delta);
  s = stripCompleteToolCallXml(s);
  s = stripReasoningWrapperTags(s);
  s = stripAgentflowToolJsonBlobs(s);
  s = stripGenericToolCallJson(s);
  s = replaceInternalToolIdentifiers(s);
  s = stripInternalPromptLeakPatterns(s);
  if (
    /No reply streamed from AgentFlow Brain|Confirm Hermes is running|127\.0\.0\.1:8000\/health/i.test(
      s,
    )
  ) {
    return 'AgentFlow did not return a complete response for that message. Please retry in a moment.';
  }
  s = s.replace(/\bAGENTFLOW_[A-Z0-9_]+\b/g, 'internal configuration');
  s = s.replace(/\b(?:HERMES|Hermes)_[A-Z0-9_]+\b/g, 'internal configuration');
  s = s.replace(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?[^\s)]*/gi, 'an internal service');
  s = s.replace(/\bAgentFlow Brain\b/g, 'AgentFlow chat');
  s = s.replace(/\bHermes\b/g, 'the chat service');
  s = s.replace(/\.env\b/g, 'internal configuration');
  s = s.replace(/\b(?:AGENTFLOW_HERMES_URL|CIRCLE_AGENT_EXECUTION_WALLET|GATEWAY_NANOPAYMENT_HUB|ARC_PAYMASTER|X402_OPERATOR)\b/g, 'internal configuration');
  // Preserve streamed line breaks across chunk boundaries. Trimming every delta
  // causes adjacent chunks like "started\n" + "Research Agent..." to render as
  // "startedResearch Agent...".
  return s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}
