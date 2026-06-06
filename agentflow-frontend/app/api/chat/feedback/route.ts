import { proxyBackendRequest } from "@/lib/backendProxy";

export async function POST(request: Request) {
  return proxyBackendRequest(request, "/api/chat/feedback");
}
