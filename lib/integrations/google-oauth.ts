import type { GoogleConnection } from '@/lib/integrations/types';

/**
 * Google Workspace official hosted MCP servers (Streamable HTTP).
 * See: https://developers.google.com/workspace/mcp  + gmailmcp/calendarmcp/drivemcp
 *
 * Endpoints discovered via the community `google-official-mcp-oauth` adapter
 * (redwheeler3). They speak Streamable HTTP MCP and accept a Google OAuth
 * Bearer token, exactly like the GitHub MCP pattern already in this app.
 */
export const GOOGLE_MCP_SERVERS = {
  gmail: {
    name: 'Gmail',
    url: 'https://gmailmcp.googleapis.com/mcp/v1',
    /** Read + compose + send + labels (modify). Remove `gmail.send` for drafts-only. */
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
    ],
  },
  calendar: {
    name: 'Calendar',
    url: 'https://calendarmcp.googleapis.com/mcp/v1',
    scopes: ['https://www.googleapis.com/auth/calendar'],
  },
  drive: {
    name: 'Drive',
    url: 'https://drivemcp.googleapis.com/mcp/v1',
    scopes: ['https://www.googleapis.com/auth/drive'],
  },
} as const;

export type GoogleService = keyof typeof GOOGLE_MCP_SERVERS;

/**
 * Whether the server has Google OAuth credentials. Google uses ONE OAuth app
 * for all three services, so a single client_id/secret covers Gmail+Calendar+Drive.
 */
export function googleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
  );
}

export function googleOAuthRedirectUri(reqUrl: string): string {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const origin = new URL(reqUrl).origin;
  return `${origin}/api/integrations/google/callback`;
}

/** All scopes across the enabled services (Gmail + Calendar + Drive). */
export function googleOAuthScopes(): string {
  const fromEnv = process.env.GOOGLE_OAUTH_SCOPES?.trim();
  if (fromEnv) return fromEnv;
  return Object.values(GOOGLE_MCP_SERVERS)
    .flatMap((s) => s.scopes)
    .join(' ');
}

export function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function oauthStateSecret(): string {
  return (
    process.env.INTEGRATIONS_ENCRYPTION_KEY ||
    process.env.CHAT_SSO_SECRET ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    ''
  ).trim();
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

/**
 * Signed OAuth state that embeds ownerId. Survives the Google round-trip without
 * relying on a browser cookie (many browsers drop Set-Cookie on cross-site 302).
 */
export async function createSignedGoogleOAuthState(ownerId: string): Promise<string> {
  const secret = oauthStateSecret();
  if (!secret || secret.length < 16) {
    throw new Error('OAuth state signing secret is missing.');
  }
  const nonce = generateOAuthState().slice(0, 24);
  const payload = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ o: ownerId, t: Date.now(), n: nonce }),
    ),
  );
  const sig = await hmacSha256Base64Url(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySignedGoogleOAuthState(
  state: string,
  ownerId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const secret = oauthStateSecret();
  if (!secret || secret.length < 16) {
    return { ok: false, reason: 'signing secret missing' };
  }
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'state format invalid' };
  }
  const [payload, sig] = parts;
  const expected = await hmacSha256Base64Url(secret, payload);
  if (sig.length !== expected.length) return { ok: false, reason: 'state signature mismatch' };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: 'state signature mismatch' };

  try {
    const raw = new TextDecoder().decode(base64UrlToBytes(payload));
    const data = JSON.parse(raw) as { o?: string; t?: number };
    if (!data.o || data.o !== ownerId) return { ok: false, reason: 'state owner mismatch' };
    if (typeof data.t !== 'number' || Date.now() - data.t > 10 * 60 * 1000) {
      return { ok: false, reason: 'state expired' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'state payload invalid' };
  }
}

export function buildGoogleAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: googleOAuthScopes(),
    state: opts.state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

export async function exchangeGoogleCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Google token exchange failed (${response.status})`,
    );
  }
  return payload;
}

export async function refreshGoogleToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Google token refresh failed (${response.status})`,
    );
  }
  return payload;
}

export function googleConnectionFromToken(
  token: GoogleTokenResponse,
  email?: string,
  prev?: Partial<GoogleConnection>,
): GoogleConnection {
  const expiresIn = typeof token.expires_in === 'number' ? token.expires_in : 3600;
  return {
    authKind: 'oauth',
    accessToken: token.access_token,
    refreshToken: token.refresh_token || prev?.refreshToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    tokenType: token.token_type || 'Bearer',
    scope: token.scope || prev?.scope,
    email: email || prev?.email,
    connectedAt: prev?.connectedAt || Date.now(),
  };
}

/** Fetch the Google account email from the userinfo endpoint (lightweight). */
export async function fetchGoogleEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { email?: string };
    return data.email ? String(data.email) : undefined;
  } catch {
    return undefined;
  }
}
