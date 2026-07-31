/** Google Workspace is one OAuth app, three independently toggleable MCP surfaces. */

export const GOOGLE_SERVICE_IDS = ['gmail', 'calendar', 'drive'] as const;
export type GoogleServiceId = (typeof GOOGLE_SERVICE_IDS)[number];

export function isGoogleServiceId(id: string): id is GoogleServiceId {
  return (GOOGLE_SERVICE_IDS as readonly string[]).includes(id);
}

/** True when any Google surface (or legacy `google`) is requested. */
export function wantsGoogleToken(integrations: string[]): boolean {
  return integrations.some((id) => {
    const key = String(id || '').trim().toLowerCase();
    return key === 'google' || isGoogleServiceId(key);
  });
}

/**
 * Expand legacy per-chat `google` into gmail+calendar+drive.
 * Leaves Notion/GitHub/other ids untouched.
 */
export function normalizeGoogleIntegrations(integrations: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let expandAll = false;

  for (const raw of integrations) {
    const id = String(raw || '').trim().toLowerCase();
    if (!id) continue;
    if (id === 'google') {
      expandAll = true;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  if (expandAll) {
    for (const service of GOOGLE_SERVICE_IDS) {
      if (seen.has(service)) continue;
      seen.add(service);
      out.push(service);
    }
  }

  return out;
}

export function enabledGoogleServices(integrations: string[]): GoogleServiceId[] {
  const normalized = new Set(normalizeGoogleIntegrations(integrations));
  return GOOGLE_SERVICE_IDS.filter((service) => normalized.has(service));
}

export function isGoogleMcpId(id: string): boolean {
  const key = String(id || '').trim().toLowerCase();
  return key === 'google' || isGoogleServiceId(key);
}
