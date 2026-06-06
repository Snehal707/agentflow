import '../lib/loadEnv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ClarificationCase = {
  id: string;
  message: string;
  history?: ConversationMessage[];
  expectedAny: string[];
  forbiddenAny?: string[];
  note?: string;
};

type ClarificationResult = {
  id: string;
  message: string;
  pass: boolean;
  response: string;
  expectedAny: string[];
  forbiddenAny: string[];
  latencyMs: number;
  note?: string;
  error?: string;
};

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const WALLET =
  process.env.TEST_WALLET_ADDRESS?.trim() ||
  '0xBb2Aeb16Af0f4E6C8C6d7B2D6210B7785E0dA4b1';

const CASES: ClarificationCase[] = [
  {
    id: 'swap_missing_amount',
    message: 'turn some usdc into eurc for me',
    expectedAny: ['how much', 'amount'],
    forbiddenAny: ['terminal', 'cron', 'tool', 'hermes', 'portfolio agent'],
  },
  {
    id: 'bridge_missing_amount',
    message: 'can we get funds onto arc from base',
    expectedAny: ['how much', 'which source chain', 'source chain'],
    forbiddenAny: ['connected eoa wallet', 'technical workflow', 'core components'],
  },
  {
    id: 'send_missing_amount',
    message: 'pay jack for lunch',
    expectedAny: ['how much', 'amount'],
    forbiddenAny: ['i can execute commands', 'terminal', 'cron'],
  },
  {
    id: 'payment_link_missing_recipient',
    message: 'i need something people can scan to pay me',
    expectedAny: [
      'who should pay',
      'payer',
      'who is paying',
      'who should this request be for',
      'who the payment link is for',
      'who should the payment link point to',
    ],
    forbiddenAny: ['agentflow on arc', 'core products', 'technical map'],
  },
  {
    id: 'schedule_followup_from_context',
    message: 'set up that payment every month',
    history: [
      { role: 'user', content: 'send 25 usdc to alice.arc' },
      { role: 'assistant', content: 'I can do that once or turn it into a recurring payment.' },
    ],
    expectedAny: ['alice', 'every month', 'monthly', 'reply yes', 'confirm', 'could not resolve recipient'],
    forbiddenAny: ['core components', 'connected eoa wallet'],
  },
  {
    id: 'payment_link_followup_from_context',
    message: 'yeah make that',
    history: [
      { role: 'user', content: 'i need something people can scan to pay me 10 usdc' },
      { role: 'assistant', content: 'I can make a payment link or QR-style request for that.' },
    ],
    expectedAny: [
      'who should pay',
      'payer',
      'who is paying',
      'who should this request be for',
      'who should pay through the payment link',
    ],
    forbiddenAny: ['technical map', 'product guidance', 'portfolio agent'],
  },
];

async function chatRespond(
  message: string,
  sessionId: string,
  history: ConversationMessage[] = [],
): Promise<string> {
  const response = await fetch(`${BASE}/api/chat/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': sessionId,
    },
    body: JSON.stringify({
      message,
      rawUserMessage: message,
      messages: [...history, { role: 'user', content: message }],
      walletAddress: WALLET,
      executionTarget: 'DCW',
    }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Conversation failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalText = '';

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      return;
    }

    const raw = trimmed.slice(5).trim();
    if (!raw || raw === '[DONE]') {
      return;
    }

    const payload = JSON.parse(raw) as {
      delta?: string;
      markdown?: string;
      message?: string;
      error?: string;
      type?: string;
    };

    if (payload.error) {
      throw new Error(payload.error);
    }

    if (typeof payload.delta === 'string') {
      finalText += payload.delta;
      return;
    }

    if (typeof payload.markdown === 'string' && !finalText.trim()) {
      finalText = payload.markdown;
      return;
    }

    if (typeof payload.message === 'string' && !finalText.trim()) {
      finalText = payload.message;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const line of parts) {
      processLine(line);
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      processLine(line);
    }
  }

  return finalText.trim();
}

function includesAny(text: string, patterns: string[]): boolean {
  const normalized = text.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

async function runCase(testCase: ClarificationCase): Promise<ClarificationResult> {
  const startedAt = Date.now();
  try {
    const sessionId = `wallet-${WALLET.toLowerCase()}-chat-clarify-${testCase.id}-${Date.now()}`;
    const response = await chatRespond(testCase.message, sessionId, testCase.history);
    const forbiddenAny = testCase.forbiddenAny ?? [];
    const pass =
      includesAny(response, testCase.expectedAny) &&
      !includesAny(response, forbiddenAny) &&
      response.length > 0;

    return {
      id: testCase.id,
      message: testCase.message,
      pass,
      response,
      expectedAny: testCase.expectedAny,
      forbiddenAny,
      latencyMs: Date.now() - startedAt,
      note: testCase.note,
    };
  } catch (error) {
    return {
      id: testCase.id,
      message: testCase.message,
      pass: false,
      response: '',
      expectedAny: testCase.expectedAny,
      forbiddenAny: testCase.forbiddenAny ?? [],
      latencyMs: Date.now() - startedAt,
      note: testCase.note,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function saveArtifact(results: ClarificationResult[]) {
  mkdirSync('tmp', { recursive: true });
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  const artifactPath = join(process.cwd(), 'tmp', `chat-clarifications-${timestamp}.json`);
  writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE,
        walletAddress: WALLET,
        summary: {
          total: results.length,
          passed: results.filter((result) => result.pass).length,
          failed: results.filter((result) => !result.pass).length,
        },
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  return artifactPath;
}

async function main() {
  const results: ClarificationResult[] = [];

  for (const testCase of CASES) {
    results.push(await runCase(testCase));
  }

  const passed = results.filter((result) => result.pass).length;
  const failed = results.filter((result) => !result.pass);
  const artifactPath = saveArtifact(results);

  console.log(`Chat clarification smoke: ${passed}/${results.length} passed`);
  console.log(`Artifact: ${artifactPath}`);

  for (const result of results) {
    const status = result.pass ? 'PASS' : 'FAIL';
    console.log(`\n[${status}] ${result.id} (${result.latencyMs}ms)`);
    console.log(`prompt: ${result.message}`);
    if (result.error) {
      console.log(`error: ${result.error}`);
      continue;
    }
    console.log(`reply: ${result.response}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
