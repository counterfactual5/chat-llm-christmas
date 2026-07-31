/**
 * Google Workspace REST helpers (Gmail / Calendar / Drive).
 * Edge-safe fetch wrappers — no MCP / developer-preview gate.
 */

import { calendarListCalendars } from '@/lib/integrations/google/calendar';
import { driveSearchFiles } from '@/lib/integrations/google/drive';
import { gmailListLabels } from '@/lib/integrations/google/gmail';
import {
  googleGetJson,
  googleSendJson,
  type GoogleRestJson,
} from '@/lib/integrations/google/client';

export {
  googleGetJson,
  googleSendJson,
  type GoogleRestJson,
} from '@/lib/integrations/google/client';

// Gmail helpers live in their own service module; keep this facade stable for existing callers.
export * from '@/lib/integrations/google/gmail';

// Calendar helpers live in their own service module; keep this facade stable for existing callers.
export * from '@/lib/integrations/google/calendar';

// Drive helpers live in their own service module; keep this facade stable for existing callers.
export * from '@/lib/integrations/google/drive';

/** Lightweight connectivity probe used by /api/integrations/google/probe. */
export async function probeGoogleApis(accessToken: string): Promise<
  Array<{ service: 'gmail' | 'calendar' | 'drive'; ok: boolean; error?: string }>
> {
  const checks: Array<{
    service: 'gmail' | 'calendar' | 'drive';
    run: () => Promise<unknown>;
  }> = [
    { service: 'gmail', run: () => gmailListLabels(accessToken) },
    { service: 'calendar', run: () => calendarListCalendars(accessToken) },
    {
      service: 'drive',
      run: () => driveSearchFiles(accessToken, { pageSize: 1 }),
    },
  ];
  const results = [];
  for (const check of checks) {
    try {
      await check.run();
      results.push({ service: check.service, ok: true });
    } catch (err: unknown) {
      results.push({
        service: check.service,
        ok: false,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    }
  }
  return results;
}
