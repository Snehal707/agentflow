import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '@/lib/backendProxy';

export async function POST(req: NextRequest) {
  return proxyBackendRequest(req, '/api/wallet/gateway/to-execution');
}
