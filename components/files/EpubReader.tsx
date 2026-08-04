'use client';

import { useEffect, useRef, useState } from 'react';
import ePub, { type Book, type NavItem, type Rendition } from 'epubjs';
import {
  BookOpen,
  List,
  Loader2,
  Type,
} from 'lucide-react';
import {
  EPUB_DEFAULT_FONT_FAMILY,
  EPUB_DEFAULT_FONT_SIZE,
  EPUB_FONT_FAMILIES,
  EPUB_FONT_SIZES,
  fontFamilyCss,
  loadEpubReaderPrefs,
  saveEpubReaderPrefs,
} from '@/lib/files/epub-progress';
import { cn } from '@/lib/utils';

export type EpubReaderProps = {
  /** Stable id for progress persistence (file id). */
  fileId: string;
  /** Same-origin /api/files/... URL (cookies included). */
  url: string;
  title?: string;
  className?: string;
};

type TocEntry = { id: string; label: string; href: string };

const MIN_LAYOUT_WIDTH = 160;
const MIN_LAYOUT_HEIGHT = 120;

function flattenToc(items: NavItem[] | undefined, prefix = ''): TocEntry[] {
  if (!items?.length) return [];
  const out: TocEntry[] = [];
  items.forEach((item, index) => {
    const id = `${prefix}${index}`;
    const label = String(item.label || '').trim() || `Section ${index + 1}`;
    const href = String(item.href || '').trim();
    if (href) out.push({ id, label, href });
    if (item.subitems?.length) out.push(...flattenToc(item.subitems, `${id}.`));
  });
  return out;
}

function hostSize(el: HTMLElement): { width: number; height: number } {
  const width = Math.max(0, Math.floor(el.clientWidth));
  const height = Math.max(0, Math.floor(el.clientHeight));
  return { width, height };
}

function layoutReady(el: HTMLElement): boolean {
  const { width, height } = hostSize(el);
  return width >= MIN_LAYOUT_WIDTH && height >= MIN_LAYOUT_HEIGHT;
}

export function EpubReader({ fileId, url, title, className }: EpubReaderProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontSizeRef = useRef(EPUB_DEFAULT_FONT_SIZE);
  const fontFamilyRef = useRef(EPUB_DEFAULT_FONT_FAMILY);
  const lastSizeRef = useRef({ width: 0, height: 0 });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [fontSize, setFontSize] = useState(EPUB_DEFAULT_FONT_SIZE);
  const [fontFamily, setFontFamily] = useState(EPUB_DEFAULT_FONT_FAMILY);

  useEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    if (!host || !url || !fileId) return;

    let cancelled = false;
    let book: Book | null = null;
    let rendition: Rendition | null = null;
    let started = false;
    /** continuous manager is only safe to resize after first display(). */
    let readyForResize = false;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const prefs = loadEpubReaderPrefs(fileId);
    const initialSize = prefs?.fontSize || EPUB_DEFAULT_FONT_SIZE;
    const initialFamily = prefs?.fontFamily || EPUB_DEFAULT_FONT_FAMILY;
    fontSizeRef.current = initialSize;
    fontFamilyRef.current = initialFamily;
    setFontSize(initialSize);
    setFontFamily(initialFamily);
    setLoading(true);
    setError('');
    setToc([]);

    const applyTheme = (target: Rendition, size: string, family: string) => {
      target.themes.default({
        body: {
          'font-family': fontFamilyCss(family),
          'line-height': '1.65',
          padding: '0.5rem 0.75rem !important',
        },
      });
      target.themes.fontSize(size);
    };

    const persist = (cfi?: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveEpubReaderPrefs(fileId, {
          cfi,
          fontSize: fontSizeRef.current,
          fontFamily: fontFamilyRef.current,
        });
      }, 400);
    };

    const destroyReader = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try {
        rendition?.destroy();
      } catch {
        /* ignore */
      }
      try {
        book?.destroy();
      } catch {
        /* ignore */
      }
      rendition = null;
      book = null;
      renditionRef.current = null;
      bookRef.current = null;
      host.innerHTML = '';
    };

    const startReader = async () => {
      if (cancelled || started || !layoutReady(host)) return;
      started = true;
      lastSizeRef.current = hostSize(host);

      try {
        // Fetch once (prefer direct chat-api) then open from ArrayBuffer so
        // epubjs does not re-request the URL through the Vercel proxy.
        const { fetchFileContentForPreview } = await import('@/lib/files/direct-content');
        const { buf } = await fetchFileContentForPreview(url);
        if (cancelled) return;
        if (!layoutReady(host)) {
          // Panel collapsed while downloading — allow a later retry.
          started = false;
          return;
        }

        // Copy into a fresh buffer; some gateways return a detached/shared view.
        const bytes = buf.byteLength ? buf.slice(0) : buf;
        book = ePub(bytes);
        bookRef.current = book;

        const size = hostSize(host);
        lastSizeRef.current = size;

        // Continuous vertical scroll. Explicit pixel size avoids measuring a
        // collapsing side-panel (width animates 0→460) as a tiny column.
        rendition = book.renderTo(host, {
          width: size.width,
          height: size.height,
          flow: 'scrolled',
          manager: 'continuous',
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        rendition.on('relocated', (location: { start?: { cfi?: string } }) => {
          const cfi = location?.start?.cfi;
          if (cfi) persist(cfi);
        });

        await book.ready;
        if (cancelled) return;

        applyTheme(rendition, initialSize, initialFamily);

        const nav = await book.loaded.navigation;
        if (!cancelled) setToc(flattenToc(nav?.toc));

        if (prefs?.cfi) {
          await rendition.display(prefs.cfi);
        } else {
          await rendition.display();
        }
        if (cancelled) return;

        readyForResize = true;
        // Re-measure after first paint — panel animation may have finished.
        const next = hostSize(host);
        const prev = lastSizeRef.current;
        if (
          Math.abs(next.width - prev.width) >= 2 ||
          Math.abs(next.height - prev.height) >= 2
        ) {
          lastSizeRef.current = next;
          try {
            rendition.resize(next.width, next.height);
          } catch {
            /* ignore */
          }
        }
        if (!cancelled) setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Failed to open EPUB');
          setLoading(false);
        }
      }
    };

    const scheduleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (cancelled) return;
        if (!started) {
          void startReader();
          return;
        }
        if (!readyForResize || !rendition || !layoutReady(host)) return;
        const next = hostSize(host);
        const prev = lastSizeRef.current;
        if (
          Math.abs(next.width - prev.width) < 2 &&
          Math.abs(next.height - prev.height) < 2
        ) {
          return;
        }
        lastSizeRef.current = next;
        try {
          rendition.resize(next.width, next.height);
        } catch {
          /* ignore */
        }
      }, 80);
    };

    const observer = new ResizeObserver(() => {
      scheduleResize();
    });
    observer.observe(host);
    if (root) observer.observe(root);

    // Side panel opens with width animation — poll briefly until layout is ready.
    void startReader();
    const readyPoll = window.setInterval(() => {
      if (cancelled || started) {
        window.clearInterval(readyPoll);
        return;
      }
      void startReader();
    }, 50);
    window.setTimeout(() => window.clearInterval(readyPoll), 2500);

    return () => {
      cancelled = true;
      window.clearInterval(readyPoll);
      if (resizeTimer) clearTimeout(resizeTimer);
      observer.disconnect();
      destroyReader();
    };
  }, [fileId, url]);

  const applyFont = (size: string, family: string) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    fontSizeRef.current = size;
    fontFamilyRef.current = family;
    setFontSize(size);
    setFontFamily(family);
    rendition.themes.default({
      body: {
        'font-family': fontFamilyCss(family),
        'line-height': '1.65',
        padding: '0.5rem 0.75rem !important',
      },
    });
    rendition.themes.fontSize(size);
    const loc = rendition.currentLocation() as
      | { start?: { cfi?: string } }
      | undefined;
    saveEpubReaderPrefs(fileId, {
      cfi: loc?.start?.cfi,
      fontSize: size,
      fontFamily: family,
    });
  };

  const goToc = (href: string) => {
    void renditionRef.current?.display(href);
    setTocOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'flex h-full min-h-[28rem] w-full min-w-0 flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950',
        className,
      )}
    >
      <div className="relative flex shrink-0 items-center gap-1 border-b border-stone-200 px-2 py-1.5 dark:border-stone-800">
        <button
          type="button"
          title="Table of contents"
          onClick={() => {
            setTocOpen((v) => !v);
            setFontOpen(false);
          }}
          className={cn(
            'rounded-md p-1.5 text-stone-500 hover:bg-stone-200/80 dark:hover:bg-stone-800',
            tocOpen && 'bg-stone-200/80 text-stone-800 dark:bg-stone-800 dark:text-stone-100',
          )}
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Font"
          onClick={() => {
            setFontOpen((v) => !v);
            setTocOpen(false);
          }}
          className={cn(
            'rounded-md p-1.5 text-stone-500 hover:bg-stone-200/80 dark:hover:bg-stone-800',
            fontOpen && 'bg-stone-200/80 text-stone-800 dark:bg-stone-800 dark:text-stone-100',
          )}
        >
          <Type className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 truncate px-1 text-center text-[11px] text-stone-400">
          {title || 'EPUB'}
        </div>

        {tocOpen && (
          <div className="absolute left-2 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
            {toc.length === 0 ? (
              <div className="px-3 py-2 text-xs text-stone-400">No table of contents</div>
            ) : (
              toc.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => goToc(entry.href)}
                  className="block w-full truncate px-3 py-1.5 text-left text-xs text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
                >
                  {entry.label}
                </button>
              ))
            )}
          </div>
        )}

        {fontOpen && (
          <div className="absolute left-10 top-full z-20 mt-1 w-52 rounded-lg border border-stone-200 bg-white p-2 shadow-lg dark:border-stone-700 dark:bg-stone-900">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Size
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              {EPUB_FONT_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => applyFont(size, fontFamily)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11px] text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                    fontSize === size &&
                      'bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-white',
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Font
            </div>
            <div className="flex flex-wrap gap-1">
              {EPUB_FONT_FAMILIES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => applyFont(fontSize, f.id)}
                  className={cn(
                    'rounded px-2 py-0.5 text-[11px] text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                    fontFamily === f.id &&
                      'bg-stone-200 font-medium text-stone-900 dark:bg-stone-700 dark:text-white',
                  )}
                  style={{ fontFamily: f.css }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="relative min-h-0 min-w-0 flex-1">
        <div ref={hostRef} className="absolute inset-0 overflow-hidden bg-white dark:bg-stone-950" />
        {loading && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-white/80 text-xs text-stone-400 dark:bg-stone-950/80">
            <Loader2 className="h-5 w-5 animate-spin opacity-60" />
            <span>Loading EPUB…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-stone-50 px-4 text-center text-xs text-stone-500 dark:bg-stone-950 dark:text-stone-400">
            <BookOpen className="h-8 w-8 opacity-40" />
            <span className="max-w-sm leading-relaxed">{error}</span>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              Download / open in new tab
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
