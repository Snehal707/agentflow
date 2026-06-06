#!/usr/bin/env node
const BASE = "https://docs.arc.io";
const INDEX_URL = `${BASE}/llms.txt`;
const SERVER_INFO = { name: "arc-docs-local", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-03-26";

let inputBuffer = Buffer.alloc(0);
let indexCache = null;
const pageCache = new Map();

function writeMessage(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

function sendResponse(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function sendLog(message) {
  writeMessage({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      level: "info",
      data: message,
    },
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "agentflow-arc-docs-mcp/0.1",
      Accept: "text/markdown, text/plain, application/json, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return await response.text();
}

function normalizeDocPath(pathLike) {
  const trimmed = String(pathLike || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed);
    return url.pathname;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function loadIndex() {
  if (indexCache) return indexCache;
  const text = await fetchText(INDEX_URL);
  const links = [];
  const regex = /\[([^\]]+)\]\((https:\/\/docs\.arc\.io[^\s)]+)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const title = match[1].trim();
    const url = match[2].trim();
    try {
      const parsed = new URL(url);
      links.push({
        title,
        url,
        path: parsed.pathname,
      });
    } catch {
      // ignore malformed links
    }
  }
  const deduped = [];
  const seen = new Set();
  for (const link of links) {
    if (seen.has(link.path)) continue;
    seen.add(link.path);
    deduped.push(link);
  }
  indexCache = { raw: text, links: deduped };
  return indexCache;
}

async function fetchPage(pathLike) {
  const path = normalizeDocPath(pathLike);
  if (!path) {
    throw new Error("Page path is required");
  }
  if (pageCache.has(path)) return pageCache.get(path);
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const text = await fetchText(url);
  const page = { path, url, text };
  pageCache.set(path, page);
  return page;
}

function scoreText(text, terms) {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const matches = haystack.split(term).length - 1;
    score += matches * (term.length > 4 ? 4 : 2);
  }
  return score;
}

function snippetAround(text, terms) {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return "";
  const lower = source.toLowerCase();
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx >= 0) {
      const start = Math.max(0, idx - 140);
      const end = Math.min(source.length, idx + 260);
      return source.slice(start, end).trim();
    }
  }
  return source.slice(0, 320);
}

async function searchDocs(query) {
  const { links } = await loadIndex();
  const terms = String(query)
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const prelim = links
    .map((link) => ({
      ...link,
      score:
        scoreText(link.title, terms) * 5 +
        scoreText(link.path.replace(/[/._-]+/g, " "), terms) * 3,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const enriched = [];
  for (const item of prelim) {
    try {
      const page = await fetchPage(item.path);
      const pageScore = item.score + scoreText(page.text, terms);
      enriched.push({
        ...item,
        score: pageScore,
        snippet: snippetAround(page.text, terms),
      });
    } catch (error) {
      enriched.push({
        ...item,
        snippet: `Unable to fetch page content: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  enriched.sort((a, b) => b.score - a.score);
  return enriched.slice(0, 5);
}

function renderSearchResults(results) {
  if (!results.length) {
    return "No matching Arc docs pages found.";
  }
  return results
    .map(
      (result, index) =>
        `${index + 1}. ${result.title}\nURL: ${result.url}\nPath: ${result.path}\nSnippet: ${result.snippet}`,
    )
    .join("\n\n");
}

function pathHierarchy(paths, maxDepth) {
  const root = new Map();
  for (const path of paths) {
    const parts = path.replace(/^\//, "").split("/").filter(Boolean);
    let node = root;
    for (const [index, part] of parts.entries()) {
      if (index >= maxDepth) break;
      if (!node.has(part)) {
        node.set(part, new Map());
      }
      node = node.get(part);
    }
  }
  const lines = ["/"];
  function walk(node, prefix) {
    const entries = [...node.keys()].sort((a, b) => a.localeCompare(b));
    entries.forEach((entry, idx) => {
      const last = idx === entries.length - 1;
      const branch = `${prefix}${last ? "└── " : "├── "}${entry}`;
      lines.push(branch);
      walk(node.get(entry), `${prefix}${last ? "    " : "│   "}`);
    });
  }
  walk(root, "");
  return lines.join("\n");
}

async function runFilesystemCommand(command) {
  const cmd = String(command || "").trim();
  if (!cmd) {
    throw new Error("command is required");
  }
  const { links } = await loadIndex();
  const allPaths = links.map((link) => link.path);

  if (/^ls\s+\/?$/.test(cmd)) {
    return allPaths.sort().join("\n");
  }

  const treeMatch = cmd.match(/^tree\s+\/(?:\s+-L\s+(\d+))?$/);
  if (treeMatch) {
    const depth = Number(treeMatch[1] || 3);
    return pathHierarchy(allPaths, Number.isFinite(depth) && depth > 0 ? depth : 3);
  }

  const rgMatch = cmd.match(/^rg\s+-il\s+"([^"]+)"\s+\/$/);
  if (rgMatch) {
    const query = rgMatch[1];
    const results = await searchDocs(query);
    return results.map((result) => result.path).join("\n") || "";
  }

  const headMatch = cmd.match(/^head\s+-(\d+)\s+(.+)$/);
  if (headMatch) {
    const lines = Number(headMatch[1]);
    const rawTargets = headMatch[2].trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    for (const target of rawTargets) {
      const page = await fetchPage(target);
      chunks.push(
        `==> ${page.path} <==\n` +
          page.text.split(/\r?\n/).slice(0, lines).join("\n"),
      );
    }
    return chunks.join("\n\n");
  }

  const catMatch = cmd.match(/^cat\s+(.+)$/);
  if (catMatch) {
    const rawTargets = catMatch[1].trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    for (const target of rawTargets) {
      const page = await fetchPage(target);
      chunks.push(`==> ${page.path} <==\n${page.text}`);
    }
    return chunks.join("\n\n");
  }

  throw new Error(
    "Unsupported command. Supported: ls /, tree / -L N, rg -il \"term\" /, head -N /path.md, cat /path.md",
  );
}

function textToolResult(text, isError = false) {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (!method) return;

  if (method === "initialize") {
    return sendResponse(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "ping") {
    return sendResponse(id, {});
  }

  if (method === "tools/list") {
    return sendResponse(id, {
      tools: [
        {
          name: "search_arc_docs",
          description:
            "Search Arc documentation and return matching page titles, links, paths, and snippets.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query for Arc docs." },
            },
            required: ["query"],
          },
        },
        {
          name: "query_docs_filesystem_arc_docs",
          description:
            "Read Arc docs pages through a small virtual filesystem. Supported commands: ls /, tree / -L N, rg -il \"term\" /, head -N /path.md, cat /path.md.",
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "Filesystem-like read-only command to run against Arc docs pages.",
              },
            },
            required: ["command"],
          },
        },
      ],
    });
  }

  if (method === "resources/list") {
    return sendResponse(id, { resources: [] });
  }

  if (method === "prompts/list") {
    return sendResponse(id, { prompts: [] });
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      if (name === "search_arc_docs") {
        const results = await searchDocs(args.query);
        return sendResponse(id, textToolResult(renderSearchResults(results)));
      }
      if (name === "query_docs_filesystem_arc_docs") {
        const output = await runFilesystemCommand(args.command);
        return sendResponse(id, textToolResult(output || ""));
      }
      return sendError(id, -32601, `Unknown tool: ${name}`);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      return sendResponse(id, textToolResult(messageText, true));
    }
  }

  return sendError(id, -32601, `Unsupported method: ${method}`);
}

function processBuffer() {
  while (true) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const headerText = inputBuffer.slice(0, headerEnd).toString("utf8");
    const match = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      continue;
    }
    const contentLength = Number(match[1]);
    const totalLength = headerEnd + 4 + contentLength;
    if (inputBuffer.length < totalLength) return;
    const payload = inputBuffer.slice(headerEnd + 4, totalLength).toString("utf8");
    inputBuffer = inputBuffer.slice(totalLength);
    try {
      const message = JSON.parse(payload);
      Promise.resolve(handleRequest(message)).catch((error) => {
        sendLog(`arc-docs-local error: ${error instanceof Error ? error.message : String(error)}`);
      });
    } catch (error) {
      sendLog(`arc-docs-local parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processBuffer();
});

process.stdin.on("end", () => {
  process.exit(0);
});

