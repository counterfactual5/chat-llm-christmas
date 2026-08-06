/**
 * @deprecated Removed from the click path. PR #36 used this to gate
 * `data-selecting` + `pointer-events: none` on message links/buttons, which
 * blocked ordinary clicks (mousedown often creates a selection). Kept as a
 * pure helper for tests / possible future drag-threshold chrome disabling.
 *
 * Prefer: do not disable pointer-events on interactive chrome during selection.
 */
export function shouldMarkMessagesSelecting(
  pointerDownInRoot: boolean,
  selectionActiveInRoot: boolean,
): boolean {
  return pointerDownInRoot && selectionActiveInRoot;
}
