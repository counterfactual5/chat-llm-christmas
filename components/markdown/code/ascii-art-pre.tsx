'use client';

import { eastAsianCharColumns } from '@/lib/markdown/core/east-asian-columns';
import { cn } from '@/lib/utils';

/**
 * Render ASCII / Unicode diagrams on a fixed East-Asian terminal grid.
 *
 * System mono (Menlo/Consolas) falls back to proportional CJK glyphs at
 * ~1.66×ASCII — not 2× — so box borders staircase even when the source is
 * correctly padded. Putting each scalar in a 1ch/2ch cell restores the grid
 * the model intended, independent of the fallback font metrics.
 */
export function AsciiArtPre({
  value,
  className,
  codeClassName,
}: {
  value: string;
  className?: string;
  codeClassName?: string;
}) {
  const lines = String(value ?? '').split('\n');

  return (
    <pre
      className={cn(
        'ascii-art-pre max-w-full min-w-0 overflow-x-auto whitespace-pre leading-none [overflow-wrap:normal]',
        className,
      )}
    >
      <code
        className={cn(
          'font-mono leading-none [font-kerning:none] [font-variant-ligatures:none]',
          codeClassName,
        )}
      >
        {lines.map((line, lineIdx) => (
          <span key={lineIdx} className="block whitespace-pre leading-none">
            {[...line].map((ch, charIdx) => {
              const cols = eastAsianCharColumns(ch);
              return (
                <span
                  key={charIdx}
                  className="inline-block overflow-hidden text-center align-top leading-none"
                  style={{ width: `${cols}ch` }}
                >
                  {ch === ' ' ? '\u00a0' : ch}
                </span>
              );
            })}
          </span>
        ))}
      </code>
    </pre>
  );
}
