export const SUPPORTED_BRIDGE_SOURCES = [
  { key: 'ethereum-sepolia', label: 'Ethereum Sepolia', domain: 0 },
  { key: 'avalanche-fuji', label: 'Avalanche Fuji', domain: 1 },
  { key: 'optimism-sepolia', label: 'OP Sepolia', domain: 2 },
  { key: 'arbitrum-sepolia', label: 'Arbitrum Sepolia', domain: 3 },
  { key: 'base-sepolia', label: 'Base Sepolia', domain: 6 },
  { key: 'polygon-amoy', label: 'Polygon Amoy', domain: 7 },
  { key: 'unichain-sepolia', label: 'Unichain Sepolia', domain: 10 },
  { key: 'linea-sepolia', label: 'Linea Sepolia', domain: 11 },
  { key: 'codex-testnet', label: 'Codex Testnet', domain: 12 },
  { key: 'sonic-testnet', label: 'Sonic Testnet', domain: 13 },
  { key: 'world-chain-sepolia', label: 'World Chain Sepolia', domain: 14 },
  { key: 'monad-testnet', label: 'Monad Testnet', domain: 15 },
  { key: 'sei-testnet', label: 'Sei Testnet', domain: 16 },
  { key: 'xdc-apothem', label: 'XDC Apothem', domain: 18 },
  { key: 'hyperevm-testnet', label: 'HyperEVM Testnet', domain: 19 },
  { key: 'ink-testnet', label: 'Ink Testnet', domain: 21 },
  { key: 'plume-testnet', label: 'Plume Testnet', domain: 22 },
  { key: 'edge-testnet', label: 'EDGE Testnet', domain: 28 },
  { key: 'injective-testnet', label: 'Injective Testnet', domain: 29 },
  { key: 'morph-testnet', label: 'Morph Testnet', domain: 30 },
  { key: 'pharos-atlantic', label: 'Pharos Atlantic', domain: 31 },
] as const;

export type SupportedBridgeSourceChain = (typeof SUPPORTED_BRIDGE_SOURCES)[number]['key'];

export const SUPPORTED_BRIDGE_SOURCE_KEYS = SUPPORTED_BRIDGE_SOURCES.map(
  (source) => source.key,
) as SupportedBridgeSourceChain[];

export const BRIDGE_SOURCE_DOMAIN: Record<SupportedBridgeSourceChain, number> = Object.fromEntries(
  SUPPORTED_BRIDGE_SOURCES.map((source) => [source.key, source.domain]),
) as Record<SupportedBridgeSourceChain, number>;

function normalizeBridgeSourceInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\betherium\b/g, 'ethereum')
    .replace(/\betherem\b/g, 'ethereum')
    .replace(/\bethreum\b/g, 'ethereum')
    .replace(/\bethrium\b/g, 'ethereum')
    .replace(/\bsepoll?ia\b/g, 'sepolia')
    .replace(/\bsepoll?a\b/g, 'sepolia')
    .replace(/\bsepola\b/g, 'sepolia')
    .replace(/\bsepoila\b/g, 'sepolia')
    .replace(/\bop\b/g, 'optimism')
    .replace(/\bworldchain\b/g, 'world chain')
    .replace(/\bhyper evm\b/g, 'hyperevm')
    .replace(/\bhyperliquid evm\b/g, 'hyperevm')
    .replace(/\bavax\b/g, 'avalanche')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSupportedBridgeSourceChain(
  value: unknown,
): SupportedBridgeSourceChain | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = normalizeBridgeSourceInput(value);

  if (/\bedge\b/.test(normalized) && /\btestnet\b/.test(normalized)) return 'edge-testnet';
  if (/\bcodex\b/.test(normalized) && /\btestnet\b/.test(normalized)) return 'codex-testnet';
  if (/\bworld\s+chain\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return 'world-chain-sepolia';
  if (/\bunichain\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return 'unichain-sepolia';
  if (/\blinea\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return 'linea-sepolia';
  if (/\boptimism\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return 'optimism-sepolia';
  if (/\barbitrum\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return 'arbitrum-sepolia';
  if (/\bbase\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return 'base-sepolia';
  if (/\beth(?:ereum)?\b/.test(normalized) && /\bsepolia\b/.test(normalized)) return 'ethereum-sepolia';
  if (/\bpolygon\b/.test(normalized) && /\bamoy\b/.test(normalized)) return 'polygon-amoy';
  if (/\bavalanche\b/.test(normalized) && /\bfuji\b/.test(normalized)) return 'avalanche-fuji';
  if (/\bhyperevm\b/.test(normalized) && /\btestnet\b/.test(normalized)) return 'hyperevm-testnet';
  if (/\bink\b/.test(normalized) && /\b(testnet|sepolia)\b/.test(normalized)) return 'ink-testnet';
  if (/\bmonad\b/.test(normalized) && /\btestnet\b/.test(normalized)) return 'monad-testnet';
  if (/\bmorph\b/.test(normalized) && /\b(testnet|hoodi)\b/.test(normalized)) return 'morph-testnet';
  if (/\bplume\b/.test(normalized) && /\btestnet\b/.test(normalized)) return 'plume-testnet';
  if (/\bsei\b/.test(normalized) && /\btestnet\b/.test(normalized)) return 'sei-testnet';
  if (/\bsonic\b/.test(normalized) && /\btestnet\b/.test(normalized)) return 'sonic-testnet';
  if (/\bxdc\b/.test(normalized) && /\bapothem\b/.test(normalized)) return 'xdc-apothem';
  if (/\binjective\b/.test(normalized) && /\btestnet\b/.test(normalized)) return 'injective-testnet';
  if (/\bpharos\b/.test(normalized) && /\b(atlantic|testnet)\b/.test(normalized)) return 'pharos-atlantic';

  return undefined;
}
