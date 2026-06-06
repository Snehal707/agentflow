function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getBrowserBackendUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
  return `${normalizeBaseUrl(base)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function fetchBrowserApi(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("/") ? path : `/${path}`;
  return fetch(url, init);
}
