import { defineChain } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
    public: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arcscan",
      url: "https://testnet.arcscan.app",
    },
  },
});

export const ARC_CHAIN_ID = 5042002;
export const ARC_CHAIN_ID_HEX = "0x4CEF52";
export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";
export const CIRCLE_FAUCET_URL = "https://faucet.circle.com";
export const ARC_GATEWAY_DOMAIN = 26;
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
/** Arc Testnet EURC (6 decimals). */
export const ARC_EURC_ADDRESS =
  "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as const;
export const ARC_USYC_ADDRESS =
  "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as const;
export const ARC_USYC_TELLER_ADDRESS =
  "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A" as const;
export const GATEWAY_WALLET_ADDRESS =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;

/** Arc Testnet ERC-8004 registries (Identity / Reputation / Validation). */
export const ARC_ERC8004_IDENTITY_REGISTRY =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const ARC_ERC8004_REPUTATION_REGISTRY =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;
export const ARC_ERC8004_VALIDATION_REGISTRY =
  "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as const;

const ERC8004_REGISTRY_SET = new Set(
  [
    ARC_ERC8004_IDENTITY_REGISTRY,
    ARC_ERC8004_REPUTATION_REGISTRY,
    ARC_ERC8004_VALIDATION_REGISTRY,
  ].map((a) => a.toLowerCase()),
);

/** True if `to` is an ERC-8004 registry used for `register` flows on Arc. */
export function isLikelyErc8004Registry(address: string | null | undefined): boolean {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return false;
  const lower = address.toLowerCase();
  if (ERC8004_REGISTRY_SET.has(lower)) return true;
  return /^0x8004[a-fA-F0-9]{36}$/.test(lower);
}
