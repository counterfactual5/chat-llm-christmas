'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  activatePreviewTarget,
  emptyPreviewWorkspaceRegistry,
  mountedPreviewEntries,
  type PreviewKind,
  type PreviewRegistryEntry,
  type PreviewWorkspaceRegistry,
} from '@/lib/chat/preview-workspace-registry';

export type PreviewWorkspaceTarget =
  | { kind: 'file'; identity: string }
  | { kind: 'view'; identity: string }
  | { kind: 'url'; identity: string }
  | null;

function toEntry(target: PreviewWorkspaceTarget): PreviewRegistryEntry | null {
  if (!target) return null;
  return { kind: target.kind, identity: target.identity };
}

/**
 * Keep at most active + one previous Preview kind mounted for soft-hide.
 */
export function usePreviewWorkspaceRegistry(target: PreviewWorkspaceTarget) {
  const [registry, setRegistry] = useState<PreviewWorkspaceRegistry>(
    emptyPreviewWorkspaceRegistry,
  );

  useEffect(() => {
    setRegistry((prev) => activatePreviewTarget(prev, toEntry(target)));
  }, [target?.kind, target?.identity]);

  const mounted = useMemo(() => mountedPreviewEntries(registry), [registry]);

  const isActive = (kind: PreviewKind, identity: string) =>
    Boolean(
      registry.active &&
        registry.active.kind === kind &&
        registry.active.identity === identity,
    );

  return { registry, mounted, isActive };
}
