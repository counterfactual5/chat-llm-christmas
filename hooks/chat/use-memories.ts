'use client';

/**
 * Account memory list + CRUD for the Memory manager modal.
 */

import { useCallback, useState } from 'react';
import {
  downloadTextFile,
  parseMemoriesMarkdown,
  serializeMemoriesMarkdown,
} from '@/lib/memories/markdown';
import type { MemoryItem, MemoryKind } from '@/lib/memories/types';

export function useChatMemories() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/memories?limit=100', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.message || '加载记忆失败');
      setMemories(Array.isArray(json?.data) ? json.data : []);
    } catch (cause: any) {
      setError(cause?.message || '加载记忆失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const mergeSaved = useCallback((saved: MemoryItem[]) => {
    if (!saved.length) return;
    setMemories((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const item of saved) map.set(item.id, item);
      return Array.from(map.values()).sort(
        (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0),
      );
    });
  }, []);

  const updateMemory = useCallback(
    async (
      id: string,
      patch: { content?: string; kind?: MemoryKind | string; enabled?: boolean },
    ) => {
      setSaving(true);
      setError('');
      try {
        const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || json?.message || '更新失败');
        if (json?.data) {
          setMemories((prev) =>
            prev
              .map((m) => (m.id === id ? (json.data as MemoryItem) : m))
              .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
          );
        }
        return true;
      } catch (cause: any) {
        setError(cause?.message || '更新失败');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const deleteMemory = useCallback(async (id: string) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 404) {
        throw new Error(json?.error || json?.message || '删除失败');
      }
      setMemories((prev) => prev.filter((m) => m.id !== id));
      return true;
    } catch (cause: any) {
      setError(cause?.message || '删除失败');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const exportMarkdown = useCallback(() => {
    const markdown = serializeMemoriesMarkdown(memories);
    downloadTextFile('MEMORY.md', markdown);
    return markdown;
  }, [memories]);

  const importMarkdown = useCallback(async (markdown: string) => {
    const parsed = parseMemoriesMarkdown(markdown);
    if (!parsed.length) {
      setError('未能从 Markdown 中解析出记忆条目');
      return false;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memories: parsed.map((item) => ({
            kind: item.kind,
            content: item.content,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || json?.message || '导入失败');
      }
      const saved = Array.isArray(json?.data?.saved)
        ? (json.data.saved as MemoryItem[])
        : [];
      if (saved.length) {
        setMemories((prev) => {
          const map = new Map(prev.map((m) => [m.id, m]));
          for (const item of saved) map.set(item.id, item);
          return Array.from(map.values()).sort(
            (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0),
          );
        });
      }

      // Batch insert always enables; re-disable items from ## Disabled.
      const disabledContents = new Set(
        parsed
          .filter((item) => !item.enabled)
          .map((item) => item.content.trim().toLowerCase()),
      );
      if (disabledContents.size) {
        const targets = (saved.length ? saved : memories).filter((item) =>
          disabledContents.has(String(item.content || '').trim().toLowerCase()),
        );
        for (const target of targets) {
          await fetch(`/api/memories/${encodeURIComponent(target.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
          }).catch(() => null);
        }
        await fetchMemories();
      }
      return true;
    } catch (cause: any) {
      setError(cause?.message || '导入失败');
      return false;
    } finally {
      setSaving(false);
    }
  }, [fetchMemories, memories]);

  const enabledMemoriesPayload = useCallback(() => {
    return memories
      .filter((m) => m.enabled && String(m.content || '').trim())
      .slice(0, 30)
      .map((m) => ({
        id: m.id,
        kind: String(m.kind || 'preference'),
        content: String(m.content || '').trim(),
      }));
  }, [memories]);

  return {
    memories,
    setMemories,
    loading,
    error,
    setError,
    saving,
    fetchMemories,
    mergeSaved,
    updateMemory,
    deleteMemory,
    exportMarkdown,
    importMarkdown,
    enabledMemoriesPayload,
  };
}
