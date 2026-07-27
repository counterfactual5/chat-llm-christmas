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

export async function fetchUsernameForApiKey(apiKey: string): Promise<string | null> {
  const origin = mainApiOrigin();
  const urls = [
    `${origin}/api/user/self`,
    `${origin}/api/user/profile`,
    'https://llm.christmas/api/user/self',
    'https://llm.christmas/portal/chat/user',
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
  return null;
}

export function usernameFromTokenPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  return pickUsername(d) || pickUsername(d.user) || pickUsername(d.profile);
}
