import dotenv from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ARC } from '../lib/arc-config';

dotenv.config();

const TARGET_APY_BPS = 500n;

async function main(): Promise<void> {
  const vaultAddress = requireAddress(
    process.env.VAULT_CONTRACT_ADDRESS?.trim(),
    'VAULT_CONTRACT_ADDRESS',
  );
  const account = privateKeyToAccount(requirePrivateKey('DEPLOYER_PRIVATE_KEY'));

  const publicClient = createPublicClient({
    chain,
    transport: http(ARC.rpc),
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(ARC.rpc),
  });

  const [owner, beforeApyBps] = await Promise.all([
    publicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: 'owner',
    }) as Promise<`0x${string}`>,
    publicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: 'apyBps',
    }) as Promise<bigint>,
  ]);

  console.log('[set-vault-apy] before');
  console.log(
    JSON.stringify(
      {
        vaultAddress,
        deployer: account.address,
        owner,
        apyBpsBefore: beforeApyBps.toString(),
      },
      null,
      2,
    ),
  );

  if (getAddress(owner) !== getAddress(account.address)) {
    throw new Error(
      `[set-vault-apy] DEPLOYER_PRIVATE_KEY does not own the vault. owner=${owner} deployer=${account.address}`,
    );
  }

  const hash = await walletClient.writeContract({
    account,
    chain,
    address: vaultAddress,
    abi: vaultAbi,
    functionName: 'setApyBps',
    args: [TARGET_APY_BPS],
  });

  console.log('[set-vault-apy] submitted');
  console.log(
    JSON.stringify(
      {
        targetApyBps: TARGET_APY_BPS.toString(),
        txHash: hash,
        explorerLink: `${explorerBase}${hash}`,
      },
      null,
      2,
    ),
  );

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const afterApyBps = (await publicClient.readContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: 'apyBps',
  })) as bigint;

  console.log('[set-vault-apy] after');
  console.log(
    JSON.stringify(
      {
        receiptStatus: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        apyBpsAfter: afterApyBps.toString(),
      },
      null,
      2,
    ),
  );

  if (afterApyBps !== TARGET_APY_BPS) {
    throw new Error(
      `[set-vault-apy] Verification failed: expected ${TARGET_APY_BPS} got ${afterApyBps}`,
    );
  }
}

const chain = defineChain({
  id: ARC.chainId,
  name: ARC.blockchain,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});

const vaultAbi = parseAbi([
  'function owner() view returns (address)',
  'function apyBps() view returns (uint256)',
  'function setApyBps(uint256 bps)',
]);

const explorerBase =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';

function requirePrivateKey(name: string): `0x${string}` {
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(`[set-vault-apy] Missing ${name}`);
  }
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`;
}

function requireAddress(value: string | undefined, name: string): `0x${string}` {
  if (!value) {
    throw new Error(`[set-vault-apy] Missing ${name}`);
  }
  return getAddress(value) as `0x${string}`;
}

main().catch((error) => {
  console.error('[set-vault-apy] Fatal:', error);
  process.exit(1);
});
