/** Origin for New API / one-api style routes (no /v1 suffix). */
export function mainApiOrigin(): string {
  const base = (process.env.LLM_CHRISTMAS_BASE_URL || 'https://api.llm.christmas/v1').replace(
    /\/$/,
    '',
  );
  return base.replace(/\/v1$/i, '');
}

export function pickUsername(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const u = user as Record<string, unknown>;
  const name =
    u.username ||
    u.user_name ||
    u.display_name ||
    u.displayName ||
    u.real_name ||
    u.nickname ||
    u.name ||
    u.email ||
    (u.id != null ? `User #${u.id}` : '');
  return name ? String(name).trim().slice(0, 120) : null;
}

export async function fetchUsernameViaPortalSso(apiKey: string): Promise<string | null> {
  const secret = (process.env.CHAT_SSO_SECRET || '').trim();
  if (!secret) return null;

  const attempts: Array<{ url: string; method: 'GET' | 'POST'; body?: string }> = [
    { url: 'https://llm.christmas/portal/chat/user', method: 'GET' },
    { url: 'https://llm.christmas/portal/chat/user', method: 'POST', body: JSON.stringify({ apiKey }) },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        method: attempt.method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Chat-SSO-Secret': secret,
          Authorization: `Bearer ${apiKey}`,
        },
        body: attempt.method === 'POST' ? attempt.body : undefined,
        cache: 'no-store',
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload?.success === false) continue;
      const name = usernameFromTokenPayload(payload?.data ?? payload);
      if (name) return name;
    } catch {
      // try next
    }
  }
  return null;
}

export async function fetchUsernameForApiKey(apiKey: string): Promise<string | null> {
  const origin = mainApiOrigin();
  const urls = [
    'https://llm.christmas/api/user/self',
    `${origin}/api/user/self`,
    `${origin}/api/user/profile`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload?.success === false) continue;
      const user = payload?.data ?? payload?.user ?? payload;
      let name = pickUsername(user);
      if (!name && user && typeof user === 'object') {
        const nested = (user as Record<string, unknown>).data;
        name = pickUsername(nested);
      }
      if (name) return name;
    } catch {
      // try next URL
    }
  }

  return fetchUsernameViaPortalSso(apiKey);
}

export function usernameFromTokenPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const direct = pickUsername(d) || pickUsername(d.user) || pickUsername(d.profile) || pickUsername(d.account);
  if (direct) return direct;
  for (const value of Object.values(d)) {
    if (value && typeof value === 'object') {
      const nested = pickUsername(value);
      if (nested) return nested;
    }
  }
  return null;
}
