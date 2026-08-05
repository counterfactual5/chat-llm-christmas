'use client';

import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { EpubReader } from '@/components/files/EpubReader';
import { fetchFileContentForPreview } from '@/lib/files/direct-content';
import { isEpubBytes, isPdfBytes } from '@/lib/files/serve-headers';
import { cn } from '@/lib/utils';
import './pdf-reader.css';

export type PdfReaderProps = {
  /** Same-origin /api/files/... URL (cookies included). */
  url: string;
  title?: string;
  fileId?: string;
  className?: string;
};

const MAX_PAGES = 120;
const WIDTH_PAD = 16;
const WIDTH_RESIZE_THRESHOLD = 4;

function describeNonPdf(buf: ArrayBuffer, contentType: string): string {
  const ct = String(contentType || '').split(';')[0].trim() || 'unknown type';
  if (isEpubBytes(buf) || ct === 'application/epub+zip') {
    return 'This file is an EPUB, not a PDF. Re-download or rename to .epub to preview.';
  }
  const head = new Uint8Array(buf.slice(0, 8));
  const hex = [...head].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  return `Response is not a PDF (${ct || 'no content-type'}; first bytes: ${hex || 'empty'})`;
}

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

function PdfPage({
  doc,
  pageNumber,
  containerWidth,
  scrollRoot,
}: {
  doc: PdfDoc;
  pageNumber: number;
  containerWidth: number;
  scrollRoot: RefObject<HTMLElement | null>;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [pageHeight, setPageHeight] = useState(Math.round(containerWidth * 1.414));

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const root = scrollRoot.current;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { root: root || null, rootMargin: '240px 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRoot, pageNumber]);

  useEffect(() => {
    if (!visible || !(containerWidth > 40)) return;
    let cancelled = false;
    let textLayer: { cancel: () => void } | null = null;
    let renderTask: { cancel: () => void } | null = null;

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = containerWidth / base.width;
        const viewport = page.getViewport({ scale });
        setPageHeight(Math.ceil(viewport.height));

        const canvas = canvasRef.current;
        const textEl = textRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !textEl || !wrap) return;

        const outputScale = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const transform =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        const task = page.render({
          canvasContext: ctx,
          canvas,
          viewport,
          transform,
        });
        renderTask = task;
        await task.promise;
        if (cancelled) return;

        // Match pdf.js viewer: TextLayer layout is driven by --total-scale-factor.
        wrap.style.setProperty('--scale-factor', String(viewport.scale));
        wrap.style.setProperty('--user-unit', '1');
        wrap.style.width = `${Math.floor(viewport.width)}px`;
        wrap.style.height = `${Math.floor(viewport.height)}px`;

        textEl.replaceChildren();
        const pdfjs = await import('pdfjs-dist');
        pdfjs.setLayerDimensions(textEl, viewport);
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const layer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textEl,
          viewport,
        });
        textLayer = layer;
        await layer.render();
      } catch (err) {
        if (cancelled) return;
        // Keep canvas blank; selection simply unavailable for this page.
        console.warn(
          '[PdfReader] page render failed',
          pageNumber,
          err instanceof Error ? err.message : err,
        );
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* ignore */
      }
      try {
        textLayer?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [visible, doc, pageNumber, containerWidth]);

  return (
    <div
      ref={wrapRef}
      className="pdf-reader-page relative mx-auto bg-white shadow-sm dark:bg-stone-100"
      style={{
        width: Math.max(1, Math.floor(containerWidth)),
        minHeight: pageHeight,
      }}
      data-page={pageNumber}
    >
      <canvas ref={canvasRef} className="block max-w-full" />
      <div ref={textRef} className="textLayer" />
    </div>
  );
}

/**
 * pdf.js preview with a selectable text layer so chat Quote works
 * (browser PDF iframe selection is invisible to the parent document).
 */
export function PdfReader({ url, title, fileId, className }: PdfReaderProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [asEpub, setAsEpub] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [docVersion, setDocVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;

    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setError('');
      setAsEpub(false);
      setPageCount(0);
      setDoc(null);
      try {
        const { buf, contentType: ct } = await fetchFileContentForPreview(url);
        if (cancelled) return;
        if (ct === 'application/epub+zip' || isEpubBytes(buf)) {
          setAsEpub(true);
          setLoading(false);
          return;
        }
        if (!(ct === 'application/pdf' || isPdfBytes(buf))) {
          throw new Error(describeNonPdf(buf, ct));
        }

        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        // Copy — getDocument may transfer the buffer to the worker.
        const data = new Uint8Array(buf.slice(0));
        loaded = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          void loaded.cleanup();
          return;
        }
        setDoc(loaded);
        setPageCount(loaded.numPages);
        setDocVersion((v) => v + 1);
        setLoading(false);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Failed to load PDF');
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      if (loaded) void loaded.cleanup();
    };
  }, [url]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const next = Math.max(0, Math.floor(el.clientWidth - WIDTH_PAD));
      setContainerWidth((prev) =>
        Math.abs(prev - next) >= WIDTH_RESIZE_THRESHOLD ? next : prev,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [asEpub]);

  if (asEpub) {
    return (
      <EpubReader
        fileId={fileId || url}
        url={url}
        title={title}
        className={cn('h-full min-h-0 rounded-none border-0', className)}
      />
    );
  }

  const pages = Math.min(pageCount, MAX_PAGES);
  const ready = Boolean(doc) && !loading && !error && containerWidth > 40;

  return (
    <div
      className={cn(
        'relative h-full min-h-0 w-full bg-stone-100 dark:bg-stone-900',
        className,
      )}
      data-quote-file-id={fileId || undefined}
      data-quote-file-name={title || undefined}
      data-pdf-file-id={fileId || undefined}
      data-pdf-file-name={title || undefined}
    >
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain"
        aria-label={title || 'PDF preview'}
      >
        {ready && doc ? (
          <div className="flex flex-col items-center gap-3 px-2 py-3">
            {Array.from({ length: pages }, (_, i) => (
              <PdfPage
                key={`${docVersion}-${i + 1}`}
                doc={doc}
                pageNumber={i + 1}
                containerWidth={containerWidth}
                scrollRoot={scrollRef}
              />
            ))}
            {pageCount > MAX_PAGES ? (
              <p className="pb-2 text-[11px] text-stone-400">
                Showing first {MAX_PAGES} of {pageCount} pages
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-stone-100 px-4 text-center text-xs text-stone-500 dark:bg-stone-900 dark:text-stone-400">
          <FileText className="h-8 w-8 opacity-40" />
          <span className="max-w-sm leading-relaxed">{error}</span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Download / open in new tab
          </a>
        </div>
      ) : !ready ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-stone-100/80 text-xs text-stone-400 dark:bg-stone-900/80">
          <Loader2 className="h-5 w-5 animate-spin opacity-60" />
          <span>Loading PDF…</span>
        </div>
      ) : null}
    </div>
  );
}
