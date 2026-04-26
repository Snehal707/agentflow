import type { ChatTraceEntry } from "@/components/chat/types";

export type BridgeSourceKey = "ethereum-sepolia" | "base-sepolia";

const ETH_SEPOLIA_TX = "https://sepolia.etherscan.io/tx/";
const BASE_SEPOLIA_TX = "https://sepolia.basescan.org/tx/";
const ARC_TESTNET_TX = "https://testnet.arcscan.app/tx/";

function isHexTx(h: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(h);
}

export function explorerUrlForBridgeTx(
  sourceChain: BridgeSourceKey,
  event: string,
  txHash: string,
): string | undefined {
  if (!isHexTx(txHash)) return undefined;
  if (event === "minted") {
    return `${ARC_TESTNET_TX}${txHash}`;
  }
  if (event === "approved" || event === "burned") {
    return sourceChain === "base-sepolia"
      ? `${BASE_SEPOLIA_TX}${txHash}`
      : `${ETH_SEPOLIA_TX}${txHash}`;
  }
  return undefined;
}

function extractTxHash(data: Record<string, unknown>): string | undefined {
  for (const key of ["txHash", "transactionHash", "hash"] as const) {
    const top = data[key];
    if (typeof top === "string" && isHexTx(top)) return top;
  }
  const values = data.values;
  if (values && typeof values === "object" && values !== null) {
    const v = values as Record<string, unknown>;
    for (const key of ["txHash", "transactionHash", "hash"] as const) {
      const x = v[key];
      if (typeof x === "string" && isHexTx(x)) return x;
    }
  }
  return undefined;
}

/** Map streaming bridge SSE events to timeline rows (with tx link when the kit sends a hash). */
export function bridgeTraceFromStreamEvent(
  event: string,
  data: Record<string, unknown>,
  sourceChain: BridgeSourceKey,
): ChatTraceEntry | null {
  const txHash = extractTxHash(data);

  const withOptionalTx = (label: string): ChatTraceEntry => {
    if (!txHash) return label;
    const explorerUrl =
      explorerUrlForBridgeTx(sourceChain, event, txHash) ??
      (event === "minted" ? `${ARC_TESTNET_TX}${txHash}` : undefined);
    if (!explorerUrl) return label;
    return { label, txHash, explorerUrl };
  };

  switch (event) {
    case "approved":
      return withOptionalTx("Bridge approval submitted");
    case "burned":
      return withOptionalTx("USDC burned on source chain");
    case "attested":
      return "CCTP attestation received";
    case "minted":
      return withOptionalTx("USDC minted on Arc");
    case "error":
      return typeof data.message === "string" ? data.message : "Bridge failed";
    case "done":
      if (data.success === false && typeof data.reason === "string") {
        return data.reason;
      }
      return data.success === true ? "Bridge run finished" : null;
    default:
      return null;
  }
}

type BridgeStepLike = {
  name?: string;
  state?: string;
  txHash?: string;
  explorerUrl?: string;
};

function friendlyBridgeStepName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("approve")) return "Bridge approval submitted";
  if (n.includes("burn")) return "USDC burned on source chain";
  if (n.includes("mint")) return "USDC minted on Arc";
  if (n.includes("attest")) return "CCTP attestation received";
  return name;
}

/** Prefer final `kit.bridge()` result steps — includes authoritative explorer URLs from Bridge Kit. */
export function traceEntriesFromBridgeResult(
  result: unknown,
  sourceChain: BridgeSourceKey,
): ChatTraceEntry[] {
  if (!result || typeof result !== "object") return [];
  const steps = (result as { steps?: BridgeStepLike[] }).steps;
  if (!Array.isArray(steps)) return [];

  const out: ChatTraceEntry[] = [];
  for (const step of steps) {
    if (!step || step.state === "error") continue;
    const label = step.name ? friendlyBridgeStepName(step.name) : "Bridge step";
    const txHash =
      typeof step.txHash === "string" && isHexTx(step.txHash) ? step.txHash : undefined;
    let explorerUrl = typeof step.explorerUrl === "string" ? step.explorerUrl : undefined;
    if (txHash && !explorerUrl) {
      const n = (step.name ?? "").toLowerCase();
      if (n.includes("mint")) {
        explorerUrl = `${ARC_TESTNET_TX}${txHash}`;
      } else if (n.includes("approve") || n.includes("burn")) {
        explorerUrl =
          sourceChain === "base-sepolia"
            ? `${BASE_SEPOLIA_TX}${txHash}`
            : `${ETH_SEPOLIA_TX}${txHash}`;
      }
    }
    if (txHash && explorerUrl) {
      out.push({ label, txHash, explorerUrl });
    } else {
      out.push(label);
    }
  }
  return out;
}

export function traceEntryText(step: ChatTraceEntry): string {
  return typeof step === "string" ? step : step.label;
}
