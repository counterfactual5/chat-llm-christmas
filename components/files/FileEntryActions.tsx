'use client';

import type { ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Download, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FileEntryMenuItem = {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  destructive?: boolean;
};

type FileEntryActionsProps = {
  onDownload?: () => void;
  downloadLabel: string;
  moreLabel: string;
  items: FileEntryMenuItem[];
  /** Compact sizing for Output cards; default matches Files manager. */
  size?: 'sm' | 'md';
};

export function FileEntryActions({
  onDownload,
  downloadLabel,
  moreLabel,
  items,
  size = 'sm',
}: FileEntryActionsProps) {
  const iconClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const btnClass =
    size === 'sm'
      ? 'rounded p-1 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'
      : 'rounded-md p-2 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200';

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {onDownload && (
        <button type="button" title={downloadLabel} onClick={onDownload} className={btnClass}>
          <Download className={iconClass} />
        </button>
      )}

      <Menu.Root>
        <Menu.Trigger type="button" title={moreLabel} className={btnClass} aria-label={moreLabel}>
          <MoreHorizontal className={iconClass} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[80] outline-none">
            <Menu.Popup className="min-w-[10.5rem] origin-[var(--transform-origin)] rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl outline-none dark:border-stone-700 dark:bg-stone-900">
              {items.map((item) => (
                <Menu.Item
                  key={item.label}
                  onClick={item.onSelect}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none',
                    'data-[highlighted]:bg-stone-100 dark:data-[highlighted]:bg-stone-800',
                    item.destructive
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-stone-700 dark:text-stone-300',
                  )}
                >
                  {item.icon}
                  {item.label}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
