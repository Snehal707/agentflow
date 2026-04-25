/**
 * Shared bridge agent response parsing (JSON or SSE) for web chat and Telegram.
 */

export function pickBridgeTxHash(value: Record<string, unknown> | null | undefined): string | undefined {
  if (!value) return undefined;
  for (const key of ['txHash', 'transactionHash', 'hash'] as const) {
    const raw = value[key];
    if (typeof raw === 'string' && /^0x[a-fA-F0-9]{64}$/.test(raw)) {
      return raw;
    }
  }
  return undefined;
}

export function parseBridgeStepReceipt(
  step: unknown,
): { name?: string; state?: string; txHash?: string; explorerUrl?: string } | null {
  if (!step || typeof step !== 'object') {
    return null;
  }

  const record = step as Record<string, unknown>;
  const values =
    record.values && typeof record.values === 'object'
      ? (record.values as Record<string, unknown>)
      : undefined;
  const explorerUrl =
    typeof record.explorerUrl === 'string'
      ? record.explorerUrl
      : typeof values?.explorerUrl === 'string'
        ? values.explorerUrl
        : undefined;

  return {
    name:
      typeof record.name === 'string'
        ? record.name
        : typeof record.method === 'string'
          ? record.method
          : undefined,
    state: typeof record.state === 'string' ? record.state : undefined,
    txHash: pickBridgeTxHash(record) ?? pickBridgeTxHash(values),
    explorerUrl,
  };
}

export function getBridgeReceiptDetails(result: unknown): {
  txHash?: string;
  explorerUrl?: string;
  stepName?: string;
} {
  const root =
    result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
  const steps = Array.isArray(root?.steps)
    ? root.steps
        .map((step) => parseBridgeStepReceipt(step))
        .filter(
          (step): step is { name?: string; state?: string; txHash?: string; explorerUrl?: string } =>
            Boolean(step),
        )
    : [];

  const preferredStepNames = ['mint', 'burn', 'approve'];
  const successfulSteps = steps.filter((step) => !step.state || step.state === 'success');
  for (const preferredName of preferredStepNames) {
    const match = successfulSteps.find(
      (step) =>
        step.name?.trim().toLowerCase() === preferredName && (step.txHash || step.explorerUrl),
    );
    if (match) {
      return {
        txHash: match.txHash,
        explorerUrl: match.explorerUrl,
        stepName: match.name,
      };
    }
  }

  const fallbackStep =
    successfulSteps.find((step) => step.txHash || step.explorerUrl) ||
    steps.find((step) => step.txHash || step.explorerUrl);
  if (fallbackStep) {
    return {
      txHash: fallbackStep.txHash,
      explorerUrl: fallbackStep.explorerUrl,
      stepName: fallbackStep.name,
    };
  }

  return {
    txHash: pickBridgeTxHash(root),
    explorerUrl: typeof root?.explorerUrl === 'string' ? root.explorerUrl : undefined,
  };
}

export function parseSseJsonPayload(raw: string): {
  done?: Record<string, unknown>;
  error?: string;
} {
  const lines = raw.split(/\r?\n/);
  let currentEvent = '';
  let lastDone: Record<string, unknown> | undefined;
  let errorMessage: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      currentEvent = '';
      continue;
    }
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
      continue;
    }
    if (!line.startsWith('data: ')) {
      continue;
    }

    const payload = line.slice(6).trim();
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      if (currentEvent === 'done') {
        lastDone = parsed;
      } else if (currentEvent === 'error') {
        if (typeof parsed.message === 'string' && parsed.message.trim()) {
          errorMessage = parsed.message.trim();
        } else {
          errorMessage = JSON.stringify(parsed);
        }
      }
    } catch {
      // ignore malformed event payloads here
    }
  }

  return {
    done: lastDone,
    error: errorMessage,
  };
}
