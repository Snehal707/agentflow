export type NavItem = {
  href: string;
  label: string;
  icon: string;
};

export type ChatHistoryItem = {
  id: string;
  title: string;
  /** ms epoch when this thread was last active (used for sidebar labels) */
  at: number;
};

export type ChatCategory =
  | "Research"
  | "Swap"
  | "Vault"
  | "Bridge"
  | "Portfolio"
  | "AgentPay";

export type HandleProfile = {
  handle: string;
  businessName: string;
  suggestedAmount: string;
  walletAddress: string;
};

export const navItems: NavItem[] = [
  { href: "/chat", label: "Chat", icon: "space_dashboard" },
  { href: "/pay", label: "AgentPay", icon: "payments" },
  { href: "/funds", label: "Funding", icon: "account_balance" },
  { href: "/portfolio", label: "Portfolio", icon: "bar_chart" },
  { href: "/vault", label: "Vault", icon: "savings" },
  { href: "/agents", label: "Agents", icon: "smart_toy" },
  { href: "/economy", label: "Benchmark", icon: "monitoring" },
  { href: "/settings", label: "Telegram", icon: "send" },
];

export const suggestedPrompts: Record<ChatCategory, string[]> = {
  Research: [
    "Research what affects stablecoin holders on Arc today, with sources.",
    "Research a market event and tell me how it affects my portfolio.",
    "Analyze this image and turn it into a short research brief.",
    "Transcribe this voice note and return only the transcript text.",
    "Write a concise analyst-style report from current Arc market context.",
    "Render 'AgentFlow' as ASCII art.",
  ],
  Swap: [
    "Quote swapping 25 USDC to EURC before execution.",
    "Swap 10 USDC to EURC and wait for my YES.",
    "Show expected output, fee, and price impact for a USDC to EURC swap.",
    "Swap 5 USDC to EURC, then explain how it changed my portfolio.",
  ],
  Vault: [
    "What is the current Arc vault APY?",
    "Deposit 10 USDC into the vault and explain the shares I receive.",
    "Withdraw 5 USDC from the vault and summarize the result.",
    "Show a simple vault quote for depositing 5 USDC.",
  ],
  Bridge: [
    "Bridge 1 USDC from Ethereum Sepolia to Arc.",
    "Bridge 1 USDC from Base Sepolia to Arc.",
    "Show the supported bridge source chains for Arc.",
    "Check how much sponsored bridge allowance I have left today.",
  ],
  Portfolio: [
    "Show my Agent wallet holdings, vault shares, and Gateway reserve.",
    "Summarize my recent activity and current portfolio on Arc.",
    "Explain how my portfolio changed after the last swap or vault action.",
    "Give me a clean portfolio report focused on my Agent wallet only.",
  ],
  AgentPay: [
    "Send 25 USDC to one recipient and show me the preview.",
    "Create a 50 USDC invoice for Benchmark Vendor.",
    "Split 50 USDC between three wallets and wait for confirmation.",
    "Create a weekly schedule to pay a vendor 10 USDC on Arc.",
    "Prepare a batch payout for three recipients before execution.",
  ],
};

export const paymentProfiles: Record<string, HandleProfile> = {
  acme: {
    handle: "acme.arc",
    businessName: "Acme Automation",
    suggestedAmount: "125.00",
    walletAddress: "0xacce00000000000000000000000000000000f10a",
  },
  circleops: {
    handle: "circleops.arc",
    businessName: "Circle Ops Lab",
    suggestedAmount: "42.00",
    walletAddress: "0xc1c1e0000000000000000000000000000000a0b5",
  },
};

export function getPaymentProfile(handle: string): HandleProfile {
  const normalized = handle.toLowerCase();
  return (
    paymentProfiles[normalized] || {
      handle: `${normalized}.arc`,
      businessName: normalized.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      suggestedAmount: "25.00",
      walletAddress: "0x0000000000000000000000000000000000000000",
    }
  );
}

export function shortenAddress(address: string): string {
  if (!address) {
    return "Not connected";
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
