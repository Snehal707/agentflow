/** Strip Hermes-internal metadata markers (server-injected UX hints). */
function stripAfmetaMarkers(text: string): string {
  return text.replace(/\[\[AFMETA:[^\]]*\]\]/g, '');
}

/** Completed XML-style tool envelopes only (Hermes chunk may contain a full `<tool_call>…`). */
function stripCompleteToolCallXml(chunk: string): string {
  return chunk.replace(/\s*<tool_call\b[^>]*>[\s\S]*?<\/tool_call>\s*/gi, ' ');
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

function replaceInternalToolIdentifiers(text: string): string {
  return text
    .replace(/\b(?:agentflow_portfolio|get_portfolio)\b/gi, 'portfolio check')
    .replace(/\bget_balance\b/gi, 'balance check')
    .replace(/\bvault_action\b/gi, 'vault options')
    .replace(/\bswap_tokens\b/gi, 'swap preview')
    .replace(/\bpredict_action\b/gi, 'prediction market action');
}

/**
 * Visible assistant stream only: hide tool-call JSON blobs and AFMETA fragments.
 * Does not execute tools.
 */
export function sanitizeAssistantStreamDelta(delta: string): string {
  if (typeof delta !== 'string' || !delta.length) return '';
  let s = stripAfmetaMarkers(delta);
  s = stripCompleteToolCallXml(s);
  s = stripAgentflowToolJsonBlobs(s);
  s = replaceInternalToolIdentifiers(s);
  if (
    /No reply streamed from AgentFlow Brain|Confirm Hermes is running|AGENTFLOW_HERMES_URL|127\.0\.0\.1:8000\/health/i.test(
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
  // Preserve streamed line breaks across chunk boundaries. Trimming every delta
  // causes adjacent chunks like "started\n" + "Research Agent..." to render as
  // "startedResearch Agent...".
  return s.replace(/\n{3,}/g, '\n\n');
}
