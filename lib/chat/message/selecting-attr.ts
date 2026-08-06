/**
 * Whether the messages root should expose `data-selecting` so CSS can disable
 * interactive chrome (links, slash buttons, copy, table scroll) during a
 * text-selection gesture without blocking the Quote chip (outside this root).
 *
 * Require both pointer-down AND a live selection. Marking on pointer-down alone
 * sets `pointer-events: none` on links before click completes, so ordinary
 * link / edit clicks never fire.
 */
export function shouldMarkMessagesSelecting(
  pointerDownInRoot: boolean,
  selectionActiveInRoot: boolean,
): boolean {
  return pointerDownInRoot && selectionActiveInRoot;
}
