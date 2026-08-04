'use client';

import { useLocale } from '@/lib/i18n';
import {
  shouldPreviewAsKeyValue,
  transposeToKeyValueRows,
} from '@/lib/files/spreadsheet-text';
import { cn } from '@/lib/utils';

export type SpreadsheetTableProps = {
  sheetName?: string;
  headers?: string[];
  rows: string[][];
  /** Shown when both headers and rows are empty. */
  emptyLabel?: string;
  className?: string;
  /** Hide the sheet name heading (picker may show it elsewhere). */
  hideSheetName?: boolean;
  /**
   * Preview layout. `auto` (default) turns a single wide record into
   * field|value rows; multi-row sheets always stay as a normal table.
   */
  layout?: 'auto' | 'table';
};

/** Shared HTML table used by file preview and `xlsx.table` specialized views. */
export function SpreadsheetTable({
  sheetName,
  headers,
  rows,
  emptyLabel = 'No table data.',
  className,
  hideSheetName,
  layout = 'auto',
}: SpreadsheetTableProps) {
  const { t } = useLocale();

  if (!rows.length && !(headers && headers.length)) {
    return (
      <p className={cn('px-4 py-6 text-xs text-stone-400', className)}>{emptyLabel}</p>
    );
  }

  const asKeyValue =
    layout === 'auto' && shouldPreviewAsKeyValue(headers, rows);
  const displayHeaders = asKeyValue
    ? [t('spreadsheetFieldCol'), t('spreadsheetValueCol')]
    : headers;
  const displayRows = asKeyValue
    ? transposeToKeyValueRows(headers!, rows[0]!)
    : rows;
  const colCount = Math.max(
    displayHeaders?.length || 0,
    ...displayRows.map((r) => r.length),
    1,
  );

  return (
    <div className={cn('min-w-0', className)}>
      {!hideSheetName && sheetName ? (
        <div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">
          {sheetName}
        </div>
      ) : null}
      {/*
        pb keeps the horizontal scrollbar below the last data row so overlay
        scrollbars (macOS) do not cover a single thin record.
      */}
      <div className="min-w-0 overflow-x-auto overscroll-x-contain rounded-lg border border-stone-200 pb-3 dark:border-stone-800">
        {/* w-max so wide sheets expand past the panel and scroll horizontally */}
        <table
          className={cn(
            'border-collapse text-left text-xs',
            asKeyValue ? 'w-full min-w-0' : 'w-max min-w-full',
          )}
        >
          {displayHeaders && displayHeaders.length > 0 ? (
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60">
                {Array.from({ length: colCount }, (_, i) => (
                  <th
                    key={i}
                    className={cn(
                      'px-2.5 py-1.5 font-semibold text-stone-700 dark:text-stone-200',
                      asKeyValue
                        ? i === 0
                          ? 'w-[30%] whitespace-nowrap'
                          : 'w-[70%]'
                        : 'whitespace-nowrap',
                    )}
                  >
                    {displayHeaders[i] ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {displayRows.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-stone-100 last:border-0 dark:border-stone-800/80"
              >
                {Array.from({ length: colCount }, (_, ci) => {
                  const cell = row[ci] ?? '';
                  const wrapValue = asKeyValue && ci === 1;
                  return (
                    <td
                      key={ci}
                      className={cn(
                        'px-2.5 py-1.5 text-stone-600 dark:text-stone-300',
                        wrapValue
                          ? 'max-w-none whitespace-pre-wrap break-words align-top'
                          : asKeyValue
                            ? 'whitespace-nowrap font-medium text-stone-700 dark:text-stone-200'
                            : 'max-w-[280px] truncate whitespace-nowrap',
                      )}
                      title={wrapValue ? undefined : cell}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
