import {
  ArbitrumSepolia,
  AvalancheFuji,
  BaseSepolia,
  BridgeChain,
  CodexTestnet,
  EdgeTestnet,
  EthereumSepolia,
  HyperEVMTestnet,
  InkTestnet,
  LineaSepolia,
  MonadTestnet,
  MorphTestnet,
  OptimismSepolia,
  PlumeTestnet,
  PolygonAmoy,
  SeiTestnet,
  SonicTestnet,
  UnichainSepolia,
  WorldChainSepolia,
  XDCApothem,
} from "@circle-fin/bridge-kit";
import { defineChain, type Chain } from "viem";

type BridgeKitChainValue = (typeof BridgeChain)[keyof typeof BridgeChain];

type BridgeKitEvmSource = {
  chainId: number;
  name: string;
  title?: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcEndpoints: readonly string[];
  explorerUrl: string;
  usdcAddress: string;
};

type BridgeSourceConfig = {
  key: string;
  label: string;
  chain: Chain;
  chainId: number;
  usdcAddress: `0x${string}`;
  explorerTxBase: string;
  bridgeKitChain: BridgeKitChainValue | null;
  nativeBridgeEnabled: boolean;
};

function explorerTxBase(explorerUrl: string): string {
  return explorerUrl.includes("{hash}")
    ? explorerUrl.replace("{hash}", "")
    : explorerUrl.replace(/\/?$/, "/tx/");
}

function explorerBaseUrl(explorerUrl: string): string {
  return explorerTxBase(explorerUrl).replace(/\/tx\/?$/i, "");
}

function chainFromBridgeKit(source: BridgeKitEvmSource): Chain {
  return defineChain({
    id: source.chainId,
    name: source.title || source.name,
    nativeCurrency: source.nativeCurrency,
    rpcUrls: {
      default: {
        http: [...source.rpcEndpoints],
      },
    },
    blockExplorers: {
      default: {
        name: source.name,
        url: explorerBaseUrl(source.explorerUrl),
      },
    },
    testnet: true,
  });
}

function enabledSource(input: {
  key: string;
  label: string;
  source: BridgeKitEvmSource;
  bridgeKitChain: BridgeKitChainValue;
}): BridgeSourceConfig {
  return {
    key: input.key,
    label: input.label,
    chain: chainFromBridgeKit(input.source),
    chainId: input.source.chainId,
    usdcAddress: input.source.usdcAddress as `0x${string}`,
    explorerTxBase: explorerTxBase(input.source.explorerUrl),
    bridgeKitChain: input.bridgeKitChain,
    nativeBridgeEnabled: true,
  };
}

function disabledSource(input: {
  key: string;
  label: string;
  chain: Chain;
  chainId: number;
  usdcAddress: `0x${string}`;
  explorerTxBase: string;
}): BridgeSourceConfig {
  return {
    key: input.key,
    label: input.label,
    chain: input.chain,
    chainId: input.chainId,
    usdcAddress: input.usdcAddress,
    explorerTxBase: input.explorerTxBase,
    bridgeKitChain: null,
    nativeBridgeEnabled: false,
  };
}

const injectiveTestnetChain = defineChain({
  // TODO: Verify Injective CCTP testnet EVM chain id before enabling browser execution.
  id: 1439,
  name: "Injective Testnet",
  nativeCurrency: {
    name: "Injective",
    symbol: "INJ",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://k8s.testnet.json-rpc.injective.network/"],
    },
  },
  blockExplorers: {
    default: {
      name: "Injective Testnet Explorer",
      url: "https://testnet.blockscout.injective.network",
    },
  },
  testnet: true,
});

const pharosAtlanticChain = defineChain({
  // TODO: Verify Pharos Atlantic CCTP chain id before enabling browser execution.
  id: 688689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: {
    name: "Pharos",
    symbol: "PHRS",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://atlantic.dplabs-internal.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Pharos Atlantic Explorer",
      url: "https://atlantic.pharosscan.xyz",
    },
  },
  testnet: true,
});

export const BRIDGE_SOURCE_CONFIG = {
  "ethereum-sepolia": enabledSource({
    key: "ethereum-sepolia",
    label: "Ethereum Sepolia",
    source: EthereumSepolia,
    bridgeKitChain: BridgeChain.Ethereum_Sepolia,
  }),
  "avalanche-fuji": enabledSource({
    key: "avalanche-fuji",
    label: "Avalanche Fuji",
    source: AvalancheFuji,
    bridgeKitChain: BridgeChain.Avalanche_Fuji,
  }),
  "optimism-sepolia": enabledSource({
    key: "optimism-sepolia",
    label: "OP Sepolia",
    source: OptimismSepolia,
    bridgeKitChain: BridgeChain.Optimism_Sepolia,
  }),
  "arbitrum-sepolia": enabledSource({
    key: "arbitrum-sepolia",
    label: "Arbitrum Sepolia",
    source: ArbitrumSepolia,
    bridgeKitChain: BridgeChain.Arbitrum_Sepolia,
  }),
  "base-sepolia": enabledSource({
    key: "base-sepolia",
    label: "Base Sepolia",
    source: BaseSepolia,
    bridgeKitChain: BridgeChain.Base_Sepolia,
  }),
  "polygon-amoy": enabledSource({
    key: "polygon-amoy",
    label: "Polygon Amoy",
    source: PolygonAmoy,
    bridgeKitChain: BridgeChain.Polygon_Amoy_Testnet,
  }),
  "unichain-sepolia": enabledSource({
    key: "unichain-sepolia",
    label: "Unichain Sepolia",
    source: UnichainSepolia,
    bridgeKitChain: BridgeChain.Unichain_Sepolia,
  }),
  "linea-sepolia": enabledSource({
    key: "linea-sepolia",
    label: "Linea Sepolia",
    source: LineaSepolia,
    bridgeKitChain: BridgeChain.Linea_Sepolia,
  }),
  "codex-testnet": enabledSource({
    key: "codex-testnet",
    label: "Codex Testnet",
    source: CodexTestnet,
    bridgeKitChain: BridgeChain.Codex_Testnet,
  }),
  "sonic-testnet": enabledSource({
    key: "sonic-testnet",
    label: "Sonic Testnet",
    source: SonicTestnet,
    bridgeKitChain: BridgeChain.Sonic_Testnet,
  }),
  "world-chain-sepolia": enabledSource({
    key: "world-chain-sepolia",
    label: "World Chain Sepolia",
    source: WorldChainSepolia,
    bridgeKitChain: BridgeChain.World_Chain_Sepolia,
  }),
  "monad-testnet": enabledSource({
    key: "monad-testnet",
    label: "Monad Testnet",
    source: MonadTestnet,
    bridgeKitChain: BridgeChain.Monad_Testnet,
  }),
  "sei-testnet": enabledSource({
    key: "sei-testnet",
    label: "Sei Testnet",
    source: SeiTestnet,
    bridgeKitChain: BridgeChain.Sei_Testnet,
  }),
  "xdc-apothem": enabledSource({
    key: "xdc-apothem",
    label: "XDC Apothem",
    source: XDCApothem,
    bridgeKitChain: BridgeChain.XDC_Apothem,
  }),
  "hyperevm-testnet": enabledSource({
    key: "hyperevm-testnet",
    label: "HyperEVM Testnet",
    source: HyperEVMTestnet,
    bridgeKitChain: BridgeChain.HyperEVM_Testnet,
  }),
  "ink-testnet": enabledSource({
    key: "ink-testnet",
    label: "Ink Testnet",
    source: InkTestnet,
    bridgeKitChain: BridgeChain.Ink_Testnet,
  }),
  "plume-testnet": enabledSource({
    key: "plume-testnet",
    label: "Plume Testnet",
    source: PlumeTestnet,
    bridgeKitChain: BridgeChain.Plume_Testnet,
  }),
  "edge-testnet": enabledSource({
    key: "edge-testnet",
    label: "EDGE Testnet",
    source: EdgeTestnet,
    bridgeKitChain: BridgeChain.Edge_Testnet,
  }),
  "injective-testnet": disabledSource({
    key: "injective-testnet",
    label: "Injective Testnet",
    chain: injectiveTestnetChain,
    chainId: injectiveTestnetChain.id,
    // TODO: Verify native testnet USDC address before enabling browser execution.
    usdcAddress: "0x0000000000000000000000000000000000000000",
    explorerTxBase: "https://testnet.blockscout.injective.network/tx/",
  }),
  "morph-testnet": enabledSource({
    key: "morph-testnet",
    label: "Morph Testnet",
    source: MorphTestnet,
    bridgeKitChain: BridgeChain.Morph_Testnet,
  }),
  "pharos-atlantic": disabledSource({
    key: "pharos-atlantic",
    label: "Pharos Atlantic",
    chain: pharosAtlanticChain,
    chainId: pharosAtlanticChain.id,
    // TODO: Verify native Atlantic testnet USDC address before enabling browser execution.
    usdcAddress: "0x0000000000000000000000000000000000000000",
    explorerTxBase: "https://atlantic.pharosscan.xyz/tx/",
  }),
} as const;

export type BridgeSource = keyof typeof BRIDGE_SOURCE_CONFIG;

function normalizeBridgeSourceInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\betherium\b/g, "ethereum")
    .replace(/\betherem\b/g, "ethereum")
    .replace(/\bethreum\b/g, "ethereum")
    .replace(/\bethrium\b/g, "ethereum")
    .replace(/\bsepoll?ia\b/g, "sepolia")
    .replace(/\bsepoll?a\b/g, "sepolia")
    .replace(/\bsepola\b/g, "sepolia")
    .replace(/\bsepoila\b/g, "sepolia")
    .replace(/\bop\b/g, "optimism")
    .replace(/\bworldchain\b/g, "world chain")
    .replace(/\bhyper evm\b/g, "hyperevm")
    .replace(/\bhyperliquid evm\b/g, "hyperevm")
    .replace(/\bavax\b/g, "avalanche")
    .replace(/\barb\b/g, "arbitrum")
    .replace(/\bpoly\b/g, "polygon")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectBridgeSource(prompt: string): BridgeSource | null {
  const normalized = normalizeBridgeSourceInput(prompt);

  if (!normalized || normalized === "sepolia") {
    return null;
  }

  if (/\bedge\b/.test(normalized) && /\btestnet\b/.test(normalized)) return "edge-testnet";
  if (/\bcodex\b/.test(normalized) && /\btestnet\b/.test(normalized)) return "codex-testnet";
  if (/\bworld\s+chain\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return "world-chain-sepolia";
  if (/\bunichain\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return "unichain-sepolia";
  if (/\blinea\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return "linea-sepolia";
  if (/\boptimism\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return "optimism-sepolia";
  if (/\barbitrum\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return "arbitrum-sepolia";
  if (/\bbase\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return "base-sepolia";
  if (/\beth(?:ereum)?\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return "ethereum-sepolia";
  if (/\bpolygon\b/.test(normalized) && /\bamoy\b/.test(normalized)) return "polygon-amoy";
  if (/\bavalanche\b/.test(normalized) && /\bfuji\b/.test(normalized)) return "avalanche-fuji";
  if (/\bhyperevm\b/.test(normalized) && /\btestnet\b/.test(normalized)) return "hyperevm-testnet";
  if (/\bink\b/.test(normalized) && /\b(testnet|sepolia)\b/.test(normalized)) return "ink-testnet";
  if (/\bmonad\b/.test(normalized) && /\btestnet\b/.test(normalized)) return "monad-testnet";
  if (/\bmorph\b/.test(normalized) && /\b(testnet|hoodi)\b/.test(normalized)) return "morph-testnet";
  if (/\bplume\b/.test(normalized) && /\btestnet\b/.test(normalized)) return "plume-testnet";
  if (/\bsei\b/.test(normalized) && /\btestnet\b/.test(normalized)) return "sei-testnet";
  if (/\bxdc\b/.test(normalized) && /\bapothem\b/.test(normalized)) return "xdc-apothem";
  if (/\binjective\b/.test(normalized) && /\btestnet\b/.test(normalized)) return "injective-testnet";
  if (/\bpharos\b/.test(normalized) && /\b(atlantic|testnet)\b/.test(normalized)) return "pharos-atlantic";

  if (/\bbase\b/.test(normalized)) return "base-sepolia";
  if (/\barbitrum\b/.test(normalized)) return "arbitrum-sepolia";
  if (/\boptimism\b/.test(normalized)) return "optimism-sepolia";
  if (/\beth(?:ereum)?\b/.test(normalized)) return "ethereum-sepolia";
  if (/\bavalanche\b/.test(normalized)) return "avalanche-fuji";
  if (/\bpolygon\b/.test(normalized)) return "polygon-amoy";
  if (/\bunichain\b/.test(normalized)) return "unichain-sepolia";
  if (/\blinea\b/.test(normalized)) return "linea-sepolia";
  if (/\bcodex\b/.test(normalized)) return "codex-testnet";
  if (/\bsonic\b/.test(normalized)) return "sonic-testnet";
  if (/\bworld\s+chain\b/.test(normalized)) return "world-chain-sepolia";
  if (/\bmonad\b/.test(normalized)) return "monad-testnet";
  if (/\bsei\b/.test(normalized)) return "sei-testnet";
  if (/\bxdc\b/.test(normalized)) return "xdc-apothem";
  if (/\bhyperevm\b/.test(normalized)) return "hyperevm-testnet";
  if (/\bink\b/.test(normalized)) return "ink-testnet";
  if (/\bplume\b/.test(normalized)) return "plume-testnet";
  if (/\bedge\b/.test(normalized)) return "edge-testnet";
  if (/\binjective\b/.test(normalized)) return "injective-testnet";
  if (/\bmorph\b/.test(normalized)) return "morph-testnet";
  if (/\bpharos\b/.test(normalized)) return "pharos-atlantic";

  return null;
}
