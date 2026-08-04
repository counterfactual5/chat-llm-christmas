'use client';

import { useEffect, useRef, useState } from 'react';
import ePub, { type Book, type NavItem, type Rendition } from 'epubjs';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
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

export function EpubReader({ fileId, url, title, className }: EpubReaderProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontSizeRef = useRef(EPUB_DEFAULT_FONT_SIZE);
  const fontFamilyRef = useRef(EPUB_DEFAULT_FONT_FAMILY);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const [fontSize, setFontSize] = useState(EPUB_DEFAULT_FONT_SIZE);
  const [fontFamily, setFontFamily] = useState(EPUB_DEFAULT_FONT_FAMILY);
  const [locationLabel, setLocationLabel] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !url || !fileId) return;

    let cancelled = false;
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
    setLocationLabel('');

    const book = ePub(url);
    bookRef.current = book;

    // Continuous vertical scroll (chat-like), not left/right page flips.
    const rendition = book.renderTo(host, {
      width: '100%',
      height: '100%',
      flow: 'scrolled',
      manager: 'continuous',
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    const applyTheme = (size: string, family: string) => {
      rendition.themes.default({
        body: {
          'font-family': fontFamilyCss(family),
          'line-height': '1.65',
          padding: '0.5rem 0.75rem !important',
        },
      });
      rendition.themes.fontSize(size);
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

    rendition.on('relocated', (location: {
      start?: { cfi?: string; displayed?: { page?: number; total?: number } };
      atEnd?: boolean;
    }) => {
      const cfi = location?.start?.cfi;
      // Paginated mode exposes page/total; scrolled continuous usually does not —
      // keep the label empty and let the filename sit in the toolbar instead.
      const page = location?.start?.displayed?.page;
      const total = location?.start?.displayed?.total;
      if (typeof page === 'number' && typeof total === 'number' && total > 0) {
        setLocationLabel(`${page} / ${total}`);
      } else {
        setLocationLabel('');
      }
      if (cfi) persist(cfi);
    });

    void (async () => {
      try {
        await book.ready;
        if (cancelled) return;
        applyTheme(initialSize, initialFamily);

        const nav = await book.loaded.navigation;
        if (!cancelled) setToc(flattenToc(nav?.toc));

        if (prefs?.cfi) {
          await rendition.display(prefs.cfi);
        } else {
          await rendition.display();
        }
        if (!cancelled) setLoading(false);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Failed to open EPUB');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try {
        rendition.destroy();
      } catch {
        /* ignore */
      }
      try {
        book.destroy();
      } catch {
        /* ignore */
      }
      renditionRef.current = null;
      bookRef.current = null;
      host.innerHTML = '';
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

  const goPrev = () => {
    void renditionRef.current?.prev();
  };
  const goNext = () => {
    void renditionRef.current?.next();
  };

  const goToc = (href: string) => {
    void renditionRef.current?.display(href);
    setTocOpen(false);
  };

  return (
    <div
      className={cn(
        'flex h-[min(80vh,900px)] min-h-[28rem] w-full flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-950',
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
          {locationLabel || title || 'EPUB'}
        </div>
        <button
          type="button"
          title="Previous chapter"
          onClick={goPrev}
          className="rounded-md p-1.5 text-stone-500 hover:bg-stone-200/80 dark:hover:bg-stone-800"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Next chapter"
          onClick={goNext}
          className="rounded-md p-1.5 text-stone-500 hover:bg-stone-200/80 dark:hover:bg-stone-800"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

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

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0 bg-white dark:bg-stone-950" />
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
