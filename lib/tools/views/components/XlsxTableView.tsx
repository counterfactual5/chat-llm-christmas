'use client';

import type { ToolViewPayload, XlsxTableViewData } from '@/lib/tools/views/types';

function asTableData(data: unknown): XlsxTableViewData {
  if (!data || typeof data !== 'object') return { rows: [] };
  const raw = data as XlsxTableViewData;
  return {
    sheetName: typeof raw.sheetName === 'string' ? raw.sheetName : undefined,
    headers: Array.isArray(raw.headers) ? raw.headers.map((h) => String(h ?? '')) : undefined,
    rows: Array.isArray(raw.rows)
      ? raw.rows.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')) : []))
      : [],
  };
}

export function XlsxTableView({ view }: { view: ToolViewPayload }) {
  const { sheetName, headers, rows } = asTableData(view.data);
  if (!rows.length && !(headers && headers.length)) {
    return <p className="px-4 py-6 text-xs text-stone-400">No table data.</p>;
  }
  const colCount = Math.max(
    headers?.length || 0,
    ...rows.map((r) => r.length),
    1,
  );
  return (
    <div className="min-w-0 overflow-x-auto px-4 py-4">
      {sheetName ? (
        <div className="mb-2 text-xs font-medium text-stone-500">{sheetName}</div>
      ) : null}
      <table className="w-full min-w-[240px] border-collapse text-left text-xs">
        {headers && headers.length > 0 ? (
          <thead>
            <tr className="border-b border-stone-200 dark:border-stone-700">
              {Array.from({ length: colCount }, (_, i) => (
                <th
                  key={i}
                  className="px-2 py-1.5 font-semibold text-stone-700 dark:text-stone-200"
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
              className="border-b border-stone-100 dark:border-stone-800/80"
            >
              {Array.from({ length: colCount }, (_, ci) => (
                <td
                  key={ci}
                  className="max-w-[220px] truncate px-2 py-1.5 text-stone-600 dark:text-stone-300"
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
  );
}
