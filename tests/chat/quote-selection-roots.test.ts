import { describe, expect, it } from 'vitest';

/**
 * Mirrors ChatQuoteToolbar root membership check (kept as a pure helper test
 * so PDF/preview quote wiring does not regress silently).
 */
function selectionInsideRoot(
  root: { contains: (node: unknown) => boolean } | null | undefined,
  anchor: unknown,
  focus: unknown,
): boolean {
  if (!root || !anchor || !focus) return false;
  return root.contains(anchor) && root.contains(focus);
}

describe('quote selection roots', () => {
  it('accepts selection fully inside a preview root', () => {
    const node = { id: 'text' };
    const root = {
      contains: (n: unknown) => n === node,
    };
    expect(selectionInsideRoot(root, node, node)).toBe(true);
  });

  it('rejects selection outside any root', () => {
    const outside = { id: 'outside' };
    const root = {
      contains: () => false,
    };
    expect(selectionInsideRoot(root, outside, outside)).toBe(false);
  });

  it('rejects missing nodes', () => {
    const root = { contains: () => true };
    expect(selectionInsideRoot(root, null, null)).toBe(false);
  });

  it('accepts selection when any of multiple roots contains the nodes', () => {
    const node = { id: 'text' };
    const previewRoot = { contains: () => false };
    const overlayRoot = { contains: (n: unknown) => n === node };
    const roots = [previewRoot, overlayRoot];
    expect(
      roots.some((root) => selectionInsideRoot(root, node, node)),
    ).toBe(true);
  });
});
