/**
 * Build-time backend URL. Must be allowed under manifest `host_permissions`
 * (add your production API origin before Web Store upload).
 */
export function getBackendUrl(): string {
  return (import.meta.env.VITE_BACKEND_URL || "http://localhost:4000").replace(
    /\/+$/,
    "",
  );
}

/** Marketing site for upgrade / account flows */
export function getWebOrigin(): string {
  return (import.meta.env.VITE_WEB_ORIGIN || "https://agentflow.one").replace(
    /\/+$/,
    "",
  );
}
