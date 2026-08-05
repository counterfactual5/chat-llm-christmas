/** Fixed right-rail widths (px) — Preview can absorb Context when Context is closed. */
export const CONTEXT_PANEL_WIDTH = 280;
export const PREVIEW_PANEL_BASE_WIDTH = 460;

/** Preview / ToolView width: base, or base+context when Context is closed. */
export function previewPanelWidth(contextOpen: boolean): number {
  return contextOpen
    ? PREVIEW_PANEL_BASE_WIDTH
    : PREVIEW_PANEL_BASE_WIDTH + CONTEXT_PANEL_WIDTH;
}
