import dotenv from 'dotenv';
import { getAddress } from 'viem';
import { fetchGatewayBalanceForAddress } from '../lib/gateway-balance';

dotenv.config();

async function show(label: string, addr: string) {
  try {
    const b = await fetchGatewayBalanceForAddress(getAddress(addr as `0x${string}`));
    console.log(`${label.padEnd(16)} ${addr}  available=${b.available}  total=${b.total}`);
  } catch (e) {
    console.log(`${label.padEnd(16)} ${addr}  ERROR: ${e instanceof Error ? e.message : e}`);
  }
}

(async () => {
  console.log('Gateway API:', process.env.GATEWAY_API_BASE_URL || 'https://gateway-api-testnet.circle.com/v1');
  console.log('Arc domain :', process.env.GATEWAY_DOMAIN || '26 (default)');
  console.log('price needed: 0.009 USDC\n');
  await show('EOA (test)', '0xb82ae74138acdcd2045b66984990eed0559ec769');
  await show('DCW exec', '0x0868ebd6c963C30e6aF346dbE76A98B22D75e1ac');
  await show('seller/payTo', '0x79FD75a3fC633259aDD60885f927d973d3A3642b');
})().then(() => process.exit(0));
