import type { ChatTraceEntry } from "@/components/chat/types";
import { BRIDGE_SOURCE_CONFIG, type BridgeSource } from "@/lib/bridgeSources";

const ARC_TESTNET_TX = "https://testnet.arcscan.app/tx/";

function isHexTx(h: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(h);
}

export function explorerUrlForBridgeTx(
  sourceChain: BridgeSource,
  event: string,
  txHash: string,
): string | undefined {
  if (!isHexTx(txHash)) return undefined;
  if (event === "minted") {
    return `${ARC_TESTNET_TX}${txHash}`;
  }
  if (event === "burned" || event === "deposit_submitted" || event === "approved") {
    return `${BRIDGE_SOURCE_CONFIG[sourceChain].explorerTxBase}${txHash}`;
  }
  return undefined;
}

function extractTxHash(data: Record<string, unknown>): string | undefined {
  for (const key of ["txHash", "transactionHash", "hash"] as const) {
    const top = data[key];
    if (typeof top === "string" && isHexTx(top)) return top;
  }
  return undefined;
}

export function bridgeTraceFromStreamEvent(
  event: string,
  data: Record<string, unknown>,
  sourceChain: BridgeSource,
): ChatTraceEntry | null {
  const txHash = extractTxHash(data);

  const withOptionalTx = (label: string): ChatTraceEntry => {
    if (!txHash) return label;
    const explorerUrl = explorerUrlForBridgeTx(sourceChain, event, txHash);
    if (!explorerUrl) return label;
    return { label, txHash, explorerUrl };
  };

  switch (event) {
    case "attesting":
      return typeof data.message === "string"
        ? data.message
        : "Waiting for Circle attestation (5-20 min)...";
    case "attested":
      return typeof data.message === "string"
        ? data.message
        : "Attestation confirmed";
    case "minted":
      return withOptionalTx(
        typeof data.message === "string"
          ? data.message
          : "USDC arrived in your AgentFlow wallet",
      );
    case "error":
      return typeof data.message === "string" ? data.message : "Bridge failed";
    case "done":
      if (data.success === false && typeof data.reason === "string") {
        return data.reason;
      }
      return data.success === true ? "Bridge completed" : null;
    default:
      return null;
  }
}

export function traceEntryText(step: ChatTraceEntry): string {
  return typeof step === "string" ? step : step.label;
}
