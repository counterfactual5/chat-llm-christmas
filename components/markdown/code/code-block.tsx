'use client';

import { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { Check, Copy } from 'lucide-react';
import { looksLikeAsciiArt } from '@/lib/markdown/core/ascii-art';
import { cn } from '@/lib/utils';
import { AsciiArtPre } from '@/components/markdown/code/ascii-art-pre';
import { MermaidBlock, isMermaidLanguage } from '@/components/markdown/diagrams/mermaid-block';

interface CodeBlockProps {
  language: string;
  value: string;
  /** Soft-wrap long lines (Preview panels). Default keeps horizontal scroll. */
  wrap?: boolean;
  /** Forwarded to Mermaid so fallback copy distinguishes stream vs final parse errors. */
  streaming?: boolean;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  plaintext: 'plaintext',
  text: 'plaintext',
};

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveLanguage(language: string) {
  const raw = language.trim().toLowerCase();
  if (!raw) return '';
  return LANGUAGE_ALIASES[raw] ?? raw;
}

function highlightCode(value: string, language: string) {
  try {
    const lang = resolveLanguage(language);
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(value, { language: lang }).value;
    }
    return hljs.highlightAuto(value).value;
  } catch {
    return escapeHtml(value);
  }
}

export function CodeBlock({ language, value, wrap = false, streaming = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  // Box-drawing / trees: no soft-wrap, no hljs spans (both shred alignment).
  // CJK in system mono is ~1.66×ASCII — AsciiArtPre forces a 1ch/2ch grid.
  const asciiArt = looksLikeAsciiArt(value);
  const lang = resolveLanguage(language);
  // Plain `text` fences often hold prose the model wrapped by mistake — allow
  // soft-wrap unless this block is real ASCII art (which must stay pre).
  const plainTextFence = !lang || lang === 'plaintext';
  const softWrap = !asciiArt && (wrap || plainTextFence);
  const highlighted = useMemo(
    () => (asciiArt ? '' : highlightCode(value, language)),
    [value, language, asciiArt],
  );

  if (isMermaidLanguage(language)) {
    return <MermaidBlock value={value} streaming={streaming} />;
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="group relative my-4 max-w-full min-w-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/80">
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-100/80 px-4 py-2 dark:border-stone-700 dark:bg-stone-800">
        <span className="truncate text-xs font-medium text-stone-500 dark:text-stone-400">{language}</span>
        <button
          onClick={copyToClipboard}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-stone-500 transition-colors hover:bg-stone-200/80 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
          aria-label="Copy code"
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
      {asciiArt ? (
        <AsciiArtPre value={value} className="p-4 text-sm text-stone-800 dark:text-stone-200" />
      ) : (
        <pre
          className={cn(
            'max-w-full p-4 text-sm leading-relaxed',
            softWrap ? 'overflow-x-hidden' : 'overflow-x-auto',
          )}
        >
          <code
            className={cn(
              'hljs font-mono',
              softWrap
                ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]'
                : 'whitespace-pre [overflow-wrap:normal]',
              `language-${language}`,
            )}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      )}
    </div>
  );
}
