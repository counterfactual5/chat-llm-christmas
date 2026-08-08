import { describe, expect, it, vi } from 'vitest';
import {
  applyLiveProbe,
  enrichSnapshotWithLiveProbes,
  probeProviderLiveStatus,
  type IntegrationStatus,
} from '@/lib/chat/integrations/client';
import { isIntegrationUsable, OAUTH_MCP_PROVIDERS } from '@/lib/chat/integrations/oauth-health';

function connectedStatus(
  overrides: Partial<IntegrationStatus> = {},
): IntegrationStatus {
  return {
    connected: true,
    available: true,
    label: 'user@example.com',
    ...overrides,
  };
}

describe('OAUTH_MCP_PROVIDERS registry', () => {
  it('registers notion, github, and google with probe paths', () => {
    expect(OAUTH_MCP_PROVIDERS.map((p) => p.id).sort()).toEqual([
      'github',
      'google',
      'notion',
    ]);
    for (const p of OAUTH_MCP_PROVIDERS) {
      expect(p.probePath).toMatch(new RegExp(`/api/integrations/${p.id}/probe`));
      expect(p.startPath).toMatch(new RegExp(`/api/integrations/${p.id}/start`));
    }
  });
});

describe('probeProviderLiveStatus', () => {
  it('maps 401 to needs_reconnect for any registered provider', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    await expect(probeProviderLiveStatus('notion', fetchImpl)).resolves.toEqual({
      kind: 'needs_reconnect',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/integrations/notion/probe',
      expect.anything(),
    );
  });

  it('maps usable:false to needs_reconnect', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ usable: false, connected: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(probeProviderLiveStatus('github', fetchImpl)).resolves.toEqual({
      kind: 'needs_reconnect',
    });
  });

  it('maps usable:true to ok', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ usable: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(probeProviderLiveStatus('google', fetchImpl)).resolves.toEqual({
      kind: 'ok',
    });
  });

  it('maps 5xx and network errors to inconclusive', async () => {
    await expect(
      probeProviderLiveStatus('google', vi.fn(async () => new Response('boom', { status: 503 }))),
    ).resolves.toEqual({ kind: 'inconclusive' });
    await expect(
      probeProviderLiveStatus(
        'google',
        vi.fn(async () => {
          throw new Error('offline');
        }),
      ),
    ).resolves.toEqual({ kind: 'inconclusive' });
  });
});

describe('applyLiveProbe / isIntegrationUsable', () => {
  it('sets needsReconnect on auth failure while keeping connected', () => {
    const next = applyLiveProbe(connectedStatus(), { kind: 'needs_reconnect' });
    expect(next.needsReconnect).toBe(true);
    expect(isIntegrationUsable(next)).toBe(false);
  });

  it('clears needsReconnect on ok', () => {
    const next = applyLiveProbe(connectedStatus({ needsReconnect: true }), {
      kind: 'ok',
    });
    expect(next.needsReconnect).toBe(false);
    expect(isIntegrationUsable(next)).toBe(true);
  });

  it('leaves status unchanged on inconclusive', () => {
    const prev = connectedStatus({ needsReconnect: true });
    expect(applyLiveProbe(prev, { kind: 'inconclusive' })).toBe(prev);
  });
});

describe('enrichSnapshotWithLiveProbes', () => {
  it('probes each connected provider in the registry', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/notion/probe')) {
        return new Response(JSON.stringify({ usable: false }), { status: 200 });
      }
      if (String(url).includes('/github/probe')) {
        return new Response(JSON.stringify({ usable: true }), { status: 200 });
      }
      if (String(url).includes('/google/probe')) {
        return new Response('nope', { status: 401 });
      }
      return new Response('miss', { status: 404 });
    });

    const next = await enrichSnapshotWithLiveProbes(
      {
        notion: connectedStatus({ label: 'Notion' }),
        github: connectedStatus({ label: 'octocat' }),
        google: connectedStatus({ label: 'g@x.com' }),
      },
      fetchImpl as typeof fetch,
    );

    expect(next.notion?.needsReconnect).toBe(true);
    expect(next.github?.needsReconnect).toBe(false);
    expect(next.google?.needsReconnect).toBe(true);
  });

  it('skips probe when vault says disconnected', async () => {
    const fetchImpl = vi.fn();
    const next = await enrichSnapshotWithLiveProbes(
      {
        notion: { connected: false, available: true },
        github: null,
        google: null,
      },
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(next.notion?.needsReconnect).toBeUndefined();
  });
});
