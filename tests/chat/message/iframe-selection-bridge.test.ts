import { describe, expect, it, vi } from 'vitest';
import {
  accessibleIframeDocuments,
  firstIframeSelectionUnderRoots,
  readIframeSelection,
  tryIframeDocument,
} from '@/lib/chat/message/iframe-selection-bridge';

describe('tryIframeDocument', () => {
  it('returns null for missing iframe', () => {
    expect(tryIframeDocument(null)).toBeNull();
  });

  it('returns null when contentDocument access throws', () => {
    const iframe = {
      get contentDocument() {
        throw new DOMException('Blocked');
      },
      contentWindow: null,
    } as unknown as HTMLIFrameElement;
    expect(tryIframeDocument(iframe)).toBeNull();
  });

  it('returns the document when accessible', () => {
    const doc = { body: {}, location: { href: 'blob:x' } } as unknown as Document;
    const iframe = {
      contentDocument: doc,
      contentWindow: { document: doc },
    } as unknown as HTMLIFrameElement;
    expect(tryIframeDocument(iframe)).toBe(doc);
  });
});

describe('readIframeSelection / firstIframeSelectionUnderRoots', () => {
  it('translates range rect by iframe offset', () => {
    const range = {
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        width: 40,
        height: 12,
      }),
    };
    const sel = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: { id: 'a' },
      getRangeAt: () => range,
      toString: () => 'hello',
    } as unknown as Selection;
    const doc = {
      body: {},
      defaultView: { getSelection: () => sel },
    } as unknown as Document;
    const iframe = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 300,
        height: 400,
      }),
    } as unknown as HTMLIFrameElement;

    const snap = readIframeSelection(iframe, doc, () => 'hello world');
    expect(snap).toEqual({
      text: 'hello world',
      anchorNode: sel.anchorNode,
      left: 110,
      top: 70,
      width: 40,
      height: 12,
    });
  });

  it('skips collapsed selections', () => {
    const doc = {
      body: {},
      defaultView: {
        getSelection: () => ({ isCollapsed: true, rangeCount: 0 }),
      },
    } as unknown as Document;
    const iframe = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
    } as unknown as HTMLIFrameElement;
    expect(readIframeSelection(iframe, doc, () => 'x')).toBeNull();
  });

  it('finds the first selection under roots', () => {
    const range = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      }),
    };
    const sel = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: null,
      getRangeAt: () => range,
    } as unknown as Selection;
    const doc = {
      body: {},
      defaultView: { getSelection: () => sel },
    } as unknown as Document;
    const iframe = {
      contentDocument: doc,
      contentWindow: { document: doc },
      getBoundingClientRect: () => ({
        left: 5,
        top: 5,
        width: 10,
        height: 10,
      }),
    } as unknown as HTMLIFrameElement;
    const root = {
      querySelectorAll: () => [iframe],
    } as unknown as HTMLElement;

    const spy = vi.fn(() => 'bridged');
    const snap = firstIframeSelectionUnderRoots([root], spy);
    expect(snap?.text).toBe('bridged');
    expect(snap?.left).toBe(5);
  });

  it('lists only accessible iframes', () => {
    const goodDoc = { body: {}, location: { href: 'blob:1' } } as unknown as Document;
    const good = {
      contentDocument: goodDoc,
      contentWindow: { document: goodDoc },
    } as unknown as HTMLIFrameElement;
    const bad = {
      get contentDocument() {
        throw new Error('cross-origin');
      },
      contentWindow: null,
    } as unknown as HTMLIFrameElement;
    const root = {
      querySelectorAll: () => [bad, good],
    } as unknown as HTMLElement;
    const list = accessibleIframeDocuments(root);
    expect(list).toHaveLength(1);
    expect(list[0].iframe).toBe(good);
  });
});
