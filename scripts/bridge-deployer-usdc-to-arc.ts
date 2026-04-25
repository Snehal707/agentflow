import dotenv from 'dotenv';
import { BridgeKit, ArcTestnet, EthereumSepolia } from '@circle-fin/bridge-kit';
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2';
import { createPublicClient, defineChain, formatEther, formatUnits, getAddress, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config();

const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

function toViemChain(definition: typeof EthereumSepolia) {
  return defineChain({
    id: definition.chainId,
    name: definition.name,
    nativeCurrency: definition.nativeCurrency,
    rpcUrls: {
      default: {
        http: definition.rpcEndpoints.length > 0 ? [...definition.rpcEndpoints] : ['https://rpc.sepolia.org'],
      },
    },
  });
}

function makeJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => makeJsonSafe(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, makeJsonSafe(val)]),
    );
  }
  return String(value);
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  const privateKey = normalizePrivateKey(requireEnv('DEPLOYER_PRIVATE_KEY'));
  const account = privateKeyToAccount(privateKey);
  const recipientAddress = getAddress(process.env.BRIDGE_RECIPIENT?.trim() || account.address);

  const sourceChain = toViemChain(EthereumSepolia);
  const sourceClient = createPublicClient({
    chain: sourceChain,
    transport: http(EthereumSepolia.rpcEndpoints[0]),
  });

  const sourceUsdcAddress = getAddress(
    EthereumSepolia.usdcAddress || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  );

  const [nativeBalanceRaw, usdcBalanceRaw] = await Promise.all([
    sourceClient.getBalance({ address: account.address }),
    sourceClient.readContract({
      address: sourceUsdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }) as Promise<bigint>,
  ]);

  const amountRawEnv = process.env.BRIDGE_AMOUNT?.trim();
  const amountRaw =
    amountRawEnv && amountRawEnv.toLowerCase() !== 'all'
      ? BigInt(Math.round(Number(amountRawEnv) * 1_000_000))
      : usdcBalanceRaw;

  if (amountRaw <= 0n) {
    throw new Error(
      `No official Sepolia USDC found on deployer wallet ${account.address}. Checked token ${sourceUsdcAddress}.`,
    );
  }

  const amount = formatUnits(amountRaw, 6);
  const adapter = createViemAdapterFromPrivateKey({ privateKey });
  const kit = new BridgeKit();

  /**
   * Viem adapter: signer addresses come from the private key — omit `from.address` / `to.address`.
   */
  const params = {
    from: {
      adapter,
      chain: EthereumSepolia.chain,
    },
    to: {
      adapter,
      chain: ArcTestnet.chain,
      recipientAddress,
    },
    amount,
    token: 'USDC' as const,
  };

  console.log('[bridge-deployer] config');
  console.log(
    JSON.stringify(
      {
        dryRun: isDryRun,
        deployerAddress: account.address,
        recipientAddress,
        sourceChain: EthereumSepolia.chain,
        destinationChain: ArcTestnet.chain,
        sourceUsdcAddress,
        nativeBalance: formatEther(nativeBalanceRaw),
        usdcBalance: formatUnits(usdcBalanceRaw, 6),
        bridgeAmount: amount,
      },
      null,
      2,
    ),
  );

  const estimate = await kit.estimate(params);
  console.log('[bridge-deployer] estimate');
  console.log(JSON.stringify(makeJsonSafe(estimate), null, 2));

  if (isDryRun) {
    console.log('[bridge-deployer] dry run complete');
    return;
  }

  const result = await kit.bridge(params);
  console.log('[bridge-deployer] result');
  console.log(JSON.stringify(makeJsonSafe(result), null, 2));
}

main().catch((error) => {
  console.error('[bridge-deployer] Fatal:', error);
  process.exit(1);
});
