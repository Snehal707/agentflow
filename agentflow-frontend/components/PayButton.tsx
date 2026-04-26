"use client";

import { useMemo, useState } from "react";
import { getAddress, isAddress, parseUnits } from "viem";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { ARC_CHAIN_ID, ARC_USDC_ADDRESS } from "@/lib/arcChain";
import { shortenAddress } from "@/lib/appData";
import { authHeadersForWallet } from "@/lib/authSession";

type PayButtonProps = {
  label: string;
  /** externalTransfer: sign USDC on Arc then POST ledger (legacy public pay). agentWalletSend: POST /api/pay/send (DCW, requires AgentFlow JWT). */
  mode?: "externalTransfer" | "agentWalletSend";
  endpoint?: string;
  payload?: Record<string, unknown>;
  className?: string;
};

export function PayButton({
  label,
  mode = "externalTransfer",
  endpoint,
  payload,
  className = "",
}: PayButtonProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: ARC_CHAIN_ID });
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const helperText = useMemo(() => {
    if (!isConnected) {
      return mode === "agentWalletSend"
        ? "Connect the wallet you use with AgentFlow, then sign in via Chat if needed."
        : "Connect any external wallet with RainbowKit.";
    }
    if (mode === "externalTransfer" && chainId !== ARC_CHAIN_ID) {
      return "Switch to Arc Testnet to continue.";
    }
    return `Connected as ${shortenAddress(address || "")}`;
  }, [address, chainId, isConnected, mode]);

  const handleAgentWalletSend = async () => {
    if (!address) {
      throw new Error("Connect a wallet first.");
    }
    const payerWallet = getAddress(address);
    const auth = authHeadersForWallet(payerWallet);
    if (!auth) {
      throw new Error(
        "Sign in to AgentFlow with this wallet (open Chat and connect) to pay from your agent wallet.",
      );
    }

    const toAddress = String(payload?.toAddress ?? "").trim();
    const amountRaw = String(payload?.amount ?? "").trim();
    const remarkRaw = String(payload?.remark ?? payload?.purpose ?? "").trim();
    const amount = Number(amountRaw);

    if (!toAddress) {
      throw new Error("Recipient is missing.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter a valid USDC amount.");
    }

    const response = await fetch("/api/pay/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...auth,
      },
      body: JSON.stringify({
        toAddress,
        amount,
        remark: remarkRaw ? remarkRaw.slice(0, 100) : undefined,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      txHash?: string;
      explorerLink?: string;
    };
    if (!response.ok) {
      throw new Error(result.error || "Payment failed");
    }
    const tx = result.txHash ?? "";
    const short = tx.length > 12 ? `${tx.slice(0, 10)}...` : tx;
    setStatus(
      result.explorerLink
        ? `Sent. Tx: ${short}\n${result.explorerLink}`
        : `Sent. Tx: ${short}`,
    );
  };

  const handleClick = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (mode === "externalTransfer" && chainId !== ARC_CHAIN_ID) {
      openChainModal?.();
      return;
    }

    if (mode === "agentWalletSend") {
      setIsLoading(true);
      setStatus(null);
      try {
        await handleAgentWalletSend();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Payment failed");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!endpoint) {
      setStatus("Wallet connected. Payment intent is ready.");
      return;
    }

    setIsLoading(true);
    setStatus(null);
    try {
      if (!address || !walletClient || !publicClient) {
        throw new Error("Connect a wallet on Arc Testnet to pay.");
      }

      const recipientRaw = String(payload?.recipient ?? "").trim();
      const amountRawInput = String(payload?.amount ?? "").trim();
      const handle = String(payload?.handle ?? "").trim();
      const purpose = String(payload?.purpose ?? "").trim();
      const amountUsdc = Number(amountRawInput);

      if (!isAddress(recipientRaw)) {
        throw new Error("Valid recipient wallet is required.");
      }
      if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
        throw new Error("Enter a valid USDC amount.");
      }

      const payerWallet = getAddress(address);
      const recipientWallet = getAddress(recipientRaw);
      const txHash = await walletClient.writeContract({
        account: payerWallet,
        address: ARC_USDC_ADDRESS,
        abi: [
          {
            type: "function",
            name: "transfer",
            stateMutability: "nonpayable",
            inputs: [
              { name: "to", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ name: "", type: "bool" }],
          },
        ],
        functionName: "transfer",
        args: [recipientWallet, parseUnits(amountUsdc.toFixed(6), 6)],
      });

      setStatus("Waiting for Arc confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        throw new Error("Payment transfer failed on Arc.");
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(payload || {}),
          handle,
          walletAddress: payerWallet,
          amountUsdc,
          purpose,
          txHash,
          chainId,
        }),
      });

      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        txHash?: string;
      };
      if (!response.ok) {
        throw new Error(result.error || result.message || "Payment request failed");
      }
      setStatus(result.message || `Payment confirmed on Arc: ${result.txHash ?? txHash}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Payment request failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleClick}
        className={`w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70 ${className}`}
        disabled={isLoading}
      >
        {isLoading ? "Processing..." : label}
      </button>
      <p className="text-sm text-white/52 whitespace-pre-line">{status || helperText}</p>
    </div>
  );
}
