'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { selectionActiveInRoot } from '@/lib/chat/message/quote-roots';
import { cn } from '@/lib/utils';

const NEAR_BOTTOM_PX = 48;

type ReasoningBodyScrollProps = {
  /** Growing thought text — used as a scroll-trigger dependency. */
  body: string;
  /** True while this thought step is the live trailing stream. */
  live: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Scrollable thought body with stick-to-bottom while streaming.
 * Mirrors the main chat list: follow new tokens unless the user scrolls up
 * or is actively selecting text inside this scroller.
 */
export function ReasoningBodyScroll({
  body,
  live,
  className,
  children,
}: ReasoningBodyScrollProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (live) stickToBottomRef.current = true;
  }, [live]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!live || !stickToBottomRef.current) return;
    if (selectionActiveInRoot(el)) return;
    el.scrollTop = el.scrollHeight;
  }, [body, live]);

  return (
    <div
      ref={scrollerRef}
      onScroll={() => {
        const el = scrollerRef.current;
        if (!el) return;
        stickToBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
      }}
      className={cn(
        'chat-markdown mt-0.5 max-h-72 min-w-0 max-w-full overflow-x-hidden overflow-y-auto pl-[18px] text-[12px] leading-5 text-stone-500 dark:text-stone-400 [overflow-wrap:anywhere]',
        className,
      )}
    >
      {children}
    </div>
  );
}
