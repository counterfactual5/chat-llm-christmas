import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  selectionActiveInRoot,
  selectionInsideRoot,
} from '@/lib/chat/message/quote-roots';
import { shouldMarkMessagesSelecting } from '@/lib/chat/message/selecting-attr';

describe('quote selection roots', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('selectionActiveInRoot is true for non-collapsed selection inside root', () => {
    const node = { id: 'text' } as unknown as Node;
    const root = { contains: (n: Node) => n === node };
    vi.stubGlobal('window', {
      getSelection: () => ({
        isCollapsed: false,
        rangeCount: 1,
        anchorNode: node,
        focusNode: node,
      }),
    });
    expect(selectionActiveInRoot(root)).toBe(true);
  });

  it('selectionActiveInRoot is false when collapsed or outside', () => {
    const inside = { id: 'in' } as unknown as Node;
    const outside = { id: 'out' } as unknown as Node;
    const root = { contains: (n: Node) => n === inside };
    vi.stubGlobal('window', {
      getSelection: () => ({
        isCollapsed: true,
        rangeCount: 1,
        anchorNode: inside,
        focusNode: inside,
      }),
    });
    expect(selectionActiveInRoot(root)).toBe(false);

    vi.stubGlobal('window', {
      getSelection: () => ({
        isCollapsed: false,
        rangeCount: 1,
        anchorNode: outside,
        focusNode: outside,
      }),
    });
    expect(selectionActiveInRoot(root)).toBe(false);
  });
});

describe('shouldMarkMessagesSelecting', () => {
  it('is true only while pointer is down AND selection is active', () => {
    expect(shouldMarkMessagesSelecting(true, true)).toBe(true);
  });

  it('is false on pointer-down alone so link clicks still fire', () => {
    expect(shouldMarkMessagesSelecting(true, false)).toBe(false);
  });

  it('is false for idle leftover selection (links stay clickable)', () => {
    expect(shouldMarkMessagesSelecting(false, true)).toBe(false);
  });

  it('is false when idle with no selection', () => {
    expect(shouldMarkMessagesSelecting(false, false)).toBe(false);
  });
});
