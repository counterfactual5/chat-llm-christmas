import type { NextRequest } from 'next/server';

const API_KEY_COOKIE = 'llm_chat_api_key';

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Stable per-account id derived from the bound llm.christmas API key.
 * Integration tokens are never shared across different keys.
 */
export async function resolveOwnerId(req: NextRequest): Promise<string | null> {
  const apiKey = req.cookies.get(API_KEY_COOKIE)?.value?.trim() || '';
  if (!apiKey.startsWith('sk-') || apiKey.length < 20) return null;
  return sha256Hex(`llm_chat_owner:v1:${apiKey}`);
}

export function integrationsSecret(): string {
  return (
    process.env.INTEGRATIONS_ENCRYPTION_KEY ||
    process.env.CHAT_SSO_SECRET ||
    ''
  ).trim();
}
