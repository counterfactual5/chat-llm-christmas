'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { Quote } from 'lucide-react';
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

function selectionInsideRoot(
  root: HTMLElement | null | undefined,
  anchor: Node | null,
  focus: Node | null,
): boolean {
  if (!root || !anchor || !focus) return false;
  return root.contains(anchor) && root.contains(focus);
}

/**
 * Floating "Quote" chip over selected message / preview text.
 * Positioned via DOM (no setState) so React re-renders cannot collapse the selection.
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

    const updateFromSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        hideToolbar();
        return;
      }
      const text = markdownFromDomSelection(sel);
      if (!text) {
        hideToolbar();
        return;
      }
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      const roots = allowedRoots();
      if (
        !roots.length ||
        !roots.some((root) => selectionInsideRoot(root, anchor, focus))
      ) {
        hideToolbar();
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        hideToolbar();
        return;
      }
      const clipped = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
      const quote = quotedSelectionFromDom(clipped, anchor);
      const x = Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2));
      // Sit just above the selection; wrapper uses translate(-50%, -100%).
      const y = Math.max(8, rect.top - 10);
      const el = wrap();
      if (el) {
        el.style.display = 'block';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
      quoteRef.current = quote;
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateFromSelection);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideToolbar();
      else if (e.shiftKey || e.key.startsWith('Arrow')) scheduleUpdate();
    };

    document.addEventListener('selectionchange', scheduleUpdate);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mouseup', scheduleUpdate);
    // Capture so Preview/PDF panel scrolls also reposition the chip.
    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    const scroller = scrollRef.current;
    scroller?.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
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
