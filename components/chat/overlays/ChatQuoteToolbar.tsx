'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { Quote } from 'lucide-react';
import {
  firstIframeSelectionUnderRoots,
  tryIframeDocument,
} from '@/lib/chat/message/iframe-selection-bridge';
import { selectionInsideRoot } from '@/lib/chat/message/quote-roots';
import {
  quotedSelectionFromDom,
  type QuotedSelection,
} from '@/lib/chat/message/quotes';
import { useLocale } from '@/lib/i18n';
import { markdownFromDomSelection } from '@/lib/markdown/math';

export type ChatQuoteToolbarProps = {
  messagesContentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Extra DOM roots (Preview panel) that also allow Quote. */
  extraRoots?: Array<RefObject<HTMLElement | null> | null | undefined>;
  onQuote: (quote: QuotedSelection) => void;
};

/**
 * Floating "Quote" chip over selected message / preview text.
 * Positioned via DOM (no setState) so React re-renders cannot collapse the selection.
 * Same-origin iframes under quote roots (e.g. EPUB) are bridged; cross-origin is ignored.
 */
export function ChatQuoteToolbar({
  messagesContentRef,
  scrollRef,
  extraRoots,
  onQuote,
}: ChatQuoteToolbarProps) {
  const { t } = useLocale();
  const wrapRef = useRef<HTMLDivElement>(null);
  const quoteRef = useRef<QuotedSelection | null>(null);

  useEffect(() => {
    let raf = 0;
    const wrap = () => wrapRef.current;
    const iframeCleanups = new Map<HTMLIFrameElement, () => void>();

    const hideToolbar = () => {
      const el = wrap();
      if (el) el.style.display = 'none';
      quoteRef.current = null;
    };

    const allowedRoots = (): HTMLElement[] => {
      const roots: HTMLElement[] = [];
      const msg = messagesContentRef.current;
      if (msg) roots.push(msg);
      for (const ref of extraRoots || []) {
        const el = ref?.current;
        if (el) roots.push(el);
      }
      return roots;
    };

    const textFromSel = (sel: Selection) => {
      try {
        return markdownFromDomSelection(sel);
      } catch {
        return String(sel.toString() || '').trim();
      }
    };

    const showQuote = (
      clipped: string,
      anchor: Node | null,
      x: number,
      y: number,
    ) => {
      const quote = quotedSelectionFromDom(clipped, anchor);
      const el = wrap();
      if (el) {
        el.style.display = 'block';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
      quoteRef.current = quote;
    };

    const updateFromSelection = () => {
      const roots = allowedRoots();
      if (!roots.length) {
        hideToolbar();
        return;
      }

      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const text = markdownFromDomSelection(sel);
        const anchor = sel.anchorNode;
        const focus = sel.focusNode;
        if (
          text &&
          roots.some((root) => selectionInsideRoot(root, anchor, focus))
        ) {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect.width || rect.height) {
            const clipped = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
            const x = Math.min(
              window.innerWidth - 12,
              Math.max(12, rect.left + rect.width / 2),
            );
            const y = Math.max(8, rect.top - 10);
            showQuote(clipped, anchor, x, y);
            return;
          }
        }
      }

      const iframeSnap = firstIframeSelectionUnderRoots(roots, textFromSel);
      if (iframeSnap) {
        const clipped =
          iframeSnap.text.length > 2000
            ? `${iframeSnap.text.slice(0, 2000)}…`
            : iframeSnap.text;
        const x = Math.min(
          window.innerWidth - 12,
          Math.max(12, iframeSnap.left + iframeSnap.width / 2),
        );
        const y = Math.max(8, iframeSnap.top - 10);
        showQuote(clipped, iframeSnap.anchorNode, x, y);
        return;
      }

      hideToolbar();
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateFromSelection);
    };

    const detachIframe = (iframe: HTMLIFrameElement) => {
      const cleanup = iframeCleanups.get(iframe);
      if (cleanup) {
        cleanup();
        iframeCleanups.delete(iframe);
      }
    };

    const attachIframe = (iframe: HTMLIFrameElement) => {
      if (iframeCleanups.has(iframe)) return;
      const doc = tryIframeDocument(iframe);
      if (!doc) return;
      const onSel = () => scheduleUpdate();
      doc.addEventListener('selectionchange', onSel);
      doc.addEventListener('mouseup', onSel);
      doc.addEventListener('keyup', onSel);
      iframeCleanups.set(iframe, () => {
        doc.removeEventListener('selectionchange', onSel);
        doc.removeEventListener('mouseup', onSel);
        doc.removeEventListener('keyup', onSel);
      });
    };

    const syncIframeListeners = () => {
      const live = new Set<HTMLIFrameElement>();
      for (const root of allowedRoots()) {
        for (const iframe of Array.from(root.querySelectorAll('iframe'))) {
          live.add(iframe);
          attachIframe(iframe);
        }
      }
      for (const iframe of Array.from(iframeCleanups.keys())) {
        if (!live.has(iframe)) detachIframe(iframe);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideToolbar();
      else if (e.shiftKey || e.key.startsWith('Arrow')) scheduleUpdate();
    };

    document.addEventListener('selectionchange', scheduleUpdate);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mouseup', scheduleUpdate);
    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    const scroller = scrollRef.current;
    scroller?.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    const observers: MutationObserver[] = [];
    for (const root of allowedRoots()) {
      const mo = new MutationObserver(() => {
        syncIframeListeners();
        scheduleUpdate();
      });
      mo.observe(root, { childList: true, subtree: true });
      observers.push(mo);
    }
    syncIframeListeners();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('selectionchange', scheduleUpdate);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mouseup', scheduleUpdate);
      document.removeEventListener('scroll', scheduleUpdate, {
        capture: true,
      } as EventListenerOptions);
      scroller?.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      for (const mo of observers) mo.disconnect();
      for (const iframe of Array.from(iframeCleanups.keys())) detachIframe(iframe);
    };
  }, [messagesContentRef, scrollRef, extraRoots]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        display: 'none',
        left: 0,
        top: 0,
        transform: 'translate(-50%, -100%)',
        zIndex: 160,
        pointerEvents: 'none',
      }}
    >
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          const quote = quoteRef.current;
          quoteRef.current = null;
          const el = wrapRef.current;
          if (el) el.style.display = 'none';
          window.getSelection()?.removeAllRanges();
          if (quote?.text.trim()) onQuote(quote);
        }}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
      >
        <Quote className="h-3.5 w-3.5 text-orange-500" />
        {t('quote')}
      </button>
    </div>
  );
}
