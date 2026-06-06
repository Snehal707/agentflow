function normalizeAppBase(value: string | undefined): string {
  const raw = value?.trim() || 'https://agentflow.one';
  return raw.replace(/\/+$/, '');
}

export const APP_BASE_URL = normalizeAppBase(
  process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL,
);

export function appUrl(path = '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${APP_BASE_URL}${normalizedPath}`;
}

export const APP_URLS = {
  home: APP_BASE_URL,
  chat: appUrl('/chat'),
  funds: appUrl('/funds'),
  pay: appUrl('/pay'),
  portfolio: appUrl('/portfolio'),
  settings: appUrl('/settings'),
} as const;
