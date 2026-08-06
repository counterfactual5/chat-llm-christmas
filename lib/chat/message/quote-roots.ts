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
