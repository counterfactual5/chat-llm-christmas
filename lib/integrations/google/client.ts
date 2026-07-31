/**
 * Shared edge-safe Google API transport.
 * Service-specific Gmail, Calendar, and Drive wrappers build on these helpers.
 */

export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export type GoogleRestJson = Record<string, unknown>;

export function googleAuthHeaders(
  accessToken: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...extra,
  };
}

export async function readGoogleError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // Ignore non-JSON API error bodies.
  }
  return text.slice(0, 280) || response.statusText || `HTTP ${response.status}`;
}

export async function googleGetJson(
  url: string,
  accessToken: string,
): Promise<GoogleRestJson> {
  const response = await fetch(url, {
    method: 'GET',
    headers: googleAuthHeaders(accessToken),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await readGoogleError(response));
  return (await response.json()) as GoogleRestJson;
}

export async function googleSendJson(
  url: string,
  accessToken: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<GoogleRestJson | null> {
  const response = await fetch(url, {
    method,
    headers: googleAuthHeaders(
      accessToken,
      body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    ),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await readGoogleError(response));
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as GoogleRestJson;
}
