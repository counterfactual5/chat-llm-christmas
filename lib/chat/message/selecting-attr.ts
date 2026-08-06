/**
 * Whether the messages root should expose `data-selecting` so CSS can disable
 * interactive chrome (links, slash buttons, copy, table scroll) during a
 * text-selection gesture without blocking the Quote chip (outside this root).
 */
export function shouldMarkMessagesSelecting(
  pointerDownInRoot: boolean,
  selectionActiveInRoot: boolean,
): boolean {
  return pointerDownInRoot || selectionActiveInRoot;
}
