/**
 * Quote selection root membership — shared by ChatQuoteToolbar and tests.
 */
export function selectionInsideRoot(
  root: { contains: (node: Node) => boolean } | null | undefined,
  anchor: Node | null,
  focus: Node | null,
): boolean {
  if (!root || !anchor || !focus) return false;
  return root.contains(anchor) && root.contains(focus);
}

/**
 * True when the window selection is non-collapsed and fully inside `root`.
 * Used to pause stick-to-bottom scrolling while the user is selecting text
 * (macOS three-finger drag keeps the pointer fixed while content would otherwise scroll under it).
 */
export function selectionActiveInRoot(
  root: { contains: (node: Node) => boolean } | null | undefined,
): boolean {
  if (!root || typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return false;
  }
  try {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    return selectionInsideRoot(root, sel.anchorNode, sel.focusNode);
  } catch {
    return false;
  }
}
