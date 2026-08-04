/**
 * Browser-only KaTeX DOM helpers: recover TeX source from rendered KaTeX
 * markup so copy/selection produces math source instead of glyph soup.
 */

/** Recover TeX source from a KaTeX DOM node (annotation / MathML). */
export function texFromKatexElement(el: Element): string | null {
  const ann =
    el.querySelector('annotation[encoding="application/x-tex"]') ||
    el.querySelector('annotation');
  const tex = ann?.textContent?.trim();
  return tex || null;
}

function closestKatex(node: Node | null): Element | null {
  if (!node) return null;
  const el =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest('.katex') ?? null;
}

function isDisplayKatex(el: Element): boolean {
  return Boolean(el.closest('.katex-display'));
}

/**
 * Prefer KaTeX TeX annotations over glyph soup when the user selects a formula.
 * Falls back to plain selection text.
 */
export function markdownFromDomSelection(sel: Selection | null): string {
  if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
  const plain = sel.toString().replace(/\u00a0/g, ' ').trim();

  const startKatex = closestKatex(sel.anchorNode);
  const endKatex = closestKatex(sel.focusNode);
  if (startKatex && startKatex === endKatex) {
    const tex = texFromKatexElement(startKatex);
    if (tex) {
      return isDisplayKatex(startKatex) ? `$$\n${tex}\n$$` : `$${tex}$`;
    }
  }

  try {
    const range = sel.getRangeAt(0);
    const container = document.createElement('div');
    container.appendChild(range.cloneContents());

    const serialize = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node as Element;
      if (el.classList.contains('katex')) {
        const tex = texFromKatexElement(el);
        if (tex) {
          const display =
            el.classList.contains('katex-display') ||
            el.parentElement?.classList.contains('katex-display');
          return display ? `$$\n${tex}\n$$` : `$${tex}$`;
        }
        return '';
      }
      if (el.classList.contains('katex-mathml') || el.classList.contains('katex-html')) {
        return '';
      }
      if (el.tagName === 'BR') return '\n';
      let out = '';
      for (const child of Array.from(el.childNodes)) out += serialize(child);
      if (
        ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'TR', 'BLOCKQUOTE', 'PRE'].includes(
          el.tagName,
        ) &&
        out &&
        !out.endsWith('\n')
      ) {
        out += '\n';
      }
      return out;
    };

    const built = serialize(container).replace(/\n{3,}/g, '\n\n').trim();
    if (built) return built;
  } catch {
    // fall through
  }

  return plain;
}
