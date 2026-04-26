import { NextResponse } from "next/server";
import { ARC_CHAIN_ID, arcTestnet } from "@/lib/arcChain";

export const dynamic = "force-dynamic";

const ARC_RPC_URL =
  process.env.ALCHEMY_ARC_RPC ||
  process.env.NEXT_PUBLIC_ARC_RPC_URL ||
  arcTestnet.rpcUrls.default.http[0];

export async function GET() {
  try {
    const response = await fetch(ARC_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "eth_blockNumber",
        params: [],
      }),
      cache: "no-store",
    });

    const json = (await response.json()) as {
      result?: string;
      error?: { message?: string };
    };

    if (!response.ok || json.error || !json.result) {
      throw new Error(json.error?.message || `RPC failed with status ${response.status}`);
    }

    return NextResponse.json(
      {
        blockNumber: Number.parseInt(json.result, 16),
        chainId: ARC_CHAIN_ID,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Block lookup failed" },
      { status: 500 },
    );
  }
}
