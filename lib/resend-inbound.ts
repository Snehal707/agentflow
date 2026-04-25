/**
 * Resolve a short-lived HTTPS URL for an inbound-email attachment (Resend).
 * Used by the invoice webhook and /run/email when only email_id + attachment ids are known.
 */
export async function fetchResendAttachmentDownloadUrl(
  emailId: string,
  attachmentId: string,
): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('[resend-inbound] RESEND_API_KEY is required');
  }

  const base = (process.env.RESEND_API_BASE_URL || 'https://api.resend.com').replace(/\/+$/, '');
  const path = `${base}/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`;

  const res = await fetch(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'manual',
  });

  if (res.status === 302 || res.status === 301) {
    const loc = res.headers.get('location');
    if (loc) {
      return loc;
    }
  }

  if (res.ok) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const j = (await res.json()) as { url?: string; download_url?: string };
      if (typeof j.url === 'string') {
        return j.url;
      }
      if (typeof j.download_url === 'string') {
        return j.download_url;
      }
    }
  }

  const text = await res.text().catch(() => '');
  throw new Error(
    `[resend-inbound] Attachment fetch failed: HTTP ${res.status} ${text.slice(0, 200)}`,
  );
}
