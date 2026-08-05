/**
 * pdf.js TextLayer alone does not install selection helpers — those live on
 * TextLayerBuilder in pdf_viewer. Without endOfContent + .selecting, Chrome
 * selection across absolute glyph spans often jumps many lines below the drag.
 *
 * Mirrors the essential mouse / selectionchange behavior from pdfjs-dist's
 * TextLayerBuilder (web/pdf_viewer.mjs).
 */

type LayerEntry = { end: HTMLDivElement };

const textLayers = new Map<HTMLElement, LayerEntry>();
let selectionChangeAC: AbortController | null = null;

function resetLayer(textLayer: HTMLElement, end: HTMLDivElement) {
  if (end.parentNode !== textLayer) {
    textLayer.append(end);
  }
  end.style.width = '';
  end.style.height = '';
  end.style.userSelect = '';
  textLayer.classList.remove('selecting');
}

function enableGlobalSelectionListener() {
  if (selectionChangeAC) return;
  selectionChangeAC = new AbortController();
  const { signal } = selectionChangeAC;

  let isPointerDown = false;
  let isFirefox: boolean | undefined;
  let prevRange: Range | null = null;

  const resetAll = () => {
    for (const [layer, { end }] of textLayers) {
      resetLayer(layer, end);
    }
  };

  document.addEventListener(
    'pointerdown',
    () => {
      isPointerDown = true;
    },
    { signal },
  );
  document.addEventListener(
    'pointerup',
    () => {
      isPointerDown = false;
      resetAll();
    },
    { signal },
  );
  window.addEventListener(
    'blur',
    () => {
      isPointerDown = false;
      resetAll();
    },
    { signal },
  );
  document.addEventListener(
    'keyup',
    () => {
      if (!isPointerDown) resetAll();
    },
    { signal },
  );

  document.addEventListener(
    'selectionchange',
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        resetAll();
        return;
      }

      const active = new Set<HTMLElement>();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        for (const layer of textLayers.keys()) {
          if (!active.has(layer) && range.intersectsNode(layer)) {
            active.add(layer);
          }
        }
      }

      for (const [layer, { end }] of textLayers) {
        if (active.has(layer)) {
          layer.classList.add('selecting');
        } else {
          resetLayer(layer, end);
        }
      }

      // Firefox uses a different selection model; Chrome needs endOfContent
      // repositioned next to the active glyph (pdf.js TextLayerBuilder).
      const sampleEnd = textLayers.values().next().value?.end;
      if (sampleEnd) {
        isFirefox ??=
          getComputedStyle(sampleEnd).getPropertyValue('-moz-user-select') ===
          'none';
      }
      if (isFirefox) return;

      const range = selection.getRangeAt(0);
      const modifyStart =
        Boolean(prevRange) &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange!) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange!) === 0);

      let anchor: Node | null = modifyStart
        ? range.startContainer
        : range.endContainer;
      if (anchor?.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode;
      }
      if (
        anchor instanceof HTMLElement &&
        anchor.classList.contains('highlight')
      ) {
        anchor = anchor.parentNode;
      }
      if (!modifyStart && range.endOffset === 0 && anchor) {
        do {
          while (anchor && !anchor.previousSibling) {
            anchor = anchor.parentNode;
          }
          anchor = anchor?.previousSibling ?? null;
        } while (anchor && !anchor.childNodes.length);
      }
      if (!(anchor instanceof Node)) return;

      const parentEl =
        anchor instanceof Element ? anchor : anchor.parentElement;
      const parentTextLayer = parentEl?.closest?.(
        '.textLayer',
      ) as HTMLElement | null;
      const entry = parentTextLayer
        ? textLayers.get(parentTextLayer)
        : undefined;
      if (!parentTextLayer || !entry) return;

      const { end } = entry;
      end.style.width = parentTextLayer.style.width;
      end.style.height = parentTextLayer.style.height;
      end.style.userSelect = 'text';
      const insertBefore = modifyStart ? anchor : anchor.nextSibling;
      if (anchor.parentElement) {
        anchor.parentElement.insertBefore(end, insertBefore);
      }
      prevRange = range.cloneRange();
    },
    { signal },
  );
}

/**
 * Install endOfContent + selection listeners on a rendered `.textLayer`.
 * Returns a disposer that removes this layer from the global registry.
 */
export function bindPdfTextLayerSelection(textLayer: HTMLElement): () => void {
  textLayer.querySelectorAll('.endOfContent').forEach((n) => n.remove());
  const end = document.createElement('div');
  end.className = 'endOfContent';
  textLayer.append(end);

  const onMouseDown = () => {
    textLayer.classList.add('selecting');
  };
  textLayer.addEventListener('mousedown', onMouseDown);

  textLayers.set(textLayer, { end });
  enableGlobalSelectionListener();

  return () => {
    textLayer.removeEventListener('mousedown', onMouseDown);
    textLayers.delete(textLayer);
    resetLayer(textLayer, end);
    end.remove();
    if (textLayers.size === 0) {
      selectionChangeAC?.abort();
      selectionChangeAC = null;
    }
  };
}
