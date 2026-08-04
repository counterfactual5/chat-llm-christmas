'use client';

import { useMemo, useState } from 'react';
import { SpreadsheetTable } from '@/components/files/SpreadsheetTable';
import { useLocale } from '@/lib/i18n';
import type { ToolViewPayload, XlsxTableViewData } from '@/lib/tools/views/types';
import { cn } from '@/lib/utils';

function asTableData(data: unknown): XlsxTableViewData {
  if (!data || typeof data !== 'object') return { rows: [] };
  const raw = data as XlsxTableViewData;
  const tables = Array.isArray(raw.tables)
    ? raw.tables.map((t) => ({
        sheetName: String(t?.sheetName || ''),
        headers: Array.isArray(t?.headers)
          ? t.headers.map((h) => String(h ?? ''))
          : undefined,
        rows: Array.isArray(t?.rows)
          ? t.rows.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')) : []))
          : [],
      }))
    : undefined;
  return {
    sheetName: typeof raw.sheetName === 'string' ? raw.sheetName : undefined,
    headers: Array.isArray(raw.headers) ? raw.headers.map((h) => String(h ?? '')) : undefined,
    rows: Array.isArray(raw.rows)
      ? raw.rows.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')) : []))
      : [],
    sheetNames: Array.isArray(raw.sheetNames)
      ? raw.sheetNames.map((n) => String(n ?? ''))
      : undefined,
    tables,
    empty: Boolean(raw.empty),
  };
}

export function XlsxTableView({ view }: { view: ToolViewPayload }) {
  const { t } = useLocale();
  const data = asTableData(view.data);
  const sheetOptions = useMemo(() => {
    if (data.tables?.length) return data.tables.map((t) => t.sheetName).filter(Boolean);
    if (data.sheetNames?.length) return data.sheetNames;
    return data.sheetName ? [data.sheetName] : [];
  }, [data.tables, data.sheetNames, data.sheetName]);

  const [activeSheet, setActiveSheet] = useState(
    () => data.sheetName || sheetOptions[0] || '',
  );

  const active = useMemo(() => {
    if (data.tables?.length) {
      return (
        data.tables.find((t) => t.sheetName === activeSheet) ||
        data.tables.find((t) => t.sheetName === data.sheetName) ||
        data.tables[0]
      );
    }
    return {
      sheetName: data.sheetName,
      headers: data.headers,
      rows: data.rows,
    };
  }, [data, activeSheet]);

  return (
    <div className="flex min-h-0 flex-col gap-2 px-4 py-4">
      {sheetOptions.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {sheetOptions.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setActiveSheet(name)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                (activeSheet || active?.sheetName) === name &&
                  'bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-white',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <SpreadsheetTable
        sheetName={active?.sheetName}
        headers={active?.headers}
        rows={active?.rows || []}
        hideSheetName={sheetOptions.length > 1}
        emptyLabel={t('toolViewEmptyTable')}
      />
    </div>
  );
}
