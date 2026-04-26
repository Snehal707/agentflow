"use client";

import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  toFunctionSelector,
  type Address,
  type WalletClient,
} from "viem";
import {
  ARC_USDC_ADDRESS,
  ARC_USYC_ADDRESS,
  ARC_USYC_TELLER_ADDRESS,
  arcTestnet,
} from "@/lib/arcChain";

type UsycAction = "usyc_deposit" | "usyc_withdraw";

export type EoaUsycExecutionPlan = {
  action: UsycAction;
  walletAddress: string;
  receiverAddress: string;
  tellerAddress: string;
  usdcAddress: string;
  usycAddress: string;
  amount: string;
};

type EoaUsycPreflightResult =
  | { ok: true; trace: string[] }
  | { ok: false; error: string; trace: string[] };

type ExecuteEoaUsycResult = {
  txHash: string;
  approvalSkipped: boolean;
  usycReceived?: string;
  usdcReceived?: string;
};

const tellerAbi = parseAbi([
  "function deposit(uint256 _assets, address _receiver) returns (uint256)",
  "function redeem(uint256 _shares, address _receiver, address _account) returns (uint256)",
  "function authority() view returns (address)",
]);

const rolesAuthorityAbi = parseAbi([
  "function canCall(address user, address target, bytes4 functionSig) view returns (bool)",
]);

const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const depositSelector = toFunctionSelector("function deposit(uint256,address)");
const redeemSelector = toFunctionSelector("function redeem(uint256,address,address)");

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(arcTestnet.rpcUrls.default.http[0]),
  });
}

async function readDecimals(client: ReturnType<typeof getPublicClient>, token: Address): Promise<number> {
  try {
    const decimals = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "decimals",
    });
    return Number(decimals);
  } catch {
    return 6;
  }
}

async function canUseTeller(params: {
  walletAddress: Address;
  tellerAddress: Address;
  action: UsycAction;
}): Promise<boolean> {
  const client = getPublicClient();
  const authority = await client.readContract({
    address: params.tellerAddress,
    abi: tellerAbi,
    functionName: "authority",
  });

  return client.readContract({
    address: authority,
    abi: rolesAuthorityAbi,
    functionName: "canCall",
    args: [
      params.walletAddress,
      params.tellerAddress,
      params.action === "usyc_deposit" ? depositSelector : redeemSelector,
    ],
  });
}

export async function preflightEoaUsycAction(input: {
  action: UsycAction;
  walletAddress: string;
  amount: number;
}): Promise<EoaUsycPreflightResult> {
  const client = getPublicClient();
  const walletAddress = getAddress(input.walletAddress);
  const tellerAddress = getAddress(ARC_USYC_TELLER_ADDRESS);
  const usdcAddress = getAddress(ARC_USDC_ADDRESS);
  const usycAddress = getAddress(ARC_USYC_ADDRESS);

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return {
      ok: false,
      error: "USYC amount must be greater than zero.",
      trace: ["USYC preflight failed", "Invalid amount"],
    };
  }

  const entitled = await canUseTeller({
    walletAddress,
    tellerAddress,
    action: input.action,
  });

  if (!entitled) {
    return {
      ok: false,
      error:
        "This connected wallet is not entitled for USYC on Arc Testnet yet. Complete the hackathon or Hashnote onboarding for this wallet, then try again.",
      trace: [
        "USYC preflight failed",
        "Connected EOA is not entitled for the Teller action",
      ],
    };
  }

  if (input.action === "usyc_deposit") {
    const amountRaw = parseUnits(input.amount.toFixed(6), 6);
    const usdcBalance = await client.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    });

    if (usdcBalance < amountRaw) {
      return {
        ok: false,
        error:
          "I did not start the USYC subscribe because your connected wallet does not have enough USDC on Arc yet.",
        trace: [
          "USYC preflight failed",
          `Connected EOA balance ${formatUnits(usdcBalance, 6)} USDC is below ${input.amount} USDC`,
        ],
      };
    }
  } else {
    const usycDecimals = await readDecimals(client, usycAddress);
    const amountRaw = parseUnits(input.amount.toFixed(usycDecimals), usycDecimals);
    const usycBalance = await client.readContract({
      address: usycAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    });

    if (usycBalance < amountRaw) {
      return {
        ok: false,
        error:
          "I did not start the USYC redeem because your connected wallet does not hold enough USYC on Arc yet.",
        trace: [
          "USYC preflight failed",
          `Connected EOA balance ${formatUnits(usycBalance, usycDecimals)} USYC is below ${input.amount} USYC`,
        ],
      };
    }
  }

  return {
    ok: true,
    trace: [
      "USYC EOA preflight passed",
      input.action === "usyc_deposit"
        ? "Connected EOA is entitled and holds enough USDC"
        : "Connected EOA is entitled and holds enough USYC",
    ],
  };
}

export async function executeEoaUsycPlan(input: {
  walletClient: WalletClient;
  plan: EoaUsycExecutionPlan;
}): Promise<ExecuteEoaUsycResult> {
  const client = getPublicClient();
  const account = getAddress(input.plan.walletAddress);
  const receiver = getAddress(input.plan.receiverAddress);
  const tellerAddress = getAddress(input.plan.tellerAddress);
  const usdcAddress = getAddress(input.plan.usdcAddress);
  const usycAddress = getAddress(input.plan.usycAddress);
  const amountNum = Number(input.plan.amount);

  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error("USYC amount must be greater than zero.");
  }

  if (input.plan.action === "usyc_deposit") {
    const amountRaw = parseUnits(amountNum.toFixed(6), 6);
    const allowance = await client.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, tellerAddress],
    });

    let approvalSkipped = allowance >= amountRaw;
    if (!approvalSkipped) {
      const approveHash = await input.walletClient.writeContract({
        account,
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [tellerAddress, amountRaw],
        chain: arcTestnet,
      });
      await client.waitForTransactionReceipt({ hash: approveHash });
      approvalSkipped = false;
    }

    const usycDecimals = await readDecimals(client, usycAddress);
    const before = await client.readContract({
      address: usycAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [receiver],
    });

    const txHash = await input.walletClient.writeContract({
      account,
      address: tellerAddress,
      abi: tellerAbi,
      functionName: "deposit",
      args: [amountRaw, receiver],
      chain: arcTestnet,
    });
    await client.waitForTransactionReceipt({ hash: txHash });

    const after = await client.readContract({
      address: usycAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [receiver],
    });

    return {
      txHash,
      approvalSkipped,
      usycReceived: formatUnits(after > before ? after - before : BigInt(0), usycDecimals),
    };
  }

  const usycDecimals = await readDecimals(client, usycAddress);
  const sharesRaw = parseUnits(amountNum.toFixed(usycDecimals), usycDecimals);
  const allowance = await client.readContract({
    address: usycAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, tellerAddress],
  });

  let approvalSkipped = allowance >= sharesRaw;
  if (!approvalSkipped) {
    const approveHash = await input.walletClient.writeContract({
      account,
      address: usycAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [tellerAddress, sharesRaw],
      chain: arcTestnet,
    });
    await client.waitForTransactionReceipt({ hash: approveHash });
    approvalSkipped = false;
  }

  const before = await client.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [receiver],
  });

  const txHash = await input.walletClient.writeContract({
    account,
    address: tellerAddress,
    abi: tellerAbi,
    functionName: "redeem",
    args: [sharesRaw, receiver, account],
    chain: arcTestnet,
  });
  await client.waitForTransactionReceipt({ hash: txHash });

  const after = await client.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [receiver],
  });

  return {
    txHash,
    approvalSkipped,
    usdcReceived: formatUnits(after > before ? after - before : BigInt(0), 6),
  };
}
