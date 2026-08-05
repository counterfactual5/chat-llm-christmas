import { describe, expect, it } from 'vitest';
import {
  CONTEXT_PANEL_WIDTH,
  PREVIEW_PANEL_BASE_WIDTH,
  previewPanelWidth,
} from '@/components/chat/panels/panel-widths';

describe('previewPanelWidth', () => {
  it('uses base width when Context is open', () => {
    expect(previewPanelWidth(true)).toBe(PREVIEW_PANEL_BASE_WIDTH);
  });

  it('absorbs Context width when Context is closed', () => {
    expect(previewPanelWidth(false)).toBe(
      PREVIEW_PANEL_BASE_WIDTH + CONTEXT_PANEL_WIDTH,
    );
  });
});
