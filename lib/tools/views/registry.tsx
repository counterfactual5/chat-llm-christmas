'use client';

import type { ComponentType } from 'react';
import type { ToolViewPayload } from '@/lib/tools/views/types';
import { DocxExtractView } from '@/lib/tools/views/components/DocxExtractView';
import { DocxOutlineView } from '@/lib/tools/views/components/DocxOutlineView';
import { DocxCommentsView } from '@/lib/tools/views/components/DocxCommentsView';
import { XlsxTableView } from '@/lib/tools/views/components/XlsxTableView';
import { UnsupportedToolView } from '@/lib/tools/views/components/UnsupportedToolView';

export type ToolViewComponent = ComponentType<{ view: ToolViewPayload }>;

const REGISTRY: Record<string, ToolViewComponent> = {
  'docx.extract': DocxExtractView,
  'docx.outline': DocxOutlineView,
  'docx.comments': DocxCommentsView,
  'xlsx.table': XlsxTableView,
};

export function getToolViewComponent(viewType: string): ToolViewComponent {
  return REGISTRY[String(viewType || '').trim()] || UnsupportedToolView;
}

export function renderToolView(view: ToolViewPayload) {
  const Comp = getToolViewComponent(view.viewType);
  return <Comp view={view} />;
}
