/**
 * Pure registry for side-Preview kind keep-alive (active + one previous).
 * Visibility / abort policy lives in panels + the React hook.
 */

export type PreviewKind = 'url' | 'file' | 'view';

export type PreviewRegistryEntry = {
  kind: PreviewKind;
  /** Stable identity for the slot (url / fileId / viewId[+messageId]). */
  identity: string;
};

export type PreviewWorkspaceRegistry = {
  active: PreviewRegistryEntry | null;
  /** Hidden keep-alive; at most one. */
  previous: PreviewRegistryEntry | null;
};

export function emptyPreviewWorkspaceRegistry(): PreviewWorkspaceRegistry {
  return { active: null, previous: null };
}

/**
 * Activate `next`. If it matches active identity, no-op.
 * Former active becomes previous (LRU N=2); old previous is dropped.
 */
export function activatePreviewTarget(
  prev: PreviewWorkspaceRegistry,
  next: PreviewRegistryEntry | null,
): PreviewWorkspaceRegistry {
  if (!next) {
    return { active: null, previous: null };
  }
  if (
    prev.active &&
    prev.active.kind === next.kind &&
    prev.active.identity === next.identity
  ) {
    return prev;
  }
  // Re-activating the previous slot: swap.
  if (
    prev.previous &&
    prev.previous.kind === next.kind &&
    prev.previous.identity === next.identity
  ) {
    return {
      active: next,
      previous: prev.active,
    };
  }
  return {
    active: next,
    previous: prev.active,
  };
}

/** Entries that should stay mounted (active first, then previous if distinct). */
export function mountedPreviewEntries(
  reg: PreviewWorkspaceRegistry,
): PreviewRegistryEntry[] {
  const out: PreviewRegistryEntry[] = [];
  if (reg.active) out.push(reg.active);
  if (
    reg.previous &&
    !(
      reg.active &&
      reg.active.kind === reg.previous.kind &&
      reg.active.identity === reg.previous.identity
    )
  ) {
    out.push(reg.previous);
  }
  return out;
}
