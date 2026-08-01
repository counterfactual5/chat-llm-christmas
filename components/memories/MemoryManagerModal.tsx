'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { MemoryItem } from '@/lib/memories/types';

type MemoryManagerModalProps = {
  open: boolean;
  onClose: () => void;
  memories: MemoryItem[];
  loading: boolean;
  saving: boolean;
  error: string;
  onRefresh: () => void | Promise<void>;
  onUpdate: (
    id: string,
    patch: { content?: string; enabled?: boolean },
  ) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onExportMarkdown: () => void;
  onImportMarkdown: (markdown: string) => Promise<boolean>;
};

function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function MemoryManagerModal({
  open,
  onClose,
  memories,
  loading,
  saving,
  error,
  onRefresh,
  onUpdate,
  onDelete,
  onExportMarkdown,
  onImportMarkdown,
}: MemoryManagerModalProps) {
  const [pendingDelete, setPendingDelete] = useState<MemoryItem | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) void onRefresh();
  }, [open, onRefresh]);

  useEffect(() => {
    if (!open) {
      setPendingDelete(null);
      setDrafts({});
    }
  }, [open]);

  const enabledCount = useMemo(
    () => memories.filter((m) => m.enabled).length,
    [memories],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <section
        className="flex max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900"
        onClick={(event) => event.stopPropagation()}
        aria-label="Memory manager"
      >
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              Memory
            </h2>
            <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
              {enabledCount} enabled · {memories.length} total · export/import as MEMORY.md
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onExportMarkdown()}
              disabled={loading || saving}
              title="Export MEMORY.md"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || saving}
              title="Import MEMORY.md"
            >
              <Upload className="h-4 w-4" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown,text/plain"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const text = await file.text();
                await onImportMarkdown(text);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void onRefresh()}
              disabled={loading || saving}
              title="Refresh memories"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={saving}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {error && (
          <p className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading memories…
            </div>
          ) : memories.length === 0 ? (
            <div className="py-12 text-center text-sm text-stone-500">
              No memories yet. Durable preferences will appear here after chats settle.
            </div>
          ) : (
            <ul className="space-y-2">
              {memories.map((memory) => {
                const draft = drafts[memory.id] ?? memory.content;
                const dirty = draft.trim() !== memory.content.trim();
                return (
                  <li
                    key={memory.id}
                    className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-950/40"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                        {memory.kind}
                      </span>
                      <span className="text-[10px] text-stone-400">
                        {formatDate(memory.updatedAt)}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <Switch
                          size="sm"
                          checked={memory.enabled}
                          disabled={saving}
                          onCheckedChange={(enabled) => void onUpdate(memory.id, { enabled })}
                          aria-label="Enable memory"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-stone-400 hover:text-red-600"
                          disabled={saving}
                          onClick={() => setPendingDelete(memory)}
                          title="Delete memory"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <textarea
                      value={draft}
                      disabled={saving}
                      onChange={(event) =>
                        setDrafts((prev) => ({ ...prev, [memory.id]: event.target.value }))
                      }
                      rows={2}
                      className="w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                    />
                    {dirty && (
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          onClick={() =>
                            setDrafts((prev) => {
                              const next = { ...prev };
                              delete next[memory.id];
                              return next;
                            })
                          }
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={saving || !draft.trim()}
                          onClick={async () => {
                            const ok = await onUpdate(memory.id, { content: draft.trim() });
                            if (ok) {
                              setDrafts((prev) => {
                                const next = { ...prev };
                                delete next[memory.id];
                                return next;
                              });
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {pendingDelete && (
          <div className="border-t border-stone-200 px-5 py-4 dark:border-stone-800">
            <p className="text-sm text-stone-700 dark:text-stone-200">
              Delete this memory?
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-stone-500">{pendingDelete.content}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={saving}
                onClick={async () => {
                  const ok = await onDelete(pendingDelete.id);
                  if (ok) setPendingDelete(null);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
