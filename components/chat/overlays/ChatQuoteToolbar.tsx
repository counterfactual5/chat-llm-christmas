'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { Quote } from 'lucide-react';
import {
  firstIframeSelectionUnderRoots,
  tryIframeDocument,
} from '@/lib/chat/message/iframe-selection-bridge';
import { selectionActiveInRoot, selectionInsideRoot } from '@/lib/chat/message/quote-roots';
import { shouldMarkMessagesSelecting } from '@/lib/chat/message/selecting-attr';
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

type PendingQuote = {
  quote: QuotedSelection;
  x: number;
  y: number;
};

type UpdateMode = 'stash' | 'show' | 'reposition';

/**
 * Floating "Quote" chip over selected message / preview text.
 * Positioned via DOM (no setState) so React re-renders cannot collapse the selection.
 * Same-origin iframes under quote roots (e.g. EPUB) are bridged; cross-origin is ignored.
 *
 * The chip stays hidden while a pointer gesture is active so it cannot sit under
 * macOS three-finger drag (`pointer-events-auto`) and steal the selection.
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
    let pointerDown = false;
    let pointerDownInMessages = false;
    const wrap = () => wrapRef.current;
    const iframeCleanups = new Map<HTMLIFrameElement, () => void>();

    const syncMessagesSelectingAttr = () => {
      const msg = messagesContentRef.current;
      if (!msg) return;
      if (
        shouldMarkMessagesSelecting(
          pointerDownInMessages,
          selectionActiveInRoot(msg),
        )
      ) {
        msg.setAttribute('data-selecting', '');
      } else {
        msg.removeAttribute('data-selecting');
      }
    };

    const hideToolbar = () => {
      const el = wrap();
      if (el) el.style.display = 'none';
      quoteRef.current = null;
    };

    const paintToolbar = (next: PendingQuote) => {
      const el = wrap();
      if (el) {
        el.style.display = 'block';
        el.style.left = `${next.x}px`;
        el.style.top = `${next.y}px`;
      }
      quoteRef.current = next.quote;
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

    const computePending = (): PendingQuote | null => {
      const roots = allowedRoots();
      if (!roots.length) return null;

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
            return {
              quote: quotedSelectionFromDom(clipped, anchor),
              x: Math.min(
                window.innerWidth - 12,
                Math.max(12, rect.left + rect.width / 2),
              ),
              y: Math.max(8, rect.top - 10),
            };
          }
        }
      }

      const iframeSnap = firstIframeSelectionUnderRoots(roots, textFromSel);
      if (!iframeSnap) return null;
      const clipped =
        iframeSnap.text.length > 2000
          ? `${iframeSnap.text.slice(0, 2000)}…`
          : iframeSnap.text;
      return {
        quote: quotedSelectionFromDom(clipped, iframeSnap.anchorNode),
        x: Math.min(
          window.innerWidth - 12,
          Math.max(12, iframeSnap.left + iframeSnap.width / 2),
        ),
        y: Math.max(8, iframeSnap.top - 10),
      };
    };

    const updateFromSelection = (mode: UpdateMode) => {
      const next = computePending();
      if (!next) {
        hideToolbar();
        return;
      }
      quoteRef.current = next.quote;
      const el = wrap();
      const visible = el?.style.display === 'block';

      if (mode === 'stash') {
        if (el) el.style.display = 'none';
        return;
      }
      if (mode === 'show' || (mode === 'reposition' && visible)) {
        paintToolbar(next);
      }
    };

    const scheduleUpdate = (mode: UpdateMode) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => updateFromSelection(mode));
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
      const onSelChange = () => scheduleUpdate(pointerDown ? 'stash' : 'show');
      const onSelCommit = () => scheduleUpdate('show');
      doc.addEventListener('selectionchange', onSelChange);
      doc.addEventListener('mouseup', onSelCommit);
      doc.addEventListener('keyup', onSelCommit);
      iframeCleanups.set(iframe, () => {
        doc.removeEventListener('selectionchange', onSelChange);
        doc.removeEventListener('mouseup', onSelCommit);
        doc.removeEventListener('keyup', onSelCommit);
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

    const onPointerDown = (e: PointerEvent) => {
      pointerDown = true;
      const msg = messagesContentRef.current;
      const target = e.target;
      pointerDownInMessages = Boolean(
        msg && target instanceof Node && msg.contains(target),
      );
      syncMessagesSelectingAttr();
    };
    const onPointerUp = () => {
      pointerDown = false;
      pointerDownInMessages = false;
      syncMessagesSelectingAttr();
      scheduleUpdate('show');
    };
    const onSelectionChange = () => {
      syncMessagesSelectingAttr();
      scheduleUpdate(pointerDown ? 'stash' : 'show');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideToolbar();
      else if (e.shiftKey || e.key.startsWith('Arrow')) scheduleUpdate('show');
    };
    const onMouseUp = () => scheduleUpdate('show');
    const onReposition = () => scheduleUpdate('reposition');

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('scroll', onReposition, {
      capture: true,
      passive: true,
    });
    const scroller = scrollRef.current;
    scroller?.addEventListener('scroll', onReposition, { passive: true });
    window.addEventListener('resize', onReposition);

    const observers: MutationObserver[] = [];
    for (const root of allowedRoots()) {
      const mo = new MutationObserver(() => {
        syncIframeListeners();
        scheduleUpdate('reposition');
      });
      mo.observe(root, { childList: true, subtree: true });
      observers.push(mo);
    }
    syncIframeListeners();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('scroll', onReposition, {
        capture: true,
      } as EventListenerOptions);
      scroller?.removeEventListener('scroll', onReposition);
      window.removeEventListener('resize', onReposition);
      for (const mo of observers) mo.disconnect();
      for (const iframe of Array.from(iframeCleanups.keys())) detachIframe(iframe);
      messagesContentRef.current?.removeAttribute('data-selecting');
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
