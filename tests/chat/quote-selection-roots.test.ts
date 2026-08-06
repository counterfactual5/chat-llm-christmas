import { describe, expect, it } from 'vitest';
import { selectionInsideRoot } from '@/lib/chat/message/quote-roots';

describe('quote selection roots', () => {
  it('accepts selection fully inside a preview root', () => {
    const node = { id: 'text' } as unknown as Node;
    const root = {
      contains: (n: Node) => n === node,
    };
    expect(selectionInsideRoot(root, node, node)).toBe(true);
  });

  it('rejects selection outside any root', () => {
    const outside = { id: 'outside' } as unknown as Node;
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
    const node = { id: 'text' } as unknown as Node;
    const previewRoot = { contains: () => false };
    const overlayRoot = { contains: (n: Node) => n === node };
    const roots = [previewRoot, overlayRoot];
    expect(roots.some((root) => selectionInsideRoot(root, node, node))).toBe(
      true,
    );
  });
});
