/**
 * Same-origin iframe selection helpers for Quote bridging.
 * Cross-origin access returns null — never throws to callers.
 */

export function tryIframeDocument(
  iframe: HTMLIFrameElement | null | undefined,
): Document | null {
  if (!iframe) return null;
  try {
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document ?? null;
    // Opaque / sandboxed without allow-same-origin still "returns" but is unusable.
    if (!doc || !doc.body) return null;
    void doc.location?.href;
    return doc;
  } catch {
    return null;
  }
}

/** List accessible (same-origin) iframe documents under a root. */
export function accessibleIframeDocuments(root: HTMLElement): Array<{
  iframe: HTMLIFrameElement;
  doc: Document;
}> {
  const out: Array<{ iframe: HTMLIFrameElement; doc: Document }> = [];
  for (const iframe of Array.from(root.querySelectorAll('iframe'))) {
    const doc = tryIframeDocument(iframe);
    if (doc) out.push({ iframe, doc });
  }
  return out;
}

export type IframeSelectionSnapshot = {
  text: string;
  anchorNode: Node | null;
  /** Viewport coordinates (translated by iframe offset). */
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Read a non-collapsed selection from an iframe document.
 * `textFromSelection` should mirror parent markdown extraction when possible.
 */
export function readIframeSelection(
  iframe: HTMLIFrameElement,
  doc: Document,
  textFromSelection: (sel: Selection) => string,
): IframeSelectionSnapshot | null {
  const win = doc.defaultView;
  const sel = win?.getSelection?.() ?? null;
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = String(textFromSelection(sel) || '').trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const ir = iframe.getBoundingClientRect();
  return {
    text,
    anchorNode: sel.anchorNode,
    left: rect.left + ir.left,
    top: rect.top + ir.top,
    width: rect.width,
    height: rect.height,
  };
}

/** First usable selection among accessible iframes under `roots`. */
export function firstIframeSelectionUnderRoots(
  roots: HTMLElement[],
  textFromSelection: (sel: Selection) => string,
): IframeSelectionSnapshot | null {
  for (const root of roots) {
    for (const { iframe, doc } of accessibleIframeDocuments(root)) {
      const snap = readIframeSelection(iframe, doc, textFromSelection);
      if (snap) return snap;
    }
  }
  return null;
}
