'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useTheme } from '@/components/theme/ThemeProvider';
import { cn } from '@/lib/utils';
import { sanitizeMermaidForRender } from '@/lib/markdown/core/mermaid';

/** Mermaid pins the root svg to its intrinsic width; let the container drive size. */
function fluidSvg(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag
      .replace(/max-width:\s*[\d.]+px/gi, 'max-width:100%')
      .replace(/\sheight="[\d.]+(?:px)?"/i, ' height="auto"'),
  );
}

/** mermaid.render()/parse() can leave temp or error nodes attached to <body>. */
function removeStrayMermaidNodes(id: string): void {
  for (const el of [document.getElementById(id), document.getElementById(`d${id}`)]) {
    el?.remove();
  }
}

type MermaidBlockProps = {
  value: string;
  className?: string;
  /** When true, parse failures are treated as incomplete stream (softer copy). */
  streaming?: boolean;
};

/**
 * Renders a ```mermaid fenced block as an SVG diagram.
 * Falls back to the source text when the diagram is incomplete (streaming)
 * or fails to parse.
 */
export function MermaidBlock({ value, className, streaming = false }: MermaidBlockProps) {
  const { theme } = useTheme();
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [fit, setFit] = useState(true);

  const rawSource = String(value || '').trim();
  const source = sanitizeMermaidForRender(rawSource);

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      // Clear state asynchronously to satisfy react-hooks linting and avoid
      // synchronous cascading renders while the input is changing.
      queueMicrotask(() => {
        if (cancelled) return;
        setSvg('');
        setError(null);
        setPending(false);
      });
      return;
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setPending(true);
      setError(null);
    });

    const timer = window.setTimeout(() => {
      void (async () => {
        const id = `mermaid-${reactId}-${Math.random().toString(36).slice(2, 9)}`;
        try {
          const mermaid = (await import('mermaid')).default;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: theme === 'dark' ? 'dark' : 'neutral',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          });
          // Validate first: mermaid.render() injects a visible error graphic into
          // the document when parsing fails, which piles up while streaming.
          const parsed = await mermaid.parse(source, { suppressErrors: true });
          if (cancelled) return;
          if (!parsed) {
            setError('Invalid mermaid syntax');
            return;
          }
          const { svg: rendered } = await mermaid.render(id, source);
          if (cancelled) return;
          setSvg(fluidSvg(rendered));
          setError(null);
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
        } finally {
          removeStrayMermaidNodes(id);
          if (!cancelled) setPending(false);
        }
      })();
    }, streaming ? 400 : 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, theme, reactId, streaming]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(rawSource || source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const showFallback = (Boolean(error) || !pending) && !svg;
  const fallbackHint = streaming
    ? 'Diagram not ready yet (incomplete or invalid while streaming).'
    : 'Could not render this diagram — showing source. Check Mermaid syntax.';

  return (
    <div
      className={cn(
        'group relative my-4 overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900/80',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-100/80 px-4 py-2 dark:border-stone-700 dark:bg-stone-800">
        <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
          mermaid
          {pending ? ' · rendering…' : error ? ' · source' : ''}
        </span>
        <div className="flex items-center gap-1">
          {svg && !showSource ? (
            <button
              type="button"
              onClick={() => setFit((v) => !v)}
              className="rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-200/80 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            >
              {fit ? 'Actual size' : 'Fit'}
            </button>
          ) : null}
          {svg ? (
            <button
              type="button"
              onClick={() => setShowSource((v) => !v)}
              className="rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-200/80 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            >
              {showSource ? 'Diagram' : 'Source'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-200/80 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            aria-label="Copy mermaid source"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {pending && !svg ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-stone-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Rendering diagram…
        </div>
      ) : null}

      {svg && !showSource ? (
        <div
          className={cn(
            'overflow-auto px-3 py-4 [&_svg]:h-auto',
            fit
              ? 'max-h-[60vh] [&_svg]:max-h-[56vh] [&_svg]:mx-auto [&_svg]:max-w-full'
              : 'max-h-none [&_svg]:max-h-none [&_svg]:mx-0 [&_svg]:max-w-none',
          )}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}

      {(showFallback || showSource) && (rawSource || source) ? (
        <pre className="overflow-x-auto border-t border-stone-200/70 p-4 text-sm leading-relaxed text-stone-700 dark:border-stone-800 dark:text-stone-200">
          <code className="font-mono whitespace-pre">{rawSource || source}</code>
        </pre>
      ) : null}

      {error && !svg ? (
        <p className="border-t border-stone-200/70 px-4 py-2 text-[11px] text-stone-400 dark:border-stone-800">
          {fallbackHint}
        </p>
      ) : null}
    </div>
  );
}

export function isMermaidLanguage(language: string): boolean {
  return language.trim().toLowerCase() === 'mermaid';
}
