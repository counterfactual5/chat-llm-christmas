'use client';

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
};

/** Shared HTML table used by file preview and `xlsx.table` specialized views. */
export function SpreadsheetTable({
  sheetName,
  headers,
  rows,
  emptyLabel = 'No table data.',
  className,
  hideSheetName,
}: SpreadsheetTableProps) {
  if (!rows.length && !(headers && headers.length)) {
    return (
      <p className={cn('px-4 py-6 text-xs text-stone-400', className)}>{emptyLabel}</p>
    );
  }
  const colCount = Math.max(headers?.length || 0, ...rows.map((r) => r.length), 1);
  return (
    <div className={cn('min-w-0', className)}>
      {!hideSheetName && sheetName ? (
        <div className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">
          {sheetName}
        </div>
      ) : null}
      <div className="min-w-0 overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
        <table className="w-full min-w-[240px] border-collapse text-left text-xs">
          {headers && headers.length > 0 ? (
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/60">
                {Array.from({ length: colCount }, (_, i) => (
                  <th
                    key={i}
                    className="px-2.5 py-1.5 font-semibold text-stone-700 dark:text-stone-200"
                  >
                    {headers[i] ?? ''}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-stone-100 last:border-0 dark:border-stone-800/80"
              >
                {Array.from({ length: colCount }, (_, ci) => (
                  <td
                    key={ci}
                    className="max-w-[220px] truncate px-2.5 py-1.5 text-stone-600 dark:text-stone-300"
                    title={row[ci] || ''}
                  >
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
