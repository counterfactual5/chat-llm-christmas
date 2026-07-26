import type { NotionConnection } from '@/lib/integrations/types';

export function notionOAuthConfigured(): boolean {
  return Boolean(
    process.env.NOTION_CLIENT_ID?.trim() &&
      process.env.NOTION_CLIENT_SECRET?.trim(),
  );
}

export function notionRedirectUri(reqUrl: string): string {
  const configured = process.env.NOTION_REDIRECT_URI?.trim();
  if (configured) return configured;
  const origin = new URL(reqUrl).origin;
  return `${origin}/api/integrations/notion/callback`;
}

export function buildNotionAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL('https://api.notion.com/v1/oauth/authorize');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('owner', 'user');
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('state', opts.state);
  return url.toString();
}

export type NotionTokenResponse = {
  access_token: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string;
  workspace_icon?: string | null;
};

export async function exchangeNotionCode(opts: {
  code: string;
  redirectUri: string;
}): Promise<NotionTokenResponse> {
  const clientId = process.env.NOTION_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.NOTION_CLIENT_SECRET?.trim() || '';
  if (!clientId || !clientSecret) {
    throw new Error('Notion OAuth is not configured on the server.');
  }

  const basic = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
    cache: 'no-store',
  });

  const payload = (await response.json()) as NotionTokenResponse & {
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.message || payload.error || 'Notion token exchange failed');
  }
  return payload;
}

export function notionConnectionFromToken(token: NotionTokenResponse): NotionConnection {
  return {
    accessToken: token.access_token,
    botId: token.bot_id,
    workspaceId: token.workspace_id,
    workspaceName: token.workspace_name,
    workspaceIcon: token.workspace_icon ?? null,
    connectedAt: Date.now(),
  };
}
