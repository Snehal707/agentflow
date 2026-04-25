import { getAddress, isAddress } from 'viem';

const GATEWAY_API_BASE_URL =
  process.env.GATEWAY_API_BASE_URL?.trim() || 'https://gateway-api-testnet.circle.com/v1';
const ARC_TESTNET_DOMAIN = Number(process.env.GATEWAY_DOMAIN?.trim() || '26');

export type GatewayFundingWallet = {
  walletId: string;
  address: `0x${string}`;
};

function normalizeAddressOrThrow(value: string, fieldName: string): `0x${string}` {
  if (!isAddress(value)) {
    throw new Error(`Valid ${fieldName} is required`);
  }
  return getAddress(value);
}

/**
 * Query Gateway USDC for one or more depositor addresses on Arc.
 * Sums balances across rows (funding wallet + EOA may both appear).
 */
export async function fetchGatewayBalancesForDepositors(addresses: `0x${string}`[]): Promise<{
  available: string;
  total: string;
}> {
  const unique = [...new Set(addresses.map((a) => getAddress(a)))] as `0x${string}`[];
  if (unique.length === 0) {
    return { available: '0', total: '0' };
  }

  const response = await fetch(`${GATEWAY_API_BASE_URL}/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: unique.map((depositor) => ({ depositor, domain: ARC_TESTNET_DOMAIN })),
    }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    balances?: Array<{ balance?: string; withdrawing?: string; depositor?: string }>;
    message?: string;
    error?: string;
  };

  if (!response.ok) {
    const details = json.message || json.error || `HTTP ${response.status}`;
    throw new Error(`Gateway API balance fetch failed: ${details}`);
  }

  let sumAvail = 0;
  let sumTotal = 0;

  for (const row of json.balances ?? []) {
    const availStr = String(row.balance ?? '0');
    const availNum = Number(availStr);
    if (!Number.isFinite(availNum)) {
      continue;
    }
    const withdrawing = Number(row.withdrawing ?? 0);
    const w = Number.isFinite(withdrawing) ? withdrawing : 0;
    sumAvail += availNum;
    sumTotal += availNum + w;
  }

  const fmt = (n: number) =>
    Number.isFinite(n) ? String(parseFloat(n.toFixed(6))) : '0';

  return { available: fmt(sumAvail), total: fmt(sumTotal) };
}

export async function fetchGatewayBalanceForAddress(address: `0x${string}`): Promise<{
  available: string;
  total: string;
}> {
  return fetchGatewayBalancesForDepositors([address]);
}

export async function getOrCreateGatewayFundingWallet(
  userWalletAddress: string,
): Promise<GatewayFundingWallet> {
  const normalizedUserWallet = normalizeAddressOrThrow(userWalletAddress, 'walletAddress');
  const circleWalletMod = await import('./circleWallet');
  const walletStoreMod = await import('./walletStore');

  const existing = await circleWalletMod.findCircleWalletForUser(normalizedUserWallet);
  if (existing?.walletId && existing.address) {
    return {
      walletId: String(existing.walletId),
      address: getAddress(existing.address),
    };
  }

  await circleWalletMod.getOrCreateWalletSetId();
  const created = await circleWalletMod.createUserWallet(normalizedUserWallet);
  walletStoreMod.setWalletForUser(normalizedUserWallet, {
    circleWalletId: created.id,
    circleWalletAddress: created.address,
  });

  return {
    walletId: String(created.id),
    address: getAddress(created.address),
  };
}
