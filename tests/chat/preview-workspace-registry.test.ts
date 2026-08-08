import { describe, expect, it } from 'vitest';
import {
  activatePreviewTarget,
  emptyPreviewWorkspaceRegistry,
  mountedPreviewEntries,
} from '@/lib/chat/preview-workspace-registry';

describe('preview-workspace-registry', () => {
  it('activates first target with empty previous', () => {
    const next = activatePreviewTarget(emptyPreviewWorkspaceRegistry(), {
      kind: 'url',
      identity: 'https://a',
    });
    expect(next.active).toEqual({ kind: 'url', identity: 'https://a' });
    expect(next.previous).toBeNull();
  });

  it('keeps previous when switching kind', () => {
    let reg = activatePreviewTarget(emptyPreviewWorkspaceRegistry(), {
      kind: 'url',
      identity: 'https://a',
    });
    reg = activatePreviewTarget(reg, { kind: 'file', identity: 'f1' });
    expect(reg.active).toEqual({ kind: 'file', identity: 'f1' });
    expect(reg.previous).toEqual({ kind: 'url', identity: 'https://a' });
    expect(mountedPreviewEntries(reg)).toHaveLength(2);
  });

  it('evicts oldest when activating a third distinct target', () => {
    let reg = activatePreviewTarget(emptyPreviewWorkspaceRegistry(), {
      kind: 'url',
      identity: 'https://a',
    });
    reg = activatePreviewTarget(reg, { kind: 'file', identity: 'f1' });
    reg = activatePreviewTarget(reg, { kind: 'view', identity: 'v1' });
    expect(reg.active).toEqual({ kind: 'view', identity: 'v1' });
    expect(reg.previous).toEqual({ kind: 'file', identity: 'f1' });
    expect(mountedPreviewEntries(reg).map((e) => e.identity)).toEqual([
      'v1',
      'f1',
    ]);
  });

  it('swaps when re-activating previous', () => {
    let reg = activatePreviewTarget(emptyPreviewWorkspaceRegistry(), {
      kind: 'url',
      identity: 'https://a',
    });
    reg = activatePreviewTarget(reg, { kind: 'file', identity: 'f1' });
    reg = activatePreviewTarget(reg, { kind: 'url', identity: 'https://a' });
    expect(reg.active).toEqual({ kind: 'url', identity: 'https://a' });
    expect(reg.previous).toEqual({ kind: 'file', identity: 'f1' });
  });

  it('replaces same-kind identity without keeping stale previous of same slot', () => {
    let reg = activatePreviewTarget(emptyPreviewWorkspaceRegistry(), {
      kind: 'url',
      identity: 'https://a',
    });
    reg = activatePreviewTarget(reg, { kind: 'url', identity: 'https://b' });
    expect(reg.active?.identity).toBe('https://b');
    expect(reg.previous?.identity).toBe('https://a');
  });

  it('clearing target empties registry', () => {
    let reg = activatePreviewTarget(emptyPreviewWorkspaceRegistry(), {
      kind: 'file',
      identity: 'f1',
    });
    reg = activatePreviewTarget(reg, null);
    expect(reg).toEqual(emptyPreviewWorkspaceRegistry());
  });
});
