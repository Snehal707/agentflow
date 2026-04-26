import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '@/lib/backendProxy';

export async function GET(req: NextRequest) {
  return proxyBackendRequest(req, '/api/wallet/all-balances');
}
