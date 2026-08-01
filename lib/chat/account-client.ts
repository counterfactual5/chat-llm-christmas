/**
 * Client account status against `/api/account`.
 * No React — reusable from hooks, tests, or one-off scripts.
 */

export type AccountStatus = {
  bound: boolean;
  username: string | null;
};

export async function fetchAccountStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<AccountStatus> {
  try {
    const response = await fetchImpl('/api/account', { cache: 'no-store' });
    const data = await response.json();
    const bound = Boolean(data?.bound);
    const username = bound && data?.username ? String(data.username) : null;
    return { bound, username };
  } catch {
    return { bound: false, username: null };
  }
}

export async function bindAccountApiKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ username?: string }> {
  const response = await fetchImpl('/api/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || '绑定失败');
  return data;
}

export async function unbindAccount(fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl('/api/account', { method: 'DELETE' });
}
