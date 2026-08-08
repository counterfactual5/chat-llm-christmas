'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type PreviewPanelShellProps = {
  open: boolean;
  /** Stay mounted at width 0 when closed (keep in-flight loads / scroll). */
  keepMounted?: boolean;
  width: number;
  children: ReactNode;
  className?: string;
};

/**
 * Side Preview chrome: animate width on open/close without unmounting when
 * `keepMounted` so fetch/readers survive soft-hide.
 */
export function PreviewPanelShell({
  open,
  keepMounted = false,
  width,
  children,
  className,
}: PreviewPanelShellProps) {
  const mounted = open || keepMounted;
  return (
    <AnimatePresence initial={false}>
      {mounted ? (
        <motion.div
          key="preview-shell"
          initial={false}
          animate={{
            width: open ? width : 0,
            opacity: open ? 1 : 0,
          }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ width: { duration: 0.2, ease: 'easeInOut' } }}
          className={cn(
            'flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900',
            !open && 'pointer-events-none border-transparent',
            className,
          )}
          aria-hidden={!open}
          inert={!open || undefined}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
