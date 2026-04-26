import type { WalletClient } from "viem";
import type { Address } from "viem";
import { payProtectedResource } from "@/lib/x402BrowserClient";

export type AgentStreamEvent =
  | { type: "start" }
  | { type: "complete"; data: unknown; transaction?: string }
  | { type: "error"; message: string };

export async function* runAgentJsonAsStream(input: {
  url: string;
  walletClient: WalletClient;
  payer: Address;
  chainId: number;
  body: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
}): AsyncGenerator<AgentStreamEvent> {
  yield { type: "start" };
  try {
    const result = await payProtectedResource<unknown, Record<string, unknown>>({
      url: input.url,
      method: "POST",
      body: input.body,
      walletClient: input.walletClient,
      payer: input.payer,
      chainId: input.chainId,
      headers: {
        "Content-Type": "application/json",
        ...input.extraHeaders,
      },
    });

    yield {
      type: "complete",
      data: result.data,
      transaction: result.transaction,
    };
  } catch (cause) {
    yield {
      type: "error",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
