import type { LiveChatMessage } from "@/components/chat/types";
import { traceEntryText } from "@/lib/bridgeTrace";

const GENERIC_CLUSTERS = new Set(["AgentFlow", "AgentFlow Brain"]);
const OPERATIONAL_CLUSTER_PATTERN =
  /\b(research|analyst|writer|swap|vault|bridge|portfolio|capability|balance)\b/i;
const OPERATIONAL_TRACE_PATTERN =
  /\b(research|analyst|writer|swap|vault|bridge|portfolio|capability|balance|verified|settled|explorer|tx|execution|simulation|estimate)\b/i;

export function messageHasMeaningfulClusters(
  message: LiveChatMessage | null | undefined,
): boolean {
  const clusters = message?.activityMeta?.clusters ?? [];
  return clusters.some(
    (cluster) =>
      !GENERIC_CLUSTERS.has(cluster) && OPERATIONAL_CLUSTER_PATTERN.test(cluster),
  );
}

export function messageHasMeaningfulTrace(
  message: LiveChatMessage | null | undefined,
): boolean {
  return (message?.trace ?? []).some((entry) => {
    if (typeof entry !== "string") {
      return Boolean(entry.txHash || entry.explorerUrl || entry.label);
    }

    return OPERATIONAL_TRACE_PATTERN.test(traceEntryText(entry));
  });
}

export function messageSupportsReportPanel(
  message: LiveChatMessage | null | undefined,
): boolean {
  void message;
  return false;
}
