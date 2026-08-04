/**
 * Shared open/close XML-ish tag stream buffer for think markup and fake tool_call
 * stripping. Callers supply the tag regexes and what to do with inside vs outside text.
 */

export type StreamTagSegment = { kind: 'outside' | 'inside'; text: string };

export type StreamTagBatch = {
  segments: StreamTagSegment[];
  /** True when a close tag was consumed while not inside an open tag. */
  orphanClose: boolean;
};

export type StreamTagHoldFn = (buffer: string) => number;

/**
 * Hold an unfinished `<…` / `</…` at the end of a chunk so the next chunk can
 * complete the tag. `isPartialName` decides whether the name after `<` / `</`
 * could still become a known tag.
 */
export function incompleteTagHold(
  text: string,
  isPartialName: (partial: string) => boolean,
): number {
  const lastLt = text.lastIndexOf('<');
  if (lastLt < 0) return -1;
  const tail = text.slice(lastLt);
  if (/>/.test(tail)) return -1;
  const m = tail.match(/^<\/?([a-z_]*)/i);
  if (!m) return -1;
  const partial = m[1].toLowerCase();
  if (!partial) return lastLt;
  if (isPartialName(partial)) return lastLt;
  return -1;
}

export type OpenCloseStreamParser = {
  push: (chunk: string) => StreamTagBatch;
  flush: () => StreamTagBatch;
  readonly inside: boolean;
};

/**
 * Stateful splitter: text outside tags → `outside`, text between open and close → `inside`.
 * Incomplete tags at chunk boundaries are held until the next push or flush.
 */
export function createOpenCloseStreamParser(opts: {
  openRe: RegExp;
  closeRe: RegExp;
  hold: StreamTagHoldFn;
  /**
   * When a close tag appears before any open (orphan close), emit the preceding
   * text as `inside` instead. Used by `<think>` streams.
   */
  orphanCloseAsInside?: boolean;
}): OpenCloseStreamParser {
  let buffer = '';
  let inside = false;

  const consume = (final: boolean): StreamTagBatch => {
    const segments: StreamTagSegment[] = [];
    let orphanClose = false;
    const emit = (kind: StreamTagSegment['kind'], text: string) => {
      if (text) segments.push({ kind, text });
    };

    while (buffer.length > 0) {
      if (!inside) {
        const openMatch = buffer.match(opts.openRe);
        const closeMatch = opts.orphanCloseAsInside ? buffer.match(opts.closeRe) : null;
        const openIdx = openMatch?.index ?? -1;
        const closeIdx = closeMatch?.index ?? -1;

        if (
          opts.orphanCloseAsInside &&
          closeMatch &&
          closeIdx >= 0 &&
          (openIdx < 0 || closeIdx < openIdx)
        ) {
          emit('inside', buffer.slice(0, closeIdx));
          buffer = buffer.slice(closeIdx + closeMatch[0].length);
          orphanClose = true;
          continue;
        }

        if (!openMatch || openIdx < 0) {
          if (!final) {
            const holdAt = opts.hold(buffer);
            if (holdAt >= 0) {
              emit('outside', buffer.slice(0, holdAt));
              buffer = buffer.slice(holdAt);
              break;
            }
          }
          emit('outside', buffer);
          buffer = '';
          break;
        }
        emit('outside', buffer.slice(0, openIdx));
        buffer = buffer.slice(openIdx + openMatch[0].length);
        inside = true;
      } else {
        const closeMatch = buffer.match(opts.closeRe);
        if (!closeMatch || closeMatch.index == null) {
          if (!final) {
            const holdAt = opts.hold(buffer);
            if (holdAt >= 0) {
              emit('inside', buffer.slice(0, holdAt));
              buffer = buffer.slice(holdAt);
              break;
            }
          }
          emit('inside', buffer);
          buffer = '';
          break;
        }
        emit('inside', buffer.slice(0, closeMatch.index));
        buffer = buffer.slice(closeMatch.index + closeMatch[0].length);
        inside = false;
      }
    }

    return { segments, orphanClose };
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      return consume(false);
    },
    flush() {
      return consume(true);
    },
    get inside() {
      return inside;
    },
  };
}
