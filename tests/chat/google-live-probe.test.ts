import { describe, expect, it, vi } from 'vitest';
import {
  applyGoogleLiveProbe,
  probeGoogleLiveStatus,
  type IntegrationStatus,
} from '@/lib/chat/integrations/client';

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

describe('probeGoogleLiveStatus', () => {
  it('maps 401 to needs_reconnect', async () => {
    const fetchImpl = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    await expect(probeGoogleLiveStatus(fetchImpl)).resolves.toEqual({
      kind: 'needs_reconnect',
    });
  });

  it('maps usable:false to needs_reconnect', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ usable: false, connected: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(probeGoogleLiveStatus(fetchImpl)).resolves.toEqual({
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
    await expect(probeGoogleLiveStatus(fetchImpl)).resolves.toEqual({ kind: 'ok' });
  });

  it('maps 5xx to inconclusive', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }));
    await expect(probeGoogleLiveStatus(fetchImpl)).resolves.toEqual({
      kind: 'inconclusive',
    });
  });

  it('maps network errors to inconclusive', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(probeGoogleLiveStatus(fetchImpl)).resolves.toEqual({
      kind: 'inconclusive',
    });
  });
});

describe('applyGoogleLiveProbe', () => {
  it('sets needsReconnect on auth failure while keeping connected', () => {
    const next = applyGoogleLiveProbe(connectedStatus(), { kind: 'needs_reconnect' });
    expect(next).toEqual({
      connected: true,
      available: true,
      label: 'user@example.com',
      needsReconnect: true,
    });
  });

  it('clears needsReconnect on ok', () => {
    const next = applyGoogleLiveProbe(
      connectedStatus({ needsReconnect: true }),
      { kind: 'ok' },
    );
    expect(next.needsReconnect).toBe(false);
  });

  it('leaves status unchanged on inconclusive', () => {
    const prev = connectedStatus({ needsReconnect: true });
    expect(applyGoogleLiveProbe(prev, { kind: 'inconclusive' })).toBe(prev);
  });

  it('does not mark reconnect when vault is disconnected', () => {
    const next = applyGoogleLiveProbe(
      { connected: false, available: true },
      { kind: 'needs_reconnect' },
    );
    expect(next.needsReconnect).toBe(false);
  });
});
