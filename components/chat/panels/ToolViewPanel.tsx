'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Layers, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ToolViewPayload } from '@/lib/tools/views/types';
import { renderToolView } from '@/lib/tools/views/registry';
import { previewPanelWidth } from './panel-widths';

export type ToolViewPanelProps = {
  open: boolean;
  onClose: () => void;
  /** When Context is closed, Preview absorbs its width. */
  contextOpen?: boolean;
  view: ToolViewPayload | null;
  messageId?: string;
  onJumpToMessage?: () => void;
};

export function ToolViewPanel({
  open,
  onClose,
  contextOpen = false,
  view,
  messageId,
  onJumpToMessage,
}: ToolViewPanelProps) {
  const { t } = useLocale();
  const width = previewPanelWidth(contextOpen);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ width: { duration: 0.2, ease: 'easeInOut' } }}
          className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
        >
          <div className="relative flex h-14 shrink-0 items-center justify-center gap-2 border-b border-stone-200/50 px-4 dark:border-stone-800/50">
            <span
              className={cn(
                'pointer-events-none absolute truncate text-center text-sm font-semibold text-stone-700 dark:text-stone-300',
                view ? 'inset-x-36' : 'inset-x-12',
              )}
            >
              {view?.title || t('toolViewPanel')}
            </span>
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              {view && messageId && onJumpToMessage ? (
                <Button
                  variant="ghost"
                  size="icon"
                  title={t('viewInChat')}
                  onClick={onJumpToMessage}
                  className="h-8 w-8 text-stone-500"
                >
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 text-stone-500"
                aria-label={t('closePreview')}
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div
            className={cn(
              'min-h-0 min-w-0 flex-1 overscroll-contain',
              view?.viewType === 'xlsx.table'
                ? 'overflow-auto'
                : 'overflow-x-hidden overflow-y-auto',
            )}
          >
            {!view ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-xs text-stone-400">
                <Layers className="h-8 w-8 opacity-40" />
                <span>{t('toolViewPanelEmpty')}</span>
              </div>
            ) : (
              <>
                {view.sourceFileName || view.viewType ? (
                  <div className="border-b border-stone-100 px-4 py-2 text-[11px] text-stone-400 dark:border-stone-800">
                    <span className="font-mono">{view.viewType}</span>
                    {view.sourceFileName ? (
                      <>
                        <span className="mx-1.5">·</span>
                        {view.sourceFileName}
                      </>
                    ) : null}
                  </div>
                ) : null}
                {renderToolView(view)}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
